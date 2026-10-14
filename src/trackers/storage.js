// Port of adris/altoclef/trackers/storage/ItemStorageTracker.java,
// InventorySubTracker.java and ContainerSubTracker.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
//
// Access ALL forms of storage.
// Mineflayer mapping: ScreenHandlers -> bot.currentWindow (container slots are
// [0, window.inventoryStart)); ScreenOpenEvent -> onScreenOpen/onScreenClose called by
// whatever opens a container; BlockInteractEvent -> onBlockInteract called by tasks.
// InventorySubTracker's dirty flag is kept for API shape but mineflayer's inventory is
// already event-current, so counts are read fresh.
import {ContainerType,containerTypeFromBlock,screenHandlerMatches,ContainerCache} from './storage-cache.js';
export {ContainerType,containerTypeFromBlock,screenHandlerMatches,ContainerCache};
const keyOf=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
const distSq=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return dx*dx+dy*dy+dz*dz;};

class InventorySubTracker {
 constructor(){this.dirty=true;}
 setDirty(){this.dirty=true;}
 // `inventory`: include the player's own inventory; `screen`: include the open container.
 eachStack(bot,inventory,screen,fn){
  if(inventory){
   for(const item of bot.inventory?.items?.()||[])if(fn(item,'inventory'))return;
  }
  if(screen){
   const window=bot.currentWindow;
   if(window&&window!==bot.inventory){
    const stacks=window.slots?window.slots():[];
    const end=window.inventoryStart??stacks.length;
    for(let i=0;i<end;i++)if(stacks[i]&&fn(stacks[i],'container',i))return;
   }
  }
 }
 getItemCount(bot,inventory,screen,...items){
  let total=0;
  this.eachStack(bot,inventory,screen,stack=>{
   if(items.includes(stack.name))total+=stack.count;
   return false;
  });
  return total;
 }
 hasItem(bot,inventory,...items){return this.getItemCount(bot,inventory,true,...items)>0;}
 getSlotsWithItems(bot,inventory,screen,...items){
  const slots=[];
  this.eachStack(bot,inventory,screen,(stack,where,i)=>{if(items.includes(stack.name)){slots.push({index:i,where,stack});return false;}return false;});
  return slots;
 }
}

class ContainerSubTracker {
 constructor(){this.reset();}
 reset(){
  this.containerOpen=false;
  this.lastBlockPosInteraction=null;
  this.lastBlockInteraction=null;
  this.containerCaches=new Map(); // dimension -> Map(posKey -> ContainerCache)
  this.enderChestCache=null;
  this.hasSentError=false;
 }
 dimCaches(dimension){
  if(!this.containerCaches.has(dimension))this.containerCaches.set(dimension,new Map());
  return this.containerCaches.get(dimension);
 }
 // EventBus BlockInteractEvent -> tasks call this when they right-click a container block.
 onBlockInteract(pos,blockName){
  const type=containerTypeFromBlock(blockName);
  if(type!==ContainerType.EMPTY){this.lastBlockPosInteraction=pos;this.lastBlockInteraction=blockName;}
 }
 onScreenOpen(window){this.containerOpen=!!window;}
 onScreenClose(){
  this.containerOpen=false;
  this.lastBlockPosInteraction=null;
  this.lastBlockInteraction=null;
  this.hasSentError=false;
 }
 // EventBus onServerTick: while a container window is open, merge its slots into the cache
 // for the block we interacted with.
 updateFromWindow(bot,window){
  if(!window||window===bot.inventory||!this.lastBlockPosInteraction)return;
  const dimension=bot?.game?.dimension??'overworld';
  const dimCache=this.dimCaches(dimension);
  const posKey=keyOf(this.lastBlockPosInteraction);
  const interactType=containerTypeFromBlock(this.lastBlockInteraction);
  const cached=dimCache.get(posKey);
  // Container type mismatch, reset (port of the Java mismatch handling).
  if(cached&&!screenHandlerMatches(cached.containerType,window.type)){
   if(!this.hasSentError)this.hasSentError=true;
   dimCache.delete(posKey);
  }
  let cache=dimCache.get(posKey);
  if(!cache){
   cache=new ContainerCache(dimension,this.lastBlockPosInteraction,interactType);
   dimCache.set(posKey,cache);
   if(interactType===ContainerType.ENDER_CHEST)this.enderChestCache=cache;
  }
  const stacks=window.slots?window.slots():[];
  const end=window.inventoryStart??stacks.length;
  cache.update(stacks.slice(0,end).map(s=>s&&{name:s.name,count:s.count}));
 }
 isContainerCacheValid(bot,dimension,cache){
  if(!cache)return false;
  const pos=cache.blockPos;
  if((bot?.game?.dimension??'overworld')===dimension){
   const column=bot.world?.getLoadedColumn?.(Math.floor(pos.x)>>4,Math.floor(pos.z)>>4);
   if(column){
    const actual=containerTypeFromBlock(bot.blockAt(pos)?.name);
    if(actual===ContainerType.EMPTY||actual!==cache.containerType)return false;
   }
  }
  return true;
 }
 getContainerAtPosition(bot,pos){
  const dimension=bot?.game?.dimension??'overworld';
  const cache=this.dimCaches(dimension).get(keyOf(pos));
  if(cache&&!this.isContainerCacheValid(bot,dimension,cache)){this.dimCaches(dimension).delete(keyOf(pos));return null;}
  return cache||null;
 }
 getCachedContainers(bot,accept){
  const result=[],toRemove=[];
  for(const [dimension,map] of this.containerCaches){
   for(const cache of map.values()){
    if(!this.isContainerCacheValid(bot,dimension,cache)){toRemove.push([dimension,keyOf(cache.blockPos)]);continue;}
    if(!accept||accept(cache))result.push(cache);
   }
  }
  for(const [dimension,key] of toRemove)this.containerCaches.get(dimension).delete(key);
  return result;
 }
 getCachedContainersOfType(bot,...types){return this.getCachedContainers(bot,cache=>types.includes(cache.containerType));}
 getClosestTo(bot,pos,accept){
  let bestCache=null,bestDist=Infinity;
  for(const cache of this.getCachedContainers(bot,accept)){
   const dist=distSq(cache.blockPos,pos);
   if(dist<bestDist){bestDist=dist;bestCache=cache;}
  }
  return bestCache;
 }
 getContainersWithItem(bot,...items){return this.getCachedContainers(bot,cache=>cache.hasItem(...items));}
 getClosestWithItem(bot,pos,...items){return this.getClosestTo(bot,pos,cache=>cache.hasItem(...items));}
 hasItem(bot,...items){return this.getCachedContainers(bot).some(cache=>cache.hasItem(...items));}
}

