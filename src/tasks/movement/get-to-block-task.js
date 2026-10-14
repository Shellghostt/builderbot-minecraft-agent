// Port of adris/altoclef/tasks/movement/GetToBlockTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalBlock -> pathfinder GoalBlock via the guarded move helper. The Java preferStairs
// behaviour stack is a no-op (pathfinder has no stair preference); dimension checks are kept
// (DefaultGoToDimensionTask is out of scope, so wrong-dimension tasks simply never finish).
import {Vec3} from 'vec3';
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {blockGoal} from './goals.js';
import * as move from './move.js';
const same=(a,b)=>a&&b&&Math.floor(a.x)===Math.floor(b.x)&&Math.floor(a.y)===Math.floor(b.y)&&Math.floor(a.z)===Math.floor(b.z);

export class GetToBlockTask extends CustomBaritoneGoalTask {
 constructor(position,{preferStairs=false,dimension=null,ctx=null}={}){
  super('GetToBlockTask',{ctx});
  this.position=new Vec3(position.x,position.y,position.z);
  this.preferStairs=preferStairs;
  this.dimension=dimension;
 }
 dimensionOk(bot){return this.dimension==null||(bot.game?.dimension??'overworld')===this.dimension;}
 newGoal(bot,ctx){return blockGoal(this.position.x,this.position.y,this.position.z);}
 isFinished(bot,ctx){return super.isFinished(bot,ctx)&&this.dimensionOk(bot);}
 isEqual(other){return other instanceof GetToBlockTask&&same(other.position,this.position)&&other.preferStairs===this.preferStairs&&other.dimension===this.dimension;}
 onWander(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  // Blacklist the unreachable block so the search picks another one for a while
  // (this replaces our old "gather attempt N failed" loops).
  try{ctx&&ctx.trackers&&ctx.trackers.blocks&&ctx.trackers.blocks.requestBlockUnreachable(bot,this.position);}catch{}
 }
}
