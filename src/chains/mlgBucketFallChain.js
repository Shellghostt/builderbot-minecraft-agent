// Port of adris/altoclef chains/MLGBucketFallChain.java: MLG water bucket while falling
// fast (priority 100, velocity y < -0.7 like the Java threshold), and picking the placed
// water back up (60). The chorus-fruit levitation escape is ported with guards.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {chainConfig,inGame,hasEffect} from './settings.js';
import {hasItemName} from './combatPolicy.js';
import {movementTask,MLGBucketTask,InteractWithBlockTask} from './fallbackTasks.js';
export class MLGBucketFallChain extends SingleTaskChain{
 constructor(){
  super('MLG Water Bucket Fall Chain');
  this._lastMLG=null;
  this._tryCollectWaterUntil=0;
  this.now=()=>Date.now()/1000;
 }
 priority(bot,ctx){
  if(!inGame(bot))return -1;
  const cfg=chainConfig(ctx);
  if(this.isFallingOhNo(bot,cfg)){
   this._tryCollectWaterUntil=this.now()+4;
   const task=movementTask(ctx,'MLGBucketTask',()=>new MLGBucketTask());
   this._lastMLG=task instanceof MLGBucketTask?task:null;
   this.root=task;
   return 100;
  }
  // Just placed water while falling: collect it again before moving on.
  if(this.now()<this._tryCollectWaterUntil&&(bot.entity.velocity?bot.entity.velocity.y:0)>=-0.5){
   if(hasItemName(bot,'bucket')&&!hasItemName(bot,'water_bucket')&&this._lastMLG&&this._lastMLG.placedPos){
    const placed=this._lastMLG.placedPos;
    const me=bot.entity.position;
    if(me.distanceTo?me.distanceTo(placed)<=5.5:Math.abs(me.x-placed.x)+Math.abs(me.z-placed.z)<8){
     this.root=new InteractWithBlockTask(placed,'water_bucket');
     return 60;
    }
   }
  }else if(this.now()>=this._tryCollectWaterUntil){
   this._lastMLG=null;
  }
  // Levitation over the void: chorus fruit out of it when the effect is about to end.
  if(hasEffect(bot,'levitation')&&hasItemName(bot,'chorus_fruit')&&!hasItemName(bot,'water_bucket')){
   this._chorusFruit(bot);
  }
  return -1;
 }
 // mineflayer effect entries carry duration when available; guard everything (Java reads
 // the remaining duration and the item cooldown).
 _chorusFruit(bot){
  const effects=bot.entity&&bot.entity.effects;
  const lev=effects&&Object.values(effects).find(x=>x&&x.id===25);
  if(lev&&typeof lev.duration==='number'&&lev.duration>70)return;
  if(this._fruiting||typeof bot.consume!=='function')return;
  this._fruiting=true;
  (async()=>{
   try{await bot.equip({name:'chorus_fruit'},'hand');await bot.consume();}
   catch{}
   finally{this._fruiting=false;}
  })();
 }
 isFallingOhNo(bot,cfg){
  const c=cfg||chainConfig(null);
  if(c.autoMLGBucket===false)return false;
  const e=bot.entity||{};
  if(e.onGround||e.isInWater||e.isInLava||e.isClimbing)return false;
  // The Java chain only MLGs WITH a water bucket in the inventory: without one there is no
  // recovery to perform, and a bucketless claim would pause every fall of every job.
  if(!hasItemName(bot,'water_bucket'))return false;
  const ySpeed=e.velocity?e.velocity.y:0;
  return ySpeed<-0.7;
 }
}
