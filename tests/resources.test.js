import test from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import {Vec3} from 'vec3';
import {MineAndCollectTask} from '../src/tasks/resources/MineAndCollectTask.js';
import {SatisfyMiningRequirementTask} from '../src/tasks/resources/SatisfyMiningRequirementTask.js';
import {CraftWithMatchingPlanksTask} from '../src/tasks/resources/CraftWithMatchingMaterialsTask.js';
import {CollectCobblestoneTask} from '../src/tasks/resources/collectMining.js';
import {CollectWheatTask,CollectCropTask} from '../src/tasks/resources/collectCrops.js';
import {CollectPlanksTask} from '../src/tasks/resources/collectWood.js';
import {CollectFoodTask,foodScore} from '../src/tasks/resources/CollectFoodTask.js';
import {WOOD_SPECIES} from '../src/tasks/resources/util.js';
import {ensureTableFor,CraftInTableTask} from '../src/tasks/container/CraftInTableTask.js';
import {ensureFurnaceFor,SmeltInFurnaceTask} from '../src/tasks/container/SmeltInFurnaceTask.js';
import {StoreInAnyContainerTask} from '../src/tasks/container/StoreInAnyContainerTask.js';
import {getItemTask,CataloguedObtainTask} from '../src/tasks/catalogue.js';

const mc=minecraftData('1.21.4');
const PLACE_AT=new Vec3(1,-60,1);
// Assertion-failure messages deep-inspect the actual value; the registry graph behind a
// fake bot is enormous (every recipe, typed arrays), so the fakes never render themselves.
const SHALLOW={[Symbol.for('nodejs.util.inspect.custom')](){return '[fake]';}};
function item(name,count){return {name,count,type:mc.itemsByName[name]?.id??0,stackSize:64};}
function block(name,position){return {name,id:mc.blocksByName[name]?.id??0,position,boundingBox:'block',properties:{}};}
// Fake bot: registry from minecraft-data, an inventory list, a tiny block world and
// mineflayer-shaped recipesFor. No network, no pathfinder.
function fakeBot({inventory=[],blocks=[],omitRecipes=[]}={}){
 const bot={
  version:'1.21.4',registry:mc,blocks,
  inventory:{items:()=>inventory},
  entity:{position:new Vec3(0,-60,0),onGround:true},entities:{},
  blockAt:p=>blocks.find(b=>b.position.equals(p))||null,
  findBlock:({matching,maxDistance=32})=>{
   const ids=new Set(Array.isArray(matching)?matching:[matching]);
   let best=null,bestDist=Infinity;
   for(const b of blocks){
    if(!ids.has(b.id))continue;
    const d=b.position.distanceTo(bot.entity.position);
    if(d<=maxDistance&&d<bestDist){bestDist=d;best=b;}
   }
   return best;
  },
  findBlocks:({matching,maxDistance=32,count=64})=>{
   const ids=new Set(Array.isArray(matching)?matching:[matching]);
   return blocks.filter(b=>ids.has(b.id)&&b.position.distanceTo(bot.entity.position)<=maxDistance).slice(0,count).map(b=>b.position);
  },
  // mineflayer's recipesFor only returns recipes the current inventory can cover; mirror that.
  recipesFor:itemId=>{
   const name=mc.items[itemId]?.name;
   if(omitRecipes.includes(name))return [];
   const have=new Set(inventory.map(i=>i.name));
   return (mc.recipes[itemId]||[]).filter(r=>{
    const cells=(r.inShape||[r.ingredients||[]]).flat().filter(c=>c&&c>0);
    return cells.every(id=>have.has(mc.items[id]?.name));
   }).map(r=>{
    const shape=r.inShape||[r.ingredients];
    const width=Math.max(...shape.map(row=>row.length)),height=shape.length;
    return {
     requiresTable:width>2||height>2,
     inShape:shape.map(row=>row.map(cell=>cell&&cell>0?{id:cell,count:1}:{id:-1})),
     ingredients:null,
     result:{id:r.result?.id??itemId,count:r.result?.count||1},
    };
   });
  },
  ...SHALLOW,
 };
 return bot;
}
// Fake worker: the verified job entry points become recorders so tests assert which job a
// task runs without a server.
function fakeWorker(bot){
 const calls=[];
 const worker={
  calls,bot,epoch:7,controlToken:7,
  log(){},check(token){if(token!==this.epoch)throw Error('Job interrupted');},
  count:name=>bot.inventory.items().filter(i=>i.name===name).reduce((a,i)=>a+i.count,0),
  gather:async job=>calls.push(['gather',job.spec]),
  craft:async job=>calls.push(['craft',job.spec]),
  smelt:async job=>calls.push(['smelt',job.spec]),
  hunt:async job=>calls.push(['hunt',job.spec]),
  shear:async job=>calls.push(['shear',job.spec]),
  obtain:async job=>calls.push(['obtain',job.spec]),
  collect:async job=>calls.push(['collect',job.spec]),
  explore:async job=>calls.push(['explore',job.spec]),
  use:async job=>calls.push(['use',job.spec]),
  deposit:async job=>calls.push(['deposit',job.spec]),
  placeBlockNear:async(token,name)=>{calls.push(['placeBlockNear',name]);
   // one block per cell: replace whatever the fake world holds at the spot
   const i=bot.blocks.findIndex(b=>b.position.equals(PLACE_AT));
   if(i>=0)bot.blocks.splice(i,1);
   bot.blocks.push(block(name,PLACE_AT.clone()));
   return PLACE_AT;},
  pickUp:async(point,name)=>calls.push(['pickUp',name]),
  sweepDrops:async()=>{},
  walk:async()=>{},
  ...SHALLOW,
 };
 return worker;
}
const ctx=worker=>({worker});
const settle=()=>new Promise(r=>setTimeout(r,20));
// The tick helpers remember the active fake pair; `ticked` returns null on success or a
// short task name on failure - never hand a task object to assert.equal, whose failure
// message would deep-inspect its worker graph.
const bound={};
function bind(bot,worker){bound.bot=bot;bound.worker=worker;}
function ticked(task){
 const r=(task.onResourceTick??task.onTick).call(task,bound.bot,{worker:bound.worker});
 if(r===null)return null;
 return r?.constructor?.name??String(r);
}

