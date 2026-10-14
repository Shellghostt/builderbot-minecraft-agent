import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';
import {createMoveTasks} from '../src/tasks/movement/factories.js';
// Integration A4 (2026-10-14 13:04:32Z): "Bucket-into-lava skipped: Douse interrupted: control
// changed hands". runner.tick() claims control for a tree AFTER tickChain() has ticked it, so
// on the first tick of a fresh tree the task's onTick called worker.douseFire() while the
// token was still the idle null: the synchronous owned() check threw and the first of the two
// bucket attempts was lost.
const flush=async n=>{for(let i=0;i<(n||3);i++)await new Promise(r=>setImmediate(r));};
function lavaWorld(){
 const cells=new Map([['0,-60,0','lava'],['0,-61,0','dirt']]);
 const inv=[{name:'water_bucket',count:1}];
 const bot={
  health:20,food:20,oxygenLevel:20,
  entity:{position:new Vec3(0.5,-60,0.5),onGround:true,isInLava:true,metadata:[]},
  inventory:{items:()=>inv},heldItem:null,
  blockAt(p){const name=cells.get(Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z))||'air';return {name,position:new Vec3(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),boundingBox:name==='dirt'?'block':'empty'};},
  async equip(item){bot.heldItem={name:item.name};},
  async lookAt(){},look:async()=>{},
  activateItem(){if(bot.heldItem?.name!=='water_bucket')return;inv[0]={name:'bucket',count:1};bot.heldItem={name:'bucket'};cells.set('0,-60,0','water');},
  setControlState(){},clearControlStates(){},
  pathfinder:{stop(){},setGoal(){},setMovements(){},goto:()=>new Promise(()=>{})}
 };
 const logs=[];
 const worker={bot,epoch:7,controlToken:null,jobs:[],config:{},log:m=>logs.push(m),
  count:n=>inv.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0),
  async settleBlockChange(){},douseFire:Worker.prototype.douseFire};
 // The production facade: the chain resolves EscapeFromLavaTask through ctx.move.
 worker.move=createMoveTasks({worker,config:{},get bot(){return worker.bot;}});
 return {bot,worker,logs,cells,inv};
}
test('the lava escape pours its bucket on the first tick of a fresh tree (no ownership throw)',async()=>{
 const {worker,logs,cells,inv}=lavaWorld();
 const runner=new TaskRunner(worker,[new WorldSurvivalChain()]);
 runner.tick();
 assert.equal(worker.controlToken,worker.epoch,'the tree owns control after the tick');
 for(let i=0;i<6;i++){await flush();await new Promise(r=>setTimeout(r,60));runner.tick();}
 assert.ok(!logs.some(l=>/control changed hands/.test(l)),logs.join(' | '));
 assert.equal(inv[0].name,'bucket','the first attempt emptied the bucket');
 assert.equal(cells.get('0,-60,0'),'water');
});
test('a douse whose owner really changes mid-pour still stops',async()=>{
 const {worker,logs}=lavaWorld();
 worker.controlToken=worker.epoch;
 const slow=worker.bot.equip;worker.bot.equip=async item=>{await new Promise(r=>setTimeout(r,20));worker.epoch++;worker.bot.heldItem=null;};
 await assert.rejects(Worker.prototype.douseFire.call(worker),/control changed hands/);
 worker.bot.equip=slow;
 // Nobody claims control at all (no tree): the wait is bounded, then it refuses.
 worker.controlToken=null;
 const t0=Date.now();
 await assert.rejects(Worker.prototype.douseFire.call(worker),/control changed hands/);
 assert.ok(Date.now()-t0<1000);
 assert.equal(logs.length,0);
});
