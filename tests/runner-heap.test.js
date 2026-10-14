// Bounded-heap guard for the task system (docs/TASK_API.md "HARD RULE: memory limits").
// Drives a TaskRunner for 10k manual ticks through chains that rebuild equal roots every
// tick, spawn fresh child tasks, run promise-based actions and switch/teardown chains on a
// cadence - the patterns that could retain a tree per tick - and asserts the heap after a
// forced GC does not grow with the tick count.
import test from 'node:test';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import vm from 'node:vm';
import {TaskRunner} from '../src/tasks/runner.js';
import {Task} from '../src/tasks/task.js';
import {ActionTask} from '../src/tasks/action.js';

v8.setFlagsFromString('--expose_gc');
const gc=vm.runInNewContext('gc');
const settle=()=>new Promise(r=>setImmediate(r));

class Swing extends ActionTask{ // leaf: one promise per adoption, finished when it settles
 constructor(){super('Swing');this.ticks=0;Swing.made++;}
 onStart(){Swing.started++;this.run(Promise.resolve('hit'));} // settles on the next microtask turn
 onTick(){this.ticks++;return null;}
 isFinished(){return !this.inFlight();}
 isEqual(o){return o instanceof Swing;}
}
Swing.made=0;Swing.started=0;
class Walk extends Task{ // middle: hands to a fresh Swing each tick (isEqual keeps it)
 constructor(goal){super('Walk');this.goal=goal;this.payload=new Array(64).fill(goal);}
 onTick(){return new Swing();}
 isFinished(){return false;}
 isEqual(o){return o instanceof Walk&&o.goal===this.goal;}
}
class Root extends Task{ // root: rebuilt by the chain every tick, equal by goal
 constructor(goal){super('Root');this.goal=goal;}
 onTick(){return new Walk(this.goal);}
 isFinished(){return false;}
 isEqual(o){return o instanceof Root&&o.goal===this.goal;}
}
function chain(name,prio){
 let goal=0;
 return {
  name,started:false,userService:false,
  priority:(bot,ctx)=>prio(ctx.tick),
  onStartup(){this.started=true;},
  onTick(bot,ctx){if(ctx.tick%97===0)goal++;return new Root(goal);}, // new goal every 97 ticks: forces re-adoption
  onStopped(){},
 };
}
function fakeWorker(){
 const w={bot:{entity:{onGround:true,position:{x:0,y:0,z:0}}},epoch:1,controlToken:null,jobs:[],logs:0,
  log(){this.logs++;},stop(){},config:{},trackers:{},blacklist:{},move:{}};
 return w;
}

test('TaskRunner keeps its heap bounded over 10k ticks with chain switches and promise actions',async()=>{
 const worker=fakeWorker();
 // two chains that alternate every 250 ticks (teardown + fresh tree) plus an always-idle one
 const a=chain('A',t=>Math.floor(t/250)%2===0?10:-1);
 const b=chain('B',t=>Math.floor(t/250)%2===1?20:-1);
 const idle=chain('Idle',()=>-1);
 const runner=new TaskRunner(worker,[idle,a,b]);
 runner.ctx.tick=0;
 const samples=[];
 for(let t=1;t<=10000;t++){
  runner.ctx.tick=t;
  runner.tick();
  await settle(); // let Swing promises resolve between ticks like the real clock would
  if(t===2000||t===6000||t===10000){gc();gc();samples.push(process.memoryUsage().heapUsed);}
 }
 runner.stop();
 const [h2k,,h10k]=samples;
 const growthMB=(h10k-h2k)/1048576;
 assert.ok(growthMB<4,'heap grew '+growthMB.toFixed(2)+' MB between tick 2000 and 10000: '+JSON.stringify(samples));
 // structural bounds: one root slot per chain, no tree deeper than root->walk->swing
 assert.equal(runner.roots.size<=3,true);
 for(const root of runner.roots.values()){let depth=0;for(let x=root;x;x=x.child)depth++;assert.ok(depth<=3,'tree depth '+depth);}
 assert.ok(worker.logs<10000,'runner logged every tick: '+worker.logs);
 // the trees really ran: a fresh Swing was proposed every tick and adopted whenever one finished
 assert.ok(Swing.made>=9000,'Swing proposals '+Swing.made);
 assert.ok(Swing.started>=3000&&Swing.started<Swing.made,'Swing adoptions '+Swing.started);
});
