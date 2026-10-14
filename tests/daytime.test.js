import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {dayTicks,isNight} from '../src/daytime.js';
import {Autopilot} from '../src/autopilot.js';
import {Worker} from '../src/worker.js';
import {isDaylight,nightish} from '../src/chains/combatPolicy.js';
import {SleepTask,ShelterTask} from '../src/chains/fallbackTasks.js';
// GLM soak 7: the clock reached the autopilot as RAW world age (or negative with the
// daylight cycle stopped), so every 0..24000 window compared the wrong number and the
// night branch never fired. Every clock consumer must see the same normalised tick.
const AGE=7*24000; // a week of world age on top of the time of day
const clock=(tod,day=7)=>({time:{timeOfDay:tod,day}});
test('dayTicks normalises raw world age and negative clocks',()=>{
 assert.equal(dayTicks(clock(AGE+13000)),13000);
 assert.equal(dayTicks(clock(-11000)),13000);
 assert.equal(dayTicks(clock(500)),500);
 assert.equal(dayTicks({time:{timeOfDay:null}}),null);
 assert.equal(dayTicks(null),null);
 assert.equal(isNight(clock(AGE+13000)),true);
 assert.equal(isNight(clock(AGE+1000)),false);
 assert.equal(isNight(clock(-11000)),true);
});
test('combat policy and the night tasks read raw-age clocks as time of day',()=>{
 assert.equal(isDaylight(clock(AGE+1000)),true);
 assert.equal(isDaylight(clock(AGE+15000)),false);
 assert.equal(nightish(clock(AGE+15000)),true);
 assert.equal(nightish(clock(AGE+3000)),false);
 // Morning in raw age: the night tasks are finished (they used to hold forever).
 assert.equal(new SleepTask().isFinished({...clock(AGE+500),isSleeping:false}),true);
 assert.equal(new ShelterTask().isFinished(clock(AGE+500)),true);
 assert.equal(new ShelterTask().isFinished(clock(AGE+15000)),false);
});
function autopilot({tod,items=[],jobs=[]}){
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'daytime-test-'));
 const submitted=[],cancelled=[];
 const worker={
  ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},
  cancel(id){cancelled.push(id);const j=jobs.find(x=>x.id===id);if(j)j.status='cancelled';},
  bot:{time:{timeOfDay:tod,day:7},inventory:{items(){return items;}},entities:{},
   registry:{blocksByName:{},foodsByName:{},itemsByName:{}},findBlock(){return null;},blockAt(){return null;},
   entity:{position:{y:-60,floored(){return {x:0,y:-60,z:0,offset(){return this;}};}}}}
 };
 const ap=new Autopilot(worker,root);
 ap.start();
 return {ap,worker,submitted,cancelled,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
test('raw-age night: an idle ladder submits the night shelter',()=>{
 for(const tod of [AGE+13000,-11000]){
  const t=autopilot({tod});
  try{t.ap.tick();assert.deepEqual(t.submitted,[{type:'shelter'}],'tod '+tod);assert.equal(t.ap.currentStep,'night');}
  finally{t.done();}
 }
});
test('raw-age dusk: the ladder gathers shelter dirt before nightfall',()=>{
 const t=autopilot({tod:AGE+11000,items:[{name:'wooden_pickaxe',count:1}]});
 try{t.ap.tick();assert.equal(t.submitted[0].type,'gather');assert.equal(t.submitted[0].block,'grass_block');assert.equal(t.ap.currentStep,'dusk-dirt');}
 finally{t.done();}
});
test('raw-age morning is daytime: the ladder runs, no night job',()=>{
 const t=autopilot({tod:AGE+1000});
 try{t.ap.tick();assert.equal(t.submitted.length,1);assert.equal(t.submitted[0].type,'gather');assert.equal(t.ap.currentStep,'wood');}
 finally{t.done();}
});
test('raw-age night cancels a running day job, but never a running fight',()=>{
 const day={id:'d1',status:'running',spec:{type:'gather',block:'log'}};
 let t=autopilot({tod:AGE+14000,jobs:[day]});
 try{t.ap.tick();assert.deepEqual(t.cancelled,['d1']);assert.deepEqual(t.submitted,[{type:'shelter'}]);}
 finally{t.done();}
 const fight={id:'f1',status:'running',spec:{type:'fight',entity:'zombie'}};
 t=autopilot({tod:AGE+14000,jobs:[fight]});
 try{
  t.ap.tick();
  assert.deepEqual(t.cancelled,[]);assert.deepEqual(t.submitted,[],'the fight finishes first');
  fight.status='complete';
  t.ap.tick();
  assert.deepEqual(t.submitted,[{type:'shelter'}],'the night job follows the fight');
  t.ap.tick();assert.equal(t.submitted.length,1,'once per night');
 }finally{t.done();}
});
test('worker sleep and shelter read raw-age clocks as time of day',async()=>{
 const updates=[];
 const fake=b=>({bot:b,check(){},update(job,progress,message){updates.push(message);},count(){return 0;}});
 // Raw-age early morning: the night was handled.
 await Worker.prototype.sleep.call(fake(clock(AGE+500)),{spec:{}},0);
 assert.deepEqual(updates,['Night already slept through']);
 // Raw-age noon: refused as daytime (it used to go looking for a bed).
 await assert.rejects(Worker.prototype.sleep.call(fake(clock(AGE+6000)),{spec:{}},0),/daytime/);
 // Raw-age morning: the shelter job has nothing to do (it used to build and wait forever).
 const b={...clock(AGE+2000),blockAt(){throw Error('must not build');}};
 assert.equal(await Worker.prototype.shelter.call(fake(b),{spec:{}},0),undefined);
});
