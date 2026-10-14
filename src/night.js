// Night survival decisions (cloud round 5, after the round-4 dark-forest soak: 3 skeleton
// deaths and a drowning in one night). Pure helpers over a blockAt(x,y,z) lookup and plain
// positions, so the shelter job, the survival gate, Mob Defense and the autopilot share one
// tested rulebook:
// - the shelter starts at SUNSET (12000), ~50 s before the first spawns, not at bed time;
// - the shell is fully enclosed (feet ring, head ring, roof, open floor) and re-sealed;
// - a sealed shelter is never left for a flee: only a mob inside or next to a gap is hit;
// - caught outside in a crowd, pillar up 3 instead of sprinting through it;
// - flee headings and paths keep out of deep water after dark.
import {NIGHT_START,NIGHT_END} from './daytime.js';
export const SUNSET=12000,DUSK_PREP=10000;
// Night job window: the shelter goes up from sunset; a bed only works from NIGHT_START.
export const shelterDue=tod=>tod!=null&&tod>=SUNSET&&tod<=NIGHT_END;
export const darkNow=tod=>tod!=null&&tod>=SUNSET; // the shelter holds from sunset until the clock wraps to 0
export const nightJobFor=(tod,bedNear)=>bedNear?(tod!=null&&tod>=NIGHT_START&&tod<=NIGHT_END?{type:'sleep'}:null):(shelterDue(tod)?{type:'shelter'}:null);
const solid=b=>!!b&&b.boundingBox==='block';
const fluid=b=>!!b&&/^(water|lava|bubble_column)$/.test(b.name||'');
const key=p=>p.x+','+p.y+','+p.z;
// The 3x3x3 box around the bot's 2-high cell. required: every cell that must be solid for
// no line of sight (feet ring, head ring, the full roof, and the floor under the feet when it
// is open). support: the ring under the feet ring, placed only to anchor the feet ring where
// nothing else can (a pillar top, a ledge).
export function shelterShell(origin){
 const o={x:origin.x|0,y:origin.y|0,z:origin.z|0},required=[],support=[];
 for(let dy=0;dy<=2;dy++)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
  if(!dx&&!dz&&dy<2)continue; // the bot's feet and head cells
  required.push({x:o.x+dx,y:o.y+dy,z:o.z+dz});
 }
 required.unshift({x:o.x,y:o.y-1,z:o.z}); // floor first: a bot over a hole is not enclosed
 for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)if(dx||dz)support.push({x:o.x+dx,y:o.y-1,z:o.z+dz});
 return {origin:o,required,support};
}
// Cells of `cells` that are not solid (a gap a mob can see or walk through). Unloaded cells
// (null) count as gaps: the job can only vouch for what it sees.
export const shellGaps=(blockAt,cells)=>cells.filter(c=>!solid(blockAt(c.x,c.y,c.z)));
// Placement order for one pass: a cell is placeable when a face neighbour is solid (or will
// be, earlier in the same pass). Returns [{cell, against}] for the cells that can go now.
const FACES=[[0,-1,0],[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]];
export function placementPlan(blockAt,cells){
 const done=new Set(),out=[];
 const isSolid=p=>done.has(key(p))||solid(blockAt(p.x,p.y,p.z));
 let progress=true;
 const left=cells.filter(c=>!solid(blockAt(c.x,c.y,c.z)));
 while(progress&&left.length){
  progress=false;
  for(let i=0;i<left.length;i++){
   const c=left[i];
   const f=FACES.find(([dx,dy,dz])=>isSolid({x:c.x-dx,y:c.y-dy,z:c.z-dz}));
   if(!f)continue;
   out.push({cell:c,against:{x:c.x-f[0],y:c.y-f[1],z:c.z-f[2]},face:{x:f[0],y:f[1],z:f[2]}});
   done.add(key(c));left.splice(i,1);i--;progress=true;
  }
 }
 return {plan:out,stuck:left};
}
// A hostile inside the box: its feet within the bot's column (the 1x2 interior).
export function insideShelter(pos,origin){
 return Math.abs(pos.x-(origin.x+0.5))<1&&Math.abs(pos.z-(origin.z+0.5))<1&&pos.y>=origin.y-0.5&&pos.y<origin.y+2;
}
// What a sealed shelter may hit: a hostile inside, or one standing at a gap (its feet or
// eyes within 1.6 of an open cell's centre) and in reach (3.0 from the bot's eyes).
export function shelterTarget(hostiles,origin,gaps,reach=3){
 const eye={x:origin.x+0.5,y:origin.y+1.62,z:origin.z+0.5};
 let best=null,bestD=Infinity;
 for(const h of hostiles||[]){
  if(!h||!h.position)continue;
  const p=h.position;
  const inside=insideShelter(p,origin);
  const d=Math.hypot(p.x-eye.x,(p.y+1)-eye.y,p.z-eye.z);
  if(!inside){
   if(d>reach+0.5)continue;
   const atGap=gaps.some(g=>Math.hypot(p.x-(g.x+0.5),p.z-(g.z+0.5))<=1.6&&g.y>=Math.floor(p.y)-1&&g.y<=Math.floor(p.y)+2);
   if(!atGap)continue;
  }
  const score=inside?d-100:d;
  if(score<bestD){bestD=score;best={entity:h,inside,distance:d};}
 }
 return best;
}
// Pillar height (0..max) the standing cell allows: solid support, cells up to y+h+1 open.
export function pillarRoom(blockAt,x,y,z,max=3){
 if(!solid(blockAt(x,y-1,z)))return 0;
 let h=0;
 for(let i=1;i<=max;i++){
  const b=blockAt(x,y+i+1,z);
  if(solid(b)||fluid(b))break;
  h=i;
 }
 return h;
}
// Caught outside after dark: a crowd (3+ hostiles within 16), or any hostile within 8 that
// the fight policy refuses. Sprinting away from the nearest one ran the round-4 bot through
// the rest of the pack, into a lake, and under skeleton fire. The answer is a 3-block
// pillar (zombies cannot reach, creepers cannot fuse from the base) when 3+ blocks are held
// and the column fits; null leaves the ordinary ladder (fight / flee) in charge.
export function nightRefuge({tod,me,hostiles,blocks=0,room=0,onGround=true,inFluid=false,fightAllowed=false}){
 if(!darkNow(tod)||!me)return null;
 const near=(hostiles||[]).filter(h=>h&&h.position&&Math.hypot(h.position.x-me.x,h.position.y-me.y,h.position.z-me.z)<=16);
 if(!near.length)return null;
 const close=near.filter(h=>Math.hypot(h.position.x-me.x,h.position.z-me.z)<=8);
 const crowd=near.length>=3||(!fightAllowed&&close.length>0);
 if(!crowd)return null;
 if(inFluid||!onGround||blocks<3||room<3)return null;
 // A mob already touching the column climbs with us (spiders) or blocks the jump: fight/flee.
 if(near.some(h=>Math.hypot(h.position.x-me.x,h.position.z-me.z)<1.2))return null;
 return {action:'pillar',height:3,crowd:near.length};
}
// Deep water: a water cell with water above or below it (no footing). The step cost bans
// it after dark (cost 100 is the pathfinder's "cannot move"), and makes it expensive by day.
export function deepWaterCost(blockAt,pos,dark){
 const here=blockAt(pos.x,pos.y,pos.z);
 if(!here||!/^(water|bubble_column)$/.test(here.name||''))return 0;
 const below=blockAt(pos.x,pos.y-1,pos.z),above=blockAt(pos.x,pos.y+1,pos.z);
 const deep=[below,above].some(b=>b&&/^(water|bubble_column)$/.test(b.name||''));
 if(!deep)return 0;
 return dark?100:12;
}
// Flee heading for a blind sprint (RunAwayTask holds forward): away from the crowd's
// weighted centre, not just the nearest mob, and never into water, lava or a drop deeper
// than 3 within 4 blocks, nor through a hostile. Unknown (null) blocks are not hazards.
// Returns a unit heading {x,z,cost,blocked}, or null with no hostiles.
export function fleeHeading(blockAt,me,hostiles,{shelter=null}={}){
 const list=(hostiles||[]).filter(h=>h&&h.position);
 if(!list.length)return null;
 let ax=0,az=0;
 for(const h of list){
  const dx=me.x-h.position.x,dz=me.z-h.position.z,d=Math.max(0.5,Math.hypot(dx,dz));
  ax+=dx/(d*d);az+=dz/(d*d);
 }
 if(Math.hypot(ax,az)<1e-6){ax=1;az=0;}
 const base=Math.atan2(az,ax);
 const fx=Math.floor(me.x),fy=Math.floor(me.y),fz=Math.floor(me.z);
 const hazard=(hx,hz)=>{
  for(let s=1;s<=4;s++){
   const x=Math.floor(me.x+hx*s),z=Math.floor(me.z+hz*s);
   if(x===fx&&z===fz)continue;
   // The walk climbs one block or drops up to three: find the footing near the bot's level.
   const feet=blockAt(x,fy,z),head=blockAt(x,fy+1,z);
   if(fluid(feet)||fluid(head))return 100;
   if(feet==null)continue; // unloaded / unknown
   if(solid(feet)){const up=blockAt(x,fy+1,z),up2=blockAt(x,fy+2,z);if(solid(up)||solid(up2))return 20;continue;} // a wall: slows, not deadly
   let drop=0;
   for(let dy=1;dy<=4;dy++){const b=blockAt(x,fy-dy,z);if(b==null){drop=0;break;}if(fluid(b))return 100;if(solid(b))break;drop=dy;}
   if(drop>3)return 60;
  }
  return 0;
 };
 const through=(hx,hz)=>{
  let pen=0;
  for(const h of list){
   const rx=h.position.x-me.x,rz=h.position.z-me.z,t=rx*hx+rz*hz;
   if(t<=0||t>8)continue;
   const off=Math.abs(rx*hz-rz*hx);
   if(off<2.5)pen+=40*(1-off/2.5)+10;
  }
  return pen;
 };
 let best=null;
 for(const turn of [0,0.39,-0.39,0.79,-0.79,1.18,-1.18,1.57,-1.57,2.36,-2.36,Math.PI]){
  const a=base+turn,hx=Math.cos(a),hz=Math.sin(a);
  const hz2=hazard(hx,hz);
  let cost=Math.abs(turn)*8+hz2+through(hx,hz);
  if(shelter){
   const sx=shelter.x+0.5-me.x,sz=shelter.z+0.5-me.z,sd=Math.hypot(sx,sz);
   if(sd>1&&sd<=24)cost-=6*Math.max(0,(sx*hx+sz*hz)/sd);
  }
  if(!best||cost<best.cost)best={x:hx,z:hz,cost,turn,hazard:hz2};
 }
 // blocked: even the best heading walks into a fluid - better to stand than to swim.
 return {x:best.x,z:best.z,cost:best.cost,blocked:best.hazard>=100};
}
