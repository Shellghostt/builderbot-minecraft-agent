// Port of adris/altoclef/tasks/movement/RunAwayFromPositionTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Baritone GoalRunAway -> our GoalRunAway on the pathfinder interface; the flat
// away-direction fallback (awayFrom) doubles as the flee bearing when pathing fails.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {GoalRunAway} from './goals.js';
import * as move from './move.js';

export class RunAwayFromPositionTask extends CustomBaritoneGoalTask {
 // distance: how far away to get; positions: danger block positions; maintainY: pin the Y.
 constructor(distance,positions,{maintainY=null,ctx=null}={}){
  super('RunAwayFromPositionTask',{ctx});
  this.distance=distance;
  this.positions=(positions||[]).map(p=>p&&p.position?p.position:p);
  this.maintainY=maintainY;
  this.dest=null;
 }
 // The bearing straight away from the nearest danger, `distance` blocks out (used to
 // seed the goal region and as a fallback destination).
 static awayFrom(from,danger,distance){return move.awayFrom(from,danger,distance);}
 newGoal(bot,ctx){
  const from=bot.entity.position.floored();
  let nearest=null,best=Infinity;
  for(const p of this.positions){
   const dx=p.x-from.x,dy=p.y-from.y,dz=p.z-from.z,sq=dx*dx+dy*dy+dz*dz;
   if(sq<best){best=sq;nearest=p;}
  }
  this.dest=nearest?move.awayFrom(from,nearest,this.distance):from.clone();
  return new GoalRunAway(this.distance,this.positions,{maintainY:this.maintainY});
 }
 isEqual(other){return other instanceof RunAwayFromPositionTask&&other.distance===this.distance&&other.positions.length===this.positions.length&&other.positions.every((p,i)=>{const q=this.positions[i];return Math.floor(p.x)===Math.floor(q.x)&&Math.floor(p.y)===Math.floor(q.y)&&Math.floor(p.z)===Math.floor(q.z);});}
}
