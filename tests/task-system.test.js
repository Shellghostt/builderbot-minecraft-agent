// Unit tests for the AltoClef task system port (src/tasks/*.js): fake bot/worker, manual clock -
// runner.tick() is called by hand, nothing here touches mineflayer, the live server or real processes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Task} from '../src/tasks/task.js';
import {TaskChain} from '../src/tasks/chain.js';
import {TaskRunner} from '../src/tasks/runner.js';

const makeBot=()=>({entity:{position:{x:0,y:64,z:0},onGround:true},pathfinder:null,clearControlStates(){},setControlState(){}});
const makeWorker=bot=>({ready:true,bot,epoch:0,controlToken:null,config:{},log(){}});
const runs=(worker,...chains)=>new TaskRunner(worker,chains);
// Scripted task: every lifecycle call lands in the shared log as start:/tick:/stop:<interrupt flag>.
class ScriptedTask extends Task{
 constructor(name,o={}){super(name);this.o=o;this.l=o.l;this.ticks=0;}
 onStart(bot){this.l.push('start:'+this.name);}
 onTick(bot){this.ticks++;this.l.push('tick:'+this.name);return this.o.child?this.o.child(bot,this):null;}
 onStop(bot,interrupt){this.l.push('stop:'+this.name+':'+(interrupt?1:0));}
 isFinished(bot){return this.o.finished?!!this.o.finished(bot,this):false;}
}
class ScriptedChain extends TaskChain{
 constructor(name,o={}){super(name);this.o=o;}
 priority(bot,ctx){return this.o.priority?this.o.priority(bot,ctx):-1;}
 onTick(bot,ctx){this.root=this.o.root?this.o.root(bot,ctx,this):this.root;return this.root;}
}
const n=(l,prefix)=>l.filter(x=>x.startsWith(prefix)).length;

test('subtask switching stops the old child exactly once and adopts the new one',()=>{
 const l=[];
 class GoalA extends ScriptedTask{}
 class GoalB extends ScriptedTask{}
 const a=new GoalA('a',{l}),b=new GoalB('b',{l}); // distinct goals: default isEqual is per-constructor
 let useB=false;
 const parent=new ScriptedTask('parent',{l,child:()=>useB?b:a});
 const runner=runs(makeWorker(makeBot()),new ScriptedChain('c',{priority:()=>0,root:()=>parent}));
 for(let i=0;i<4;i++){if(i===2)useB=true;runner.tick();}
 assert.equal(n(l,'start:parent'),1);
 assert.equal(n(l,'start:a'),1);
 assert.equal(n(l,'stop:a:1'),1); // superseded -> interrupt=true, exactly once
 assert.equal(n(l,'start:b'),1);
 assert.equal(n(l,'stop:b'),0); // b is equal to itself across ticks: never restarted
 assert.equal(b.ticks,2);
});

test('isEqual keeps an identical child running instead of restarting it',()=>{
 const l=[];
 // A fresh instance with the same goal every tick: default isEqual (same constructor) must keep it alive.
 const parent=new ScriptedTask('parent',{l,child:()=>new ScriptedTask('leaf',{l})});
 const runner=runs(makeWorker(makeBot()),new ScriptedChain('c',{priority:()=>0,root:()=>parent}));
 for(let i=0;i<5;i++)runner.tick();
 assert.equal(n(l,'start:leaf'),1); // the restart storm AltoClef's isEqual check prevents
 assert.equal(n(l,'stop:leaf'),0);
 assert.equal(n(l,'start:parent'),1);
});

test('isFinished pops the leaf and the parent re-decides on its next tick',()=>{
 const l=[];
 const first=new ScriptedTask('first',{l,finished:()=>true});
 const second=new ScriptedTask('second',{l});
 const parent=new ScriptedTask('parent',{l,child:()=>first.stopped?second:first});
 const runner=runs(makeWorker(makeBot()),new ScriptedChain('c',{priority:()=>0,root:()=>parent}));
 for(let i=0;i<3;i++)runner.tick();
 assert.equal(n(l,'stop:first:0'),1); // a completion pops cleanly, not with an interrupt
 assert.equal(n(l,'start:first'),1);
 assert.equal(n(l,'start:second'),1); // the parent picked a new child once first had popped
 assert.equal(first.ticks,1); // popped at descent: never ticked again after finishing
});

