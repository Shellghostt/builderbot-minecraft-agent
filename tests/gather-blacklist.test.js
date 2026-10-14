import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
import {Blacklist} from '../src/trackers/blacklist.js';
// Canopy spawns (soak hard1/hard2, 2026-10-14): the bot sat for minutes on
// "Cannot reach or harvest this block" at the same few logs. A block that cannot be reached
// is skipped at once, by this job and (through the shared blacklist) by the next job.
function canopyFake({blacklist=new Blacklist(),logs,reachable=()=>false}={}){
 const registry={blocksByName:{oak_log:{id:1}},blocks:{1:{drops:[102],harvestTools:null}},items:{102:{name:'oak_log'}}};
 const world=new Map(logs.map(([x,y,z])=>[x+','+y+','+z,{name:'oak_log',type:1,position:new Vec3(x,y,z),boundingBox:'block'}]));
 const tries=[],logLines=[];let cobble=0;
 const bot={registry,entity:{position:new Vec3(0.5,130,0.5)},heldItem:{type:5},
  inventory:{items(){return [];},emptySlotCount(){return 30;}},
  pathfinder:{movements:null,setMovements(){}},
  findBlocks(){return [...world.values()].map(b=>b.position);},
  blockAt(p){return world.get(Math.floor(p.x)+','+Math.floor(p.y)+','+Math.floor(p.z))||null;},
  canDigBlock(b){return reachable(b);},
  tool:{async equipForBlock(b){tries.push(b.position.x+','+b.position.y+','+b.position.z);}},
  async dig(b){world.delete(b.position.x+','+b.position.y+','+b.position.z);cobble++;}};
 const w={bot,blacklist,config:{limits:{radius:32}},count(){return cobble;},save(){},check(){},update(){},
  log(m){logLines.push(m);},exploreMovements(){return {};},
  async walk(){},async reachUp(){},async descendToReach(){},async canopyDrop(){},async sweepDrops(){},async mineColumnUnder(){},
  gatherFailed:Worker.prototype.gatherFailed,gatherBlacklisted:Worker.prototype.gatherBlacklisted,takeStrandedTunnel:Worker.prototype.takeStrandedTunnel};
 return {w,tries,logLines,job:()=>({spec:{type:'gather',block:'oak_log',count:2,radius:32}})};
}
test('an unreachable block is tried once, skipped, and the job moves on to the next block',async()=>{
 const f=canopyFake({logs:[[2,128,0],[2,127,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 assert.deepEqual([...f.tries].sort(),['2,127,0','2,128,0','5,128,3'],'each block exactly once');
 assert.equal(f.logLines.filter(l=>/skipping oak_log/.test(l)).length,3);
});
test('the next gather job skips the blocks the last one could not reach (shared blacklist)',async()=>{
 const blacklist=new Blacklist();
 const f=canopyFake({blacklist,logs:[[2,128,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 const g=canopyFake({blacklist,logs:[[2,128,0],[5,128,3]]});
 await assert.rejects(Worker.prototype.gather.call(g.w,g.job(),0),/No matching blocks/);
 assert.deepEqual(g.tries,[],'no retry of a blacklisted block');
 // ...and a block it CAN reach still gets mined
 const h=canopyFake({blacklist,logs:[[2,128,0],[5,128,3],[1,129,1],[1,128,1]],reachable:b=>b.position.x===1});
 h.w.walk=async()=>{};
 await Worker.prototype.gather.call(h.w,h.job(),0);
 assert.ok(h.tries.every(k=>k.startsWith('1,')),h.tries.join(' '));
});
test('other errors blacklist a block on its second failure, counted per block',async()=>{
 // The old single counter blacklisted only the column of every third failure, so attempts
 // alternating between two trunks (A,B,A,B...) never blacklisted either one.
 const f=canopyFake({logs:[[2,128,0],[-2,128,0]],reachable:()=>true});
 let n=0;
 f.w.bot.dig=async()=>{n++;throw Error('Digging aborted');};
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/No matching blocks/);
 assert.equal(n,4,'two tries per block, then both skipped');
});
test('a missing tool fails the job at once instead of trying every block',async()=>{
 const f=canopyFake({logs:[[2,128,0],[5,128,3],[7,128,3]],reachable:()=>true});
 f.w.bot.registry.blocks[1].harvestTools={9:true};
 await assert.rejects(Worker.prototype.gather.call(f.w,f.job(),0),/suitable harvesting tool/);
 assert.equal(f.tries.length,1);
});
