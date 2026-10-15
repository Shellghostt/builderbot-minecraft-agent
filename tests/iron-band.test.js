// Round 7, task 5: iron pickaxe 1/3, normal3 staircased to y=19, normal1 ended with 30 raw
// iron unsmelted. Iron is mined in the band near the surface (entered from the top, never
// below 16, exposed ore first) and smelted in the tunnel while the gather mines on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,descentTarget,DESCENT_LEG} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';
import {ironGather,IRON_FLOOR,IRON_TOP} from '../src/autopilot.js';
console.error=()=>{};
test('descentTarget: the band is entered from its top, a leg at a time, never below its floor',()=>{
 const s=ironGather(6);
 assert.equal(DESCENT_LEG,32);
 assert.equal(descentTarget(s,131),IRON_TOP,'a 131 surface stops at 64, not 32');
 assert.equal(descentTarget(s,64),32);
 assert.equal(descentTarget(s,40),IRON_FLOOR);
 assert.equal(descentTarget(s,70),38,'a plains surface: 32 down');
 assert.equal(descentTarget({targetY:-58},120),-58,'no band (diamonds): straight to the target');
});
// A stone world with ore placed by hand; the bot stands in a 1x2 air column at y=50.
function oreWorld(ores,air=[]){
 const cells=new Map();for(const [x,y,z] of ores)cells.set(x+','+y+','+z,'iron_ore');
 for(const [x,y,z] of air)cells.set(x+','+y+','+z,'air');
 for(const y of [50,51])cells.set('0,'+y+',0','air');
 const TYPES={stone:1,iron_ore:10,air:0};
 const nameAt=(x,y,z)=>cells.get(x+','+y+','+z)||'stone';
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,type:TYPES[name],position:new Vec3(x,y,z),boundingBox:name==='air'?'empty':'block'};};
 return {cells,nameAt,blockAt,set:(x,y,z,n)=>cells.set(x+','+y+','+z,n)};
}
function bandGather(world,{count=1,kilnTick}={}){
 const registry={blocksByName:{iron_ore:{id:10},deepslate_iron_ore:{id:11}},blocks:{10:{drops:[100],harvestTools:null},11:{drops:[100]}},items:{100:{name:'raw_iron'}}};
 let raw=0;const dug=[],walks=[],stairs=[];
 const bot={registry,entity:{position:new Vec3(0.5,50,0.5)},heldItem:{type:9},
  inventory:{items(){return [];},emptySlotCount(){return 30;}},pathfinder:{movements:null,setMovements(){}},
  findBlocks({point,maxDistance,count:n}){const out=[];for(const k of world.cells.keys()){if(world.cells.get(k)!=='iron_ore')continue;const [x,y,z]=k.split(',').map(Number);const p=new Vec3(x,y,z);if(p.distanceTo(point)<=maxDistance)out.push(p);}return out.slice(0,n);},
  blockAt(p){return world.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z));},
  canDigBlock(){return true;},tool:{async equipForBlock(){}},
  async dig(bl){dug.push(bl.position.toString());if(world.nameAt(bl.position.x,bl.position.y,bl.position.z)==='iron_ore')raw++;world.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker={bot,blacklist:new Blacklist(),config:{limits:{radius:32}},count(n){return n==='raw_iron'?raw:0;},save(){},check(){},update(){},log(){},
  exploreMovements(){return {};},async walk(p){walks.push(p.toString());},async sweepDrops(){},async mineColumnUnder(){},async exploreLeg(){},
  async staircase(job,token,y){stairs.push(y);bot.entity.position=new Vec3(0.5,y,0.5);},
  kilnTick:kilnTick?(job=>kilnTick(job,()=>raw,n=>{raw=n;})):Worker.prototype.kilnTick,
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 return {worker,dug,walks,stairs,raw:()=>raw,job:{spec:{...ironGather(count),count}}};
}
test('a band gather mines exposed ore before nearer buried ore, and never ore below the floor',async()=>{
 // Buried ore 3 away, exposed ore (a cave cell beside it) 6 away, a rich vein at y=10.
 const w=oreWorld([[3,50,0],[0,50,6],[1,10,0],[2,10,0],[1,11,0]],[[0,50,7],[0,51,7]]);
 const g=bandGather(w,{count:1,kilnTick:async()=>{}});
 await Worker.prototype.gather.call(g.worker,g.job,0);
 assert.deepEqual(g.dug,[new Vec3(0,50,6).toString()],'the exposed one first');
 const g2=bandGather(oreWorld([[1,10,0],[2,10,0],[1,11,0]]),{count:1,kilnTick:async()=>{}});
 await assert.rejects(Worker.prototype.gather.call(g2.worker,g2.job,0),/No matching blocks/);
 assert.deepEqual(g2.dug,[],'y=10 is below the band: not a target');
});
test('the band gather staircases to the band top first, then legs down to the floor',async()=>{
 const w=oreWorld([]);
 const g=bandGather(w,{count:1,kilnTick:async()=>{}});
 g.worker.bot.entity.position=new Vec3(0.5,131,0.5);
 g.job.spec.searchIfMissing=false;
 await assert.rejects(Worker.prototype.gather.call(g.worker,g.job,0),/No matching blocks/);
 assert.deepEqual(g.stairs,[64,32,16]);
});
test('raw ore loaded into the kiln still counts: a 6-ore gather digs 6, not 6 plus the kiln',async()=>{
 const ores=[];for(let i=1;i<=9;i++)ores.push([i,50,0]);
 const air=ores.map(([x])=>[x,51,0]); // every ore exposed from above
 const w=oreWorld(ores,air);
 let loads=0;
 const g=bandGather(w,{count:6,kilnTick:async(job,get,set)=>{if(get()>=3){job.kilnIn=(job.kilnIn||0)+get();set(0);loads++;}}});
 await Worker.prototype.gather.call(g.worker,g.job,0);
 assert.equal(g.dug.length,6);assert.equal(loads,1,'loaded once at 3 (the second 3 finished the job)');
});
// ---- the kiln itself ----------------------------------------------------------------------
function kilnWorker({inv:start={raw_iron:3,coal:2,furnace:1,stone_pickaxe:1},place=true}={}){
 const inv={...start},logs=[],picked=[];
 let block=null;
 const furnace={input:null,fuel:null,output:null,
  inputItem(){return this.input;},fuelItem(){return this.fuel;},outputItem(){return this.output;},
  async putInput(id,m,n){inv.raw_iron-=n;this.input={count:n};},async putFuel(id,m,n){const name=id===3?'coal':'oak_planks';inv[name]-=n;this.fuel={count:n};},
  async takeOutput(){inv.iron_ingot=(inv.iron_ingot||0)+this.output.count;this.output=null;},
  async takeInput(){inv.raw_iron+=this.input.count;this.input=null;},async takeFuel(){inv.coal+=this.fuel.count;this.fuel=null;},
  smelt(n){const k=Math.min(n,this.input?.count||0);this.output={count:(this.output?.count||0)+k};this.input=this.input.count-k?{count:this.input.count-k}:null;}};
 const bot={entity:{position:new Vec3(0.5,40,0.5)},
  registry:{itemsByName:{raw_iron:{id:1},iron_ingot:{id:2},coal:{id:3},oak_planks:{id:5}}},
  inventory:{items(){return Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
  blockAt(p){return block&&p.equals(block)?{name:'furnace',position:p}:{name:'stone',position:p};},
  async openFurnace(){return furnace;},async closeWindow(){}};
 const w=Object.assign(Object.create(Worker.prototype),{bot,deadline:Infinity,epoch:0,ready:true,config:{limits:{}},
  log:m=>logs.push(m),save(){},check(){},update(){},async walk(){},
  async placeBlockNear(){if(!place)throw Error('No clear spot');inv.furnace--;block=new Vec3(1,40,0);return block;},
  async pickUp(p){picked.push(p.toString());block=null;inv.furnace=(inv.furnace||0)+1;}});
 return {w,inv,furnace,logs,picked};
}
test('kiln: loads at 3 raw, takes the batch and reloads while mining, then comes back with the leftovers',async()=>{
 const k=kilnWorker();
 const job={spec:ironGather(6)};
 await k.w.kilnTick(job,0);
 assert.deepEqual([job.kiln.loaded,job.kilnIn,k.inv.raw_iron,k.inv.furnace],[3,3,0,0]);
 assert.ok(k.logs.some(m=>/^Gather: kiln at 1,40,0; smelting raw_iron while mining/.test(m)));
 // Not ready yet: nothing happens, even with more raw held.
 k.inv.raw_iron=3;await k.w.kilnTick(job,0);assert.equal(k.furnace.input.count,3);
 // Ready: take the 3 ingots, reload the 3 new raw with fresh fuel.
 k.furnace.smelt(3);job.kiln.readyAt=0;
 await k.w.kilnTick(job,0);
 assert.deepEqual([k.inv.iron_ingot,job.kiln.taken,job.kiln.loaded,job.kilnIn,k.inv.raw_iron],[3,3,3,6,0]);
 // Gather ends with the second batch half done: wait (bounded), take output, take back the rest.
 k.furnace.smelt(2);job.kiln.readyAt=Date.now()-1;
 await k.w.kilnTick(job,0,true);
 assert.deepEqual([k.inv.iron_ingot,k.inv.raw_iron,job.kilnIn,k.inv.furnace,job.kiln],[5,1,5,1,null]);
 assert.equal(k.picked.length,1,'the furnace came back');
});
test('kiln: no furnace, no fuel or no spot turns it off for the job; the gather goes on',async()=>{
 for(const [inv,place,reason] of [[{raw_iron:3,coal:2},true,/no furnace held/],[{raw_iron:3,furnace:1},true,/Not enough fuel/],[{raw_iron:3,coal:2,furnace:1},false,/could not place the furnace/]]){
  const k=kilnWorker({inv,place});
  const job={spec:ironGather(6)};
  await k.w.kilnTick(job,0);
  assert.match(job.kilnOff,reason);assert.equal(job.kiln,undefined);
  assert.ok(k.logs.some(m=>/smelting after the gather/.test(m)));
  await k.w.kilnTick(job,0);await k.w.kilnTick(job,0,true); // off: no retries, nothing to collect
 }
});
