// Port of adris/altoclef/tasks/movement/RunAwayFromCreepersTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Run away from tracked creepers NOW (force-cancels whatever path is running), scoring
// candidate positions with creeper safety. The Java safety formula lives in
// MobDefenseChain (P2's chains); it can be injected via `cost`, otherwise plain distance.
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {GoalRunAwayFromEntities,blockGoal} from './goals.js';
import * as move from './move.js';

export class RunAwayFromCreepersTask extends CustomBaritoneGoalTask {
 constructor(distance,{cost,creeperSupplier,ctx=null}={}){
  super('RunAwayFromCreepersTask',{ctx});
  // movementTask resolves factories by name with no args, so an instance built through
  // ctx.move must still run without the chain-supplied distance (Java's chain passes 10):
  // default to a full break-off instead of an undefined goal radius.
  this.distanceToRun=distance??24;
  this.cost=cost;
  this.creeperSupplier=creeperSupplier||((bot)=>Object.values(bot.entities||{}).filter(e=>e&&e!==bot.entity&&e.name==='creeper'&&e.position));
 }
 onStart(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  super.onStart(bot,ctx);
  // We want to run away NOW.
  move.cancel(ctx);
 }
 newGoal(bot,ctx){
  // A concrete block goal on the away vector: mineflayer-pathfinder's A* MINIMISES f=g+h,
  // so a pure run-away heuristic (negative costs) makes the search expand the whole map
  // and time out before the bot takes a step. Java's GoalRunAway relied on Baritone
  // MAXIMISING its heuristic; here the same intent is a snapshotted destination the
  // pathfinder solves instantly, re-issued when the chain rebuilds the task.
  const list=this.creeperSupplier(bot)
   .sort((a,b)=>a.position.distanceSquared(bot.entity.position)-b.position.distanceSquared(bot.entity.position));
  if(!list.length)return null;
  const dest=move.awayFrom(bot.entity.position,list[0].position,this.distanceToRun);
  return blockGoal(dest.x,dest.y,dest.z);
 }
 isEqual(other){return other instanceof RunAwayFromCreepersTask&&Math.abs(other.distanceToRun-this.distanceToRun)<=1;}
}
