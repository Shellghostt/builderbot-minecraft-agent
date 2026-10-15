// Round 8, task 2: hard3 was `blown up by Creeper` during a craft at (138,123,39), daytime.
// A craft must yield to Mob Defense at once - at the table walk, while the table opens and
// mid-click - and the survival tree never acts with the crafting window still open.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker,creeperThreat} from '../src/worker.js';
import {craftConfirmed,interruptible} from '../src/crafting.js';
console.error=()=>{};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('interruptible: a check that starts throwing ends the wait; a silent server times out',async()=>{
 let stop=false;
 const t0=Date.now();
 setTimeout(()=>{stop=true;},50);
 await assert.rejects(interruptible(new Promise(()=>{}),()=>{if(stop)throw Error('Job interrupted');},'x',5000),/Job interrupted/);
 assert.ok(Date.now()-t0<1000,'well before the 5 s give-up');
 await assert.rejects(interruptible(new Promise(()=>{}),()=>{},'Crafting click on slot 3',60),/Crafting click on slot 3 timed out/);
 assert.equal(await interruptible(Promise.resolve(7),()=>{},'y',60),7);
});
function craftBot({openWindow=true,hangClick=false}={}){
 const bot=new EventEmitter();
 const win={type:'minecraft:crafting',slots:[],selectedItem:null,inventoryStart:10,inventoryEnd:46,findInventoryItem(){return {slot:12};},firstEmptySlotRange(){return 13;}};
 Object.assign(bot,{inventory:{},currentWindow:null,closed:0,clicks:0,
  activateBlock(){if(openWindow)setTimeout(()=>{bot.currentWindow=win;bot.emit('windowOpen',win);},10);},
  async _syncWindow(){},
  clickWindow(){bot.clicks++;return hangClick?new Promise(()=>{}):Promise.resolve();},
  async closeWindow(){bot.closed++;bot.currentWindow=null;}});
 return bot;
}
const recipe={requiresTable:true,inShape:[[{id:5}]],result:{id:9}};
test('craftConfirmed: a reflex preemption while the table never opens throws at once',async()=>{
 const bot=craftBot({openWindow:false});
 let preempted=false;setTimeout(()=>{preempted=true;},60);
 const t0=Date.now();
 await assert.rejects(craftConfirmed(bot,recipe,{},()=>{if(preempted)throw Error('Job interrupted');}),/Job interrupted/);
 assert.ok(Date.now()-t0<1500);
});
test('craftConfirmed: a click mineflayer never settles is cut by the preemption and the window closes',async()=>{
 const bot=craftBot({hangClick:true});
 let preempted=false;
 const craft=craftConfirmed(bot,recipe,{},()=>{if(preempted)throw Error('Job interrupted');});
 for(let i=0;i<50&&!bot.clicks;i++)await sleep(20);
 assert.equal(bot.clicks,1,'stuck on the first click');
 preempted=true;
 await assert.rejects(craft,/Job interrupted/);
 assert.equal(bot.closed,1,'the crafting window was closed');assert.equal(bot.currentWindow,null);
});
function gateBot(){
 const bot=new EventEmitter();
 Object.assign(bot,{entities:{},health:20,food:20,time:{timeOfDay:6000,day:3},
  clearControlStates(){},setControlState(){},entity:{onGround:true,position:new Vec3(138,123,39),metadata:[0],height:1.8},
  pathfinder:{movements:null,setGoal(){},stop(){},setMovements(m){this.movements=m;},goto(){return new Promise(()=>{});}},
  registry:{blocksByName:{},foodsByName:{},itemsByName:{}},inventory:{items(){return [];},emptySlotCount(){return 36;},slots:[]},
  blockAt(){return null;},findBlock(){return null;},findBlocks(){return [];},stopDigging(){return {catch(){}};},respawn(){},
  look(){return Promise.resolve();},lookAt(){return Promise.resolve();}});
 return bot;
}
async function withWorker(fn){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'craft-int-'));
 const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
 const bot=gateBot(),logs=[];worker.ready=true;worker.bot=bot;worker.movements={id:'normal'};worker.log=m=>logs.push(m);
 try{await fn({worker,bot,logs});}finally{worker.taskRunner.stop();fs.rmSync(root,{recursive:true,force:true});}
}
const creeper=(id,dx,{fusing=false}={})=>({id,name:'creeper',type:'hostile',isValid:true,height:1.7,position:new Vec3(138+dx,123,39),metadata:fusing?{16:1}:{16:-1},velocity:new Vec3(0,0,0)});
test('a creeper at 5 during a craft: Mob Defense takes over, pauses the craft and closes the table window first',async()=>{
 await withWorker(async({worker,bot,logs})=>{
  worker.jobs.push({id:'c',spec:{type:'craft',item:'furnace',count:1},status:'running',message:'Working'});
  bot.closed=0;bot.currentWindow={type:'minecraft:crafting'};
  bot.closeWindow=w=>{bot.closed++;bot.currentWindow=null;};
  bot.entities[7]=creeper(7,5);
  worker.taskRunner.tick();
  assert.equal(worker.taskRunner.current&&worker.taskRunner.current.name,'Mob Defense');
  assert.equal(worker.jobs[0].status,'paused');assert.match(worker.jobs[0].message,/^Reflex: preempted by Mob Defense/);
  assert.equal(bot.closed,1,'the crafting window is closed before the tree acts');
  assert.ok(logs.some(l=>l==='Runner: closed the open crafting window for Mob Defense'),logs.join('\n'));
 });
});
test('a creeper within 6 overrides an eat, bed-walk or unsealed shelter hold; a sealed box keeps it',async()=>{
 await withWorker(async({worker,bot,logs})=>{
  const md=worker.taskRunner.chains.find(c=>c.name==='Mob Defense'),ctx=worker.taskRunner.ctx;
  for(const type of ['eat','sleep','shelter']){
   worker.jobs.length=0;worker.shelterSealed=false;
   worker.jobs.push({id:type,spec:{type},status:'running',message:'Working'});
   bot.entities={};
   assert.equal(md.priority(bot,ctx),-1,type+': no creeper, the hold stands');
   bot.entities={9:creeper(9,12)};
   assert.equal(md.priority(bot,ctx),-1,type+': a creeper at 12 is not an override');
   bot.entities={9:creeper(9,5)};
   assert.ok(md.priority(bot,ctx)>=0,type+': a creeper at 5 always takes over');
   md.priority(bot,{...ctx}); // still active: logged once per engagement
  }
  assert.ok(logs.some(l=>/^Reflex: creeper at 5\.0 overrides the eat hold/.test(l)),logs.join('\n'));
  bot.entities={9:creeper(9,9,{fusing:true})};
  assert.ok(md.priority(bot,ctx)>=0,'a fusing creeper within 10 too');
  worker.shelterSealed=true;bot.entities={9:creeper(9,4)};
  assert.equal(md.priority(bot,ctx),-1,'sealed: the walls are the answer');
  worker.shelterSealed=false;bot.isSleeping=true;
  assert.equal(md.priority(bot,ctx),-1,'in bed: no override');
 });
});
test('creeperThreat: nearest creeper within 6, or fusing within 10',()=>{
 const bot={entity:{position:new Vec3(0,0,0)},entities:{}};
 assert.equal(creeperThreat(bot),null);
 bot.entities={1:{name:'creeper',position:new Vec3(7,0,0),metadata:{16:-1}},2:{name:'zombie',position:new Vec3(1,0,0)}};
 assert.equal(creeperThreat(bot),null);
 bot.entities[1].metadata={16:1};
 assert.equal(creeperThreat(bot),7);
 bot.entities[3]={name:'creeper',position:new Vec3(0,0,4)};
 assert.equal(creeperThreat(bot),4);
});
