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
