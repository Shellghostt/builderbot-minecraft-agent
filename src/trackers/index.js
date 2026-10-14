// One-stop wiring for the P4 trackers (docs/TASK_API.md ctx.trackers/ctx.blacklist).
// The tracker classes keep the house rule of an explicit `bot` argument; chains written
// against the ctx facade (e.g. combatPolicy's ctx.trackers.getHostiles()) may omit it,
// so the `api` facade prepends the live bot (reconnect-safe getter) when a call omits it.
// MIT License, Copyright (c) 2020 Adris Jautakas (headers on each ported class file).
import {Blacklist} from './blacklist.js';
import {BlockTracker} from './block-tracker.js';
import {EntityTracker} from './entity-tracker.js';
import {ItemStorageTracker} from './storage.js';
import {ChunkTracker} from './chunk-tracker.js';

export {Blacklist,ObjectBlacklist} from './blacklist.js';
export {BlockTracker} from './block-tracker.js';
export {EntityTracker} from './entity-tracker.js';
export {ItemStorageTracker,ContainerType,ContainerCache,containerTypeFromBlock,screenHandlerMatches} from './storage.js';
export {ChunkTracker} from './chunk-tracker.js';

// Wire as: const trackers=createTrackers({getBot:()=>worker.bot});
//          worker.trackers=trackers.api; worker.blacklist=trackers.blacklist;
// and per runner tick: trackers.blocks.tick(bot); trackers.storage.onTick(bot).
export function createTrackers({getBot,config={}}={}){
 const chunks=new ChunkTracker();
 const blocks=new BlockTracker(config.blocks);
 const entities=new EntityTracker(config.entities);
 const storage=new ItemStorageTracker();
 const blacklist=new Blacklist();
 // The facade ALWAYS prepends the live bot: every tracker method takes bot first, so
 // chains call api.entities.getHostiles() / api.entities.getClosestEntity(['zombie']).
 // Explicit-bot style uses the raw trackers (also returned).
 const bound=tracker=>new Proxy(tracker,{get:(target,prop)=>{
  const value=target[prop];
  if(typeof value!=='function')return value;
  return (...args)=>{
   if(getBot){let b=null;try{b=getBot();}catch{}args.unshift(b);}
   return value.apply(target,args);
  };
 }});
 const api={
  blocks:bound(blocks),
  entities:bound(entities),
  storage:bound(storage),
  chunks:bound(chunks)
 };
 return {chunks,blocks,entities,storage,blacklist,api};
}
