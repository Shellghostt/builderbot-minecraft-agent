import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,GATHER_RESCAN_MS} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';
import {isExposed,pickStairDir,stonePlan,stoneBeside} from '../src/digDown.js';
// Hard-run stone step (soak 2026-10-14, dark-oak canopy on a dirt hill): findBlocks saw only
// stone BURIED under the dirt, every walk failed with "Cannot reach or harvest", and the bot
// skipped dozens of blocks a second with 0-22 cobble. Mine exposed stone near the bot, else
// staircase down where it stands; never straight down, never through fluid or built blocks.
const TYPES={air:0,stone:1,dirt:2,grass_block:3,water:4,oak_planks:5,bedrock:6,oak_leaves:7};
const natural=bl=>['stone','dirt','grass_block','oak_leaves'].includes(bl.name);
// A hill: grass at y=129, dirt down to 126, stone from 125 down. `edit` overrides cells.
function hill(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{
  const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);
  return y>129?'air':y===129?'grass_block':y>=126?'dirt':y>=110?'stone':'bedrock';
 };
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,type:TYPES[name],position:new Vec3(x,y,z),boundingBox:name==='air'||name==='water'?'empty':'block'};};
 return {cells,nameAt,blockAt,set:(x,y,z,name)=>cells.set(x+','+y+','+z,name)};
}
const isStone=bl=>bl.name==='stone';
test('isExposed: buried stone is not exposed, stone beside a dug cell is',()=>{
 const w=hill();
 assert.equal(isExposed(w.blockAt,new Vec3(0,125,0)),false);
 w.set(1,125,0,'air');
 assert.equal(isExposed(w.blockAt,new Vec3(0,125,0)),true);
 w.set(0,126,0,'water');
 assert.equal(isExposed(w.blockAt,new Vec3(0,124,0)),false,'water is not open space');
});
test('pickStairDir digs into the hill, never off a cliff, through water or a built block',()=>{
 const w=hill();
 // East: a cliff (no floor). South: water two steps in. West: a planks wall. North is left.
 for(let x=1;x<=8;x++)for(let y=110;y<=129;y++)for(let z=-3;z<=3;z++)if(x>=2)w.set(x,y,z,'air');
 w.set(0,127,2,'water');
 for(let y=120;y<=129;y++)w.set(-2,y,0,'oak_planks');
 const pick=pickStairDir(w.blockAt,{x:0,y:130,z:0},{isNatural:natural,isTarget:isStone});
 assert.ok(pick,'a direction is found');
 assert.deepEqual([pick.dir.x,pick.dir.z],[0,-1],'north, the only clean way into the ground');
 assert.equal(pick.steps,6);
 assert.ok(pick.stone>0,'the last steps reach the stone');
 // Every simulated step moves one block sideways per block down.
 const none=hill();for(const [x,z]of [[1,0],[-1,0],[0,1],[0,-1]])none.set(x,129,z,'water');
 assert.equal(pickStairDir(none.blockAt,{x:0,y:130,z:0},{isNatural:natural}),null,'water all round: no staircase');
});
test('pickStairDir prefers the direction through more stone when depths tie',()=>{
 const w=hill();
 // Shallow stone (y=127) on the west side only.
 for(let x=-8;x<=-1;x++)for(let z=-3;z<=3;z++)for(const y of [127,126])w.set(x,y,z,'stone');
 const pick=pickStairDir(w.blockAt,{x:0,y:130,z:0},{isNatural:natural,isTarget:isStone});
 assert.deepEqual([pick.dir.x,pick.dir.z],[-1,0]);
});
const stoneTargets=(w,cx,cz,r=8)=>{const out=[];for(let x=cx-r;x<=cx+r;x++)for(let z=cz-r;z<=cz+r;z++)for(let y=118;y<=129;y++)if(w.nameAt(x,y,z)==='stone')out.push(w.blockAt(x,y,z));return out;};
test('stonePlan: buried stone only -> dig down; exposed stone near -> mine it',()=>{
 const w=hill();
 let plan=stonePlan({targets:stoneTargets(w,0,0),botPos:new Vec3(0.5,130,0.5),blockAt:w.blockAt,isNatural:natural,isTarget:isStone});
 assert.equal(plan.action,'dig-down');
 assert.equal(plan.targetY,124,'six steps from y=130');
 // A cave mouth 5 blocks away exposes stone: mine that, do not dig.
 w.set(5,125,0,'air');
 plan=stonePlan({targets:stoneTargets(w,0,0),botPos:new Vec3(0.5,130,0.5),blockAt:w.blockAt,isNatural:natural,isTarget:isStone});
 assert.equal(plan.action,'mine');
 assert.ok(plan.targets.length&&plan.targets.every(t=>isExposed(w.blockAt,t.position)),'only exposed blocks');
});
test('stonePlan falls back to the old target list when digging down is not possible',()=>{
 const w=hill();
 // Dig-downs used up.
 let plan=stonePlan({targets:stoneTargets(w,0,0),botPos:new Vec3(0.5,130,0.5),blockAt:w.blockAt,isNatural:natural,isTarget:isStone,digDowns:3});
 assert.equal(plan.action,'mine');assert.ok(plan.targets.length>0);
 // Stone only far below (bot high on a pillar): no dig-down evidence within 12.
 plan=stonePlan({targets:stoneTargets(w,0,0),botPos:new Vec3(0.5,150,0.5),blockAt:w.blockAt,isNatural:natural,isTarget:isStone});
 assert.equal(plan.action,'mine');
 // The block under the feet is never a target (no shaft).
 const under=w.blockAt(0,125,0);w.set(0,126,0,'air');w.set(0,127,0,'air');
 plan=stonePlan({targets:[under],botPos:new Vec3(0.5,126,0.5),blockAt:w.blockAt,isNatural:natural,isTarget:isStone,digDowns:3});
 assert.deepEqual(plan.targets,[]);
});
test('stoneBeside looks at the side walls, not the floor',()=>{
 const w=hill();w.set(0,126,0,'air');w.set(0,127,0,'air');
 // Feet at 126: the floor (125) is stone, the walls are dirt.
 assert.equal(stoneBeside(w.blockAt,{x:0,y:126,z:0},isStone),false);
 assert.equal(stoneBeside(w.blockAt,{x:0,y:125,z:0},isStone),true);
});
// A gather on the hill with a real Worker.gather: the staircase is stubbed to cut the cells
// it would dig (it is covered by the live integration staircase leg).
function hillGather(w,{reach=4.5,count=3}={}){
 const registry={blocksByName:{stone:{id:1}},blocks:{1:{drops:[102],harvestTools:null}},items:{102:{name:'cobblestone'}}};
 let cobble=0;const calls={walks:[],stairs:[],explores:0,scans:[],logs:[]};
 const bot={registry,entity:{position:new Vec3(0.5,130,0.5)},heldItem:{type:9},
  inventory:{items(){return [];},emptySlotCount(){return 30;}},
  pathfinder:{movements:null,setMovements(){}},
  findBlocks({point,maxDistance,count:n}){calls.scans.push(Date.now());const out=[];for(let x=-10;x<=10;x++)for(let z=-10;z<=10;z++)for(let y=116;y<=131;y++)if(w.nameAt(x,y,z)==='stone'&&new Vec3(x,y,z).distanceTo(point)<=maxDistance)out.push(new Vec3(x,y,z));return out.sort((a,c)=>a.distanceTo(point)-c.distanceTo(point)).slice(0,n);},
  blockAt(p){return w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));},
  canDigBlock(bl){return bl.position.offset(0.5,0.5,0.5).distanceTo(bot.entity.position.offset(0,1.6,0))<=reach&&isExposed(w.blockAt,bl.position);},
  tool:{async equipForBlock(){}},
  async dig(bl){if(w.nameAt(bl.position.x,bl.position.y,bl.position.z)==='stone')cobble++;w.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker={bot,blacklist:new Blacklist(),config:{limits:{radius:32}},count(){return cobble;},save(){},check(){},update(){},
  log(m){calls.logs.push(m);},exploreMovements(){return {};},
  async walk(p){calls.walks.push(p.x+','+p.y+','+p.z);},async reachUp(){},async descendToReach(){},async canopyDrop(){},async sweepDrops(){},async mineColumnUnder(){},
  async exploreLeg(){calls.explores++;},
  async staircase(job,token,targetY,opts){
   calls.stairs.push({targetY,dir:[opts.dir.x,opts.dir.z],natural:!!opts.natural});
   job.tunnel=job.tunnel||[];
   while(Math.floor(bot.entity.position.y)>targetY){
    const f=bot.entity.position.floored(),n=f.plus(opts.dir).offset(0,-1,0);
    for(const dy of [0,1,2]){const bl=w.blockAt(n.x,n.y+dy,n.z);if(bl.boundingBox==='block'){assert.ok(opts.natural(bl),'natural only');await bot.dig(bl);}}
    bot.entity.position=new Vec3(n.x+0.5,n.y,n.z+0.5);job.tunnel.push({x:n.x,y:n.y,z:n.z});
    if(opts.stopWhen())break;
   }
  },
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 return {worker,calls,cobble:()=>cobble,job:{spec:{type:'gather',block:'stone',count,radius:32,searchIfMissing:true}}};
}
test('a stone gather on a dirt hill digs down where it stands and mines the tunnel walls',async()=>{
 const w=hill();
 const g=hillGather(w);
 await Worker.prototype.gather.call(g.worker,g.job,0);
 assert.ok(g.cobble()>=3,'collected '+g.cobble());
 assert.equal(g.calls.stairs.length,1,'one dig-down');
 assert.ok(g.calls.stairs[0].natural);
 assert.equal(g.calls.explores,0,'no canopy search');
 assert.ok(!g.calls.logs.some(l=>/skipping stone/.test(l)),'no buried-stone skip burst: '+g.calls.logs.join(' | '));
 // The bot stopped as soon as the walls were stone (y=125), not at the full six steps.
 assert.equal(g.job.tunnel.length,5);
 // Never a shaft: no tunnel cell sits straight under the previous one.
 for(let i=1;i<g.job.tunnel.length;i++){const a=g.job.tunnel[i-1],c=g.job.tunnel[i];assert.ok(a.x!==c.x||a.z!==c.z);}
});
test('exposed stone in reach is mined without digging down',async()=>{
 const w=hill();for(let y=126;y<=129;y++)w.set(2,y,0,'air'); // a pit beside the bot exposes stone
 const g=hillGather(w,{reach:7,count:1});
 await Worker.prototype.gather.call(g.worker,g.job,0);
 assert.equal(g.calls.stairs.length,0);
 assert.equal(g.cobble(),1);
});
test('a gather that collects nothing rescans at most once per second',async()=>{
 // Exposed stone that can never be reached (canDigBlock false): each scan blacklists one.
 const w=hill();for(const x of [3,5,7])for(let y=126;y<=129;y++)w.set(x,y,0,'air');
 const g=hillGather(w,{reach:0,count:1});
 g.job.spec.searchIfMissing=false;g.job.spec.radius=8;
 // No dig-down either: water round the bot.
 for(const [x,z]of [[1,0],[-1,0],[0,1],[0,-1]])w.set(x,129,z,'water');
 await assert.rejects(Worker.prototype.gather.call(g.worker,g.job,0));
 assert.ok(g.calls.scans.length>=3,'scans '+g.calls.scans.length);
 for(let i=1;i<g.calls.scans.length;i++)assert.ok(g.calls.scans[i]-g.calls.scans[i-1]>=GATHER_RESCAN_MS-20,'gap '+(g.calls.scans[i]-g.calls.scans[i-1]));
});
test('a natural-only tunnel step refuses a built block and a missing floor',async()=>{
 const w=hill();w.set(1,129,0,'oak_planks');
 const fake={bot:{blockAt:p=>w.blockAt(p.x,p.y,p.z),inventory:{items:()=>[]},tool:{async equipForBlock(){}},async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');}},check(){},clearCells:Worker.prototype.clearCells};
 await assert.rejects(Worker.prototype.digTunnelStep.call(fake,{},0,new Vec3(1,129,0),true,natural),/not natural terrain/);
 w.set(1,129,0,'dirt');w.set(1,128,0,'air');
 await assert.rejects(Worker.prototype.digTunnelStep.call(fake,{},0,new Vec3(1,129,0),true,natural),/no floor/);
 w.set(1,128,0,'dirt');
 await Worker.prototype.digTunnelStep.call(fake,{},0,new Vec3(1,129,0),true,natural);
});
