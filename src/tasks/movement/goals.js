// Goal adapters for the movement tasks.
// Ported from AltoClef's use of Baritone goal classes (baritone.api.pathing.goals.*) as used by
// tasks/movement/*.java (MIT License, Copyright (c) 2020 Adris Jautakas):
// GoalBlock/GoalNear/GoalXZ map onto the identical mineflayer-pathfinder classes;
// GoalRunAway (Baritone), GoalChunk and GoalFollowEntity (adris/altoclef/util/baritone/*.java)
// are re-expressed here on the pathfinder Goal interface ({isEnd(vec3), heuristic(vec3)}).
import pathfinderPackage from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
const {goals}=pathfinderPackage;
export {goals};
export const blockGoal=(x,y,z)=>new goals.GoalBlock(Math.floor(x),Math.floor(y),Math.floor(z));
export const nearGoal=(x,y,z,range)=>new goals.GoalNear(Math.floor(x),Math.floor(y),Math.floor(z),range);
export const xzGoal=(x,z)=>new goals.GoalXZ(Math.floor(x),Math.floor(z));
// GoalFollowEntity: stay within `range` of a (moving) entity; re-pathed by the caller.
export function followEntityGoal(entity,range){
 // The full pathfinder Goal contract: isValid/hasChanged are polled by monitorMovement
 // every physics tick - a goal without them throws 'stateGoal.isValid is not a function'
 // and (before the app-level guard) killed the whole dashboard.
 return {
  entity,range,
  isValid(){return true;},
  hasChanged(){return false;},
  heuristic(pos){const p=entity.position;const dx=pos.x-p.x,dy=pos.y-p.y,dz=pos.z-p.z;return Math.sqrt(dx*dx+dy*dy+dz*dz);},
  isEnd(pos){const p=entity.position;const dx=pos.x-p.x,dy=pos.y-p.y,dz=pos.z-p.z;return Math.sqrt(dx*dx+dy*dy+dz*dz)<=range;}
 };
}
// Baritone GoalChunk: goal met anywhere inside the chunk.
export function chunkGoal(cx,cz){
 return {
  cx,cz,
  // monitorMovement polls these every physics tick; a goal missing them throws
  // 'stateGoal.isValid is not a function' and used to take down the dashboard.
  isValid(){return true;},
  hasChanged(){return false;},
  isEnd(pos){return Math.floor(pos.x)>>4===cx&&Math.floor(pos.z)>>4===cz;}
 };
}
// Port of Baritone's GoalRunAway as AltoClef's RunAwayFromPositionTask uses it:
// finished once EVERY danger position is at least distanceGoal away (xz unless maintainY).
export class GoalRunAway {
 constructor(distanceGoal,positions,{maintainY=null}={}){
  this.distanceGoal=distanceGoal;
  this.maintainY=maintainY;
  this.positions=positions.map(p=>new Vec3(p.x,p.y,p.z));
 }
 // mineflayer-pathfinder's Goal contract (its own GoalBlock etc. implement it): a run-away
 // goal is always valid and never re-computes - completion is isEnd - and heuristic(node)
 // already matches. Missing members throw inside the physics timer (monitorMovement).
 isValid(){return true;}
 hasChanged(){return false;}
 distSq(pos,x,y,z){
  const dx=pos.x-x,dz=pos.z-z;
  if(this.maintainY==null)return dx*dx+dz*dz;
  const dy=pos.y-y;
  return dx*dx+dy*dy+dz*dz;
 }
 isEnd(pos){return this.positions.every(p=>Math.sqrt(this.distSq(p,pos.x,pos.y,pos.z))>=this.distanceGoal);}
 // The pathfinder minimises f=g+heuristic: farther nodes get a bonus (negative heuristic)
 // so the path bends away from the dangers until every one is distanceGoal off.
 heuristic(pos){
  let min=Infinity;
  for(const p of this.positions)min=Math.min(min,Math.sqrt(this.distSq(p,pos.x,pos.y,pos.z)));
  return Math.max(min-this.distanceGoal,-this.distanceGoal);
 }
}
// Port of adris/altoclef/util/baritone/GoalRunAwayFromEntities.java: a GoalRunAway whose
// danger positions come from a live supplier and whose per-entity cost is overridable
// (RunAwayFromCreepersTask plugs MobDefenseChain's creeper safety in there via `cost`).
export class GoalRunAwayFromEntities extends GoalRunAway {
 constructor(distance,{xz=false,penalty=1,getEntities,cost}={}){
  super(distance,[],{maintainY:xz?null:0}); // maintainY!=null => full 3D distance counts
  this.xz=xz;this.penalty=penalty;this.getEntities=getEntities;this.costFn=cost;
 }
 entities(){return (this.getEntities?this.getEntities():[]).filter(e=>e&&e.position);}
 isEnd(pos){
  const list=this.entities();
  if(!list.length)return true;
  // super.isEnd walks the STATIC positions (empty here) - the live supplier is the truth.
  return list.every(e=>Math.sqrt(this.distSq(e.position,pos.x,pos.y,pos.z))>=this.distanceGoal);
 }
 heuristic(pos){
  const list=this.entities().slice(0,10); // if we had 100 players, this would never calculate
  if(!list.length)return 0;
  let costSum=0;
  for(const e of list){
   let cost=this.costFn?this.costFn(e,pos):Math.sqrt(this.distSq(e.position,pos.x,pos.y,pos.z));
   // Closer entities get a bigger weight; cost 0 is very bad. The pathfinder minimises
   // f=g+h (Baritone maximises its heuristic), so the bonus is negated here.
   costSum+=cost>0?1/cost:1000;
  }
  return -(costSum/list.length)*this.penalty;
 }
}
