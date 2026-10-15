import test from 'node:test';
import assert from 'node:assert/strict';
import {eatMeal,guardEquip} from '../src/eating.js';
import {FoodChain,EAT_RETRY_MS} from '../src/chains/foodChain.js';
// Round 7: normal3 failed 4 meals with `Promise timed out.` holding 4 cooked food. A meal is
// judged by the bar rising or the stack shrinking, not by consume's promise.
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function bot({food=8,count=4,consume}={}){
 const items=[{name:'cooked_beef',count,slot:36}];
 const b={food,health:20,quickBarSlot:0,selects:[],equips:[],deactivated:0,items,
  inventory:{items:()=>items.filter(i=>i.count>0)},
  setQuickBarSlot(n){this.quickBarSlot=n;this.selects.push(n);},
  async equip(item,dest){this.equips.push([item.name,dest]);},
  deactivateItem(){this.deactivated++;},
  consumes:0};
 b.consume=async()=>{b.consumes++;return consume(b,b.consumes);};
 return b;
}
test('eatMeal: a consume that times out while the bar rises late is a meal',async()=>{
 const b=bot({consume:async b=>{setTimeout(()=>{b.food=16;b.items[0].count--;},60);throw Error('Promise timed out.');}});
 const r=await eatMeal(b,'cooked_beef',{settleMs:300});
 assert.equal(r.ok,true);assert.equal(r.gained,8);assert.equal(b.consumes,1,'no second bite');
});
test('eatMeal: a consume that resolves with no change is released and retried on a fresh slot',async()=>{
 const b=bot({consume:async(b,n)=>{if(n===2){b.food=16;}}});
 const r=await eatMeal(b,'cooked_beef',{settleMs:80});
 assert.equal(r.ok,true);assert.equal(r.attempts,2);
 assert.equal(b.deactivated,1,'the dead use was released');
 assert.deepEqual(b.selects,[1],'another hotbar slot was selected before the re-equip');
 assert.deepEqual(b.equips,[['cooked_beef','hand'],['cooked_beef','hand']]);
});
test('eatMeal: the stack shrinking alone counts (the bar packet can lag)',async()=>{
 const b=bot({consume:async b=>{b.items[0].count--;}});
 const r=await eatMeal(b,'cooked_beef',{settleMs:80});
 assert.equal(r.ok,true);assert.equal(r.gained,0);
});
test('eatMeal: two dead meals fail with the reason; no stack and a full bar are told apart',async()=>{
 const b=bot({consume:async()=>{throw Error('Promise timed out.');}});
 const w={eating:false};
 const r=await eatMeal(b,'cooked_beef',{settleMs:40,worker:w});
 assert.equal(r.ok,false);assert.equal(r.reason,'Promise timed out. (2 tries)');
 assert.equal(w.eating,false,'the eating flag is cleared');assert.equal(b.__meal,null);
 assert.match((await eatMeal(b,'bread',{settleMs:10})).reason,/no bread stack/);
 b.food=20;assert.equal((await eatMeal(b,'cooked_beef',{settleMs:10})).reason,'Food is already full');
});
test('guardEquip: a hand equip waits for the meal in flight; the off hand does not',async()=>{
 let finish;
 const b=bot({consume:()=>new Promise(r=>{finish=()=>{b.food=16;r();};})});
 guardEquip(b);
 const meal=eatMeal(b,'cooked_beef',{settleMs:200});
 await sleep(10);
 const order=[];
 const hand=b.equip({name:'stone_pickaxe'},'hand').then(()=>order.push('pickaxe'));
 const off=b.equip({name:'shield'},'off-hand').then(()=>order.push('shield'));
 await sleep(30);
 assert.deepEqual(order,['shield'],'the pickaxe would end the meal server-side');
 finish();
 assert.equal((await meal).ok,true);await hand;await off;
 assert.deepEqual(order,['shield','pickaxe']);
 assert.deepEqual(b.equips.map(e=>e[0]),['cooked_beef','shield','stone_pickaxe']);
});
test('FoodChain: a failed meal backs off before the next try; no-food hunger is counted apart',async()=>{
 const meals={eaten:0,due:0,failed:0};
 const chain=new FoodChain(),ctx={worker:{meals}};
 const b=bot({food:9,consume:async()=>{throw Error('Promise timed out.');}});
 Object.assign(b,{entity:{position:{x:0,y:0,z:0},metadata:[0]},registry:{foodsByName:{cooked_beef:{foodPoints:8,saturation:12.8}}}});
 chain.priority(b,ctx);
 // eatMeal's default settle is 1.5 s x 2 tries; wait it out
 for(let i=0;i<80&&!meals.failed;i++)await sleep(50);
 assert.equal(meals.failed,1);assert.match(meals.lastError,/Promise timed out/);
 const tries=b.consumes;
 chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,tries,'no new bite inside the retry window');
 chain._retryAt=Date.now()-1;chain.priority(b,ctx);await sleep(20);
 assert.ok(b.consumes>tries,'retried after '+EAT_RETRY_MS+' ms');
 assert.equal(meals.noFood||0,0);
 // the food runs out while hungry: one noFood episode, however many ticks
 b.items[0].count=0;b.food=5;
 for(let i=0;i<5;i++)chain.priority(b,ctx);
 assert.equal(meals.noFood,1);
});
// Round 8: all three normal runs read `bar 14..20: EAT FAILED (due 1, failed 0)` with 8-10
// cooked food held - a meal became due and was never attempted. FoodChain ate only at 10
// (AltoClef), and one wedged equip (mineflayer's crafting-window click waits for the result
// slot with no timeout) held `_eating` for the rest of the session.
const cooked={cooked_beef:{foodPoints:8,saturation:12.8}};
function chainBot(food,o={}){
 const b=bot({food,consume:async b=>{b.food=Math.min(20,b.food+8);b.items[0].count--;},...o});
 Object.assign(b,{entity:{position:{x:0,y:0,z:0},metadata:[0]},registry:{foodsByName:cooked}});
 return b;
}
const fresh=()=>({eaten:0,due:0,attempts:0,failed:0,deferred:0});
const waitFor=async(fn,ms=2000)=>{for(const end=Date.now()+ms;!fn()&&Date.now()<end;)await sleep(10);};
test('FoodChain eats at a bar of 14 with food held, not only at 10',async()=>{
 const meals=fresh(),logs=[];
 const chain=new FoodChain(),ctx={worker:{meals,log:m=>logs.push(m)}};
 const b=chainBot(15);
 chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,0,'15: not hungry enough');assert.equal(meals.due,0);
 b.food=14;chain.priority(b,ctx);
 await waitFor(()=>b.consumes>0&&!chain._eating);
 assert.equal(meals.due,1);assert.equal(meals.attempts,1);assert.equal(b.food,20);
 assert.ok(logs.some(l=>/^Food: ate cooked_beef/.test(l)),logs.join('|'));
});
test('FoodChain defers a meal while a window is open or Mob Defense is active, and records why',async()=>{
 const meals=fresh();
 const md={_cachedLastPriority:-1,_cachedAt:Date.now(),isActive(){return this._cachedLastPriority>=0&&Date.now()-this._cachedAt<1000;}};
 const chain=new FoodChain({mobDefense:md}),ctx={worker:{meals}};
 const b=chainBot(12);
 b.currentWindow={type:'minecraft:crafting'};
 for(let i=0;i<5;i++)chain.priority(b,ctx);
 await sleep(20);
 assert.equal(b.consumes,0,'no meal with the crafting window open');
 assert.equal(meals.due,1);assert.equal(meals.attempts,0);
 assert.equal(meals.deferred,1,'one deferral per episode, not per tick');assert.equal(meals.lastDeferred,'a window is open');
 b.currentWindow=null;md._cachedLastPriority=65;md._cachedAt=Date.now();
 chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,0,'no meal mid-fight');
 assert.equal(meals.deferred,2);assert.match(meals.lastDeferred,/mid-fight/);
 // a stale cache (the worker gate skipped Mob Defense) is not a fight
 md._cachedAt=Date.now()-5000;
 chain.priority(b,ctx);
 await waitFor(()=>b.consumes>0&&!chain._eating);
 assert.equal(meals.attempts,1);assert.equal(b.food,20);
});
test('FoodChain: a fight job defers the meal unless it is critical; the eat job keeps it',async()=>{
 const meals=fresh();
 const jobs=[{status:'running',spec:{type:'fight'}}];
 const chain=new FoodChain(),ctx={worker:{meals,jobs}};
 const b=chainBot(12);
 chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,0);assert.match(meals.lastDeferred,/fight job/);
 jobs[0].spec.type='eat';chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,0);assert.equal(meals.lastDeferred,'the eat job is eating');
 // critical (AltoClef needsToEatCritical: armour 15+ and food < 3): eats through the fight
 jobs[0].spec.type='fight';b.food=2;
 chain.needsToEatCritical=()=>true;
 chain.priority(b,ctx);
 await waitFor(()=>b.consumes>0&&!chain._eating);
 assert.equal(meals.attempts,1);
});
test('FoodChain: a meal that never settles is abandoned by the watchdog and the next one runs',async()=>{
 const meals=fresh(),w={meals,eating:false};
 const chain=new FoodChain(),ctx={worker:w};
 chain.watchdogMs=150;chain.mealOpts={equipMs:5000,settleMs:30};
 const b=chainBot(12);
 let hang=true;b.equip=async()=>{if(hang)await new Promise(()=>{});};
 chain.priority(b,ctx);
 await waitFor(()=>meals.failed>0,1000);
 assert.equal(meals.failed,1);assert.match(meals.lastError,/^meal stuck/);
 assert.equal(chain._eating,false,'the flag is released');assert.equal(w.eating,false);
 hang=false;chain._retryAt=Date.now()-1;
 chain.priority(b,ctx);
 await waitFor(()=>b.consumes>0&&!chain._eating);
 assert.equal(meals.attempts,2);assert.equal(b.food,20);
});
test('eatMeal: an equip that hangs throws like a refused one; an open window waits, then refuses',async()=>{
 const b=bot({consume:async b=>{b.food=16;}});
 b.equip=()=>new Promise(()=>{});
 await assert.rejects(eatMeal(b,'cooked_beef',{equipMs:40,settleMs:20}),/equip timed out/);
 assert.equal(b.consumes,0);
 const c=bot({consume:async b=>{b.food=16;}});
 c.currentWindow={type:'minecraft:crafting'};
 assert.equal((await eatMeal(c,'cooked_beef',{windowMs:40})).reason,'a window is open');
 assert.equal(c.consumes,0);
 setTimeout(()=>{c.currentWindow=null;},20);
 assert.equal((await eatMeal(c,'cooked_beef',{windowMs:500,settleMs:50})).ok,true,'a window that closes in time is fine');
});
test('FoodChain never eats in bed',async()=>{
 const meals=fresh();
 const chain=new FoodChain(),ctx={worker:{meals}};
 const b=chainBot(9);b.isSleeping=true;
 chain.priority(b,ctx);await sleep(20);
 assert.equal(b.consumes,0);
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Worker} from '../src/worker.js';
test('worker gate: a queued shelter job no longer switches eating off (collect band stays off)',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'eat-gate-'));
 try{
  const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
  worker.log=()=>{};
  const b=chainBot(12);worker.bot=b;
  // the autopilot's shelter waits behind a gather; the hold used to stop every chain but World
  worker.jobs.push({id:'g',spec:{type:'gather',block:'stone',count:6},status:'queued',message:'Queued'});
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'queued',message:'Queued'});
  const food=worker.taskRunner.chains.find(c=>c.name==='Food');
  assert.ok(worker.survivalHold(),'the queued shelter holds');
  assert.equal(food.priority(b,worker.taskRunner.ctx),-1,'no collect band under the hold');
  await waitFor(()=>b.consumes>0&&!worker.eating);
  assert.equal(b.consumes,1,'but the meal happened');assert.equal(worker.meals.attempts,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
