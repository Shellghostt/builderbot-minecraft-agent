// Port of adris/altoclef/tasks/movement/GetToEntityTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalFollowEntity -> our dynamic follow goal via the guarded move helper. Deviation: a
// vanished entity counts as finished (the Java version wandered forever after Baritone
// lost a dead target; our chains re-decide instead).
import {Task} from '../task.js';
import * as move from './move.js';
import * as goals from './goals.js';
import {TimeoutWanderTask} from './timeout-wander-task.js';
import {MovementProgressChecker} from './progress-checker.js';

export class GetToEntityTask extends Task {
 constructor(entity,closeEnoughDistance=1,{ctx=null}={}){
  super('GetToEntityTask');
  this.ctx=ctx;
  this.entity=entity;
  this.closeEnoughDistance=closeEnoughDistance;
  this.progress=new MovementProgressChecker(5,0.1,5,0.001,2);
  this.wanderTask=null;
  this.navPromise=null;
 }
 entityExists(bot){return this.entity&&this.entity.position!=null&&(this.entity.id==null||bot.entities[this.entity.id]!=null);}
 onStart(bot,ctx){this.navPromise=null;this.wanderTask=null;this.progress.reset();}
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(!this.entityExists(bot,ctx))return null; // goal gone; isFinished ends us
  if(this.wanderTask&&this.wanderTask.started&&!this.wanderTask.isFinished(bot,ctx)){
   this.progress.reset();
   return this.wanderTask;
  }
  if(!this.navPromise){
   this.navPromise=move.goto(ctx,goals.followEntityGoal(this.entity,this.closeEnoughDistance),{seconds:5})
    .finally(()=>{this.navPromise=null;});
  }
  if(this.entity.position.distanceTo(bot.entity.position)<=this.closeEnoughDistance)this.progress.reset();
  if(!this.progress.check(bot)){
   this.wanderTask=this.wanderTask||new TimeoutWanderTask(10);
   return this.wanderTask;
  }
  return null;
 }
 isFinished(bot,ctx){
  if(!this.entityExists(bot,ctx))return true;
  try{return bot.entity.position.distanceTo(this.entity.position)<=this.closeEnoughDistance;}catch{return false;}
 }
 onStop(bot,ctx,interrupt){this.navPromise=null;}
 isEqual(other){return other instanceof GetToEntityTask&&other.entity===this.entity&&Math.abs(other.closeEnoughDistance-this.closeEnoughDistance)<0.1;}
}
