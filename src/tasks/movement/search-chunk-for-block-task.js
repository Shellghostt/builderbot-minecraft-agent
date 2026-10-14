// Port of adris/altoclef/tasks/movement/SearchChunkForBlockTask.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// Searches/explores chunks until the given block names are found in one of them.
import {SearchChunksExploreTask} from './search-chunks-explore-task.js';
import {ChunkTracker} from '../../trackers/chunk-tracker.js';

export class SearchChunkForBlockTask extends SearchChunksExploreTask {
 constructor(blocks,{chunkTracker,ctx=null}={}){
  super({chunkTracker:chunkTracker||new ChunkTracker(),ctx});
  this.toSearchFor=new Set(blocks);
 }
 // Scans every block of a loaded chunk for the target names (port of scanChunk +
 // _toSearchFor.contains); unloaded chunks say "not here" so the search walks to them.
 isChunkWithinSearchSpace(bot,cx,cz){
  const found={hit:false};
  this.chunkTracker.scanChunk(bot,cx,cz,(pos,block)=>{
   if(block&&this.toSearchFor.has(block.name)){found.hit=true;return true;}
   return false;
  });
  return found.hit;
 }
 isEqual(other){
  return other instanceof SearchChunkForBlockTask
   &&other.toSearchFor.size===this.toSearchFor.size
   &&[...this.toSearchFor].every(name=>other.toSearchFor.has(name));
 }
}
