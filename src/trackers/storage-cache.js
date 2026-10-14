// Port of adris/altoclef/trackers/storage/ContainerType.java and ContainerCache.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// ContainerType becomes a string enum; Java screen-handler instanceof checks become
// window-type substring matches (mineflayer window types look like 'minecraft:chest').
export const ContainerType={
 CHEST:'CHEST',ENDER_CHEST:'ENDER_CHEST',SHULKER:'SHULKER',FURNACE:'FURNACE',BREWING:'BREWING',MISC:'MISC',EMPTY:'EMPTY'
};
const FURNACE_BLOCKS=new Set(['furnace','blast_furnace','smoker']);
export function containerTypeFromBlock(blockName){
 if(!blockName)return ContainerType.EMPTY;
 if(blockName==='chest'||blockName==='trapped_chest')return ContainerType.CHEST;
 if(FURNACE_BLOCKS.has(blockName))return ContainerType.FURNACE;
 if(blockName==='ender_chest')return ContainerType.ENDER_CHEST;
 if(blockName.endsWith('shulker_box'))return ContainerType.SHULKER;
 if(blockName==='brewing_stand')return ContainerType.BREWING;
 if(blockName==='barrel'||blockName==='dispenser'||blockName==='dropper'||blockName==='hopper')return ContainerType.MISC;
 return ContainerType.EMPTY;
}
export function screenHandlerMatches(type,windowType){
 const w=String(windowType||'');
 switch(type){
  case ContainerType.CHEST:
  case ContainerType.ENDER_CHEST:return /chest|generic_9x|shulker_box/.test(w);
  case ContainerType.SHULKER:return /shulker_box|generic_9x/.test(w);
  case ContainerType.FURNACE:return /furnace|smoker/.test(w);
  case ContainerType.BREWING:return /brewing/.test(w);
  case ContainerType.MISC:return /generic_3x3|generic_9x|shulker_box|hopper|dispenser/.test(w);
  default:return false;
 }
}

// Item counts for one cached container (its STORAGE slots; the player-inventory part of
// the open window is excluded by the caller).
export class ContainerCache {
 constructor(dimension,blockPos,containerType){
  this.dimension=dimension;
  this.blockPos=blockPos;
  this.containerType=containerType;
  this.itemCounts=new Map();
  this.emptySlots=0;
  this.hasFurnaceOutput=this.containerType===ContainerType.FURNACE;
 }
 // `stacks` = container slot stacks in slot order (use window.slots() sliced to the
 // container range); slot 2 of a furnace is its output and never counts as empty.
 update(stacks){
  this.itemCounts.clear();
  this.emptySlots=0;
  stacks.forEach((stack,i)=>{
   if(!stack||!stack.count){if(!(this.hasFurnaceOutput&&i===2))this.emptySlots++;return;}
   this.itemCounts.set(stack.name,(this.itemCounts.get(stack.name)||0)+stack.count);
  });
 }
 getItemCount(...items){let total=0;for(const item of items)total+=this.itemCounts.get(item)||0;return total;}
 hasItem(...items){for(const item of items)if((this.itemCounts.get(item)||0)>0)return true;return false;}
 getEmptySlotCount(){return this.emptySlots;}
 isFull(){return this.emptySlots===0;}
 getBlockPos(){return this.blockPos;}
 getContainerType(){return this.containerType;}
 getDimension(){return this.dimension;}
}
