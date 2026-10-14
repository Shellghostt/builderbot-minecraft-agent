// Port of adris/altoclef/tasks/movement/GetCloseToBlockTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Approaching a block that may itself be unreachable (e.g. the middle of a lava pool):
// keep a strictly decreasing range so we get as close as we can.
import {Task} from '../task.js';
import {GetWithinRangeOfBlockTask} from './get-within-range-of-block-task.js';

export class GetCloseToBlockTask extends Task {
 constructor(toApproach,{ctx=null}={}){
  super('GetCloseToBlockTask');
  this.ctx=ctx;
  this.toApproach=toApproach;
  this.currentRange=Number.MAX_SAFE_INTEGER;
 }
 onStart(bot,ctx){this.currentRange=Number.MAX_SAFE_INTEGER;}
 onTick(bot,ctx){
  // Always bump the range down if we've met it; strictly decreasing, so we eventually
  // get as close as we can.
  if(this.inRange(bot))this.currentRange=this.getCurrentDistance(bot)-1;
  return new GetWithinRangeOfBlockTask(this.toApproach,Math.max(0,this.currentRange),{ctx:this.ctx||ctx});
 }
 getCurrentDistance(bot){
  const p=bot.entity.position.floored();
  const dx=p.x-this.toApproach.x,dy=p.y-this.toApproach.y,dz=p.z-this.toApproach.z;
  return Math.floor(Math.sqrt(dx*dx+dy*dy+dz*dz));
 }
 inRange(bot){return this.getCurrentDistance(bot)<=this.currentRange;}
 isEqual(other){return other instanceof GetCloseToBlockTask&&Math.floor(other.toApproach.x)===Math.floor(this.toApproach.x)&&Math.floor(other.toApproach.y)===Math.floor(this.toApproach.y)&&Math.floor(other.toApproach.z)===Math.floor(this.toApproach.z);}
}
