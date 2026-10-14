import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
// M5 iron step, worker side: the ore scan takes both strata, and a furnace the smelt job
// placed goes back into the inventory (the ladder's stone step counts a held furnace).
const STOP=Error('scan captured');
function gatherFake(block){
 const registry={
  blocksByName:{iron_ore:{id:10},deepslate_iron_ore:{id:11},coal_ore:{id:12},stone:{id:1}},
  blocks:{10:{drops:[100]},11:{drops:[100]},12:{drops:[101]},1:{drops:[102]}},
  items:{100:{name:'raw_iron'},101:{name:'coal'},102:{name:'cobblestone'}}
 };
 const seen=[];
 const w={
  bot:{registry,entity:{position:new Vec3(0.5,20,0.5)},inventory:{items(){return [];},emptySlotCount(){return 30;}},
   pathfinder:{movements:null,setMovements(){}},findBlocks(o){seen.push(o.matching);throw STOP;},blockAt(){return null;}},
  config:{limits:{radius:32}},count(){return 0;},save(){},check(){},update(){},exploreMovements(){return {};}
 };
 return {w,seen,job:{spec:{type:'gather',block,count:2,radius:32}}};
}
test('an ore gather scans both stone and deepslate variants (same drop)',async()=>{
 let t=gatherFake('iron_ore');
 await assert.rejects(Worker.prototype.gather.call(t.w,t.job,0),e=>e===STOP);
 assert.deepEqual(t.seen[0],[10,11]);
 assert.equal(t.job.dropName,'raw_iron');
 t=gatherFake('stone');
 await assert.rejects(Worker.prototype.gather.call(t.w,t.job,0),e=>e===STOP);
 assert.equal(t.seen[0],1,'non-ore blocks are unchanged');
});
function smeltFake({worldFurnace}){
 const calls=[];
 const inv={raw_iron:6,coal:1,iron_ingot:0,furnace:worldFurnace?0:1};
 const furnaceAt=new Vec3(2,64,0);
 const w={
  bot:{
   registry:{itemsByName:{raw_iron:{id:1},iron_ingot:{id:2},coal:{id:3},furnace:{id:4}},blocksByName:{furnace:{id:40}}},
   inventory:{items(){return Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
   findBlock(){return worldFurnace?{position:furnaceAt,name:'furnace'}:null;},
   blockAt(p){return {position:p,name:'furnace'};},
   async openFurnace(){let out=0;return {
    async putInput(id,meta,n){calls.push(['input',n]);inv.raw_iron-=n;out=n;},
    async putFuel(id,meta,n){calls.push(['fuel',id,n]);},
    outputItem(){return {count:out};},
    async takeOutput(){inv.iron_ingot+=out;out=0;}};},
   async closeWindow(){}
  },
  log(m){calls.push(['log',m]);},check(){},
  count(n){return inv[n]||0;},
  fuelPlan:Worker.prototype.fuelPlan,
  async placeBlockNear(token,name){calls.push(['place',name]);inv[name]--;return furnaceAt;},
  async walk(){},
  async pickUp(p,name){calls.push(['pickUp',name,p.x]);inv[name]=(inv[name]||0)+1;}
 };
 return {w,calls,inv};
}
test('a smelt job picks up the furnace it placed, and leaves a world furnace standing',async()=>{
 let t=smeltFake({worldFurnace:false});
 await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6}},0);
 assert.equal(t.inv.iron_ingot,6);
 assert.deepEqual(t.calls.filter(c=>c[0]==='place'),[['place','furnace']]);
 assert.deepEqual(t.calls.filter(c=>c[0]==='pickUp'),[['pickUp','furnace',2]]);
 assert.equal(t.inv.furnace,1,'the furnace is held again (stone step stays done)');
 assert.deepEqual(t.calls.find(c=>c[0]==='fuel'),['fuel',3,1],'one coal smelts six');
 t=smeltFake({worldFurnace:true});
 await Worker.prototype.smelt.call(t.w,{spec:{type:'smelt',item:'raw_iron',count:6}},0);
 assert.equal(t.calls.filter(c=>c[0]==='pickUp').length,0,'a furnace it did not place is not taken');
});
test('pickUp equips the right tool before breaking (a furnace drops nothing to a bare hand)',async()=>{
 const order=[];let held=0;
 const block={name:'furnace',position:new Vec3(1,64,0)};
 const w={
  bot:{blockAt(p){return held>=1&&order.includes('dig')?null:block;},tool:{async equipForBlock(b){order.push('equip:'+b.name);}},async dig(){order.push('dig');held=1;}},
  count(){return held;},async walk(){},check(){},async sweepDrops(){}
 };
 await Worker.prototype.pickUp.call(w,block.position,'furnace',0);
 assert.deepEqual(order,['equip:furnace','dig']);
});
test('an ore job with a targetY digs its staircase before any surface search',async()=>{
 const t=gatherFake('iron_ore');
 const steps=[];
 t.w.bot.findBlocks=()=>[];
 t.w.exploreLeg=async()=>{steps.push('explore');throw STOP;};
 t.w.staircase=async(job,token,y)=>{steps.push('stair '+y);throw STOP;};
 t.job.spec={...t.job.spec,searchIfMissing:true,targetY:16};
 await assert.rejects(Worker.prototype.gather.call(t.w,t.job,0),e=>e===STOP);
 assert.deepEqual(steps,['stair 16']);
 // Without a targetY (or already at depth) the surface search still comes first.
 const u=gatherFake('iron_ore');
 u.w.bot.findBlocks=()=>[];u.w.exploreLeg=t.w.exploreLeg;u.w.staircase=t.w.staircase;
 u.job.spec={...u.job.spec,searchIfMissing:true};steps.length=0;
 await assert.rejects(Worker.prototype.gather.call(u.w,u.job,0),e=>e===STOP);
 assert.deepEqual(steps,['explore']);
});
