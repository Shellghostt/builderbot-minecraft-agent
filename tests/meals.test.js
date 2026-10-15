import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Worker} from '../src/worker.js';
import {edibleCount} from '../src/observe.js';
// M4 food, measured honestly (cloud session 2026-10-14): the soak read a `_edible` key that
// observe never had, so edible_peak was 0 even in runs that hunted, cooked and ate.
test('observe counts edible items from the registry, never the never-eat list',()=>{
 const items=[{name:'cooked_beef',count:3},{name:'bread',count:2},{name:'rotten_flesh',count:5},{name:'spider_eye',count:1},{name:'stick',count:9}];
 const bot={inventory:{items:()=>items},registry:{foodsByName:{cooked_beef:{},bread:{},rotten_flesh:{},spider_eye:{}}}};
 assert.equal(edibleCount(bot),5);
});
function mealBot(){
 const bot=new EventEmitter();
 Object.assign(bot,{food:10,health:20,heldItem:{name:'cooked_beef'},consumed:0,async consume(){this.consumed++;}});
 const w={meals:{eaten:0,points:0,cooked:0,items:{}}};
 Worker.prototype.trackMeals.call(w,bot);
 return {bot,w};
}
test('a meal is a food-bar rise right after a consume (any eat path)',async()=>{
 const {bot,w}=mealBot();
 bot.emit('health'); // baseline 10
 await bot.consume();
 assert.equal(bot.consumed,1,'the real consume still runs');
 bot.food=18;bot.emit('health');
 assert.deepEqual(w.meals,{eaten:1,points:8,cooked:0,items:{cooked_beef:1}});
 bot.food=17;bot.emit('health'); // hunger drain
 bot.food=19;bot.emit('health'); // a rise without a fresh consume is not a meal
 assert.equal(w.meals.eaten,1);
});
test('a respawn\'s full bar is not a meal',async()=>{
 const {bot,w}=mealBot();
 bot.emit('health');
 await bot.consume(); // started eating, then died before the bar moved
 bot.health=0;bot.food=4;bot.emit('health');bot.emit('death');
 bot.health=20;bot.food=20;bot.emit('health');
 assert.equal(w.meals.eaten,0);
});
test('smelting food counts as cooked; smelting iron does not',async()=>{
 for(const [item,out,food] of [['beef','cooked_beef',true],['raw_iron','iron_ingot',false]]){
  const inv={[item]:2,coal:1,[out]:0};
  const w={
   meals:{eaten:0,points:0,cooked:0,items:{}},
   bot:{registry:{itemsByName:{[item]:{id:1},[out]:{id:2},coal:{id:3}},blocksByName:{furnace:{id:40}},foodsByName:food?{[out]:{}}:{}},
    inventory:{items(){return Object.entries(inv).filter(([,n])=>n>0).map(([name,count])=>({name,count}));}},
    findBlock(){return {position:{x:1,y:64,z:0},name:'furnace'};},
    async openFurnace(){let o=0;return {async putInput(id,m,n){inv[item]-=n;o=n;},async putFuel(){},outputItem(){return {count:o};},async takeOutput(){inv[out]+=o;o=0;}};},
    async closeWindow(){}},
   check(){},log(){},count(n){return inv[n]||0;},fuelPlan:Worker.prototype.fuelPlan,async walk(){}
  };
  await Worker.prototype.smelt.call(w,{spec:{type:'smelt',item,count:2}},0);
  assert.equal(w.meals.cooked,food?2:0,item);
 }
});
// Round 6: eaten 0 on every round-5 run. FoodChain now counts each episode a meal was due
// (food held, needsToEat) and each failed eat, so the soak can tell a full bar from a broken
// eat path.
import {FoodChain} from '../src/chains/foodChain.js';
function chainBot(food,{equipThrows=false}={}){
 const items=[{name:'cooked_beef',count:8,slot:36}];
 const bot={entity:{position:{x:0,y:0,z:0},metadata:[0]},health:20,food,foodSaturation:0,
  inventory:{items:()=>items},registry:{foodsByName:{cooked_beef:{foodPoints:8,saturation:12.8}}},
  equip:async()=>{if(equipThrows)throw Error('equip refused');},consume:async()=>{bot.food=Math.min(20,bot.food+8);}};
 return bot;
}
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r));};
test('FoodChain: a full-ish bar is no meal due; at 14 (round 8 threshold) one episode is due and eaten',async()=>{
 const meals={eaten:0,due:0,failed:0};
 const chain=new FoodChain(),ctx={worker:{meals}};
 const bot=chainBot(15);
 for(let i=0;i<5;i++)chain.priority(bot,ctx);
 assert.equal(meals.due,0,'15 with beef (8) held: nothing due - eaten 0 means not hungry enough');
 bot.food=14;
 for(let i=0;i<5;i++)chain.priority(bot,ctx); // repeated ticks of one episode count once
 assert.equal(meals.due,1);
 await settle();
 assert.equal(bot.food,20,'the chain ate');
 chain.priority(bot,ctx);
 assert.equal(meals.failed,0);
});
test('FoodChain: a failing eat is counted with its reason',async()=>{
 const meals={eaten:0,due:0,failed:0};
 const chain=new FoodChain(),ctx={worker:{meals}};
 const bot=chainBot(9,{equipThrows:true});
 chain.priority(bot,ctx);await settle();
 assert.equal(meals.due,1);
 assert.equal(meals.failed,1);
 assert.equal(meals.lastError,'equip refused');
});
