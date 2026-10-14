// Port of adris/altoclef/trackers/BlockTracker.java (with its inner PosCache and
// BlockTrackerConfig) (MIT License, Copyright (c) 2020 Adris Jautakas).
//
// Tracks blocks the way we want it, when we want it: a "check and don't care" interface
// where tasks can look up blocks and their locations over and over without scanning the
// world over and over, plus blacklists for unreachable blocks.
//
// Baritone -> mineflayer mappings:
// - MineProcess.searchWorld -> our own scanning of loaded chunk columns near the bot
//   (Column.getBlock). Baritone scanned asynchronously off-thread; we spread the cost over
//   per-tick "slices" (columnsPerSlice columns per update) instead.
// - Block objects -> block name strings (prismarine registry names).
// - ConfigHelper config -> constructor options, same defaults as BlockTrackerConfig.
// - EventBus BlockPlaceEvent -> tasks may call addBlock when they place/dig.
import {Vec3} from 'vec3';
import {ObjectBlacklist} from './blacklist.js';
const keyOf=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const distSq=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return dx*dx+dy*dy+dz*dz;};

class PosCache {
 constructor(config={}){
  this.config=config;
  this.cachedBlocks=new Map(); // name -> Map(key -> Vec3)
  this.cachedByPosition=new Map(); // key -> name
  this.blacklist=new ObjectBlacklist({key:keyOf}); // WorldLocateBlacklist (positions, value-keyed)
 }
 anyFound(names){for(const name of names)if(this.cachedBlocks.get(name)?.size)return true;return false;}
 anyFoundWhere(names,test){
  for(const name of names){const spots=this.cachedBlocks.get(name);if(spots)for(const pos of spots.values())if(test(pos))return true;}
  return false;
 }
 getKnownLocations(names){
  const result=[];
  for(const name of names){const spots=this.cachedBlocks.get(name);if(spots)for(const pos of spots.values())result.push(pos);}
  return result;
 }
 removeBlock(pos,names){
  const key=keyOf(pos);
  for(const name of names){
   const spots=this.cachedBlocks.get(name);
   if(spots&&spots.delete(key)&&spots.size===0)this.cachedBlocks.delete(name);
  }
  if(this.cachedByPosition.get(key)&&names.includes(this.cachedByPosition.get(key)))this.cachedByPosition.delete(key);
 }
 addBlock(name,pos){
  if(this.blockUnreachable(pos))return;
  const key=keyOf(pos),existing=this.cachedByPosition.get(key);
  if(existing){if(existing===name)return;this.removeBlock(pos,[existing]);}
  if(!this.cachedBlocks.has(name))this.cachedBlocks.set(name,new Map());
  this.cachedBlocks.get(name).set(key,pos);
  this.cachedByPosition.set(key,name);
 }
 clear(){this.cachedBlocks.clear();this.cachedByPosition.clear();this.blacklist.clear();}
 blacklistBlockUnreachable(bot,pos,failuresAllowed){this.blacklist.blackListItem(bot,pos,failuresAllowed);}
 blockUnreachable(pos){return this.blacklist.unreachable(pos);}
 // Gets nearest block by a cheap heuristic (straight distance; the Java port used
 // Baritone's generic heuristic, we keep squared distance + a below-bias at the caller).
 getNearest(bot,position,names,isValid,isBlockValid){
  if(!this.anyFound(names))return null;
  let closest=null,minScore=Infinity;
  const known=this.getKnownLocations(names);
  let toPurge=known.length-this.config.maxCacheSizePerBlockType;
  for(const pos of known){
   // If a cached block is no longer valid, fix it up while we're iterating.
   if(isBlockValid&&!isBlockValid(bot,pos,names)){this.removeBlock(pos,names);continue;}
   if(isValid&&!isValid(pos))continue;
   const score=distSq(position,pos);
   if(score<minScore){minScore=score;closest=pos;}
   if(toPurge>0&&distSq(position,pos)>this.config.cutoffDistance*this.config.cutoffDistance){this.removeBlock(pos,names);toPurge--;}
  }
  while(toPurge>0&&known.length){known.pop();toPurge--;}
  return closest;
 }
 // Purge enough blocks so our cache stays small: drop blacklisted first, keep the closest.
 smartPurge(bot,playerPos){
  for(const [name,spots] of this.cachedBlocks){
   const kept=[...spots.values()]
    .filter(pos=>!this.blockUnreachable(pos))
    .sort((a,b)=>distSq(a,playerPos)-distSq(b,playerPos))
    .slice(0,this.config.maxCacheSizePerBlockType);
   this.cachedBlocks.set(name,new Map(kept.map(p=>[keyOf(p),p])));
  }
  const total=[...this.cachedBlocks.values()].reduce((a,m)=>a+m.size,0);
  if(total>this.config.maxTotalCacheSize){
   let toRemove=total-this.maxTotal;
   for(const [name,spots] of this.cachedBlocks){
    if(toRemove<=0)break;
    const entries=[...spots.entries()].sort((a,b)=>distSq(a[1],playerPos)-distSq(b[1],playerPos));
    const far=entries.slice(-Math.min(entries.length,toRemove));
    for(const [k] of far){spots.delete(k);this.cachedByPosition.delete(k);}
    toRemove-=far.length;
   }
  }
 }
}

