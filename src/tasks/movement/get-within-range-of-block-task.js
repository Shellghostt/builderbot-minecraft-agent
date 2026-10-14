// Port of adris/altoclef/tasks/movement/GetWithinRangeOfBlockTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalNear -> pathfinder GoalNear.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {nearGoal} from './goals.js';

export class GetWithinRangeOfBlockTask extends CustomBaritoneGoalTask {
 constructor(blockPos,range,{ctx=null}={}){
  super('GetWithinRangeOfBlockTask',{ctx});
  this.blockPos=blockPos;
  this.range=range;
 }
 newGoal(bot,ctx){return nearGoal(this.blockPos.x,this.blockPos.y,this.blockPos.z,this.range);}
 isEqual(other){return other instanceof GetWithinRangeOfBlockTask&&Math.floor(other.blockPos.x)===Math.floor(this.blockPos.x)&&Math.floor(other.blockPos.y)===Math.floor(this.blockPos.y)&&Math.floor(other.blockPos.z)===Math.floor(this.blockPos.z)&&other.range===this.range;}
}
