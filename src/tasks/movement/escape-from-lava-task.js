// Port of adris/altoclef/tasks/movement/EscapeFromLavaTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// The Java task used a dynamic Baritone goal (isInGoal: not lava and not lava-adjacent,
// water strongly discouraged). With mineflayer-pathfinder we pre-compute the same
// target: findSafeBlock picks the nearest standing spot that is not lava, has no lava
// in its horizontal neighbours and is not water; sprint+jump while still in lava.
// Never wanders (the Java checker was set to never fail).
import {Vec3} from 'vec3';
import {CustomBaritoneGoalTask} from './custom-baritone-goal-task.js';
import {blockGoal} from './goals.js';
import * as move from './move.js';

export const LAVA_NAMES=new Set(['lava']);
const passable=b=>!b||['air','cave_air','void_air','water'].includes(b.name);
const isLava=b=>!!b&&LAVA_NAMES.has(b.name);

export function inLava(bot){
 // Block data is the authority: ViaVersion's entity.isInLava STICKS TRUE after the bot
 // exits (same failure mode as isInWater - measured 2026-10-13: the escape task never
 // popped, the chain stayed at priority 100 and the douse band never armed; the bot burned
 // to death mid-burn-clock). isInLava only decides when the client has no blocks under it.
 const e=bot&&bot.entity;if(!e||!e.position)return false;
 const p=e.position.floored();
 const at=dy=>{try{const b=bot.blockAt&&bot.blockAt(new Vec3(p.x,p.y+dy,p.z));return b&&LAVA_NAMES.has(b.name);}catch{return false;}};
 if(at(0)||at(-1)||at(1))return true;
 if(e.isInLava){
  try{const under=bot.blockAt&&bot.blockAt(new Vec3(p.x,p.y-1,p.z));if(!under)return true;}catch{}
 }
 return false;
}
export function isOnFire(bot){
 try{return !!(bot.entity?.metadata?.[0]&0x01);}catch{return false;}
}
export function findSafeBlock(bot,from,radius=16){
 const floor=(p)=>bot.blockAt(new Vec3(p.x,p.y-1,p.z));
 const lavaAdjacent=(p)=>{
  for(const d of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1]])if(isLava(bot.blockAt(new Vec3(p.x+d[0],p.y,p.z+d[1]))))return true;
  return false;
 };
 // Rings by distance so "nearest" wins; y constrained to climbing distance from the bot.
 for(let r=0;r<=radius;r++){
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   for(let dy=2;dy>=-1;dy--){
    const p=new Vec3(Math.floor(from.x)+dx,Math.floor(from.y)+dy,Math.floor(from.z)+dz);
    const body=bot.blockAt(p);
    if(!passable(body))continue;
    if(!passable(bot.blockAt(new Vec3(p.x,p.y+1,p.z))))continue;
    const ground=floor(p);
    if(!ground||ground.boundingBox!=='block')continue;
    if(isLava(body)||isLava(ground)||lavaAdjacent(p)||lavaAdjacent(new Vec3(p.x,p.y-1,p.z)))continue;
    // Water is discouraged (heuristic -100 in the Java goal): take it only if it is the
    // only escape left, so keep scanning unless this ring yields nothing better.
    if(body.name==='water'||ground.name==='water')continue;
    return p;
   }
  }
 }
 // Water escape as a last resort.
 for(let r=0;r<=radius;r++){
  for(let dx=-r;dx<=r;dx++)for(let dz=-r;dz<=r;dz++){
   if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
   for(let dy=2;dy>=-1;dy--){
    const p=new Vec3(Math.floor(from.x)+dx,Math.floor(from.y)+dy,Math.floor(from.z)+dz);
    const ground=bot.blockAt(new Vec3(p.x,p.y-1,p.z));
    const body=bot.blockAt(p);
    if(isLava(body)||isLava(ground))continue;
    if(ground&&ground.boundingBox==='block'&&passable(body))return p;
   }
  }
 }
 return null;
}

export class EscapeFromLavaTask extends CustomBaritoneGoalTask {
 constructor(strength=100,{ctx=null}={}){
  super('EscapeFromLavaTask',{wander:false,navSeconds:4,ctx});
  this.strength=strength;
 }
 onStart(bot,ctx){super.onStart(bot,ctx);this._bucketAttempts=0;this._pouring=null;}
 onTick(bot,ctx){
  ctx=move.pickCtx(this,ctx);
  // While IN lava the direct scramble OWNS movement - with NO pathfinder leg: a nav's
  // physics hook clears our jump/sprint every tick and a route out of lava wades anyway
  // (the burn clock wins). Raw controls hop the rim; isFinished pops the task on exit.
  if(inLava(bot)){
   if(this.navPromise){move.cancel(ctx);this.navPromise=null;}
   this.cachedGoal=null;this._safe=null;
   // Player move (A4 probe 2026-10-13: wading out alone cost ~7 hp and the post-exit burn
   // another ~4): pour the water bucket INTO the lava at our feet - the source turns to
   // obsidian/cobble under the bot and the burn clock stops with it. Two attempts per
   // episode (a tp yanks can abort the first mid-pour); while it runs the scramble holds
   // still (the pour's forced lookAt must not fight our look).
   if(this._pouring)return null;
   if((this._bucketAttempts||0)<2){
    const w=ctx&&ctx.worker;
    if(w&&typeof w.douseFire==='function'&&(bot.inventory.items()||[]).some(i=>i.name==='water_bucket')){
     this._bucketAttempts=(this._bucketAttempts||0)+1;
     this._pouring=(async()=>{
      try{await w.douseFire();}
      catch(e){try{w.log&&w.log('Bucket-into-lava skipped: '+e.message);}catch{}}
      finally{this._pouring=null;this._safe=null;this._safeAt=0;}
     })();
     return null;
    }
   }
   move.setControls(ctx,{jump:true,sprint:true});
   try{
    if(!this._safe||Date.now()-(this._safeAt||0)>1000){this._safe=findSafeBlock(bot,bot.entity.position.floored(),16);this._safeAt=Date.now();}
    if(this._safe){
     const dx=this._safe.x+0.5-bot.entity.position.x,dz=this._safe.z+0.5-bot.entity.position.z;
     if(Math.hypot(dx,dz)>0.3)bot.look(Math.atan2(-dx,-dz),0,false).catch(()=>{});
     move.setControls(ctx,{forward:true});
    }
   }catch{}
   return null;
  }
  move.releaseControls(ctx,['jump','sprint','forward']);
  this._safe=null;
  // Out of the lava: one nav leg to the last safe block solidifies the escape until the
  // runner pops this task (isFinished is true out of the lava).
  if(!this.navPromise)this.cachedGoal=null;
  return super.onTick(bot,ctx);
 }
 // Out of the lava = done. The post-exit FIRE belongs to the ExtinguishWithWater chain
 // (priority 90): if this task held the tree while burning, the douse could never run.
 isFinished(bot,ctx){return !inLava(bot);}
 newGoal(bot,ctx){
  const safe=findSafeBlock(bot,bot.entity.position.floored(),16);
  if(!safe)return null; // nowhere visible to go; keep sprint/jump alive until there is
  return blockGoal(safe.x,safe.y,safe.z);
 }
 isEqual(other){return other instanceof EscapeFromLavaTask;}
 onStop(bot,ctx,interrupt){
  move.releaseControls(ctx,['jump','sprint']);
  super.onStop(bot,ctx,interrupt);
 }
}