test('chain priority switching interrupts the previous chain tree deepest first',()=>{
 const l=[];
 const leaf=new ScriptedTask('low-leaf',{l});
 const root=new ScriptedTask('low-root',{l,child:()=>leaf});
 let highActive=false;
 const low=new ScriptedChain('low',{priority:()=>0,root:()=>root});
 const high=new ScriptedChain('high',{priority:()=>highActive?1:-1,root:()=>new ScriptedTask('high-root',{l})});
 const worker=makeWorker(makeBot());
 const runner=runs(worker,low,high);
 runner.tick();runner.tick();
 highActive=true;
 runner.tick();runner.tick();
 assert.ok(l.indexOf('stop:low-leaf:1')<l.indexOf('stop:low-root:1'),'deepest first');
 assert.equal(n(l,'stop:low-leaf:1'),1); // the whole old tree dies with interrupt=true, once
 assert.equal(n(l,'stop:low-root:1'),1);
 assert.equal(n(l,'start:high-root'),1);
 assert.equal(n(l,'tick:high-root'),2); // a fresh equal root per tick is kept: no restart at chain level either
 assert.equal(low.started,false); // onStopped fired on the superseded chain
 assert.equal(high.started,true); // onStartup fired on the winner
 assert.equal(runner.status().chain,'high');
 assert.equal(runner.status().task,'high-root');
 assert.equal(worker.controlToken,worker.epoch); // ownership survives the switch (fresh epoch)
});

test('runner.stop() unwinds the whole tree deepest first with interrupt=true',()=>{
 const l=[];
 const leaf=new ScriptedTask('leaf',{l});
 const mid=new ScriptedTask('mid',{l,child:()=>leaf});
 const root=new ScriptedTask('root',{l,child:()=>mid});
 const worker=makeWorker(makeBot());
 const runner=runs(worker,new ScriptedChain('c',{priority:()=>0,root:()=>root}));
 runner.start();
 assert.equal(runner.status().running,true);
 runner.tick();runner.tick();
 const epochBefore=worker.epoch;
 runner.stop();
 assert.ok(l.indexOf('stop:leaf:1')<l.indexOf('stop:mid:1')&&l.indexOf('stop:mid:1')<l.indexOf('stop:root:1'),'deepest first');
 assert.equal(n(l,'stop:leaf:1'),1);
 assert.equal(n(l,'stop:mid:1'),1);
 assert.equal(n(l,'stop:root:1'),1);
 assert.deepEqual(runner.status(),{running:false,chain:null,task:null});
 assert.equal(worker.controlToken,null); // ownership released...
 assert.ok(worker.epoch>epochBefore);    // ...with an epoch bump so stale cleanups skip themselves
});

test('the ownership token is taken while a tree is active and released on stop',()=>{
 const worker=makeWorker(makeBot());
 const runner=runs(worker,new ScriptedChain('c',{priority:()=>0,root:()=>new ScriptedTask('t',{l:[]})}));
 assert.equal(worker.controlToken,null);
 runner.tick();
 assert.equal(worker.controlToken,worker.epoch);
 assert.ok(worker.epoch>0); // taken with a bump, like withControl
 const held=worker.epoch;
 runner.tick();
 assert.equal(worker.epoch,held); // steady state: no per-tick re-bump
 runner.stop();
 assert.equal(worker.controlToken,null);
 assert.ok(worker.epoch>held);
});

test('ctx exposes a live bot getter and P4 placeholders',()=>{
 const worker=makeWorker(makeBot());
 const runner=new TaskRunner(worker,[]);
 const reborn=makeBot();
 worker.bot=reborn; // reconnect: chains must see the new bot without rebuilding the runner
 assert.equal(runner.ctx.bot,reborn);
 assert.deepEqual(Object.keys(runner.ctx).sort(),['blacklist','bot','config','move','trackers','worker']);
});

test('a forcing child (ITaskCanForce) cannot be switched out mid-job',()=>{
 const l=[];
 const forced=new ScriptedTask('forced',{l});
 forced.shouldForce=()=>true; // duck-typed ITaskCanForce
 const other=new ScriptedTask('other',{l});
 let flip=false;
 const parent=new ScriptedTask('parent',{l,child:()=>flip?other:forced});
 const runner=runs(makeWorker(makeBot()),new ScriptedChain('c',{priority:()=>0,root:()=>parent}));
 runner.tick();
 flip=true;
 runner.tick();runner.tick();
 assert.equal(n(l,'stop:forced'),0); // it forced its way through the attempted switch
 assert.equal(n(l,'start:other'),0);
 assert.equal(n(l,'start:forced'),1);
 assert.ok(forced.ticks>=2);
});

test('a parent that stops needing its child drops it with a clean stop',()=>{
 const l=[];
 let drops=false;
 const leaf=new ScriptedTask('leaf',{l});
 const parent=new ScriptedTask('parent',{l,child:()=>drops?null:leaf});
 const runner=runs(makeWorker(makeBot()),new ScriptedChain('c',{priority:()=>0,root:()=>parent}));
 runner.tick();runner.tick();
 drops=true;
 runner.tick();
 assert.equal(n(l,'stop:leaf:0'),1); // Java drops the sub cleanly here (interruptTask=null)
 assert.equal(leaf.ticks,2);
});
