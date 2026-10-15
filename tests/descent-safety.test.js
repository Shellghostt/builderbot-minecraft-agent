// Round 10, bug A: round-9 normal2 'fell from a high place' at (444,13,10) on the diamond
// rung and normal3 fell 18.4 -> 12.4 -> 3.5 hp on its staircase. The ore staircase (and the
// strip mine) never looked under the next step, so a cave or ravine opening there dropped
// the bot. Now every step's footing is checked two cells down: a shallow hole is filled, a
// deep opening turns the tunnel, and no safe way on stops it - the bot never drops > 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker,planTunnelStep,descendLeg,STAIR_TURNS} from '../src/worker.js';
import {stepFooting,turnOrder} from '../src/digDown.js';

// Stone below y=130, air above; `edit` overrides cells ('x,y,z' -> name).
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>=130?'air':'stone';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|water|lava/.test(name)?'empty':'block'};};
 const set=(x,y,z,name)=>cells.set(x+','+y+','+z,name);
 return {nameAt,blockAt,set};
}
const solidAt=(w,x,y,z)=>w.blockAt(x,y,z).boundingBox==='block';
// A cave: every cell in the box is air.
const carve=(w,[x0,x1],[y0,y1],[z0,z1])=>{for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++)w.set(x,y,z,'air');};
function digger(w,start=new Vec3(0.5,130,0.5),items=[{name:'cobblestone',count:16}]){
 const placed=[],drops=[],logs=[];
 const bot={entity:{position:start.clone()},entities:{},heldItem:null,
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items.filter(i=>i.count>0)},tool:{async equipForBlock(){}},
  async equip(item){bot.heldItem=item;},
  async placeBlock(support,face){const p=support.position.plus(face);w.set(p.x,p.y,p.z,bot.heldItem.name);bot.heldItem.count--;placed.push(p.x+','+p.y+','+p.z);},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,check(){},save(){},log(m){logs.push(m);},async placeTorch(){},
  // Walk into the cell, then fall like the game does until something solid is underfoot.
  async stepInto(next){
   let y=next.y;while(y>100&&!solidAt(w,next.x,y-1,next.z))y--;
   drops.push(next.y-y);bot.entity.position=new Vec3(next.x+0.5,y,next.z+0.5);
  }});
 return {bot,worker,placed,drops,logs};
}

