// Port of adris/altoclef/tasks/movement/ChunkSearchTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Use to walk through and search interconnected structures or biomes (dark forest for a
// mansion, nether fortress for blazes, stronghold for the portal). ChunkLoadEvent ->
// bot.world 'chunkColumnLoad'; getChunkTracker().isChunkLoaded -> ChunkTracker; the
// abstract isChunkPartOfSearchSpace/isChunkSearchEqual are constructor predicates here.
import {Task} from '../task.js';
import {GetToChunkTask} from './get-to-chunk-task.js';

export class ChunkSearchTask extends Task {
 // startPoint: {x,y,z}; options.isChunkPartOfSearchSpace(bot,cx,cz): whether the chunk
 // belongs to the search blob (default: all chunks); loadedChunks: a ChunkTracker-like
 // object (default: a private one).
 constructor(startPoint,{isChunkPartOfSearchSpace,chunkTracker,ctx=null,maxQueue=1024}={}){
  super('ChunkSearchTask');
  this.ctx=ctx;
  this.startPoint=startPoint;
  this.searchFn=isChunkPartOfSearchSpace||(()=>true);
  this.chunkTracker=chunkTracker||null;
  this.maxQueue=maxQueue; // an always-true predicate would otherwise queue every chunk
  this.consideredAlready=new Set();
  this.searchedAlready=new Set();
  this.searchLater=[];
  this.justLoaded=[];
  this.first=true;
  this.finished=false;
  this.onChunkLoad=null; // event listener, bound in onStart
 }
 chunkTrackerOf(bot){
  if(!this.chunkTracker){
   // Lazy: only needs bot.world access, no event wiring required for loads we see ourselves.
   this.chunkTracker={isChunkLoaded:(b,cx,cz)=>{try{return !!b.world?.getLoadedColumn?.(cx,cz);}catch{return false;}},scanChunk:null};
  }
  return this.chunkTracker;
 }
 getSearchedChunks(){return this.searchedAlready;}
 finished(){return this.finished;}
 onStart(bot,ctx){
  if(this.first){
   this.finished=false;
   this.first=false;
   const p=this.startPoint;
   this.searchChunkOrQueueSearch(bot,Math.floor(p.x)>>4,Math.floor(p.z)>>4);
  }
  const emitter=bot.world&&typeof bot.world.on==='function'?bot.world:bot;
  this.onChunkLoad=column=>{
   const cx=column?.chunkX,cz=column?.chunkZ;
   if(!Number.isInteger(cx)||!Number.isInteger(cz))return;
   const key=`${cx},${cz}`;
   if(!this.searchedAlready.has(key)&&this.justLoaded.length<this.maxQueue)this.justLoaded.push({x:cx,z:cz,key});
  };
  emitter.on('chunkColumnLoad',this.onChunkLoad);
 }
 onStop(bot,ctx,interrupt){
  if(this.onChunkLoad){
   const emitter=bot.world&&typeof bot.world.off==='function'?bot.world:bot;
   try{emitter.off('chunkColumnLoad',this.onChunkLoad);}catch{}
   this.onChunkLoad=null;
  }
 }
 onTick(bot,ctx){
  // Search everything we can now reach of the chunks loaded since last tick.
  const stillQueued=[];
  for(const chunk of this.justLoaded)if(this.searchLater.some(c=>c.key===chunk.key)&&!this.trySearchChunk(bot,chunk.x,chunk.z))stillQueued.push(chunk);
  this.justLoaded=[];
  this.searchLater=this.searchLater.filter(c=>!stillQueued.some(s=>s.key===c.key));
  // Now that we have an updated map, go to the nearest chunk left to search.
  const closest=this.getBestChunk(bot,this.searchLater);
  if(closest==null){
   this.finished=true;
   return null;
  }
  return new GetToChunkTask(closest,{ctx:this.ctx||ctx});
 }
 getBestChunk(bot,chunks){
  let lowestScore=Infinity,bestChunk=null;
  const px=bot.entity.position.x,pz=bot.entity.position.z;
  for(const toSearch of chunks){
   const cx=toSearch.x*16+8,cz=toSearch.z*16+8;
   const distanceSq=(cx-px)*(cx-px)+(cz-pz)*(cz-pz);
   const dx=this.startPoint.x-cx,dz=this.startPoint.z-cz;
   const distanceToCenterSq=dx*dx+dz*dz;
   const score=distanceSq+distanceToCenterSq*0.8;
   if(score<lowestScore){lowestScore=score;bestChunk=toSearch;}
  }
  return bestChunk;
 }
 isFinished(bot,ctx){return this.searchLater.length===0;}
 isEqual(other){return other instanceof ChunkSearchTask&&other.startPoint.x===this.startPoint.x&&other.startPoint.y===this.startPoint.y&&other.startPoint.z===this.startPoint.z&&other.searchFn===this.searchFn;}
 searchChunkOrQueueSearch(bot,cx,cz){
  const key=`${cx},${cz}`;
  // Don't search/consider this chunk again.
  if(this.consideredAlready.has(key))return;
  this.consideredAlready.add(key);
  if(!this.trySearchChunk(bot,cx,cz)&&!this.searchedAlready.has(key)&&this.searchLater.length<this.maxQueue)this.searchLater.push({x:cx,z:cz,key});
 }
 // Try to search the chunk; true = DONE, false = we need to SEARCH IT IN PERSON.
 trySearchChunk(bot,cx,cz){
  const key=`${cx},${cz}`;
  if(this.searchedAlready.has(key))return true;
  const tracker=this.chunkTrackerOf(bot);
  if(tracker.isChunkLoaded(bot,cx,cz)){
   this.searchedAlready.add(key);
   this.searchLater=this.searchLater.filter(c=>c.key!==key);
   if(this.searchFn(bot,cx,cz)){
    // This chunk may lead to more, so either search or enqueue its neighbours.
    this.searchChunkOrQueueSearch(bot,cx+1,cz);
    this.searchChunkOrQueueSearch(bot,cx-1,cz);
    this.searchChunkOrQueueSearch(bot,cx,cz+1);
    this.searchChunkOrQueueSearch(bot,cx,cz-1);
   }
   return true;
  }
  return false;
 }
}
