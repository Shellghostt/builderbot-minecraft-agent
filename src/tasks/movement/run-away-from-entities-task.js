// Port of adris/altoclef/tasks/movement/RunAwayFromEntitiesTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// GoalRunAwayFromEntities (AltoClef's, in util/baritone) -> our dynamic goal on the
// pathfinder interface; the danger list comes from the live supplier each evaluation.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {GoalRunAwayFromEntities} from './goals.js';

export class RunAwayFromEntitiesTask extends CustomBaritoneGoalTask {
 // toRunAwayFrom: supplier returning the entities to flee; distanceToRun: how far is safe;
 // xz: ignore height differences; penalty: see GoalRunAwayFromEntities; cost: per-entity
 // cost override (the creeper task plugs creeper safety in here).
 constructor(toRunAwayFrom,distanceToRun,xz,penalty=1,{cost,ctx=null}={}){
  super('RunAwayFromEntitiesTask',{ctx});
  this.toRunAwayFrom=toRunAwayFrom;
  this.distanceToRun=distanceToRun;
  this.xz=xz;
  this.penalty=penalty;
  this.cost=cost;
 }
 newGoal(bot,ctx){
  return new GoalRunAwayFromEntities(this.distanceToRun,{xz:this.xz,penalty:this.penalty,cost:this.cost,getEntities:this.toRunAwayFrom});
 }
 isEqual(other){
  return other instanceof RunAwayFromEntitiesTask&&other.toRunAwayFrom===this.toRunAwayFrom&&Math.abs(other.distanceToRun-this.distanceToRun)<0.5&&other.xz===this.xz;
 }
}
