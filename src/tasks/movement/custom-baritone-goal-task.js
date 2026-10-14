// Port of adris/altoclef/tasks/movement/CustomBaritoneGoalTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Turns a goal into a task: re-issues navigation through the ownership-guarded move helper
// when no leg is in flight, and on stalled progress wanders (Baritone's explore process ->
// our TimeoutWanderTask plan-B legs).
import {Task} from '../task.js';
import * as move from './move.js';
import {TimeoutWanderTask} from './timeout-wander-task.js';
import {MovementProgressChecker} from './progress-checker.js';

export class CustomBaritoneGoalTask extends Task {
 constructor(name,{wander=true,navSeconds=8,ctx=null}={}){
  super(name);
  this.wander=wander;
  this.navSeconds=navSeconds;
  this.ctx=ctx; // fallback when the runner's tickTask passes only bot
  this.cachedGoal=null;
  this.wanderTask=null;
  this.navPromise=null;
  this.checker=new MovementProgressChecker(6,0.1,0.5,0.001);
 }
 onStart(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  this.cachedGoal=null;
  this.navPromise=null;
  this.checker.reset();
 }
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(!this.cachedGoal)this.cachedGoal=this.newGoal(bot,ctx);
  if(this.wander){
   if(this.isFinished(bot,ctx)){
    // Don't wander if we've reached our goal.
    this.checker.reset();
   }else{
    if(this.wanderTask&&this.wanderTask.started&&!this.wanderTask.isFinished(bot,ctx)){
     this.checker.reset();
     return this.wanderTask;
    }
    if(!this.checker.check(bot)){
     this.onWander(bot,ctx);
     this.wanderTask=this.wanderTask||new TimeoutWanderTask(10);
     return this.wanderTask;
    }
   }
  }
  // Re-issue only when no leg is in flight: the runner ticks us faster than pathing finishes.
  if(!this.navPromise){
   const leg=move.goto(ctx,this.cachedGoal,{seconds:this.navSeconds});
   this.navPromise=leg.finally(()=>{this.navPromise=null;});
  }
  return null;
 }
 isFinished(bot,ctx){
  if(!this.cachedGoal){try{this.cachedGoal=this.newGoal(bot,ctx);}catch{return false;}}
  if(!this.cachedGoal)return false;
  try{return this.cachedGoal.isEnd(bot.entity.position.floored());}catch{return false;}
 }
 onStop(bot,ctx,interrupt){
  // An in-flight leg cleans up after itself via move.goto's ownership guard; drop the
  // reference so a fresh start re-issues from scratch.
  this.navPromise=null;
  this.cachedGoal=null;
 }
 // Subclasses return the pathfinder goal for this task's intent.
 newGoal(bot,ctx){return null;}
 // Called when the progress checker gave up on the current leg.
 onWander(bot,ctx){}
}
