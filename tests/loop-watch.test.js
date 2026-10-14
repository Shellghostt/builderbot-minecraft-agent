// Cloud round 5, task 5: 'BuilderBot lost connection: Timed out' right after the drowning.
// Keep-alive answers wait behind any synchronous work, so the bot reports every tick that
// holds the event loop for more than 500 ms, names it, and the drowning path no longer
// rescans the world on every tick.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {createLoopWatch,SLOW_TICK_MS} from '../src/loop-watch.js';
import {TaskRunner} from '../src/tasks/runner.js';
import {Task} from '../src/tasks/task.js';
import {GetOutOfWaterTask} from '../src/tasks/movement/get-out-of-water-task.js';
const busy=ms=>{const end=Date.now()+ms;while(Date.now()<end){}};
test('timeTick names a tick over 500 ms with its breakdown, rate limited, and stays silent under it',()=>{
 let t=0;const lines=[];
 const w=createLoopWatch({log:m=>lines.push(m),now:()=>t});
 const orig=console.log;console.log=()=>{};
 try{
  w.timeTick('runner',()=>{t+=120;});
  assert.deepEqual(lines,[]);
  w.timeTick('runner',()=>{t+=SLOW_TICK_MS+150;},()=>'Mob Defense 640ms');
  assert.deepEqual(lines,['LOOP_SLOW runner tick 650 ms (Mob Defense 640ms)']);
  w.timeTick('runner',()=>{t+=900;});
  assert.equal(lines.length,1,'within 5 s: counted, not printed');
  t+=5000;
  w.timeTick('runner',()=>{t+=700;});
  assert.equal(lines[1],'LOOP_SLOW runner tick 700 ms [+1 more]');
  w.timeTick('autopilot',()=>{t+=600;});
  assert.match(lines[2],/^LOOP_SLOW autopilot tick 600 ms/,'each tick has its own limiter');
  assert.equal(w.slow,4);assert.equal(w.worst,900);
  assert.throws(()=>w.timeTick('x',()=>{throw Error('boom');}),/boom/,'errors pass through');
 }finally{console.log=orig;}
});
test('the lag monitor reports a stalled event loop (a keep-alive could not have been answered)',async()=>{
 const lines=[];const orig=console.log;console.log=()=>{};
 const w=createLoopWatch({log:m=>lines.push(m)});
 try{
  w.start(50);
  await new Promise(r=>setTimeout(r,80));
  busy(SLOW_TICK_MS+200);
  await new Promise(r=>setTimeout(r,120));
  assert.ok(lines.some(l=>/^LOOP_STALL event loop \d+ ms late/.test(l)),lines.join(' | '));
 }finally{w.stop();console.log=orig;}
});
test('a slow chain shows up by name in the runner tick line',async()=>{
 const lines=[];const orig=console.log;console.log=()=>{};
 const worker={bot:{entity:{}},epoch:0,controlToken:null,jobs:[],log(){}};
 worker.loopWatch=createLoopWatch({log:m=>lines.push(m)});
 class Hold extends Task{constructor(){super('Hold');}isFinished(){return false;}}
 const slow={name:'Slow Chain',started:true,root:null,priority(){busy(SLOW_TICK_MS+100);return 60;},onTick(){return this.root||(this.root=new Hold());},onStartup(){},onStopped(){}};
 const runner=new TaskRunner(worker,[slow],{intervalMs:20});
 try{
  runner.start();
  await new Promise(r=>setTimeout(r,SLOW_TICK_MS*3));
  const line=lines.find(l=>l.startsWith('LOOP_SLOW runner'));
  assert.ok(line,lines.join(' | '));
  assert.match(line,/Slow Chain \d+ms/);
  assert.match(line,/chain Slow Chain task Hold/);
 }finally{runner.stop();console.log=orig;}
});
test('the drowning escape searches for land at most once a second, not on every tick',()=>{
 let reads=0;
 const bot={entity:{position:new Vec3(0.5,60,0.5),isInWater:true,onGround:false},oxygenLevel:3,
  blockAt:p=>{reads++;return {name:'water',boundingBox:'empty',position:p};},setControlState(){}};
 const ctx={bot,worker:null};
 const task=new GetOutOfWaterTask({ctx});
 task.onStart(bot,ctx);
 task.onTick(bot,ctx);
 const first=reads;
 assert.ok(first>1000,'one full search: '+first);
 for(let i=0;i<20;i++)task.onTick(bot,ctx);
 assert.ok(reads-first<100,'20 more ticks in the same second: '+(reads-first)+' reads');
 task.searchedAt=Date.now()-1001;
 task.onTick(bot,ctx);
 assert.ok(reads-first>1000,'a second later it searches again');
});
