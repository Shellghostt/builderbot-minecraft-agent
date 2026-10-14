// Port of adris/altoclef/tasks/movement/SearchChunksExploreTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Searches/explores a continuous "blob" of chunks, attempting to load in ALL nearby chunks
// that are part of this "blob"; isChunkWithinSearchSpace decides the blob (e.g. desert chunks).
// ChunkLoadEvent -> bot.world 'chunkColumnLoad'; getChunkTracker().getLoadedChunks -> ChunkTracker.
import {Task} from '../task.js';
import {ChunkSearchTask} from './chunk-search-task.js';
import {TimeoutWanderTask} from './timeout-wander-task.js';
import {ChunkTracker} from '../../trackers/chunk-tracker.js';

export class SearchChunksExploreTask extends Task {
 constructor({isChunkWithinSearchSpace,chunkTracker,ctx=null}={}){
  super('SearchChunksExploreTask');
  this.ctx=ctx;
  this.searchFn=isChunkWithinSearchSpace||(()=>true);
  this.chunkTracker=chunkTracker||new ChunkTracker();
  this.alreadyExplored=new Set();
  this.searcher=null;
  this.onChunkLoad=null;
 }
 onStart(bot,ctx){
  const emitter=bot.world&&typeof bot.world.on==='function'?bot.world:bot;
  this.onChunkLoad=column=>{
   const cx=column?.chunkX,cz=column?.chunkZ;
   if(Number.isInteger(cx))this.onChunkColumnLoad(bot,cx,cz);
  };
  emitter.on('chunkColumnLoad',this.onChunkLoad);
  this.resetSearch(bot);
 }
 onStop(bot,ctx,interrupt){
  if(this.onChunkLoad){
   const emitter=bot.world&&typeof bot.world.off==='function'?bot.world:bot;
   try{emitter.off('chunkColumnLoad',this.onChunkLoad);}catch{}
   this.onChunkLoad=null;
  }
 }
 onTick(bot,ctx){
  if(this.searcher==null){
   // Explore until a chunk of the blob is loaded.
   return this.getWanderTask(bot,ctx);
  }
  if(this.searcher.started&&this.searcher.isFinished(bot,ctx)){
   // Search exhausted its blob without a hit.
   for(const key of this.searcher.getSearchedChunks())this.alreadyExplored.add(key);
   this.searcher=null;
  }else if(this.searcher.finished()){
   for(const key of this.searcher.getSearchedChunks())this.alreadyExplored.add(key);
   this.searcher=null;
  }
  return this.searcher; // still searching within chunks
 }
 // When we find a valid chunk, start our search there.
 onChunkColumnLoad(bot,cx,cz){
  if(this.searcher!=null)return;
  if(!this.searchFn(bot,cx,cz))return;
  const key=`${cx},${cz}`;
  if(!this.alreadyExplored.has(key))this.searcher=this.newSearcher(bot,{x:cx,z:cz});
 }
 getWanderTask(bot,ctx){return new TimeoutWanderTask(Infinity,false,true,{ctx:this.ctx||ctx});}
 newSearcher(bot,chunkPos){
  return new ChunkSearchTask(this.chunkCenter(bot,chunkPos),{
   isChunkPartOfSearchSpace:(b,cx,cz)=>this.isChunkWithinSearchSpace(b,cx,cz),
   chunkTracker:this.chunkTracker,
   ctx:this.ctx
  });
 }
 chunkCenter(bot,chunkPos){return {x:chunkPos.x*16+8,y:bot.entity.position.y,z:chunkPos.z*16+8};}
 isChunkWithinSearchSpace(bot,cx,cz){return this.searchFn(bot,cx,cz);}
 failedSearch(){return this.searcher==null;}
 resetSearch(bot){
  this.searcher=null;
  this.alreadyExplored.clear();
  // We want to search the currently loaded chunks too!
  for(const chunk of this.chunkTracker.getLoadedChunks(bot))this.onChunkColumnLoad(bot,chunk.x,chunk.z);
 }
 isEqual(other){return other instanceof SearchChunksExploreTask&&other.searchFn===this.searchFn;}
}
