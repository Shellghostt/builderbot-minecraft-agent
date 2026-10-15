// Round 10, habit 8: diamonds the safe way - a branch mine at y -53 (lava lakes are at -54):
// a main 1x2 tunnel, side branches every 3, torches, lava plugged, done when the count is in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,plugLava,BRANCH_MAIN,BRANCH_LEN,BRANCH_EVERY} from '../src/worker.js';
import {diamondGather,DIAMOND_Y} from '../src/autopilot.js';
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return 'deepslate';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|water|lava|torch/.test(name)?'empty':'block'};};
 return {nameAt,blockAt,set:(x,y,z,n)=>cells.set(x+','+y+','+z,n)};
}
const Y=-53;
function miner(w,items=[{name:'cobblestone',count:16},{name:'torch',count:16},{name:'iron_pickaxe',count:1}]){
 w.set(0,Y,0,'air');w.set(0,Y+1,0,'air');
 const logs=[],placed=[],visits=[];
 const bot={entity:{position:new Vec3(0.5,Y,0.5)},entities:{},blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items.filter(i=>i.count>0)},tool:{async equipForBlock(){}},heldItem:null,
  async equip(item){bot.heldItem=item;},
  async placeBlock(ref,face){const p=ref.position.plus(face);placed.push(p.x+','+p.y+','+p.z+' '+bot.heldItem.name);w.set(p.x,p.y,p.z,bot.heldItem.name);},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,logs,check(){},save(){},log(m){logs.push(m);},
  count(n){return items.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  async stepInto(next){bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);visits.push(next.clone());},
  async climbTunnel(job){const p=job.tunnel[0];bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);}});
 return {bot,worker,logs,placed,visits};
}
test('the diamond trip goes to -53 and branch-mines there',()=>{
 assert.equal(DIAMOND_Y,-53);
 const j=diamondGather(3);
 assert.deepEqual([j.targetY,j.bandTop,j.strip],[-53,-53,true]);
});
test('branch mine: a main tunnel with branches left and right every 3, all on one level',async()=>{
 const w=world();
 const {worker,visits,placed}=miner(w);
 const job={id:'b'};
 await worker.branchMine(job,0,{main:9,branch:4});
 assert.equal(job.tunnel.length,9,'the main tunnel is the climb-back record');
 assert.ok(visits.every(v=>v.y===Y),'never off the level');
 // the main runs along +x (start 0,0 hashes to east); branches at x=3,6,9 to both sides
 for(const x of [3,6,9])for(const z of [4,-4])assert.equal(w.nameAt(x,Y,z),'air','branch end '+x+','+z);
 assert.equal(w.nameAt(4,Y,1),'deepslate','no branch between');
 assert.equal(visits.length,9+6*4);
 assert.ok(placed.some(p=>/torch$/.test(p)),'torches on the main tunnel');
});
test('a branch that meets lava ends there; the main tunnel goes on',async()=>{
 const w=world({'3,-53,-3':'lava'}); // beside the right branch's third cell
 const {worker,visits}=miner(w);
 const job={id:'l'};
 await worker.branchMine(job,0,{main:6,branch:4});
 assert.equal(job.tunnel.length,6);
 assert.equal(w.nameAt(3,Y,-2),'deepslate','the branch stopped before the cell beside the lava');
 assert.equal(w.nameAt(3,Y,-1),'air');
 assert.equal(w.nameAt(6,Y,-4),'air','the next branch still ran');
 assert.ok(visits.every(v=>w.nameAt(v.x,v.y,v.z)!=='lava'));
});
test('stopWhen ends the branch mine as soon as the count is in',async()=>{
 const w=world();const {worker,visits}=miner(w);
 let n=0;
 await worker.branchMine({id:'s'},0,{main:24,branch:6,stopWhen:()=>++n>=5});
 assert.equal(visits.length,5);
});
test('plugLava: lava beside the bot is replaced with a held block',async()=>{
 const w=world({'1,-53,0':'lava'});
 const {worker,placed,logs}=miner(w);
 await plugLava(worker,0,new Vec3(0,Y,0));
 assert.deepEqual(placed,['1,-53,0 cobblestone']);
 assert.ok(logs.some(l=>/plugged lava at 1,-53,0/.test(l)));
 const dry=world({'0,-51,0':'lava'});const t=miner(dry,[]);
 await assert.rejects(plugLava(t.worker,0,new Vec3(0,Y,0)),/no block to plug it/);
});
test('defaults: branches every 3, 6 long, a 24-block main',()=>{
 assert.deepEqual([BRANCH_EVERY,BRANCH_LEN,BRANCH_MAIN],[3,6,24]);
});
