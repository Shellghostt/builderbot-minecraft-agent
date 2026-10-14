// Port of adris/altoclef/tasks/movement/TimeoutWanderTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// "Call this when the place you're currently at is bad for some reason and you just wanna
// get away." Baritone's explore process -> random-direction GoalXZ legs around the origin;
// the Java plan B (GoalRunAway in a random direction) is kept as-is. Stuck-in-plant/fence
// detection -> SafeRandomShimmyTask, like the original.
import {Task} from '../task.js';
import * as move from './move.js';
import * as goals from './goals.js';
import {SafeRandomShimmyTask} from './safe-random-shimmy-task.js';
import {MovementProgressChecker} from './progress-checker.js';

// Happens all the time in mineshafts and swamps/jungles.
const ANNOYING_STUCK_BLOCKS=new Set([
 'oak_fence','spruce_fence','birch_fence','jungle_fence','acacia_fence','dark_oak_fence','mangrove_fence','cherry_fence','bamboo_fence','crimson_fence','warped_fence','nether_brick_fence',
 'vine','cave_vines','cave_vines_plant','twisting_vines','twisting_vines_plant','weeping_vines','weeping_vines_plant','ladder','big_dripleaf','big_dripleaf_stem','small_dripleaf','tall_grass','short_grass','grass','snow','snow_layer','sweet_berry_bush'
]);
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];

export class TimeoutWanderTask extends Task {
 // distanceToWander Infinity: wander until told otherwise (Java TimeoutWanderTask(true)
 // forces exploration with no distance cap).
 constructor(distanceToWander=Infinity,increaseRange=false,forceExplore=false,{ctx=null}={}){
  super('TimeoutWanderTask');
  this.ctx=ctx;
  this.distanceToWander=distanceToWander;
  this.increaseRange=increaseRange;
  this.forceExplore=forceExplore;
  this.origin=null;
  this.executingPlanB=false;
  this.failCounter=0;
  this.wanderDistanceExtension=0;
  this.unstuckTask=null;
  this.navPromise=null;
  this.progress=new MovementProgressChecker(6,0.5);
  this.navSeconds=6;
 }
 resetWander(){this.executingPlanB=false;this.wanderDistanceExtension=0;}
 onStart(bot,ctx){
  this.origin=bot.entity.position.clone();
  this.failCounter=0;
  this.navPromise=null;
  this.progress.reset();
 }
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(this.unstuckTask&&this.unstuckTask.started&&!this.unstuckTask.isFinished(bot,ctx)&&this.stuckInBlock(bot)){
   // Stop other navigation, we are JUST shimmying.
   move.cancel(ctx);
   this.navPromise=null;
   return this.unstuckTask;
  }
  if(!this.navPromise){
   const goal=this.executingPlanB?this.getRandomDirectionGoal(bot):this.getExploreGoal(bot);
   this.navPromise=move.goto(ctx,goal,{seconds:this.navSeconds}).finally(()=>{this.navPromise=null;});
  }
  if(!this.progress.check(bot)){
   this.progress.reset();
   this.failCounter++;
   const blockStuck=this.stuckInBlock(bot);
   if(blockStuck){
    this.unstuckTask=this.unstuckTask||new SafeRandomShimmyTask();
    return this.unstuckTask;
   }
   if(!this.forceExplore){
    if(this.executingPlanB)move.cancel(ctx); // cancel current plan B
    this.executingPlanB=true;
    this.navPromise=null;
   }
  }
  return null;
 }
 getExploreGoal(bot){
  // Explore: a leg in a fresh direction from the origin (Baritone's ExploreProcess).
  const from=this.origin||bot.entity.position;
  const dir=DIRS[Math.floor(Math.random()*DIRS.length)];
  const distance=Math.min(this.distanceToWander===Infinity?48:this.distanceToWander,32)+this.wanderDistanceExtension;
  return goals.xzGoal(from.x+dir[0]*distance,from.z+dir[1]*distance);
 }
 getRandomDirectionGoal(bot){
  const distance=this.distanceToWander===Infinity?32:this.distanceToWander+this.wanderDistanceExtension;
  return new goals.GoalRunAway(distance,[bot.entity.position.floored()]);
 }
 isFinished(bot,ctx){
  if(this.distanceToWander===Infinity)return false;
  // If we fail 10 times or more, we may as well try the previous task again.
  if(this.failCounter>10)return true;
  try{
   const sqDist=bot.entity.position.distanceSquared(this.origin);
   const toWander=this.distanceToWander+this.wanderDistanceExtension;
   return sqDist>toWander*toWander;
  }catch{return false;}
 }
 onStop(bot,ctx,interrupt){
  this.navPromise=null;
  if(this.isFinished(bot,ctx)&&this.increaseRange){
   this.wanderDistanceExtension+=this.distanceToWander;
  }
 }
 isEqual(other){
  if(!(other instanceof TimeoutWanderTask))return false;
  if(this.distanceToWander===Infinity||other.distanceToWander===Infinity)return this.distanceToWander===other.distanceToWander;
  return Math.abs(other.distanceToWander-this.distanceToWander)<0.5;
 }
 stuckInBlock(bot){
  const p=bot.entity.position.floored();
  const isAnnoying=at=>{try{return ANNOYING_STUCK_BLOCKS.has(bot.blockAt(at)?.name);}catch{return false;}};
  if(isAnnoying(p)||isAnnoying(p.offset(0,1,0)))return p;
  for(const [dx,dz] of DIRS)if(isAnnoying(p.offset(dx,0,dz)))return p;
  for(const [dx,dz] of DIRS)if(isAnnoying(p.offset(dx,1,dz)))return p;
  return null;
 }
}
