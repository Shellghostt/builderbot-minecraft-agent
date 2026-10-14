// Port of adris/altoclef/trackers/EntityTracker.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
//
// Keeps track of entities so we can search/grab them.
// Mineflayer mapping: MinecraftClient.world.getEntities() -> bot.entities values;
// entity classes -> entity.name/kind categories; ControllerExtras.inRange -> a distance
// check (default 4.5); PlayerCollidedWithEntityEvent and projectile caching are skipped
// (they needed client mixins; dodge behaviour belongs to the chains, not the tracker).
import {Vec3} from 'vec3';
import {ObjectBlacklist} from './blacklist.js';
const distSq=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return dx*dx+dy*dy+dz*dz;};
const isAlive=(bot,e)=>e!=null&&(e.id==null||bot.entities[e.id]===e||bot.entities[e.id]?.uuid===e.uuid||Object.values(bot.entities).includes(e));
// Dropped-item stacks live in the item entity's metadata; guard the index (version dependent).
function dropName(e){
 try{
  const stack=e.metadata?.[8];
  if(stack&&typeof stack.name==='string')return stack.name;
  for(const m of e.metadata||[])if(m&&typeof m.name==='string'&&(m.count!=null||m.itemId!=null))return m.name;
 }catch{}
 return null;
}

export class EntityTracker {
 constructor(config={}){
  this.config={inRange:4.5,hostileRange:26,...config};
  this.itemDrops=new Map(); // item name -> [entity]
  this.entityMap=new Map(); // category name -> [entity]
  this.closeEntities=[];
  this.hostiles=[];
  this.players=new Map(); // username -> entity
  this.playerLast=new Map(); // username -> Vec3
  this.blacklist=new ObjectBlacklist(); // EntityLocateBlacklist
  this.dirty=true;
 }
 setDirty(){this.dirty=true;}
 // Port of reset(): the dirty flag clears everything else, the give-up list needs clearing too.
 invalidate(){this.blacklist.clear();this.setDirty();}
 ensureUpdated(bot){if(this.dirty)this.updateState(bot);}
 updateState(bot){
  this.itemDrops.clear();this.entityMap.clear();
  this.closeEntities=[];this.hostiles=[];
  this.players.clear();this.playerLast.clear();
  if(!bot)return;
  for(const entity of Object.values(bot.entities||{})){
   if(!entity||!entity.position)continue;
   if(entity===bot.entity||entity.username===bot.username)continue; // never catalogue ourselves
   if(!isAlive(bot,entity))continue;
   const name=entity.name||entity.displayName||'unknown';
   if(!this.entityMap.has(name))this.entityMap.set(name,[]);
   this.entityMap.get(name).push(entity);
   const distance=Math.sqrt(distSq(entity.position,bot.entity.position));
   if(distance<=this.config.inRange)this.closeEntities.push(entity);
   if(entity.kind==='hostile'&&distance<=this.config.hostileRange)this.hostiles.push(entity);
   if(entity.name==='item'||entity.type==='item'){
    const item=dropName(entity);
    if(item){
     // Only care about GROUNDED item entities (or ones resting on/in something).
     const grounded=entity.onGround===true||entity.isInWater===true||this.solidBelow(bot,entity,2)||this.solidBelow(bot,entity,3);
     if(grounded){
      if(!this.itemDrops.has(item))this.itemDrops.set(item,[]);
      this.itemDrops.get(item).push(entity);
     }
    }
   }else if(entity.type==='player'||entity.username){
    this.players.set(entity.username,entity);
    this.playerLast.set(entity.username,entity.position.clone?entity.position.clone():new Vec3(entity.position.x,entity.position.y,entity.position.z));
   }
  }
  this.dirty=false;
 }
 solidBelow(bot,entity,dy){
  try{const p=entity.position.floored();return bot.blockAt(new Vec3(p.x,p.y-dy,p.z))?.boundingBox==='block';}catch{return false;}
 }
 getTrackedEntities(bot,kind){this.ensureUpdated(bot);return this.entityMap.get(kind)?[...this.entityMap.get(kind)]:[];}
 entityFound(bot,...kinds){
  this.ensureUpdated(bot);
  for(const kind of kinds)if(this.entityMap.get(kind)?.length)return true;
  return false;
 }
 getClosestEntity(bot,kinds,{pos,filter}={}){
  this.ensureUpdated(bot);
  let closest=null,minCost=Infinity;
  for(const kind of kinds){
   for(const entity of this.entityMap.get(kind)||[]){
    if(!isAlive(bot,entity))continue; // don't accept entities that no longer exist
    if(filter&&!filter(entity))continue;
    if(this.blacklist.unreachable(entity))continue;
    const cost=distSq(entity.position,pos||bot.entity.position);
    if(cost<minCost){minCost=cost;closest=entity;}
   }
  }
  return closest;
 }
 getCloseEntities(bot){this.ensureUpdated(bot);return [...this.closeEntities];}
 getHostiles(bot){this.ensureUpdated(bot);return [...this.hostiles];}
 getDroppedItems(bot){this.ensureUpdated(bot);return [...this.itemDrops.values()].flat();}
 itemDropped(bot,...items){
  this.ensureUpdated(bot);
  for(const item of items)for(const entity of this.itemDrops.get(item)||[])if(!this.blacklist.unreachable(entity))return true;
  return false;
 }
 getClosestItemDrop(bot,items,{pos,filter}={}){
  this.ensureUpdated(bot);
  if(!items.length)return null;
  let closest=null,minCost=Infinity;
  for(const item of items){
   for(const entity of this.itemDrops.get(item)||[]){
    if(this.blacklist.unreachable(entity))continue;
    if(dropName(entity)!==item)continue;
    if(filter&&!filter(entity))continue;
    const cost=distSq(entity.position,pos||bot.entity.position);
    if(cost<minCost){minCost=cost;closest=entity;}
   }
  }
  return closest;
 }
 isPlayerLoaded(bot,name){this.ensureUpdated(bot);return this.players.has(name);}
 getPlayerMostRecentPosition(bot,name){this.ensureUpdated(bot);return this.playerLast.get(name)||null;}
 getPlayerEntity(bot,name){this.ensureUpdated(bot);return this.players.get(name)||null;}
 // Tells the entity tracker that we were unable to reach this entity.
 requestEntityUnreachable(bot,entity){this.blacklist.blackListItem(bot,entity,3);}
 isEntityReachable(bot,entity){return !this.blacklist.unreachable(entity);}
}