test('stepFooting: solid floor ok, a shallow hole is filled, a deep opening or lava turns',()=>{
 const w=world();
 assert.deepEqual(stepFooting(w.blockAt,{x:1,y:129,z:0}),{ok:true});
 // A one-deep pocket under the step: fill it from the block below (top face).
 w.set(1,128,0,'air');
 const fill=stepFooting(w.blockAt,{x:1,y:129,z:0});
 assert.deepEqual(fill.fill,{x:1,y:128,z:0});
 assert.deepEqual([fill.support,fill.face],[{x:1,y:127,z:0},{x:0,y:1,z:0}]);
 // Three deep: a cave opening, not a pocket.
 w.set(1,127,0,'air');w.set(1,126,0,'air');
 assert.match(stepFooting(w.blockAt,{x:1,y:129,z:0}).turn,/cave opening/);
 const lava=world({'1,127,0':'lava'});
 assert.match(stepFooting(lava.blockAt,{x:1,y:129,z:0}).turn,/lava two below/);
 const loose=world({'1,128,0':'gravel','1,127,0':'air'});
 assert.match(stepFooting(loose.blockAt,{x:1,y:129,z:0}).turn,/loose gravel over a hollow/);
 const water=world({'1,128,0':'water'});
 assert.match(stepFooting(water.blockAt,{x:1,y:129,z:0}).turn,/water under/);
});
test('turnOrder: straight on, then the two sides, never back',()=>{
 assert.deepEqual(turnOrder({x:1,z:0}).map(d=>[d.x,d.z]),[[1,0],[0,-1],[0,1]]);
});
test('a staircase reaching a cave opening turns aside and never drops more than one block',async()=>{
 const w=world();
 // A cave right under the third step east: (3,126..121,0) and around it.
 carve(w,[3,6],[118,126],[-1,1]);
 const {worker,drops,logs}=digger(w);
 const job={id:'dia'};
 await Worker.prototype.staircase.call(worker,job,0,124,{dir:new Vec3(1,0,0)});
 assert.ok(drops.every(d=>d===0),'every step lands on its own floor: '+drops);
 assert.equal(job.tunnel.length,6);
 for(const p of job.tunnel)assert.ok(solidAt(w,p.x,p.y-1,p.z),'floor under '+JSON.stringify(p));
 assert.ok(logs.some(l=>/cave opening.*turning (north|south)/.test(l)),logs.join('\n'));
 assert.ok(job.stairTurns>=1);
});
test('a one-deep pocket under a step is filled with cobblestone, then stepped on',async()=>{
 const w=world({'2,127,0':'air'}); // under step 2 (feet y=128)
 const {worker,placed,drops,logs}=digger(w);
 const job={id:'iron'};
 await Worker.prototype.staircase.call(worker,job,0,127,{dir:new Vec3(1,0,0)});
 assert.deepEqual(placed,['2,127,0']);
 assert.equal(w.nameAt(2,127,0),'cobblestone');
 assert.ok(drops.every(d=>d===0));
 assert.ok(logs.some(l=>/filled a hole under/.test(l)));
 assert.equal(job.stairTurns||0,0,'filled, not turned');
});
test('a hole with no block to fill it turns the tunnel instead',async()=>{
 const w=world({'1,128,0':'air'});
 const {worker,placed,drops}=digger(w,undefined,[]);
 const job={id:'x'};
 await Worker.prototype.staircase.call(worker,job,0,128,{dir:new Vec3(1,0,0)});
 assert.deepEqual(placed,[]);
 assert.ok(drops.every(d=>d===0));
 assert.notEqual(job.tunnel[0].x,1,'turned away from the hole');
});
test('openings on every side stop the staircase where it stands',async()=>{
 const w=world();
 carve(w,[-3,3],[120,128],[-3,3]);w.set(0,129,0,'stone'); // the bot stands on a pillar over a cave
 for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)if(x||z)w.set(x,129,z,'stone');
 const {worker,bot,drops}=digger(w);
 const job={id:'d'};
 await assert.rejects(Worker.prototype.staircase.call(worker,job,0,120,{dir:new Vec3(1,0,0)}),/Tunnel stopped: cave opening.*no safe way on/);
 assert.equal(bot.entity.position.y,130,'never walked off');
 assert.deepEqual(drops,[]);
});
test('turns are capped per job',()=>{
 const w=world();carve(w,[1,1],[120,128],[0,0]);
 const bot={entity:{position:new Vec3(0.5,130,0.5)},blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),inventory:{items:()=>[]}};
 const job={stairTurns:STAIR_TURNS};
 const plan=planTunnelStep(bot,job,new Vec3(1,0,0),-1);
 assert.equal(plan.next,undefined);
 assert.ok(plan.why.includes('turn limit'));
});
test('the strip mine turns at a ravine instead of walking into it',async()=>{
 const w=world();
 // Strip at the bot's level (feet y=130 on stone): a ravine two cells ahead in its direction.
 for(let y=130;y<=131;y++)for(let x=-40;x<=40;x++)for(let z=-40;z<=40;z++)w.set(x,y,z,'stone'); // buried
 w.set(0,130,0,'air');w.set(0,131,0,'air');
 const start=new Vec3(0.5,130,0.5);
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(0+0*5)%4];
 carve(w,[2*dir.x-1+(dir.x?0:0),2*dir.x+1],[110,129],[-1,1]);
 const {worker,drops,logs}=digger(w,start);
 const job={id:'s'};
 await Worker.prototype.stripMine.call(worker,job,0,6);
 assert.ok(drops.every(d=>d===0),'drops '+drops);
 for(const p of job.tunnel)assert.ok(solidAt(w,p.x,p.y-1,p.z));
 assert.ok(logs.some(l=>/turning/.test(l)),logs.join('\n'));
});
test('descendToReach refuses a dig that opens a deep drop (the precedence bug)',async()=>{
 const w=world();carve(w,[0,0],[120,128],[0,0]); // the block under the feet hides a shaft
 const {worker,bot}=digger(w);
 let digs=0;bot.dig=async()=>{digs++;};bot.canDigBlock=()=>false;
 await Worker.prototype.descendToReach.call(worker,{position:new Vec3(1,124,0)},0);
 assert.equal(digs,0,'a 9-block shaft under the floor is never opened');
 const shallow=world({'0,128,0':'air'});
 const t=digger(shallow);let d2=0;t.bot.dig=async bl=>{d2++;shallow.set(bl.position.x,bl.position.y,bl.position.z,'air');t.bot.entity.position=new Vec3(0.5,128,0.5);};t.bot.canDigBlock=()=>false;
 await Worker.prototype.descendToReach.call(t.worker,{position:new Vec3(1,124,0)},0);
 assert.ok(d2>=1,'a 2-block drop is still allowed');
});
test('an ore descent stopped by a cave opening hands back to the gather; lava still fails it',async()=>{
 const {worker,logs}=digger(world());
 worker.staircase=async()=>{throw Error('Tunnel stopped: cave opening under 1,120,0 (3+ deep); no safe way on');};
 await descendLeg(worker,{},0,-54);
 assert.ok(logs.some(l=>/descent stopped at y=130.*searching from here/.test(l)));
 worker.staircase=async()=>{throw Error('Tunnel stopped: lava at 1,120,0');};
 await assert.rejects(descendLeg(worker,{},0,-54),/lava at/);
});