test('the catalogue maps oak_log and the log family to wood-collection tasks',()=>{
 const bot=fakeBot(),worker=fakeWorker(bot);
 bind(bot,worker);
 const task=getItemTask(bot,'oak_log',4,ctx(worker));
 assert.ok(task instanceof MineAndCollectTask,'oak_log should be a MineAndCollect wood task');
 assert.deepEqual(task.blocks,['oak_log']);
 assert.equal(task.targets[0].matches[0],'oak_log');
 const family=getItemTask(bot,'log',8,ctx(worker));
 assert.ok(family instanceof MineAndCollectTask);
 assert.deepEqual(family.blocks,['log']);
 assert.equal(task.isEqual(getItemTask(bot,'oak_log',4,ctx(worker))),true,'same goal keeps the child running');
});

test('raw_iron maps to a MineAndCollect task over iron ores that demands a stone pickaxe',async()=>{
 const bot=fakeBot(),worker=fakeWorker(bot);
 bind(bot,worker);
 const task=getItemTask(bot,'raw_iron',3,ctx(worker));
 assert.ok(task instanceof MineAndCollectTask);
 assert.deepEqual([...task.blocks].sort(),['deepslate_iron_ore','iron_ore']);
 assert.equal(task.requirement,'stone');
 // Without a pickaxe the task delegates to SatisfyMiningRequirement first (Java behaviour).
 const child=task.onResourceTick(bot,ctx(worker));
 assert.ok(child instanceof SatisfyMiningRequirementTask);
 const pick=child.onTick(bot,ctx(worker));
 assert.ok(pick instanceof CataloguedObtainTask,'expected a catalogue obtain child');
 assert.equal(pick.item,'stone_pickaxe');
 // With a stone pickaxe the task runs the verified gather job instead.
 bot.inventory.items().push(item('stone_pickaxe',1));
 assert.equal(ticked(task),null,'expected a gather action to start');
 await settle();
 const gather=worker.calls.find(c=>c[0]==='gather');
 assert.ok(gather,'expected a gather job');
 assert.equal(gather[1].block,'iron_ore');
 assert.equal(gather[1].searchIfMissing,true);
});

