// Port of adris/altoclef/trackers/blacklisting/AbstractObjectBlacklist.java,
// WorldLocateBlacklist.java and EntityLocateBlacklist.java
// (MIT License, Copyright (c) 2020 Adris Jautakas).
//
// Sometimes we will try to access something and fail TOO many times: this lets us
// mark a block/entity unreachable and ignore it from searches intelligently, which
// replaces our old "gather attempt N failed" retry loops. The Java best-tool reset
// becomes a best-approach score (squared distance); MiningRequirement is not modelled.
// TimedBlacklist additionally implements the ctx.blacklist contract from docs/TASK_API.md
// (entity(kind,pos,seconds) / wasRecently(kind,pos,seconds)): give up on a target for a while.
const keyOf=p=>`${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
// Works for Vec3 positions, block positions and entities alike (entities carry .position).
const posOf=item=>item&&item.position?item.position:item;
const distSq=(a,b)=>{const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;return dx*dx+dy*dy+dz*dz;};

export class ObjectBlacklist {
 // key: how to identify an item across calls. Java's BlockPos/Entity had value/identity
 // equals; here entities key by identity (default) and world positions key by their
 // floored coordinates (WorldLocateBlacklist passes the posKey below).
 // maxEntries prunes the oldest entries: the Java blacklist grew without bound.
 constructor({approachScore,key,maxEntries=5000}={}){
  this.entries=new Map();
  this.keyFn=key||(item=>item);
  this.maxEntries=maxEntries;
  // Optional custom "how good was our approach" score; default: squared distance to the bot.
  this.approachScore=approachScore||((bot,item)=>distSq(posOf(item),bot.entity.position));
 }
 prune(limit){
  while(this.entries.size>limit){const oldest=this.entries.keys().next().value;this.entries.delete(oldest);}
 }
 blackListItem(bot,item,failuresAllowed=4){
  const k=this.keyFn(item);
  let entry=this.entries.get(k);
  if(!entry){entry={failuresAllowed,failures:0,bestScore:Infinity};this.entries.set(k,entry);this.prune(this.maxEntries);}
  const score=this.approachScore(bot,item);
  // Add a threshold so tiny 1-block improvements do not reset the counter every time.
  if(score<entry.bestScore-1){entry.bestScore=score;entry.failures=0;}
  entry.failures++;
  entry.failuresAllowed=failuresAllowed;
  return entry;
 }
 unreachable(item){
  const entry=this.entries.get(this.keyFn(item));
  return !!entry&&entry.failures>entry.failuresAllowed;
 }
 clear(){this.entries.clear();}
}

// Time-based give-up list used as ctx.blacklist by chains/tasks (docs/TASK_API.md).
export class Blacklist {
 constructor({now,maxEntries=5000}={}){
  this.entries=new Map();
  this.maxEntries=maxEntries;
  this.now=now||(()=>Date.now());
 }
 prune(limit){
  while(this.entries.size>limit){const oldest=this.entries.keys().next().value;this.entries.delete(oldest);}
 }
 record(kind,pos,seconds){
  this.entries.set(`${kind}|${keyOf(pos)}`,{kind,key:keyOf(pos),until:this.now()+seconds*1000,at:this.now()});
  this.prune(this.maxEntries);
 }
 entity(kind,pos,seconds){this.record(kind,pos,seconds);}
 block(pos,seconds){this.record('block',pos,seconds);}
 wasRecently(kind,pos,seconds){
  const entry=this.entries.get(`${kind}|${keyOf(pos)}`);
  if(!entry)return false;
  const now=this.now();
  if(entry.until<=now)return false;
  // An explicit window tightens the check: was it recorded no longer than `seconds` ago?
  return seconds==null||now-entry.at<=seconds*1000;
 }
 blockRecently(pos,seconds){return this.wasRecently('block',pos,seconds);}
 clear(){this.entries.clear();}
}
