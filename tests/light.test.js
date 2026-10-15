// Round 10, habit 7: light and mark mines - torches as soon as coal and sticks exist, one every
// 7 tunnel steps on the right-hand wall (the way back is on the left), a lit home bed, and
// charcoal from logs when coal digs keep failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Vec3} from 'vec3';
import {Worker,torchSpot,TORCH_EVERY} from '../src/worker.js';
import {Autopilot,torchJob,ironRung,COAL_OFF_MS,TORCHES} from '../src/autopilot.js';
import {jobSchema} from '../src/schema.js';
const c=map=>n=>map[n]||0;
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>=130?'air':'stone';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|torch/.test(name)?'empty':'block'};};
 return {nameAt,blockAt,set:(x,y,z,n)=>cells.set(x+','+y+','+z,n)};
}
test('torchSpot: the right-hand wall of the way in, else the floor',()=>{
 const w=world();
 // heading east (+x): the right hand is south (+z); the torch hangs on that wall's north face
 assert.deepEqual(torchSpot(w.blockAt,{x:0,y:129,z:0},{x:1,z:0}),{against:{x:0,y:129,z:1},face:{x:0,y:0,z:-1},side:'right'});
 // heading north (-z): the right hand is east (+x)
 assert.deepEqual(torchSpot(w.blockAt,{x:0,y:129,z:0},{x:0,z:-1}).against,{x:1,y:129,z:0});
 w.set(0,129,1,'air');
 assert.deepEqual(torchSpot(w.blockAt,{x:0,y:129,z:0},{x:1,z:0}),{against:{x:0,y:128,z:0},face:{x:0,y:1,z:0},side:'floor'});
 assert.equal(torchSpot(world({'0,128,0':'air','0,129,1':'air'}).blockAt,{x:0,y:129,z:0},{x:1,z:0}),null);
});
test('a staircase lights every 7th step on its right-hand wall',async()=>{
 const w=world();const placed=[];
 const items=[{name:'torch',count:8},{name:'cobblestone',count:4}];
 const bot={entity:{position:new Vec3(0.5,130,0.5)},entities:{},blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items},tool:{async equipForBlock(){}},async equip(){},
  async placeBlock(bl,face){placed.push(bl.position.offset(face.x,face.y,face.z).toArray().join(','));},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,check(){},save(){},log(){},count(n){return items.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  async stepInto(next){bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);}});
 await Worker.prototype.staircase.call(worker,{id:'t'},0,130-2*TORCH_EVERY,{dir:new Vec3(1,0,0)});
 assert.equal(placed.length,2,'steps 7 and 14: '+placed);
 // step 7 is at x=7, feet y=123: the torch cell is in the tunnel, against the south wall
 assert.deepEqual(placed[0],'7,123,0');
});
test('torchJob: torches from held coal and sticks, one coal kept for the furnace',()=>{
 assert.deepEqual(torchJob({coal:3,stick:4},{}),{type:'craft',item:'torch',count:8});
 assert.equal(torchJob({coal:1,stick:4},{}),null,'the last coal is the furnace\'s');
 assert.deepEqual(torchJob({coal:9,stick:9,torch:12},{}),{type:'craft',item:'torch',count:4});
 assert.equal(torchJob({coal:9,stick:9,torch:TORCHES},{}),null);
 assert.equal(torchJob({coal:9},{}),null,'no sticks');
 assert.ok(jobSchema.safeParse(torchJob({charcoal:3,stick:2},{})).success);
});
test('coal digs that keep failing turn into charcoal from logs',()=>{
 const base={iron_pickaxe:1,iron_sword:1,shield:1,stone_sword:1,stick:8,oak_planks:8,crafting_table:1,cobblestone:20,stone_pickaxe:2,furnace:1};
 let j=ironRung(c({...base,oak_log:8}),{planksTotal:8,logsTotal:8,heldLog:'oak_log',coalOff:true});
 assert.deepEqual(j,{type:'smelt',item:'oak_log',count:4});
 j=ironRung(c(base),{planksTotal:8,logsTotal:0,heldLog:null,coalOff:true});
 assert.equal(j.block,'log');
 j=ironRung(c(base),{planksTotal:8,logsTotal:0,heldLog:null});
 assert.equal(j.block,'coal_ore','coal first while digs work');
});
function autopilot({items={},home=null,blocks={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'light-'));
 const submitted=[],jobs=[];
 const worker={ready:true,userStopped:false,deathResume:false,jobs,log(){},
  submit(spec){jobSchema.parse(spec);submitted.push(spec);const job={id:'j'+submitted.length,status:'running',spec};jobs.push(job);return job;},cancel(){},
  bot:{time:{timeOfDay:3000,day:3},inventory:{items:()=>Object.entries(items).filter(([,n])=>n>0).map(([name,count])=>({name,count})),slots:[]},entities:{},
   registry:{blocksByName:{},foodsByName:{cooked_beef:{}},itemsByName:{}},findBlock(){return null;},
   blockAt(p){const k=p.x+','+p.y+','+p.z;const n=blocks[k]??(p.y<64?'grass_block':'air');return {name:n,boundingBox:/air|torch/.test(n)?'empty':'block'};},
   entity:{position:new Vec3(0.5,64,0.5)}}};
 const ap=new Autopilot(worker,root);ap.home=home;
 return {ap,worker,jobs,submitted,items,done(){fs.rmSync(root,{recursive:true,force:true});}};
}
const KIT={oak_planks:8,stick:10,crafting_table:1,wooden_pickaxe:1,wooden_sword:1,wooden_axe:1,stone_pickaxe:2,stone_sword:1,stone_axe:1,stone_shovel:1,furnace:1,cooked_beef:8,cobblestone:20};
test('autopilot: two torches beside the home bed, then the ladder',()=>{
 const t=autopilot({items:{...KIT,torch:16},home:{x:1,y:64,z:0},blocks:{'1,64,0':'white_bed'}});
 try{
  t.ap.start();t.ap.tick();
  assert.deepEqual(t.submitted[0],{type:'place',block:'torch',position:{x:3,y:64,z:0}});
  assert.equal(t.ap.currentStep,'light');
  t.jobs[0].status='complete';t.worker.bot.blockAt=(orig=>p=>p.x===3&&p.y===64&&p.z===0?{name:'torch',boundingBox:'empty'}:orig(p))(t.worker.bot.blockAt);
  t.ap.tick();
  assert.deepEqual(t.submitted[1],{type:'place',block:'torch',position:{x:-1,y:64,z:0}});
  t.jobs[1].status='complete';const prev=t.worker.bot.blockAt;t.worker.bot.blockAt=p=>p.x===-1&&p.y===64&&p.z===0?{name:'torch',boundingBox:'empty'}:prev(p);
  t.ap.tick();
  assert.notEqual(t.submitted[2].block,'torch','lit: the ladder goes on');
 }finally{t.done();}
});
test('autopilot: two failed coal digs set coal aside for charcoal',()=>{
 const t=autopilot({items:{...KIT,iron_pickaxe:1,iron_sword:1,shield:1}});
 try{
  t.ap.start();
  for(let i=0;i<2;i++){t.ap.coolUntil=0;t.ap.tick();assert.equal(t.submitted.at(-1).block,'coal_ore');t.jobs.at(-1).status='failed';t.ap.tick();}
  assert.ok(t.ap.coalOffUntil>Date.now()+COAL_OFF_MS-1000);
  t.ap.coolUntil=0;t.ap.tick();
  assert.equal(t.submitted.at(-1).block,'log','logs for charcoal (none held)');
 }finally{t.done();}
});
