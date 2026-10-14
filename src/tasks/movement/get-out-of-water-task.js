// Adapted for BuilderBot from AltoClef's WorldSurvivalChain.handleDrowning
// (MIT License, Copyright (c) 2020 Adris Jautakas): AltoClef held jump as a reflex while
// drowning; as a task we pick the nearest walk-out spot (solid ground, two air above, no
// fluid) and path there, jumping to keep our air up while submerged.
import {Vec3} from 'vec3';
import {Task} from '../task.js';
import {blockGoal} from './goals.js';
import * as move from './move.js';

export function inWater(bot){
 if(bot.entity?.isInWater)return true;
 try{const p=bot.entity.position.floored();return ['water','seagrass','tall_seagrass','kelp','kelp_plant'].includes(bot.blockAt(p)?.name)||['water'].includes(bot.blockAt(new Vec3(p.x,p.y+1,p.z))?.name);}catch{return false;}
}
export function findNearestLand(bot,from,radius=24){
 for(let r=0;r<=radius;r++){
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   for(let dy=3;dy>=-3;dy--){
    const p=new Vec3(Math.floor(from.x)+dx,Math.floor(from.y)+dy,Math.floor(from.z)+dz);
    const body=bot.blockAt(p);
    if(!body||!['air','cave_air','void_air'].includes(body.name))continue;
    if(!['air','cave_air','void_air'].includes(bot.blockAt(new Vec3(p.x,p.y+1,p.z))?.name))continue;
    const ground=bot.blockAt(new Vec3(p.x,p.y-1,p.z));
    if(!ground||ground.boundingBox!=='block'||['water','lava'].includes(ground.name))continue;
    return p;
   }
  }
 }
 return null;
}

export class GetOutOfWaterTask extends Task {
 constructor({maxSeconds=30,radius=24,ctx=null}={}){
  super('GetOutOfWaterTask');
  this.ctx=ctx;
  this.maxSeconds=maxSeconds*1000;
  this.radius=radius;
  this.startedAt=null;
  this.navPromise=null;
 }
 onStart(bot,ctx){this.startedAt=Date.now();this.navPromise=null;}
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  if(!this.startedAt)this.startedAt=Date.now();
  // Swim up while our air runs low (the ported drowning reflex).
  if((bot.oxygenLevel??20)<(bot.oxygenMaximum??20))move.setControls(ctx,{jump:true});
  else move.releaseControls(ctx,['jump']);
  if(!this.navPromise&&!this.isFinished(bot,ctx)){
   const land=findNearestLand(bot,bot.entity.position.floored(),this.radius);
   if(land){
    const leg=move.goto(ctx,blockGoal(land.x,land.y,land.z),{seconds:8});
    this.navPromise=leg.finally(()=>{this.navPromise=null;});
   }
  }
  return null;
 }
 isFinished(bot,ctx){
  if(!inWater(bot)&&bot.entity.onGround)return true;
  return this.startedAt!=null&&Date.now()-this.startedAt>this.maxSeconds; // give up; the chain re-decides
 }
 onStop(bot,ctx,interrupt){
  move.releaseControls(ctx,['jump']);
  this.navPromise=null;
 }
 isEqual(other){return other instanceof GetOutOfWaterTask;}
}