export class ItemStorageTracker {
 constructor(){
  this.inventory=new InventorySubTracker();
  this.containers=new ContainerSubTracker();
 }
 // --- inventory-side (counts include crafting/furnace "conversion" slots only insofar as
 // the open window exposes them; the Java conversion-slot list was client-UI specific) ---
 getItemCount(bot,...items){return this.inventory.getItemCount(bot,true,true,...items);}
 getItemCountScreen(bot,...items){return this.inventory.getItemCount(bot,false,true,...items);}
 // ONLY use when getting an item is the END GOAL: excludes anything in open container slots.
 getItemCountInventoryOnly(bot,...items){return this.inventory.getItemCount(bot,true,false,...items);}
 // Only the currently open container, NOT the player's inventory.
 getItemCountContainer(bot,...items){return this.inventory.getItemCount(bot,false,true,...items);}
 hasItem(bot,...items){return this.getItemCount(bot,...items)>0;}
 hasItemAll(bot,...items){return items.every(item=>this.hasItem(bot,item));}
 getSlotsWithItemScreen(bot,...items){return this.inventory.getSlotsWithItems(bot,true,true,...items);}
 getSlotsWithItemContainer(bot,...items){return this.inventory.getSlotsWithItems(bot,false,true,...items);}
 getSlotsWithItemPlayerInventory(bot,...items){return this.inventory.getSlotsWithItems(bot,true,false,...items);}
 getItemStacksPlayerInventory(bot){return bot.inventory?.items?.()||[];}
 registerSlotAction(){this.inventory.setDirty();}
 // --- container-side ---
 hasItemContainer(bot,...items){return this.containers.hasItem(bot,...items);}
 getContainerAtPosition(bot,pos){return this.containers.getContainerAtPosition(bot,pos);}
 isContainerCached(bot,pos){return !!this.getContainerAtPosition(bot,pos);}
 getEnderChestStorage(bot){return this.containers.enderChestCache;}
 getCachedContainers(bot){return this.containers.getCachedContainers(bot,null);}
 getContainerClosestTo(bot,pos,accept){return this.containers.getClosestTo(bot,pos,accept);}
 getContainersWithItem(bot,...items){return this.containers.getContainersWithItem(bot,...items);}
 getClosestContainerWithItem(bot,pos,...items){return this.containers.getClosestWithItem(bot,pos,...items);}
 getLastBlockPosInteraction(){return this.containers.lastBlockPosInteraction;}
 // --- events tasks must forward ---
 onBlockInteract(bot,pos,blockName){this.containers.onBlockInteract(pos,blockName);}
 onScreenOpen(bot,window){if(window&&window!==bot.inventory)this.containers.containerOpen=true;}
 onScreenClose(bot){this.containers.onScreenClose();}
 onTick(bot){if(this.containers.containerOpen)this.containers.updateFromWindow(bot,bot.currentWindow);}
 // Port of reset(): dropped everything when we leave the world.
 reset(){this.containers.reset();this.inventory.setDirty();}
}
