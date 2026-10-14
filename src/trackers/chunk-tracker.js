// Port of adris/altoclef/trackers/SimpleChunkTracker.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Keeps track of currently loaded chunks. That's it.
// Mineflayer mapping: ChunkLoadEvent/ChunkUnloadEvent -> bot.world 'chunkColumnLoad'/'chunkColumnUnload';
// getChunk instanceof EmptyChunk -> bot.world.getLoadedColumn(cx,cz) == null.
import {Vec3} from 'vec3';
const key=(cx,cz)=>`${cx},${cz}`;

export class ChunkTracker {
 constructor(){this.loaded=new Set();}
 listen(bot){
  if(!bot.world||typeof bot.world.on!=='function'||this.listening)return;
  this.listening=true;
  bot.world.on('chunkColumnLoad',column=>{if(Number.isInteger(column?.chunkX))this.loaded.add(key(column.chunkX,column.chunkZ));});
  bot.world.on('chunkColumnUnload',column=>{if(Number.isInteger(column?.chunkX))this.loaded.delete(key(column.chunkX,column.chunkZ));});
 }
 isChunkLoaded(bot,cx,cz){
  try{return !!bot.world?.getLoadedColumn?.(cx,cz);}catch{return false;}
 }
 isBlockChunkLoaded(bot,pos){return this.isChunkLoaded(bot,Math.floor(pos.x)>>4,Math.floor(pos.z)>>4);}
 getLoadedChunks(bot){
  const result=[];
  try{
   for(const [k] of Object.entries(bot.world?.columns||{})){
    const [cx,cz]=k.split(',').map(Number);
    if(Number.isInteger(cx)&&Number.isInteger(cz)&&this.isChunkLoaded(bot,cx,cz))result.push({x:cx,z:cz,key:key(cx,cz)});
   }
  }catch{}
  for(const k of this.loaded)if(!result.some(c=>c.key===k)){const [cx,cz]=k.split(',').map(Number);if(this.isChunkLoaded(bot,cx,cz))result.push({x:cx,z:cz,key:k});}
  return result;
 }
 reset(){this.loaded.clear();}
 // Loops through every block of a loaded chunk; `onBlock` returning true stops the scan.
 // Returns whether onBlock ever returned true. Unloaded chunks scan nothing.
 scanChunk(bot,cx,cz,onBlock,yRange){
  const column=this.isChunkLoaded(bot,cx,cz)&&bot.world.getLoadedColumn(cx,cz);
  if(!column)return false;
  const height=column.getWorldHeight?column.getWorldHeight():256;
  const y0=Math.max(0,yRange?yRange.min:0),y1=Math.min(height-1,yRange?yRange.max:height-1);
  const baseX=cx*16,baseZ=cz*16;
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)for(let y=y0;y<=y1;y++){
   let block=null;
   try{block=column.getBlock(new Vec3(x,y,z));}catch{}
   const worldPos=new Vec3(baseX+x,y,baseZ+z);
   if(onBlock(worldPos,block))return true;
  }
  return false;
 }
}