export class BlockTracker {
 constructor(config={}){
  this.config={scanInterval:7,scanIntervalWhenNewBlocksFound:2,maxCacheSizePerBlockType:100,maxTotalCacheSize:10000,
   cutoffDistance:128,defaultUnreachableAttemptsAllowed:4,scanRadiusChunks:6,scanHeightMargin:32,columnsPerSlice:2,...config};
  this.refs=new Map(); // block name -> track refcount (the Java _trackingBlocks)
  this.caches=new Map(); // dimension -> PosCache
  this.lastScan=-Infinity;this.newBlockTimer=-Infinity;this.cycle=null;
  this.now=Date.now;
 }
 currentCache(bot){
  const dim=bot?.game?.dimension??'overworld';
  if(!this.caches.has(dim))this.caches.set(dim,new PosCache(this.config));
  return this.caches.get(dim);
 }
 // Port of reset(): caches clear wholesale; unlike setDirty this does NOT force a rescan
 // (the scanner refills on its own schedule, exactly like the Java tracker).
 invalidate(){for(const cache of this.caches.values())cache.clear();this.cycle=null;}
 setDirty(){this.lastScan=-Infinity;}
 isTracking(name){return (this.refs.get(name)??0)>0;}
 // Always pair with stopTracking, or the block stays tracked forever (harmless, but other
 // block types lose their cache budget).
 trackBlock(bot,...names){
  for(const name of names){
   if(!this.refs.has(name)){
    this.refs.set(name,0);
    this.setDirty();
    // New block types get scanned promptly (port of _forceElapseTimer logic).
    if(this.now()-this.newBlockTimer>this.config.scanIntervalWhenNewBlocksFound*1000){this.lastScan=-Infinity;this.newBlockTimer=this.now();}
   }
   this.refs.set(name,this.refs.get(name)+1);
  }
 }
 stopTracking(...names){
  for(const name of names){
   const count=this.refs.get(name);
   if(count===undefined)continue; // untracked more times than necessary: Java warns, we tolerate
   if(count<=1){this.refs.delete(name);this.setDirty();}
   else this.refs.set(name,count-1);
  }
 }
 // Manually add a block at a position (e.g. right after placing it).
 addBlock(bot,name,pos){if(this.blockIsValid(bot,pos,name))this.currentCache(bot).addBlock(name,pos.clone?pos.clone():new Vec3(pos.x,pos.y,pos.z));}
 anyFound(bot,...names){this.ensureUpdated(bot);return this.currentCache(bot).anyFound(names);}
 anyFoundWhere(bot,test,...names){this.ensureUpdated(bot);return this.currentCache(bot).anyFoundWhere(names,test);}
 getKnownLocations(bot,...names){this.ensureUpdated(bot);return this.currentCache(bot).getKnownLocations(names);}
 // Add juuust a little y bias, to prevent digging down all the time (blocks BELOW preferred).
 getNearestTracking(bot,names,{pos,filter}={}){
  for(const name of names)if(!this.isTracking(name))return null;
  this.ensureUpdated(bot);
  const from=pos?new Vec3(pos.x,pos.y,pos.z):bot.entity.position.clone().add(new Vec3(0,0.6,0));
  // spread n: blockIsValid takes the names as rest args
  return this.currentCache(bot).getNearest(bot,from,names,filter,(b,p,n)=>this.blockIsValid(b,p,...n));
 }
 // Checks whether it would be WRONG to say "at pos the block is name".
 // Returns true if correct OR undetermined (chunk not loaded).
 blockIsValid(bot,pos,...names){
  const cache=this.currentCache(bot);
  if(cache.blockUnreachable(pos))return false;
  const loaded=bot.world?.getLoadedColumn?.(Math.floor(pos.x)>>4,Math.floor(pos.z)>>4);
  if(!loaded)return true; // can't judge what we can't see
  try{
   const block=bot.blockAt(new Vec3(pos.x,pos.y,pos.z));
   if(!block)return true;
   if(names.includes('air')&&['air','cave_air','void_air'].includes(block.name))return true;
   return names.includes(block.name);
  }catch{return true;}
 }
 unreachable(pos){ // TODO(per-dimension): Java keys caches per dimension too
  for(const cache of this.caches.values())if(cache.blockUnreachable(pos))return true;
  return false;
 }
 requestBlockUnreachable(bot,pos,failuresAllowed=this.config.defaultUnreachableAttemptsAllowed){
  this.currentCache(bot).blacklistBlockUnreachable(bot,pos,failuresAllowed);
 }
 // Call every runner tick: rescans for newly tracked blocks after scanInterval seconds.
 tick(bot){
  const interval=(this.refs.size>this.trackedAtLastScan?this.config.scanIntervalWhenNewBlocksFound:this.config.scanInterval)*1000;
  if(this.now()-this.lastScan>=interval)this.update(bot);
 }
 ensureUpdated(bot){
  const interval=(this.refs.size>this.trackedAtLastScan?this.config.scanIntervalWhenNewBlocksFound:this.config.scanInterval)*1000;
  if(this.now()-this.lastScan>=interval)this.update(bot);
 }
 // One scanning slice (a few chunk columns round-robin around the bot). After a full
 // cycle over the loaded columns, purge the caches like rescanWorld's smartPurge.
 update(bot){
  this.trackedAtLastScan=this.refs.size;
  this.lastScan=this.now();
  const names=[...this.refs.keys()];
  if(!names.length)return;
  const cache=this.currentCache(bot);
  const loaded=this.loadedColumns(bot);
  if(!this.cycle||this.cycle.dim!==(bot?.game?.dimension??'overworld'))this.cycle={dim:bot?.game?.dimension??'overworld',index:0,columns:loaded};
  const within=loaded.filter(c=>this.withinRadius(bot,c));
  this.cycle.columns=within;
  if(!within.length){cache.smartPurge(bot,bot.entity.position);return;}
  const margin=this.config.scanHeightMargin,botY=Math.floor(bot.entity.position.y);
  let scanned=0;
  while(scanned<this.config.columnsPerSlice){
   const column=within[this.cycle.index%within.length];
   this.cycle.index++;
   this.scanColumn(bot,column,cache,names,botY-margin,botY+margin);
   scanned++;
   if(this.cycle.index%within.length===0){cache.smartPurge(bot,bot.entity.position);break;} // cycle complete
  }
 }
 loadedColumns(bot){
  const result=[];
  try{for(const [k,column] of Object.entries(bot.world?.columns||{})){const [cx,cz]=k.split(',').map(Number);result.push({x:cx,z:cz,column});}}
  catch{}
  return result;
 }
 withinRadius(bot,c){
  const cx=Math.floor(bot.entity.position.x)>>4,cz=Math.floor(bot.entity.position.z)>>4;
  return Math.max(Math.abs(c.x-cx),Math.abs(c.z-cz))<=this.config.scanRadiusChunks;
 }
 scanColumn(bot,c,cache,names,y0,y1){
  const column=c.column,height=column.getWorldHeight?column.getWorldHeight():256;
  const top=Math.min(height-1,y1),bottom=Math.max(0,y0);
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)for(let y=bottom;y<=top;y++){
   let block=null;
   try{block=column.getBlock(new Vec3(x,y,z));}catch{}
   if(block&&names.includes(block.name))cache.addBlock(block.name,new Vec3(c.x*16+x,y,c.z*16+z));
  }
 }
}
