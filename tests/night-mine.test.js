// Round 10, habit 4: use the night instead of idling in the box. A sealed shelter with a stone
// pickaxe sinks a checked 2-deep sump through its floor, staircases down from there (the box
// stays sealed above), mines coal/iron in the walls, and is back in the box before dawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {shelterShell,shellGaps,nightMineWanted,tunnelBreach,NIGHT_MINE_FROM,NIGHT_MINE_STOP,NIGHT_MINE_BLOCKS} from '../src/night.js';
const ORIGIN=new Vec3(0,64,0);
function world(edit={}){
 const cells=new Map(Object.entries(edit));
 const nameAt=(x,y,z)=>{const k=x+','+y+','+z;if(cells.has(k))return cells.get(k);return y>=64?'air':'stone';};
 const blockAt=(x,y,z)=>{const name=nameAt(x,y,z);return {name,position:new Vec3(x,y,z),boundingBox:/air|water|lava/.test(name)?'empty':'block'};};
 const set=(x,y,z,n)=>cells.set(x+','+y+','+z,n);
 for(const c of shelterShell(ORIGIN).required)if(nameAt(c.x,c.y,c.z)==='air')set(c.x,c.y,c.z,'cobblestone');
 return {nameAt,blockAt,set};
}
const solidAt=(w,x,y,z)=>w.blockAt(x,y,z).boundingBox==='block';
function miner(w,{tod=13500,items=[{name:'stone_pickaxe',count:1,type:901},{name:'cobblestone',count:12}]}={}){
 const logs=[],gapsSeen=[];
 const fall=()=>{let p=bot.entity.position.floored();while(p.y>0&&!solidAt(w,p.x,p.y-1,p.z))p=p.offset(0,-1,0);bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);};
 const bot={entity:{position:new Vec3(0.5,64,0.5)},entities:{},health:20,time:{timeOfDay:tod},
  blockAt:p=>w.blockAt(Math.floor(p.x),Math.floor(p.y),Math.floor(p.z)),
  inventory:{items:()=>items},tool:{async equipForBlock(){}},
  pathfinder:{movements:'normal',setMovements(m){this.movements=m;}},
  async equip(){},async placeBlock(){},
  async dig(bl){w.set(bl.position.x,bl.position.y,bl.position.z,'air');fall();
   gapsSeen.push(shellGaps(w.blockAt,shelterShell(ORIGIN).required.slice(1)).length);}};
 const worker=Object.assign(Object.create(Worker.prototype),{bot,epoch:0,config:{},logs,check(){},save(){},log(m){logs.push(m);},async placeTorch(){},
  count(n){return items.filter(i=>i.name===n).reduce((a,i)=>a+i.count,0);},
  exploreMovements(){return 'explore';},
  async stepInto(next){bot.entity.position=new Vec3(next.x+0.5,next.y,next.z+0.5);fall();},
  async climbTunnel(job){const p=job.tunnel[0];bot.entity.position=new Vec3(p.x+0.5,p.y,p.z+0.5);worker.climbed=job.tunnel.length;},
  // the pathfinder's 1x1 tower: places a block under the bot at each jump
  async navigate(goal){if(goal.x===ORIGIN.x&&goal.y===ORIGIN.y&&goal.z===ORIGIN.z){w.set(0,62,0,'cobblestone');w.set(0,63,0,'cobblestone');bot.entity.position=new Vec3(0.5,64,0.5);worker.towered=true;}}});
 return {bot,worker,logs,gapsSeen};
}
test('nightMineWanted: a sealed box, a stone pickaxe, blocks to tower back, inside the window',()=>{
 const ok={tod:NIGHT_MINE_FROM,pickaxe:true,blocks:NIGHT_MINE_BLOCKS};
 assert.equal(nightMineWanted(ok),true);
 assert.equal(nightMineWanted({...ok,tod:NIGHT_MINE_FROM-1}),false,'the first spawns first');
 assert.equal(nightMineWanted({...ok,tod:NIGHT_MINE_STOP}),false,'too close to dawn');
 assert.equal(nightMineWanted({...ok,pod:true}),false,'a pod has no room');
 assert.equal(nightMineWanted({...ok,pickaxe:false}),false);
 assert.equal(nightMineWanted({...ok,blocks:NIGHT_MINE_BLOCKS-1}),false);
 assert.equal(nightMineWanted({...ok,done:true}),false,'once a night');
 assert.equal(nightMineWanted({...ok,enabled:false}),false);
});
test('tunnelBreach: an open cell the bot did not dig is a cave',()=>{
 const w=world({'5,60,1':'air'});
 assert.equal(tunnelBreach(w.blockAt,{x:5,y:60,z:0},new Set(['5,60,0','5,61,0'])).z,1);
 assert.equal(tunnelBreach(w.blockAt,{x:5,y:60,z:0},new Set(['5,60,0','5,61,0','5,60,1'])),null);
});
test('the night mine keeps the box sealed, mines wall coal, and is back in the box',async()=>{
 // coal beside the second staircase step
 const w=world();
 const {worker,bot,logs,gapsSeen}=miner(w);
 // the staircase from the sump bottom (0,62,0) heads east, south, west or north by its hash
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(0*3+0)%4];
 const step2=new Vec3(0,62,0).plus(dir.scaled(2)).offset(0,-2,0);
 const side=new Vec3(dir.z,0,-dir.x);
 w.set(step2.x+side.x,step2.y,step2.z+side.z,'coal_ore');
 const job={id:'s1',placed:[]};
 const ok=await worker.nightMine(job,0,ORIGIN);
 assert.equal(ok,true);
 assert.ok(gapsSeen.every(n=>n===0),'no wall, roof or ring cell ever opened: '+gapsSeen);
 assert.equal(w.nameAt(step2.x+side.x,step2.y,step2.z+side.z),'air','the wall coal was mined');
 assert.ok(worker.climbed>6,'climbed its tunnel back');
 assert.ok(worker.towered,'towered back into the shelter cell');
 assert.deepEqual(bot.entity.position.floored().toArray(),[0,64,0]);
 assert.equal(w.nameAt(0,63,0),'cobblestone','the floor is back');
 assert.ok(logs.some(l=>/Night mine: down from the shelter at/.test(l)));
 assert.ok(logs.some(l=>/Night mine: back in the shelter \(/.test(l)),logs.join('\n'));
 assert.equal(worker.shelterSealed,false,'the caller re-seals');
});
test('the night mine turns back when its tunnel opens onto a cave',async()=>{
 const w=world();
 const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][0];
 // a cave pocket beside step 2's head
 const step2=new Vec3(0,62,0).plus(dir.scaled(2)).offset(0,-2,0);
 w.set(step2.x,step2.y+1,step2.z+1,'air');
 const {worker,logs}=miner(w);
 await worker.nightMine({id:'s2',placed:[]},0,ORIGIN);
 assert.ok(logs.some(l=>/back in the shelter \(opened onto a cave at/.test(l)),logs.join('\n'));
 assert.ok(worker.climbed<=3,'turned back at once: '+worker.climbed);
});
test('no night mine over water, or through a player-made floor',async()=>{
 const wet=world({'1,63,0':'water'});
 const a=miner(wet);
 assert.equal(await a.worker.nightMine({id:'w',placed:[]},0,ORIGIN),false);
 assert.equal(wet.nameAt(0,63,0),'stone','nothing dug');
 const built=world({'0,63,0':'oak_planks'});
 const b=miner(built);
 assert.equal(await b.worker.nightMine({id:'p',placed:[]},0,ORIGIN),false);
 assert.ok(b.logs.some(l=>/oak_planks under the shelter is not natural/.test(l)));
 // its own placed floor block is fine to dig
 const own=world({'0,63,0':'oak_planks'});
 const c=miner(own);
 assert.equal(await c.worker.nightMine({id:'o',placed:[{x:0,y:63,z:0}]},0,ORIGIN),true);
});
