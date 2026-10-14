// Research items 2 and 4: stand in open sky before cutting wood, and make the
// pathfinder pay to walk through mobs while the bot cannot win a fight.
// Pure helpers so the worker stays a thin caller and the tests need no server.
export const OPEN_SKY=12;
const RANGED=/^(skeleton|stray|bogged)$/;

export function avoidanceActive(armed,health){return !armed||(health??20)<10;}

// A place to stand beside a log where undead burn: feet and head clear, a solid
// floor, sky light >= 12. Already standing in that light means there is nothing
// to walk to. No such cell (dark-oak canopy) returns null so gathering continues.
export function pickOpenStand(blockAt,logs,origin){
 const ox=Math.floor(origin.x),oy=Math.floor(origin.y),oz=Math.floor(origin.z);
 const here=blockAt(ox,oy,oz);
 if(here&&(here.skyLight||0)>=OPEN_SKY&&here.boundingBox!=='block')return null;
 let best=null,bestD=Infinity;
 for(const log of (logs||[]).slice(0,16)){
  const lx=Math.floor(log.x),ly=Math.floor(log.y),lz=Math.floor(log.z);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
   const x=lx+dx,y=ly,z=lz+dz;
   const feet=blockAt(x,y,z),head=blockAt(x,y+1,z),floor=blockAt(x,y-1,z);
   if(!feet||feet.boundingBox==='block')continue;
   if(!head||head.boundingBox==='block')continue;
   if(!floor||floor.boundingBox!=='block')continue;
   if((feet.skyLight||0)<OPEN_SKY)continue;
   const d=Math.hypot(x-ox,z-oz)+Math.abs(y-oy);
   if(d<bestD){bestD=d;best={x,y,z};}
  }
 }
 return best;
}

// True when (px,pz) sits on the xz segment from a shooter to the bot.
export function onShotLine(px,pz,from,to){
 const abx=to.x-from.x,abz=to.z-from.z,len2=abx*abx+abz*abz;
 if(len2<0.25)return false;
 const t=((px-from.x)*abx+(pz-from.z)*abz)/len2;
 if(t<0||t>1)return false;
 const qx=from.x+abx*t,qz=from.z+abz*t;
 return Math.hypot(px-qx,pz-qz)<=1.25;
}

// Path cost for one step. Grows inside 8 blocks of a hostile, and again on a
// skeleton's shot line, so a replan bends around both.
export function stepCost(block,hostiles,botPos){
 if(!block||!botPos)return 0;
 const p=block.position||block;
 let cost=0;
 for(const e of hostiles||[]){
  if(!e||!e.position)continue;
  const d=Math.hypot(p.x-e.position.x,p.z-e.position.z);
  if(d<8)cost+=(8-d)*6;
  if(RANGED.test(e.name||'')&&d<16&&onShotLine(p.x+0.5,p.z+0.5,e.position,botPos))cost+=40;
 }
 return cost;
}

// No-progress watchdog for a pathfinder that hangs without an event (issues
// #222 and #273). A real step resets it; digging does not count as a stall.
export function trackProgress(pos,now,prev,limitMs=12000){
 if(!prev||pos.distanceTo(prev.pos)>0.35)return {pos:pos.clone(),since:now,stuck:false};
 return {pos:prev.pos,since:prev.since,stuck:now-prev.since>limitMs};
}