test('wheat falls back to the collect-crop/seeds path when no hay is around',()=>{
 const bot=fakeBot(),worker=fakeWorker(bot);
 bind(bot,worker);
 const task=getItemTask(bot,'wheat',5,ctx(worker));
 assert.ok(task instanceof CollectWheatTask);
 const child=task.onResourceTick(bot,ctx(worker));
 assert.ok(child instanceof CollectCropTask,'expected the crop/seeds path');
 assert.deepEqual(child.cropBlocks,['wheat']);
 assert.deepEqual(child.cropSeeds,['wheat_seeds']);
 // With hay in sight it mines hay instead.
 bot.blocks.push(block('hay_block',new Vec3(3,-60,3)));
 const next=task.onResourceTick(bot,ctx(worker));
 assert.ok(next instanceof MineAndCollectTask,'expected a hay mining child');
});

test('CraftWithMatchingPlanks accepts any log species and crafts through the howto chain',async()=>{
 const bot=fakeBot(),worker=fakeWorker(bot);
 bind(bot,worker);
 const validTargets=WOOD_SPECIES.map(s=>`${s}_stairs`);
 const p={matches:WOOD_SPECIES.map(s=>`${s}_planks`),count:1};
 const recipe={slots:[p,null,null,p,p,null,p,p,p],outputCount:4}; // shapedRecipeStairs: 6 planks
 const mask=[true,false,false,true,true,false,true,true,true];
 const task=new CraftWithMatchingPlanksTask(validTargets,prefix=>`${prefix}_stairs`,recipe,mask,4);
 // Only spruce logs: the conversion child must be spruce planks, not hardcoded oak.
 bot.inventory.items().push(item('spruce_log',8));
 const child=task.onResourceTick(bot,ctx(worker));
 assert.ok(child instanceof CollectPlanksTask,'expected a planks conversion child');
 assert.deepEqual(child.targets[0].matches,['spruce_planks']);
 // With spruce planks in the inventory the craft runs via obtain (howto.buildChain is the
 // recipe source of truth), requesting the majority species' stairs.
 bot.inventory.items().push(item('spruce_planks',6));
 const task2=new CraftWithMatchingPlanksTask(validTargets,prefix=>`${prefix}_stairs`,recipe,mask,4);
 assert.equal(ticked(task2),null,'expected the craft action to start');
 await settle();
 const obtain=worker.calls.find(c=>c[0]==='obtain');
 assert.ok(obtain,'expected the howto-driven obtain job');
 assert.equal(obtain[1].item,'spruce_stairs');
 assert.equal(obtain[1].count,4);
 // The howto chain really covers it with only spruce planks held.
 const {buildChain}=await import('../src/howto.js');
 const chain=buildChain(bot,'spruce_stairs',4,{spruce_planks:6,iron_pickaxe:1});
 assert.ok(chain.steps.some(s=>s.op==='craft'&&s.item==='spruce_stairs'));
});

