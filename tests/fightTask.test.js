// Unit tests for the ActionTask base (docs/TASK_API.md "Async actions") and the FightTask
// that wraps src/combat.js's CombatController: one step per tick with no awaits, in-flight
// bookkeeping, late settlements ignored after a stop, failures visible to the parent,
// ownership passing through the guarded move helper only, and a 10k-tick heap-bounded
// runner loop. No live server, no services; the only clock is injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {ActionTask} from '../src/tasks/action.js';
import {FightTask} from '../src/chains/fightTask.js';
import {chunkGoal} from '../src/tasks/movement/goals.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {UserTaskChain} from '../src/chains/userTaskChain.js';
import {MobDefenseChain} from '../src/chains/mobDefenseChain.js';
import {FoodChain} from '../src/chains/foodChain.js';
import {MLGBucketFallChain} from '../src/chains/mlgBucketFallChain.js';
import {RespawnChain} from '../src/chains/respawnChain.js';
import {WorldSurvivalChain} from '../src/chains/worldSurvivalChain.js';

const at=(x,y,z)=>new Vec3(x,y,z);
// The guarded move adapter (the production rule from src/tasks/movement/move.js): when the
// token is stale the helpers are silent no-ops.
function makeMove(bot,worker){
 return {
  setControls:states=>{if(worker&&worker.controlToken!==worker.epoch)return;
   for(const[k,v]of Object.entries(states))bot.setControlState(k,v);},
  look:(yaw,pitch)=>{if(worker&&worker.controlToken!==worker.epoch)return;
   bot.look(yaw,pitch,false);},
 };
}
// A 2-high pocket: crit jumps are impossible, so every ready swing is a plain strike
// (deterministic one-tick attacks for the fakes).
const LOW_CEILING={'0,-58,0':{name:'stone',boundingBox:'block'},'0,-57,0':{name:'stone',boundingBox:'block'}};
function makeBot(opts={}){
 const calls=[];
 const inv=(opts.inventory||[]).map(n=>({name:n,count:(opts.counts&&opts.counts[n])||1}));
 const bot={
  version:'1.21.4',health:opts.health??20,food:opts.food??20,
  time:{timeOfDay:opts.timeOfDay??1000},
  entity:{id:1,position:at(0,-60,0),velocity:at(0,0,0),onGround:opts.onGround??true,height:1.8,isValid:true},
  entities:{},controlState:{},
  registry:{itemsByName:{},blocksByName:{dirt:{id:1}},foodsByName:opts.foods||null},
  inventory:{items:()=>inv,slots:(()=>{const s=[];if(opts.offhand)s[45]={name:opts.offhand};return s;})()},
  heldItem:opts.heldItem?{name:opts.heldItem}:null,
  blockAt:p=>{const k=`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;return (opts.blocks||{})[k]||null;},
  setControlState:(n,v)=>{bot.controlState[n]=v;calls.push(['control',n,v]);},
  look:async()=>calls.push(['look']),
  attack:e=>{calls.push(['attack',e.id]);},
  activateItem:off=>calls.push(['activate',!!off]),
  deactivateItem:()=>calls.push(['deactivate']),
  equip:async item=>{calls.push(['equip',item&&item.name]);bot.heldItem=item?{name:item.name}:null;},
  unequip:async()=>{calls.push(['unequip']);bot.heldItem=null;},
  consume:async()=>calls.push(['consume'])
 };
 (opts.entities||[]).forEach(e=>{bot.entities[e.id]=e;});
 return {bot,calls,inv};
}
const mob=(id,name,position,extra={})=>({id,name,type:extra.type||'hostile',position,isValid:true,...extra});
const ctxOf=bot=>({worker:null,bot:null,move:makeMove(bot,null),trackers:{},blacklist:{},config:{}});

// ---- ActionTask contract ---------------------------------------------------------------
test('ActionTask: run records the in-flight promise; failed actions are visible to the parent',async()=>{
 const t=new ActionTask('Probe');
 let rejectFn;
 t.run(new Promise((_,rej)=>{rejectFn=rej;}));
 assert.ok(t.inFlight(),'the action counts as in flight while unsettled');
 rejectFn(new Error('place failed'));
 await new Promise(r=>setTimeout(r,10));
 assert.equal(t.inFlight(),false);
 assert.deepEqual(t.failed,{reason:'place failed'},'the parent reads failed instead of catching');
 t.run(new Promise(r=>setTimeout(()=>r('done'),5)));
 await new Promise(r=>setTimeout(r,30));
 assert.equal(t.lastResult(),'done');
 assert.equal(t.failed,null,'a fresh action clears the previous failure');
});
test('ActionTask: late settlements are ignored once the task stopped',async()=>{
 const t=new ActionTask('Probe');
 let resolveFn;
 t.run(new Promise(r=>{resolveFn=r;}));
 t.stopped=true; // the runner marked the task stopped (chain switch) before settlement
 resolveFn('late');
 await new Promise(r=>setTimeout(r,10));
 assert.ok(t.inFlight(),'the promise stays recorded; the settlement handler skipped itself');
 assert.equal(t.lastResult(),null,'the late result is dropped');
 assert.equal(t.failed,null);
});
test('ActionTask: guardedStops skip when the epoch moved (not the owner any more)',()=>{
 const bot={pathfinder:{stop:()=>{throw Error('must not run');},setGoal:()=>{throw Error('must not run');}}};
 const worker={controlToken:7,epoch:8}; // stale: someone else owns control
 new ActionTask('Probe').guardedStops(bot,worker); // must not throw
 const hit=[];
 const worker2={controlToken:9,epoch:9};
 const bot2={pathfinder:{stop:()=>hit.push('stop'),setGoal:()=>hit.push('goal')},stopDigging:()=>hit.push('dig'),clearControlStates:()=>hit.push('controls'),deactivateItem:()=>hit.push('deactivate')};
 new ActionTask('Probe').guardedStops(bot2,worker2);
 assert.ok(hit.includes('stop')&&hit.includes('goal'),'the owner token cleans up');
});

// ---- FightTask targeting and lifecycle ---------------------------------------------------
test('FightTask: picks the nearest hostile, finishes when the area is clear',()=>{
 const {bot}=makeBot({entities:[mob(10,'zombie',at(3,-60,0)),mob(11,'zombie',at(7,-60,0))]});
 const t=new FightTask({move:makeMove(bot,null),opts:{range:16}});
 assert.equal(t.isFinished(bot),false);
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 assert.equal(t.controller.target.id,10,'the nearest hostile is engaged first');
 assert.equal(t.candidates(bot).length,2);
 delete bot.entities[10];delete bot.entities[11];
 assert.equal(t.isFinished(bot),true,'no hostiles left in range');
});
test('FightTask: entityFilter hunts only the named species',()=>{
 const {bot,calls}=makeBot({
  blocks:LOW_CEILING,
  entities:[mob(10,'cow',at(2,-60,0),{type:'passive'}),mob(11,'zombie',at(5,-60,0))],
  heldItem:'iron_sword',inventory:['iron_sword']});
 const t=new FightTask({move:makeMove(bot,null),opts:{entityFilter:'cow',range:24}});
 assert.deepEqual(t.candidates(bot).map(e=>e.id),[10],'the zombie is not a hunt target');
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 assert.equal(t.controller.target.id,10);
 assert.deepEqual(calls.filter(c=>c[0]==='attack').map(c=>c[1]),[10],'the verified weapon strikes the cow');
});
test('FightTask: lockFirst kills exactly one animal (hunt), then finishes when it is gone',()=>{
 const {bot}=makeBot({entities:[mob(10,'cow',at(4,-60,0),{type:'passive'}),mob(11,'cow',at(6,-60,0),{type:'passive'})]});
 const t=new FightTask({move:makeMove(bot,null),opts:{entityFilter:'cow',range:24,lockFirst:true,allowHand:true}});
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 assert.equal(t.controller.target.id,10,'the nearest cow is locked');
 delete bot.entities[10];
 assert.equal(t.isFinished(bot),true,'finished the moment the hunted animal is gone');
 assert.equal(t.controller.target.id,10,'the lock does not re-target the next cow');
});
test('FightTask: shield to the off hand on start; controller stop clears the controls',()=>{
 const {bot,calls}=makeBot({inventory:['shield','iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(3,-60,0))]});
 const t=new FightTask({move:makeMove(bot,null),opts:{}});
 t.onStart(bot,ctxOf(bot));
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='shield'),'the shield is equipped off-hand');
 t.onTick(bot,ctxOf(bot));
 t.onStop(bot,true);
 assert.ok(Object.values(bot.controlState).every(v=>!v),'no control sticks after the stop');
 assert.equal(t.controller.target,null,'the controller releases its target');
});
test('FightTask: eats while disengaged through the in-flight gate (no awaits in onTick)',async()=>{
 const {bot,calls}=makeBot({
  health:10,food:10,inventory:['cooked_beef','iron_sword'],heldItem:'iron_sword',
  entities:[mob(10,'zombie',at(3,-60,0))],
  foods:{cooked_beef:{foodPoints:8,saturation:0.8}}});
 const t=new FightTask({move:makeMove(bot,null),opts:{}});
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 // health 10 <= 12 and food exists: the controller disengages, the task fires the eat
 assert.ok(calls.some(c=>c[0]==='equip'&&c[1]==='cooked_beef'),'food equipped');
 assert.ok(t.inFlight(),'the eat is the in-flight action');
 t.onTick(bot,ctxOf(bot)); // while in flight: a no-op step (synchronous, no second eat)
 assert.equal(calls.filter(c=>c[0]==='equip'&&c[1]==='cooked_beef').length,1,'one eat at a time');
 await new Promise(r=>setTimeout(r,10));
 t.onTick(bot,ctxOf(bot));
 assert.ok(calls.some(c=>c[0]==='consume'),'the food was consumed');
});
test('FightTask: no food means the controller fights on instead of disengaging forever',()=>{
 const {bot,calls}=makeBot({
  health:10,food:10,inventory:['iron_sword'],heldItem:'iron_sword',blocks:LOW_CEILING,
  entities:[mob(10,'zombie',at(2,-60,0))],
  foods:{}});
 const t=new FightTask({move:makeMove(bot,null),opts:{}});
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 assert.ok(calls.some(c=>c[0]==='attack'),'nothing to eat: keep striking (backing off into mobs just loses)');
});
test('FightTask: reports mob, tactic, hits, crits, damage taken and result once',()=>{
 const {bot}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(3,-60,0))]});
 const logs=[];
 const t=new FightTask({move:makeMove(bot,null),log:m=>logs.push(m),opts:{}});
 t.onStart(bot,ctxOf(bot));
 t.onTick(bot,ctxOf(bot));
 t._report(t.controller,'finished');
 t._report(t.controller,'finished'); // second call: ignored
 const reports=logs.filter(l=>l.startsWith('Fight result:')); // the state log ('Combat: ...') is separate
 assert.equal(reports.length,1,'the report is emitted exactly once');
 assert.match(reports[0],/Fight result: zombie tactic=/);
 assert.match(reports[0],/hits=\d+ crits=\d+/);
 assert.match(reports[0],/damage taken=/);
 assert.match(reports[0],/result=finished/);
});

// ---- the whole loop through the runner ----------------------------------------------------
function stack(){
 const food=new FoodChain();
 const md=new MobDefenseChain({food});
 food.mobDefense=md;
 return [new RespawnChain(),new WorldSurvivalChain(),new MLGBucketFallChain(),md,food,new UserTaskChain()];
}
// MobDefense is config-gated off for the user-task legs: the survival chains are covered by
// chains.test.js; here the tree under test is the FightTask the job handed to UserTaskChain.
const RUNNER_OPTS={config:{chains:{mobDefense:false}}};
test('the runner owns the FightTask end to end: control taken, fight fought, control released',()=>{
 const {bot,calls}=makeBot({blocks:LOW_CEILING,inventory:['iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(2,-60,0))]});
 const worker={bot,epoch:0,controlToken:null,log(){},jobs:[],config:{},move:makeMove(bot,null)};
 const chains=stack();
 const finished=[];
 chains.find(c=>c.name==='User Tasks').runTask(
  new FightTask({move:worker.move,log:()=>{},opts:{}}),
  r=>finished.push(r));
 const runner=new TaskRunner(worker,chains,RUNNER_OPTS);
 for(let i=0;i<40&&!calls.some(c=>c[0]==='attack');i++)runner.tick();
 assert.equal(runner.status().chain,'User Tasks');
 assert.equal(runner.status().task,'FightTask');
 assert.ok(calls.some(c=>c[0]==='attack'),'the zombie was attacked under the runner');
 assert.equal(worker.controlToken,worker.epoch,'the tree owns control');
 assert.equal(worker.epoch,0,'no epoch bump: the user-service chain never preempts its own job');
 delete bot.entities[10];
 for(let i=0;i<10&&!finished.length;i++)runner.tick();
 assert.equal(finished.length,1,'onFinish fired when the fight ended');
 assert.equal(runner.status().task,null,'the tree is gone');
 assert.equal(worker.controlToken,null,'control released');
 runner.stop();
});
test('runner.stop tears down a live fight tree (interrupt reaches the controller)',()=>{
 const {bot}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(3,-60,0))],timeOfDay:13000});
 const worker={bot,epoch:0,controlToken:null,log(){},jobs:[],config:{},move:makeMove(bot,null)};
 const chains=stack();
 const finished=[];
 chains.find(c=>c.name==='User Tasks').runTask(
  new FightTask({move:worker.move,log:()=>{},opts:{}}),
  r=>finished.push(r));
 const runner=new TaskRunner(worker,chains,RUNNER_OPTS);
 runner.tick();
 assert.equal(runner.status().task,'FightTask','the tree is live');
 runner.stop();
 assert.equal(worker.controlToken,null,'stop releases control with the bump');
 assert.equal(runner.status().running,false);
 assert.ok(finished.length===0,'an interrupted task does not report a normal finish');
});
test('10k ticks of a live fight tree stay heap-bounded (no task/promise accumulation)',()=>{
 const {bot}=makeBot({blocks:LOW_CEILING,inventory:['iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(3,-60,0))]});
 // ring-buffer the call log: recording 10k control calls would measure the test, not the runner
 bot.setControlState=(n,v)=>{bot.controlState[n]=v;};
 const worker={bot,epoch:0,controlToken:null,log(){},jobs:[],config:{},move:makeMove(bot,null)};
 const chains=stack();
 chains.find(c=>c.name==='User Tasks').runTask(
  new FightTask({move:worker.move,log:()=>{},opts:{}}),()=>{});
 const runner=new TaskRunner(worker,chains,RUNNER_OPTS);
 global.gc&&global.gc();
 const before=process.memoryUsage().heapUsed;
 for(let i=0;i<10000;i++)runner.tick();
 global.gc&&global.gc();
 const grown=process.memoryUsage().heapUsed-before;
 assert.ok(grown<32*1024*1024,'heap grew '+Math.round(grown/1024)+' KiB over 10k ticks (budget 32 MiB)');
 assert.equal(runner.status().task,'FightTask','the fight is still running, not restarting');
 runner.stop();
});
test('chunkGoal satisfies the pathfinder goal contract',()=>{
 const g=chunkGoal(1,2);
 assert.equal(typeof g.isValid,'function');
 assert.equal(g.isValid(),true);
 assert.equal(g.hasChanged(),false);
 assert.equal(g.isEnd({x:16,y:0,z:32}),true);
 assert.equal(g.isEnd({x:15,y:0,z:32}),false);
});
test('a stalled approach paths with a Goal, never a GetToXZ task',()=>{
 const {bot}=makeBot({inventory:['iron_sword'],heldItem:'iron_sword',entities:[mob(10,'zombie',at(8,-60,0))]});
 const got=[];
 const move={
  ...makeMove(bot,null),
  goals:{xzGoal:(x,z)=>({x,z,isValid(){return true;},hasChanged(){return false;},isEnd(){return false;}})},
  getToXZ:(x,z)=>({task:true,x,z}),
  awayFrom:(from,danger,distance)=>({x:from.x-distance,y:from.y,z:from.z}),
  goto:goal=>{got.push(goal);return Promise.resolve(false);}
 };
 const task=new FightTask({move,log:()=>{},opts:{}});
 const ctx={move,bot,worker:null};
 task.onStart(bot,ctx);
 task._approachStart=Date.now()-4000;
 task.onTick(bot,ctx);
 assert.equal(got.length,1,'one approach leg');
 assert.equal(typeof got[0].isValid,'function','pathfinder can poll isValid');
 assert.equal(got[0].task,undefined,'a Task was not passed to goto');
 assert.equal(got[0].x,8);
});
test('FightTask: a creeper in the combat arena kites, never paths through the gate fuse',()=>{
 const {bot}=makeBot({inventory:['bow','arrow','iron_sword'],counts:{arrow:32},heldItem:'bow',
  entities:[mob(11,'creeper',at(1504,-60,1504))]});
 bot.entity.position=at(1496,-60,1497);
 const got=[];
 const move={
  ...makeMove(bot,null),
  goals:{xzGoal:(x,z)=>({x,z,isValid(){return true;},hasChanged(){return false;},isEnd(){return false;}})},
  goto:goal=>{got.push(goal);return Promise.resolve(false);}
 };
 const task=new FightTask({move,log:()=>{},opts:{}});
 task.onStart(bot,{move,bot,worker:null});
 task.onTick(bot,{move,bot,worker:null});
 assert.equal(got.length,0,'no gate-break: the 12x12 gate sits on the creeper (18-19.8 hp)');
 assert.equal(task.controller.target&&task.controller.target.id,11,'the controller owns the kite');
});
test('FightTask: a close or fusing creeper cancels an in-flight path and sprints',()=>{
 const {bot}=makeBot({inventory:['bow','arrow'],counts:{arrow:8},heldItem:'bow',
  entities:[mob(11,'creeper',at(3,-60,0),{metadata:{16:1}})]});
 const got=[];
 const move={
  ...makeMove(bot,null),
  goals:{xzGoal:(x,z)=>({x,z,isValid(){return true;},hasChanged(){return false;},isEnd(){return false;}})},
  goto:goal=>{got.push(goal);return new Promise(()=>{});}
 };
 const task=new FightTask({move,log:()=>{},opts:{}});
 task.onStart(bot,{move,bot,worker:null});
 task.run(move.goto({x:10,z:10}));
 assert.equal(task.inFlight(),true);
 bot.pathfinder={stop:()=>got.push('stop'),setGoal:()=>got.push('goal')};
 bot.clearControlStates=()=>got.push('clear');
 task.onTick(bot,{move,bot,worker:null});
 assert.equal(task.inFlight(),false,'the path is dropped so the sprint is free');
 assert.ok(got.includes('stop'),'pathfinder.stop ran');
 assert.equal(task.controller.target&&task.controller.target.id,11);
});
