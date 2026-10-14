// Port of adris/altoclef/tasks/movement/SafeRandomShimmyTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Moves around randomly while holding shift; used to escape weird situations where
// pathing doesn't work. Baritone input forcing -> bot controls (guarded by the
// ownership token), random orientation -> periodic lookAt of a random direction.
import {Task} from '../task.js';
import * as move from './move.js';

export class SafeRandomShimmyTask extends Task {
 constructor(randomLookInterval=5,{ctx=null}={}){
  super('SafeRandomShimmyTask');
  this.ctx=ctx;
  this.randomLookInterval=randomLookInterval*1000;
  this.lastLook=0;
 }
 onStart(bot,ctx){this.lastLook=0;}
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(Date.now()-this.lastLook>=this.randomLookInterval){
   this.lastLook=Date.now();
   // Random orientation.
   const angle=Math.random()*Math.PI*2;
   const at=bot.entity.position.offset(Math.cos(angle),0,Math.sin(angle));
   try{bot.lookAt(at).catch(()=>{});}catch{}
  }
  move.setControls(ctx,{sneak:true,forward:true});
  return null;
 }
 onStop(bot,ctx,interrupt){
  move.releaseControls(ctx,['forward','sneak']);
 }
 isEqual(other){return other instanceof SafeRandomShimmyTask;}
}