test('a resource task is finished exactly when the inventory count is met',async()=>{
 const bot=fakeBot(),worker=fakeWorker(bot);
 bind(bot,worker);
 const task=new CollectCobblestoneTask(8);
 bot.inventory.items().push(item('cobblestone',2));
 assert.equal(task.isFinished(bot),false);
 bot.inventory.items().push(item('cobblestone',6));
 assert.equal(task.isFinished(bot),true);
 // And when it ticks unmet, it hands to the mining child, which runs the verified job.
 bot.inventory.items().push(item('wooden_pickaxe',1));
 bot.blocks.push(block('stone',new Vec3(2,-60,0)));
 const mining=task.onResourceTick(bot,ctx(worker));
 assert.ok(mining instanceof MineAndCollectTask);
 assert.equal(ticked(mining),null,'expected a gather action to start');
 await settle();
 const gather=worker.calls.find(c=>c[0]==='gather');
 assert.ok(gather,'expected a gather job');
 assert.equal(gather[1].block,'stone');
});

test('container crafting requires a table nearby or crafts and places one',async()=>{
 // (a) A table within 4 blocks is used as-is; nothing is crafted or placed.
 const table=block('crafting_table',new Vec3(2,-60,2));
 const botA=fakeBot({blocks:[table]}),workerA=fakeWorker(botA);
 const outA=await ensureTableFor(botA,workerA,workerA.controlToken,async()=>{throw Error('must not craft');});
 assert.equal(outA.block,table);
 assert.equal(outA.created,null);
 // (b) No table anywhere: one is crafted in the 2x2 grid, then placed beside the bot.
 const botB=fakeBot(),workerB=fakeWorker(botB);
 botB.inventory.items().push(item('oak_planks',4));
 const crafted=[];
 const outB=await ensureTableFor(botB,workerB,workerB.controlToken,async(b,recipe,tbl,check)=>{
  crafted.push({tbl,needsTable:recipe.requiresTable});
  b.inventory.items().push(item('crafting_table',1));
 });
 assert.equal(crafted.length,1);
 assert.equal(crafted[0].tbl,null,'the table itself is crafted without a table');
 assert.equal(crafted[0].needsTable,false);
 assert.equal(workerB.calls.some(c=>c[0]==='placeBlockNear'),true,'the crafted table must be placed');
 assert.equal(outB.block.name,'crafting_table');
 assert.ok(outB.created,'the placed table is remembered for pickup');
 // (c) No table and no planks: the recipe list is empty, fail honestly instead of looping.
 const botC=fakeBot(),workerC=fakeWorker(botC);
 await assert.rejects(ensureTableFor(botC,workerC,workerC.controlToken,async()=>{}),/Missing ingredients: need a crafting table/);
 // (d) The table task itself is a resource task on its output count.
 const botD=fakeBot();
 const craftTask=new CraftInTableTask('crafting_table',1);
 assert.equal(craftTask.isFinished(botD),false);
 botD.inventory.items().push(item('crafting_table',1));
 assert.equal(craftTask.isFinished(botD),true);
});

