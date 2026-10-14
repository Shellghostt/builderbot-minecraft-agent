// Navigation helpers for the ported movement tasks: the single-owner pathfinder gate.
// Ported from AltoClef tasks/movement/*.java's use of Baritone's CustomGoalProcess
// (MIT License, Copyright (c) 2020 Adris Jautakas); the ownership rules are our own
// race-fix pattern (src/reflexes.js gotoPoint / docs/TASK_API.md): only the current
// owner token touches the pathfinder, and a newer navigation supersedes an older call's
// cleanup entirely.
import {Vec3} from 'vec3';
import * as goalFactories from './goals.js';
let DEFAULT=null;
// The runner hands ctx only to chains, so tasks resolve it: explicit arg -> this.ctx ->
// the module default the wiring installed (setDefaultMoveContext(runner.ctx)).
export function setDefaultMoveContext(ctx){DEFAULT=ctx;}
export function pickCtx(task,ctx){
 if(ctx&&typeof ctx==='object'&&(ctx.bot!==undefined||ctx.worker!==undefined||ctx.move||ctx.trackers))return ctx;
 if(task&&task.ctx)return task.ctx;
 return DEFAULT;
}
const botOf=ctx=>{const c=pickCtx(null,ctx);const b=c&&c.bot;return typeof b==='function'?b():b;};
const workerOf=ctx=>{const c=pickCtx(null,ctx);return c&&c.worker;};
let navSeq=0;
function movements(ctx,bot){
 const worker=workerOf(ctx);
 return (worker&&worker.exploreMovements&&worker.exploreMovements())||(worker&&worker.movements)||bot.pathfinder.movements;
}
// Navigate to a goal, tolerating failures: resolves true when the goal was reached,
// false on timeout or pathfinder errors (tasks re-issue via their progress checkers
// instead of throwing, mirroring Baritone's CustomGoalProcess semantics).
export async function goto(ctx,goal,{seconds=45}={}){
 const bot=botOf(ctx),worker=workerOf(ctx);
 if(!bot||!goal)return false;
 const token=worker?worker.controlToken:null,previous=bot.pathfinder.movements,mine=++navSeq;
 if(worker)try{bot.pathfinder.setMovements(movements(ctx,bot));}catch{}
 let timer,monitor,reached=false;
 const isEnd=()=>{try{return bot.entity&&goal.isEnd&&goal.isEnd(bot.entity.position.floored());}catch{return false;}};
 try{
  await Promise.race([
   (async()=>{try{await bot.pathfinder.goto(goal);reached=true;}catch{reached=isEnd();}})(),
   new Promise(r=>{monitor=setInterval(()=>{if(isEnd()){reached=true;r();}},200);monitor.unref?.();}),
   // The timeout is ref'd on purpose: it is the leg's safety bound and must keep the
   // event loop alive until it fires (the monitor poller stays unref'd).
   new Promise(r=>{timer=setTimeout(r,seconds*1000);}),
  ]);
 }catch{reached=isEnd();}
 finally{
  clearTimeout(timer);clearInterval(monitor);
  // Only the current owner cleans up, and only if no newer goto superseded us.
  if(mine===navSeq&&(!worker||token===worker.epoch)){
   // stop() first, then setGoal(null) clears the sticky stopPathing flag for the next job.
   try{bot.pathfinder.stop();bot.pathfinder.setGoal(null);}catch{}
   try{bot.clearControlStates();}catch{}
   try{bot.pathfinder.setMovements(previous||movements(ctx,bot));}catch{}
  }
 }
 return reached;
}
// Port of Baritone forceCancel (RunAwayFromCreepersTask): drop whatever path is running now.
export function cancel(ctx){
 const bot=botOf(ctx),worker=workerOf(ctx);
 if(!bot)return;
 if(worker&&worker.controlToken!==worker.epoch)return;
 try{bot.pathfinder.stop();bot.pathfinder.setGoal(null);}catch{}
}
// Input-style controls (Baritone Input.JUMP/SPRINT/SNEAK/MOVE_FORWARD), only when we own control.
export function setControls(ctx,states){
 const bot=botOf(ctx),worker=workerOf(ctx);
 if(!bot)return;
 if(worker&&worker.controlToken!==worker.epoch)return;
 for(const [name,value] of Object.entries(states))try{bot.setControlState(name,value);}catch{}
}
export function releaseControls(ctx,names){setControls(ctx,Object.fromEntries(names.map(n=>[n,false])));}
// Flat away-direction helper (RunAwayFromPositionTask / flee logic): the destination
// `distance` blocks from `from`, pointing straight away from `danger`.
export function awayFrom(from,danger,distance){
 const flat=new Vec3(from.x-danger.x,0,from.z-danger.z);
 const heading=Math.abs(flat.x)+Math.abs(flat.z)>0?flat.normalize():new Vec3(1,0,0);
 return new Vec3(Math.floor(from.x+heading.x*distance),Math.floor(from.y),Math.floor(from.z+heading.z*distance));
}
// ctx.move navigation helpers for the runner wiring (docs/TASK_API.md); the bound
// ctxBase.bot may be the live getter function. Task factories live in factories.js
// (importing the task classes here would be circular: they import this module).
export function createMoveApi(ctxBase){
 return {
  goals:goalFactories,
  goto:(goal,opts)=>goto(ctxBase,goal,opts),
  cancel:()=>cancel(ctxBase),
  setControls:states=>setControls(ctxBase,states),
  releaseControls:names=>releaseControls(ctxBase,names),
  // Ownership-guarded look (the combat controller's aiming): fire-and-forget.
  // force=true snaps yaw this tick. Creeper kite is look-relative: a interpolated
  // look(false) left forward walking into the fuse (combat 73176: draw at 10.6,
  // swell 1 at 2.8, death at the gate 1498,1501).
  look:(yaw,pitch,force)=>{const bot=botOf(ctxBase);if(!bot)return;
   if(workerOf(ctxBase)&&workerOf(ctxBase).controlToken!==workerOf(ctxBase).epoch)return;
   try{const p=bot.look(yaw,pitch,!!force);p&&p.catch&&p.catch(()=>{});}catch{}},
  awayFrom
 };
}
