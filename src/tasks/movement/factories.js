// Task factories for the ctx.move facade (docs/TASK_API.md): chains ask for movement
// tasks by name and get instances that carry ctxBase, so they resolve the live bot even
// though the runner's tickTask passes only bot. Separate from move.js because the task
// classes import move.js (a top-level cycle here would put their base classes in TDZ).
import {GetToEntityTask} from './get-to-entity-task.js';
import {GetToBlockTask} from './get-to-block-task.js';
import {GetToXZTask} from './get-to-xz-task.js';
import {GetToChunkTask} from './get-to-chunk-task.js';
import {RunAwayFromPositionTask} from './run-away-from-position-task.js';
import {RunAwayFromCreepersTask} from './run-away-from-creepers-task.js';
import {EscapeFromLavaTask} from './escape-from-lava-task.js';
import {GetOutOfWaterTask} from './get-out-of-water-task.js';
import {TimeoutWanderTask} from './timeout-wander-task.js';
import {SafeRandomShimmyTask} from './safe-random-shimmy-task.js';

export function createMoveTasks(ctxBase){
 return {
  getToEntity:(entity,distance=1)=>new GetToEntityTask(entity,distance,{ctx:ctxBase}),
  getToBlock:(position,opts={})=>new GetToBlockTask(position,{...opts,ctx:ctxBase}),
  getToXZ:(x,z,dimension=null)=>new GetToXZTask(x,z,dimension,{ctx:ctxBase}),
  getToChunk:chunkPos=>new GetToChunkTask(chunkPos,{ctx:ctxBase}),
  runAwayFromPosition:(distance,positions,opts={})=>new RunAwayFromPositionTask(distance,positions,{...opts,ctx:ctxBase}),
  runAwayFromCreepers:(distance,opts={})=>new RunAwayFromCreepersTask(distance,{...opts,ctx:ctxBase}),
  escapeFromLava:()=>new EscapeFromLavaTask(100,{ctx:ctxBase}),
  getOutOfWater:opts=>new GetOutOfWaterTask({...opts,ctx:ctxBase}),
  timeoutWander:(distance,opts={})=>new TimeoutWanderTask(distance,!!(opts&&opts.increaseRange),!!(opts&&opts.forceExplore),{ctx:ctxBase}),
  safeRandomShimmy:()=>new SafeRandomShimmyTask(5,{ctx:ctxBase})
 };
}
