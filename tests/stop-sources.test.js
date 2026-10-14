import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,LADDER_SAFE_STOPS} from '../src/worker.js';
import {Autopilot,RECOVER_MS} from '../src/autopilot.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {Task} from '../src/tasks/task.js';
// Round 3 soak: 'Autopilot stopped (Stop all)' fired on its own (normal2 twice, hard1, hard2),
// each time right before a death. Only the API's stop/cancel and an explicit disconnect may
// set userStopped; every internal stop path keeps the ladder running.
console.error=()=>{};
const src=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src');
function makeBot(){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:20,food:20,time:{timeOfDay:1000,day:1},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:new Vec3(0,-60,0)},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(){return null;},findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){}});
 return bot;
}
async function withWorker(fn,limits={}){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'stop-sources-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5,...limits}});
 const bot=makeBot();worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};
 try{await fn({worker,bot,root});}finally{fs.rmSync(root,{recursive:true,force:true});}
}
const running=worker=>{const job={id:'j1',spec:{type:'gather',block:'stone',count:4},status:'running',message:'Working'};worker.jobs.push(job);worker.busy=true;return job;};
// The ladder's own check: a tick right after the stop must not print Stop all.
const ladderSurvives=(worker,root)=>{
 const ap=new Autopilot(worker,root);ap.start();
 const logs=[];worker.log=m=>logs.push(m);
 try{ap.tick();}catch{} // the fake world is thin; only the Stop-all branch matters here
 assert.ok(!logs.some(l=>/Stop all/.test(l)),logs.join(' | '));
 assert.equal(ap.enabled,true);
};
test('a low-health stop pauses the job without pressing Stop all',async()=>{
 await withWorker(async({worker,bot,root})=>{
  const job=running(worker);
  bot.health=8;worker.onHealth(bot);
  assert.equal(job.status,'paused');assert.equal(job.message,'Health or food is low');
  assert.equal(worker.userStopped,false);
  ladderSurvives(worker,root);
 });
});
test('a death holds the ladder through deathResume, not userStopped',async()=>{
 await withWorker(async({worker,bot,root})=>{
  running(worker);
  worker.onDeath(bot);
  assert.equal(worker.userStopped,false);assert.equal(worker.deathResume,true);
  const ap=new Autopilot(worker,root);ap.start();worker.deathResume=true;ap.tick();
  assert.equal(ap.enabled,true);assert.match(ap.state,/paused: died/);
 });
});
test('a dropped connection is not the user pressing Stop',async()=>{
 await withWorker(async({worker,bot})=>{
  running(worker);
  worker.onEnd(bot);
  assert.equal(worker.userStopped,false);assert.equal(worker.ready,false);
 });
});
test('the job watchdog times out a job without pressing Stop all',async()=>{
 await withWorker(async({worker,root})=>{
  worker.jobs.push({id:'w1',spec:{type:'goto',position:{x:9,y:-60,z:0}},status:'queued',message:'Waiting'});
  const pumping=worker.pump();
  for(let i=0;i<40&&worker.jobs[0].status!=='paused';i++)await new Promise(r=>setTimeout(r,100));
  assert.equal(worker.jobs[0].status,'paused');assert.equal(worker.jobs[0].message,'Job time limit reached');
  assert.equal(worker.userStopped,false);
  ladderSurvives(worker,root);
  await pumping;await new Promise(r=>setTimeout(r,150)); // the pump's own re-pump and save
 },{jobMinutes:0.001});
});
test('a survival chain preempting a running job is a reflex stop',async()=>{
 await withWorker(async({worker})=>{
  running(worker);
  class Hold extends Task{constructor(){super('Hold');}isFinished(){return false;}}
  const chain={name:'Threat',priority:()=>50,started:false,onStartup(){this.started=true;},onTick:()=>new Hold(),onStopped(){}};
  const runner=new TaskRunner(worker,[chain]);
  runner.tick();
  assert.match(worker.jobs[0].message,/^Reflex: preempted by Threat/);
  assert.equal(worker.userStopped,false);
 });
});
test('the API stop/cancel and an explicit disconnect are the user\'s',async()=>{
 await withWorker(async({worker})=>{
  running(worker);worker.stop('Stopped by user','user');assert.equal(worker.userStopped,true);
 });
 await withWorker(async({worker})=>{
  running(worker);worker.cancel('j1','user');assert.equal(worker.userStopped,true);
 });
 await withWorker(async({worker,bot})=>{
  bot.quit=()=>{};worker.disconnect();assert.equal(worker.userStopped,true);
 });
 const app=fs.readFileSync(path.join(src,'app.js'),'utf8');
 assert.match(app,/\/api\/stop'\)\{worker\.stop\('Stopped by user','user'\)/);
 assert.match(app,/\/api\/cancel'\)\{worker\.cancel\(data\.id,'user'\)/);
});
test('every internal stop/cancel call names a ladder-safe source',()=>{
 // Scans src/ for worker stop/cancel calls: only app.js (the API) and Worker.disconnect may
 // be the user's; everything else must pass a source from LADDER_SAFE_STOPS.
 const files=[];const walk=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())walk(p);else if(p.endsWith('.js'))files.push(p);}};walk(src);
 const bad=[];
 for(const file of files){
  if(file.endsWith('app.js'))continue;
  fs.readFileSync(file,'utf8').split('\n').forEach((text,i)=>{
   for(const m of text.matchAll(/\b(?:this|w|worker|this\.worker)\.(stop|cancel)\(/g)){
    const rest=text.slice(m.index);
    if(m[1]==='stop'&&rest.startsWith(m[0]+')'))continue; // TaskRunner.stop()/autopilot.stop() take no message
    if(/^this\.stop\('Current job cancelled',source\)/.test(rest))continue; // Worker.cancel forwards its caller's source
    if(/^this\.stop\('Disconnected by user','user'\)/.test(rest))continue; // the user's own disconnect
    const source=(rest.match(/^.*?,'([a-z]+)'\)/)||[])[1];
    if(!source||!LADDER_SAFE_STOPS.has(source))bad.push(path.basename(file)+':'+(i+1)+' '+rest.slice(0,80));
   }
  });
 }
 assert.deepEqual(bad,[]);
});
test('after a low-health stop the ladder eats and waits for regen instead of failing steps',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'recover-'));
 try{
  const submitted=[];
  const worker={ready:true,userStopped:false,deathResume:false,jobs:[],config:{limits:{minHealth:10}},log(){},
   submit(spec){submitted.push(spec);const job={id:'r'+submitted.length,spec,status:'queued'};return job;}};
  worker.bot={health:7,food:15,time:{timeOfDay:1000,day:1},entities:{},entity:{position:new Vec3(0,64,0)},
   inventory:{items(){return [{name:'cooked_beef',count:3}];}},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},blockAt(){return null;}};
  const ap=new Autopilot(worker,root);ap.start();
  ap.tick();
  assert.deepEqual(submitted,[{type:'eat'}],'eat first: regen needs a food bar of 18');
  ap.settle({status:'complete'});ap.tick();
  assert.equal(submitted.length,1,'then it waits');assert.match(ap.state,/^recovering: health 7/);
  ap.lowSince=Date.now()-RECOVER_MS-1;
  try{ap.tick();}catch{}
  assert.ok(!/^recovering/.test(ap.state),'the wait is bounded: '+ap.state);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
