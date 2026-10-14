// Port of adris/altoclef/tasks/movement/GetToXZTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalXZ -> pathfinder GoalXZ via the guarded move helper; pathfinder failures are
// absorbed (false return) and retried by the base progress checker, never thrown.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {xzGoal} from './goals.js';

export class GetToXZTask extends CustomBaritoneGoalTask {
 constructor(x,z,dimension=null,{ctx=null}={}){
  super('GetToXZTask',{ctx});
  this.x=Math.floor(x);this.z=Math.floor(z);
  this.dimension=dimension;
 }
 dimensionOk(bot){return this.dimension==null||(bot.game?.dimension??'overworld')===this.dimension;}
 newGoal(bot,ctx){return xzGoal(this.x,this.z);}
 isFinished(bot,ctx){
  const cur=bot.entity.position.floored();
  return cur.x===this.x&&cur.z===this.z&&this.dimensionOk(bot);
 }
 isEqual(other){return other instanceof GetToXZTask&&other.x===this.x&&other.z===this.z&&other.dimension===this.dimension;}
}
