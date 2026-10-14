import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
// Passive hunts (the food step's fight jobs) kill exactly one animal and always sweep their
// own drops, also when the chase timed out (soak 7: kills lay on the ground and despawned).
function fakeWorker({outcome}){
 const me={position:new Vec3(0,-60,0)};
 const chickens={2:{id:2,name:'chicken',type:'animal',position:new Vec3(5,-60,0)},3:{id:3,name:'chicken',type:'animal',position:new Vec3(9,-60,0)}};
 const calls=[];
 const w={
  bot:{entity:me,entities:{1:me,...chickens},inventory:{items(){return [{name:'stone_sword',count:1}];}},equip(){},
   registry:{entitiesByName:{chicken:{type:'animal'},zombie:{type:'hostile'}}}},
  check(){},log(){},move:null,
  async combatTask(job,token,mk){
   const task=mk();calls.push(['task',task]);
   if(outcome==='timeout'){const e=Error('Fight timed out');e.code='COMBAT_TIMEOUT';throw e;}
   if(outcome==='stopped')throw Error('Stopped');
   delete w.bot.entities[2]; // the nearest chicken died
  },
  async sweepDrops(token,radius){calls.push(['sweep',radius]);},
  async retreatSprint(){}
 };
 w.huntSweep=Worker.prototype.huntSweep;
 return {w,calls};
}
test('a passive hunt locks one animal and sweeps its drops on success',async()=>{
 const {w,calls}=fakeWorker({outcome:'killed'});
 await Worker.prototype.fight.call(w,{spec:{type:'fight',entity:'chicken',maxSeconds:90}},0);
 const task=calls.find(c=>c[0]==='task')[1];
 assert.equal(task.lockFirst,true,'one animal per hunt job');
 assert.equal(task.range,48);
 assert.deepEqual(calls.filter(c=>c[0]==='sweep'),[['sweep',16]],'another chicken still standing is not a failure');
});
test('a timed-out passive hunt still sweeps what it killed, then reports the timeout',async()=>{
 const {w,calls}=fakeWorker({outcome:'timeout'});
 await assert.rejects(Worker.prototype.fight.call(w,{spec:{type:'fight',entity:'chicken',maxSeconds:90}},0),/timed out; chicken/);
 assert.deepEqual(calls.filter(c=>c[0]==='sweep'),[['sweep',16]]);
});
test('a stopped hunt does not sweep; hostile fights never lock or sweep',async()=>{
 let t=fakeWorker({outcome:'stopped'});
 await assert.rejects(Worker.prototype.fight.call(t.w,{spec:{type:'fight',entity:'chicken'}},0),/Stopped/);
 assert.equal(t.calls.filter(c=>c[0]==='sweep').length,0);
 t=fakeWorker({outcome:'killed'});
 await Worker.prototype.fight.call(t.w,{spec:{type:'fight',maxSeconds:30}},0);
 const task=t.calls.find(c=>c[0]==='task')[1];
 assert.equal(task.lockFirst,false);
 assert.equal(t.calls.filter(c=>c[0]==='sweep').length,0);
});
