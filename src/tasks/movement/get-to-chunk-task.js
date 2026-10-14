// Port of adris/altoclef/tasks/movement/GetToChunkTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalChunk -> our chunk goal; the progress checker is more lenient than the default,
// as we are traversing entire chunks here.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {chunkGoal} from './goals.js';
import {MovementProgressChecker} from './progress-checker.js';

export class GetToChunkTask extends CustomBaritoneGoalTask {
 constructor(chunkPos,{ctx=null}={}){ // chunkPos: {x,z}
  super('GetToChunkTask',{navSeconds:20,ctx});
  this.pos=chunkPos;
  this.checker=new MovementProgressChecker(20,0.5,5,0.001,3);
 }
 newGoal(bot,ctx){return chunkGoal(this.pos.x,this.pos.z);}
 isEqual(other){return other instanceof GetToChunkTask&&other.pos.x===this.pos.x&&other.pos.z===this.pos.z;}
}
