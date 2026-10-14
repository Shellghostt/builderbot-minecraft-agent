// Bow shot bookkeeping: did the arrow leave the bow, and did it land?
// Live combat logged `no arrow entity found near the release` and 0 hits across every run.
// Two detection faults, not proof of a dead release:
//  - bow shots never counted as hits at all (stats.hits was melee-only);
//  - the old probe looked 120 ms after release for an arrow within 6 blocks of the feet. A
//    full-draw arrow flies 3 blocks/tick, so by then it was already 6+ blocks out, in the
//    target, or stuck in the ground past the radius (still visible by name).
// Evidence used here, strongest first (each works on its own through ViaBackwards):
//  - released: the inventory arrow count drops (survival consumes one), or an `arrow`
//    entity spawns within SPAWN_RADIUS of the shooter's eye shortly after the release
//    (vanilla pairs the spawn packet before the arrow's first tick, at eye - 0.1);
//    spawn_entity objectData is the owner's entity id for projectiles.
//  - landed: an `entityHurt` (damage_event, 1.20+) on the target inside the flight window,
//    or the target's `health` metadata dropping, or the tracked arrow vanishing in the
//    same window as a hurt. An arrow flagged in_ground is a miss.
// Pure logic with an injected clock; CombatController feeds it events and polls.
export const ARROW_NAMES=new Set(['arrow','spectral_arrow']);
export const SPAWN_RADIUS=5;      // blocks from the shooter's eye at release
export const SPAWN_SECONDS=1.0;   // release -> spawn packet
export const SHOT_WINDOW=3.0;     // release -> hurt (24 blocks at 3 b/t is ~0.4 s; lag margin)

const d3=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return Math.sqrt(dx*dx+dy*dy+dz*dz);};
export function arrowCount(bot){
 try{return (bot.inventory.items()||[]).reduce((n,i)=>n+(ARROW_NAMES.has(i.name)||i.name==='tipped_arrow'?i.count||0:0),0);}catch{return null;}
}
// LivingEntity health from entity metadata (index from the registry; 9 on 1.21.4).
export function metaHealth(bot,e){
 if(!e||!e.metadata)return null;
 let i=9;
 try{const keys=bot.registry.entitiesByName[e.name].metadataKeys;const k=keys&&keys.indexOf('health');if(k>=0)i=k;}catch{}
 const v=e.metadata[i];
 return typeof v==='number'?v:null;
}
function inGround(bot,e){
 if(!e||!e.metadata)return false;
 let i=10;
 try{const keys=bot.registry.entitiesByName[e.name].metadataKeys;const k=keys&&keys.indexOf('in_ground');if(k>=0)i=k;}catch{}
 return e.metadata[i]===true;
}

export class ArrowShots{
 constructor({window=SHOT_WINDOW,spawnSeconds=SPAWN_SECONDS,spawnRadius=SPAWN_RADIUS}={}){
  this.window=window;this.spawnSeconds=spawnSeconds;this.spawnRadius=spawnRadius;
  this.shots=[];this.owners=new Map(); // arrow entity id -> owner entity id (spawn objectData)
  this.stats={released:0,landed:0,missed:0,unreleased:0};
 }
 // A full-draw release. eye = the shooter's eye position; target = the entity aimed at.
 release(bot,target,now){
  const e=bot.entity,p=e.position;
  const shot={t:now,eye:{x:p.x,y:p.y+(e.eyeHeight||1.62),z:p.z},selfId:e.id,
   targetId:target&&target.id,targetName:target&&target.name,
   targetHealth:metaHealth(bot,target),arrows:arrowCount(bot),
   arrowId:null,released:false,how:null,landed:false,done:false};
  this.shots.push(shot);
  if(this.shots.length>8)this.shots.shift();
  return shot;
 }
 _open(now){return this.shots.filter(s=>!s.done&&now-s.t<=this.window);}
 _markReleased(s,how,out){
  if(s.released)return;
  s.released=true;s.how=how;this.stats.released++;
  out.push({type:'released',shot:s,detail:how});
 }
 _land(s,how,out){
  if(s.landed||s.done)return;
  if(!s.released)this._markReleased(s,'hit',out);
  s.landed=true;s.done=true;this.stats.landed++;
  out.push({type:'landed',shot:s,detail:how});
 }
 // Raw spawn_entity objectData (projectiles: the owner's entity id).
 noteOwner(entityId,owner){
  this.owners.set(entityId,owner);
  if(this.owners.size>64)this.owners.delete(this.owners.keys().next().value);
 }
 onSpawn(e,now){
  const out=[];
  if(!e||!ARROW_NAMES.has(e.name)||!e.position)return out;
  const owner=this.owners.get(e.id);
  for(const s of this._open(now)){
   if(s.arrowId!=null||now-s.t>this.spawnSeconds)continue;
   if(owner!=null&&owner!==s.selfId)continue; // someone else's arrow (a skeleton's)
   if(d3(e.position,s.eye)>this.spawnRadius)continue;
   s.arrowId=e.id;
   const v=e.velocity,sp=v?Math.sqrt(v.x*v.x+v.y*v.y+v.z*v.z):0;
   s.speed=Math.round(sp*100)/100;
   this._markReleased(s,'arrow entity '+e.id+(sp?' at '+s.speed+' b/t':''),out);
   break;
  }
  return out;
 }
 onHurt(e,source,now){
  const out=[];
  if(!e)return out;
  for(const s of this._open(now)){
   if(e.id!==s.targetId)continue;
   const src=source&&source.id;
   // damage_event's cause is the shooter; a direct arrow id or no source also count.
   if(src!=null&&src!==s.selfId&&src!==s.arrowId)continue;
   this._land(s,'hurt event',out);
   break;
  }
  return out;
 }
 onGone(e,now){
  const out=[];
  if(!e)return out;
  for(const s of this.shots)if(!s.done&&s.arrowId===e.id)s.arrowGoneAt=now;
  return out;
 }
 // Called every controller tick: inventory count, target health metadata, in_ground, expiry.
 poll(bot,now){
  const out=[];
  const arrows=arrowCount(bot);
  for(const s of this.shots){
   if(s.done)continue;
   if(!s.released&&arrows!=null&&s.arrows!=null&&arrows<s.arrows)this._markReleased(s,'arrows '+s.arrows+'->'+arrows,out);
   const target=s.targetId!=null&&bot.entities?bot.entities[s.targetId]:null;
   const h=metaHealth(bot,target);
   if(h!=null&&s.targetHealth!=null&&h<s.targetHealth-0.01&&now-s.t<=this.window){this._land(s,'health '+Math.round(s.targetHealth*10)/10+'->'+Math.round(h*10)/10,out);continue;}
   if(s.targetHealth==null&&h!=null)s.targetHealth=h;
   const a=s.arrowId!=null&&bot.entities?bot.entities[s.arrowId]:null;
   if(s.released&&a&&inGround(bot,a)){
    s.done=true;this.stats.missed++;out.push({type:'missed',shot:s,detail:'arrow stuck in the ground'});continue;
   }
   if(now-s.t>this.window){
    s.done=true;
    if(s.released){this.stats.missed++;out.push({type:'missed',shot:s,detail:'no hurt on '+(s.targetName||'the target')+' within '+this.window+' s'});}
    else{this.stats.unreleased++;out.push({type:'unreleased',shot:s,
     detail:'no arrow left the bow: arrows '+s.arrows+'->'+arrows+', no arrow entity within '+this.spawnRadius+' of the eye'});}
   }
  }
  return out;
 }
}