test('smelting requires fuel and a furnace, provisioning both like the verified job',async()=>{
 // (a) An existing furnace wins; nothing is crafted or placed.
 const furnace=block('furnace',new Vec3(2,-60,2));
 const botA=fakeBot({blocks:[furnace]}),workerA=fakeWorker(botA);
 const outA=await ensureFurnaceFor(botA,workerA,workerA.controlToken,async()=>{throw Error('must not craft');});
 assert.equal(outA.block,furnace);
 // (b) No furnace recipe available: the table still provisions, then the furnace
 // requirement fails honestly.
 const botB=fakeBot({omitRecipes:['furnace']}),workerB=fakeWorker(botB);
 botB.inventory.items().push(item('oak_planks',4),item('cobblestone',8));
 await assert.rejects(ensureFurnaceFor(botB,workerB,workerB.controlToken,async(b,recipe,tbl,check)=>{
  b.inventory.items().push(item('crafting_table',1)); // the table craft succeeds
 }),/Missing ingredients: need a furnace, or 8 cobblestone/);
 // (c) The full provisioning flow: the table is crafted 2x2 first, then the furnace in it.
 const botC=fakeBot(),workerC=fakeWorker(botC);
 botC.inventory.items().push(item('oak_planks',4),item('cobblestone',8));
 const crafted=[];
 const outC=await ensureFurnaceFor(botC,workerC,workerC.controlToken,async(b,recipe,tbl,check)=>{
  crafted.push({tbl,needsTable:recipe.requiresTable});
  b.inventory.items().push(item(mc.items[recipe.result.id]?.name,1)); // craft the recipe's own output
 });
 assert.deepEqual(crafted.map(c=>c.needsTable),[false,true],'table is 2x2, furnace needs the table');
 assert.equal(crafted[0].tbl,null,'the table itself is crafted without a table');
 assert.equal(crafted[1].tbl.name,'crafting_table','the furnace is crafted at the placed table');
 assert.equal(outC.block.name,'furnace');
 assert.equal(workerC.calls.some(c=>c[0]==='placeBlockNear'),true);
 // (d) The smelt task demands fuel before touching the furnace (Java: CollectFuelTask).
 const botD=fakeBot(),workerD=fakeWorker(botD);
 bind(botD,workerD);
 botD.inventory.items().push(item('raw_iron',3));
 const smelt=new SmeltInFurnaceTask('raw_iron',3);
 const fuelChild=smelt.onResourceTick(botD,ctx(workerD));
 assert.ok(fuelChild,'expected a fuel collection child');
 assert.match(String(fuelChild),/Fuel/,'the child is a CollectFuelTask');
 // (e) With fuel it runs the verified smelt job.
 botD.inventory.items().push(item('coal',1));
 assert.equal(ticked(smelt),null,'expected the smelt action to start');
 await settle();
 const smeltCall=workerD.calls.find(c=>c[0]==='smelt');
 assert.ok(smeltCall,'expected the verified smelt job');
 assert.equal(smeltCall[1].item,'raw_iron');
 assert.equal(smeltCall[1].count,3);
 // (f) Materials are collected first when missing (Java: the SmeltTarget materials).
 const botF=fakeBot(),workerF=fakeWorker(botF);
 botF.inventory.items().push(item('coal',1));
 const smelt2=new SmeltInFurnaceTask('cobblestone',4);
 const materialChild=smelt2.onResourceTick(botF,ctx(workerF));
 assert.ok(materialChild,'expected a material collection child');
 assert.match(String(materialChild),/Cobblestone/);
 const mining=materialChild.onResourceTick(botF,ctx(workerF));
 assert.ok(mining instanceof MineAndCollectTask);
 assert.deepEqual([...mining.blocks].sort(),['cobblestone','stone']);
});

test('storage drops surplus into the nearest chest through the verified deposit job',async()=>{
 const chest=block('chest',new Vec3(2,-60,2));
 const bot=fakeBot({blocks:[chest]}),worker=fakeWorker(bot);
 bind(bot,worker);
 bot.inventory.items().push(item('rotten_flesh',3));
 const task=new StoreInAnyContainerTask([{name:'rotten_flesh'}]);
 assert.equal(task.isFinished(bot),false);
 assert.equal(ticked(task),null,'expected the deposit action to start');
 await settle();
 const deposit=worker.calls.find(c=>c[0]==='deposit');
 assert.ok(deposit,'expected the verified deposit job');
 assert.equal(deposit[1].item,'rotten_flesh');
 assert.deepEqual(deposit[1].position,{x:2,y:-60,z:2});
});

test('the food task scores inventory food and finishes when the units are met',()=>{
 const bot=fakeBot();
 bot.inventory.items().push(item('cooked_beef',2));
 assert.equal(foodScore(bot),16); // cooked_beef is 8 hunger per item
 assert.equal(new CollectFoodTask(10).isFinished(bot),true);
 assert.equal(new CollectFoodTask(20).isFinished(bot),false);
});
