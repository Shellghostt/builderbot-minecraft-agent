import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {jobSchema,validateBlueprint} from '../src/schema.js';
import {Worker} from '../src/worker.js';
import {EventEmitter} from 'node:events';
import {installMovementFix,installWeatherFix} from '../src/compat.js';
test('each movement packet is followed by a client tick boundary',()=>{
 const b=new EventEmitter(),packets=[];b.registry={version:{'>=':()=>true}};b.entity={position:{x:1,y:64,z:2},yaw:Math.PI,pitch:0};b._client={state:'play',write:(name,data)=>packets.push({name,data})};installMovementFix(b);b.emit('login');b._client.write('position',{x:1,y:64,z:2});b._client.write('position_look',{x:1,y:64,z:2,yaw:0,pitch:0});assert.deepEqual(packets.map(p=>p.name),['position','tick_end','position_look','tick_end']);b._client.write('teleport_confirm',{teleportId:1});assert.equal(packets.at(-1).data.yRot,0);assert.equal(packets.at(-1).data.y,64);b.emit('end');
});
test('every distinct teleport id is confirmed even when teleports arrive back to back',()=>{
 // Paper never re-sends an unconfirmed teleport; a lost confirm leaves the server ignoring
 // moves and block interactions. Two ids inside 100 ms must both go out; duplicates must not.
 const b=new EventEmitter(),packets=[];b.registry={version:{'>=':()=>true}};b.entity={position:{x:1,y:64,z:2},yaw:0,pitch:0};b._client={state:'play',write:(name,data)=>packets.push({name,data})};installMovementFix(b);b.emit('login');
 b._client.write('teleport_confirm',{teleportId:7});b._client.write('teleport_confirm',{teleportId:8});b._client.write('teleport_confirm',{teleportId:8});b._client.write('teleport_confirm',{teleportId:9});
 assert.deepEqual(packets.filter(p=>p.name==='teleport_confirm').map(p=>p.data.teleportId),[7,8,9]);b.emit('end');
});
test('the client hitbox is padded off exact block edges (26.x snap-back fix)',()=>{
 const b=new EventEmitter();b.registry={version:{'>=':()=>true}};b.entity={position:{x:0,y:0,z:0},yaw:0,pitch:0};b._client={state:'play',write(){}};
 b.physics={playerHalfWidth:0.3,playerHeight:1.8};installMovementFix(b);
 assert.equal(b.physics.playerHalfWidth,0.30001);assert.equal(b.physics.playerHeight,1.80001);
 // a physics object that is already customised is left alone
 const c=new EventEmitter();c.registry=b.registry;c.entity=b.entity;c._client=b._client;c.physics={playerHalfWidth:0.25,playerHeight:1.8};installMovementFix(c);c.emit('login');
 assert.equal(c.physics.playerHalfWidth,0.25);
});
test('weather follows the rain/thunder levels, not the inverted begin/end flags',()=>{
 // Measured on Paper 26.3: event 'start_raining' arrives when the sky clears, so mineflayer's
 // flag can stay stuck at raining. Levels are re-sent on every join/respawn and are the truth.
 const b=new EventEmitter();b._client=new EventEmitter();b.isRaining=false;b.thunderState=0;installWeatherFix(b);
 assert.equal(b.isRaining,false);
 b.isRaining=true; // the plugin's flag is honoured until a level packet arrives
 assert.equal(b.isRaining,true);
 b._client.emit('game_state_change',{reason:'rain_level_change',gameMode:1});b._client.emit('game_state_change',{reason:'thunder_level_change',gameMode:1});
 assert.equal(b.isRaining,true);assert.ok(b.thunderState>0);
 b.isRaining=true; // `weather clear`: inverted flag says raining while the level fades out
 for(const v of [0.6,0.4,0.2,0.0000001])b._client.emit('game_state_change',{reason:'rain_level_change',gameMode:v});
 b._client.emit('game_state_change',{reason:'thunder_level_change',gameMode:0.00001});
 assert.equal(b.isRaining,false);assert.equal(b.thunderState,0);
 b._client.emit('game_state_change',{reason:7,gameMode:0.9}); // numeric reason ids work too
 assert.equal(b.isRaining,true);assert.deepEqual(b.weatherLevels(),{rain:0.9,thunder:0.00001});
});
test('rejects generated executable commands and escaping blueprint paths',()=>{
 for(const input of [{type:'execute',code:'process.exit()'},{type:'build',blueprint:'../config',origin:{x:0,y:0,z:0}},{type:'gather',block:'oak_log',count:10000},{type:'goto',position:{x:0,y:0,z:0},command:'exec'}])assert.equal(jobSchema.safeParse(input).success,false);
});
test('phase 2 job schemas accept valid jobs and reject out-of-range ones',()=>{
 assert.equal(jobSchema.safeParse({type:'explore',direction:'north',distance:32}).success,true);
 assert.equal(jobSchema.safeParse({type:'explore',distance:256}).success,true);
 assert.equal(jobSchema.safeParse({type:'explore',distance:64,direction:'east',surfaceCeiling:147}).success,true);
 assert.equal(jobSchema.safeParse({type:'place',block:'cobblestone',position:{x:2,y:-60,z:6}}).success,true);
 assert.equal(jobSchema.safeParse({type:'eat'}).success,true);
 assert.equal(jobSchema.safeParse({type:'equip'}).success,true);
 assert.equal(jobSchema.safeParse({type:'collect',radius:64}).success,true);
 assert.equal(jobSchema.safeParse({type:'gather',block:'oak_log',count:8,radius:64,searchIfMissing:true}).success,true);
 assert.equal(jobSchema.safeParse({type:'smelt',item:'raw_iron',count:3,fuel:'coal'}).success,true);
 assert.equal(jobSchema.safeParse({type:'sleep'}).success,true);
 assert.equal(jobSchema.safeParse({type:'sleep',position:{x:0,y:-60,z:0}}).success,true);
 // wood-step ladder flags: leave the placed table standing / collect it at the step's end
 assert.equal(jobSchema.safeParse({type:'craft',item:'wooden_pickaxe',count:1,keepTable:true}).success,true);
 assert.equal(jobSchema.safeParse({type:'craft',item:'wooden_axe',count:1,keepTable:true,collectTable:true}).success,true);
 assert.equal(jobSchema.safeParse({type:'craft',item:'stick',count:4,keepTable:'yes'}).success,false);
 assert.equal(jobSchema.safeParse({type:'fight',maxSeconds:30}).success,true);
 assert.equal(jobSchema.safeParse({type:'fight',entity:'zombie'}).success,true);
 assert.equal(jobSchema.safeParse({type:'shelter'}).success,true);
 for(const input of [{type:'explore',distance:8},{type:'explore',direction:'up',distance:32},{type:'place',block:'stone'},{type:'collect',radius:999},{type:'eat',code:'process.exit()'},{type:'smelt',item:'raw_iron',count:99},{type:'fight',maxSeconds:0},{type:'sleep',position:{x:0,y:0}}])assert.equal(jobSchema.safeParse(input).success,false);
});
test('phase 6 job schemas accept the new jobs and reject malformed ones',()=>{
 assert.equal(jobSchema.safeParse({type:'gather',block:'stone',count:4,targetY:-58,strip:true}).success,true);
 assert.equal(jobSchema.safeParse({type:'obtain',item:'stone_bricks',count:4}).success,true);
 assert.equal(jobSchema.safeParse({type:'obtain',item:'lantern',count:1024,deposit:{x:0,y:-60,z:0}}).success,true);
 assert.equal(jobSchema.safeParse({type:'use',item:'iron_axe',position:{x:0,y:-60,z:0}}).success,true);
 assert.equal(jobSchema.safeParse({type:'use',item:'shears',entity:'sheep'}).success,true);
 assert.equal(jobSchema.safeParse({type:'shear'}).success,true);
 assert.equal(jobSchema.safeParse({type:'breed',entity:'cow'}).success,true);
 assert.equal(jobSchema.safeParse({type:'hunt',entity:'cow',count:2}).success,true);
 for(const input of [{type:'obtain',item:'stone_bricks',count:0},{type:'obtain',item:'stone_bricks',count:2000},{type:'gather',block:'stone',count:1,targetY:-65},{type:'hunt',entity:'cow',count:99},{type:'breed'},{type:'use',item:'iron_axe',code:'process.exit()'},{type:'obtain',item:'Stone_Bricks',count:1}])assert.equal(jobSchema.safeParse(input).success,false);
});
test('conflicting blueprint coordinates are rejected before building',()=>{
 assert.throws(()=>validateBlueprint({name:'bad',blocks:[{x:0,y:0,z:0,name:'stone'},{x:0,y:0,z:0,name:'dirt'}]}),/Duplicate/);
});
test('restart pauses queued and interrupted jobs; stop persists and halts controls',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'minecraft-worker-test-'));
 try{
  fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data/jobs.json'),JSON.stringify([{id:'a',status:'running',spec:{type:'gather',block:'oak_log',count:4}},{id:'b',status:'queued',spec:{type:'craft',item:'oak_planks',count:16}}]));
  const worker=new Worker(root,{limits:{minHealth:10,minFood:6}});assert.ok(worker.jobs.every(j=>j.status==='paused'));
  let cleared=false,stopped=false;worker.bot={clearControlStates(){cleared=true;},pathfinder:{stop(){stopped=true;}},stopDigging(){}};worker.jobs[0].status='running';worker.stop();assert.ok(cleared&&stopped);assert.equal(JSON.parse(fs.readFileSync(worker.file))[0].status,'paused');
 }finally{const base=path.resolve(process.env.TEMP||os.tmpdir());assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
test('save keeps the last 200 terminal jobs, archives older ones and strips terminal bulk',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'minecraft-worker-test-'));
 try{
  fs.mkdirSync(path.join(root,'data'));
  const jobs=[];
  for(let i=0;i<150;i++)jobs.push({id:'oldC'+i,status:'complete',spec:{type:'eat'},created:'2026-01-01T00:00:00',progress:1,message:'old complete '+i});
  for(let i=0;i<150;i++)jobs.push({id:'oldF'+i,status:'failed',spec:{type:'gather',block:'log',count:16},created:'2026-01-01T01:00:00',progress:0,message:'old failed '+i,tunnel:[{x:i,y:-60,z:0},...Array.from({length:60},(_,k)=>({x:k,y:-60,z:i}))]});
  jobs.push({id:'paused1',status:'paused',spec:{type:'eat'},created:'2026-01-02T00:01:00',progress:0,message:'resumable'});
  fs.writeFileSync(path.join(root,'data/jobs.json'),JSON.stringify(jobs));
  const worker=new Worker(root,{limits:{minHealth:10,minFood:6}});
  worker.save();
  const raw=fs.readFileSync(path.join(root,'data/jobs.json'),'utf8');
  const kept=JSON.parse(raw);
  const terminal=kept.filter(j=>['complete','cancelled','failed'].includes(j.status));
  assert.equal(terminal.length,200,'the terminal cap covers complete, cancelled and failed together');
  assert.ok(kept.some(j=>j.id==='paused1'),'paused jobs must be kept');
  const archive=path.join(root,'data/jobs-archive.jsonl');
  const lines=()=>fs.readFileSync(archive,'utf8').trim().split('\n');
  assert.equal(lines().length,100); // 150 completes + 150 faileds - 200 kept
  assert.equal(JSON.parse(lines()[0]).id,'oldC0');
  const keptFailed=kept.find(j=>j.id&&j.id.startsWith('oldF'));
  assert.ok(keptFailed,'recent failed jobs stay resumable in jobs.json');
  assert.ok(keptFailed.tunnel.length<=20,'tunnel history is truncated for failed jobs');
  assert.ok(raw.length<1024*1024,'the file stays compact');
  worker.save(); // must not re-archive or duplicate anything
  assert.equal(lines().length,100);
  worker.jobs.push({id:'cancel1',status:'cancelled',spec:{type:'eat'},created:'2026-01-03T00:00:00',progress:0,message:'newest terminal'});
  worker.save();
  const kept2=JSON.parse(fs.readFileSync(path.join(root,'data/jobs.json')));
  const terminal2=kept2.filter(j=>['complete','cancelled','failed'].includes(j.status));
  assert.equal(terminal2.length,200); // the cap covers all terminal jobs together
  assert.ok(terminal2.some(j=>j.id==='cancel1'),'the newest terminal job must be kept');
  assert.equal(lines().length,101);
  assert.equal(JSON.parse(lines()[100]).id,'oldC100'); // the oldest terminal rotated out
 }finally{const base=path.resolve(process.env.TEMP||os.tmpdir());assert.ok(path.resolve(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});
