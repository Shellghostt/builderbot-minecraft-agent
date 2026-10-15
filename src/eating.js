// One eat path for every caller (eat job, reflex, FoodChain, the fight's disengage-eat).
// Round 7: normal3 failed 4 meals with `Promise timed out.` while holding 4 cooked food.
// mineflayer's consume() resolves only on entity_status 9 (finish using item), a held-item
// change or a cooldown within 2.5 s; on this ViaBackwards (26.x -> 1.21.4) path the status
// can arrive late or never, and any equip from another chain mid-meal (a gather equipping its
// pickaxe, the forcefield its sword) switches the server's hand and silently ends the meal.
// So a meal is judged by its result - the food bar rising or the stack shrinking - not by the
// promise; a meal that shows neither is released and retried once on a freshly selected slot,
// and while it is in flight other hand equips wait for it (guardEquip).
import {inventoryItems} from './chains/combatPolicy.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export const EAT_SETTLE_MS=1500; // after consume returns or times out: the bar's health packet
export const EAT_GUARD_MS=4500; // longest a hand equip waits for a meal in flight
const countOf=(bot,name)=>inventoryItems(bot).filter(i=>i.name===name).reduce((n,i)=>n+(i.count||1),0);
async function until(fn,ms){
 const end=Date.now()+ms;
 for(;;){if(fn())return true;if(Date.now()>=end)return false;await sleep(Math.min(50,Math.max(1,end-Date.now())));}
}
// Hand equips from anyone but the meal wait (bounded) for the meal in flight to settle.
export function guardEquip(bot){
 if(!bot||typeof bot.equip!=='function'||bot.__rawEquip)return;
 const raw=bot.__rawEquip=bot.equip.bind(bot);
 bot.equip=async(item,dest,...rest)=>{
  if(bot.__meal&&(dest==null||dest==='hand'))await Promise.race([bot.__meal,sleep(EAT_GUARD_MS)]);
  return raw(item,dest,...rest);
 };
}
// Eat one `name`. Returns {ok, gained, attempts} or {ok:false, reason, attempts}; throws only
// what equip/check throw (a Stop, a refused equip), so callers keep their own error paths.
export async function eatMeal(bot,name,{tries=2,settleMs=EAT_SETTLE_MS,worker=null,check=null}={}){
 const equip=bot.__rawEquip||bot.equip.bind(bot);
 let reason='no '+name+' stack in the inventory';
 for(let attempt=1;attempt<=tries;attempt++){
  const stack=inventoryItems(bot).find(i=>i.name===name);
  if(!stack)return {ok:false,reason,attempts:attempt-1};
  if((bot.food|0)>=20)return attempt>1?{ok:true,gained:0,attempts:attempt-1}:{ok:false,reason:'Food is already full',attempts:0};
  const food0=bot.food,count0=countOf(bot,name);
  // A retry selects another hotbar slot first, so the server sees a fresh held-item change
  // instead of an equip that is a no-op on a slot it already holds.
  if(attempt>1&&typeof bot.setQuickBarSlot==='function'&&typeof bot.quickBarSlot==='number')
   try{bot.setQuickBarSlot((bot.quickBarSlot+1)%9);}catch{}
  await equip(stack,'hand');
  if(check)check();
  let release;bot.__meal=new Promise(r=>{release=r;});
  if(worker)worker.eating=true;
  try{
   let err=null;
   try{await bot.consume();}catch(e){err=e;}
   if(await until(()=>bot.food>food0||countOf(bot,name)<count0,settleMs))
    return {ok:true,gained:Math.max(0,bot.food-food0),attempts:attempt};
   reason=err?String(err.message||err):'the food bar did not rise';
   try{if(typeof bot.deactivateItem==='function')bot.deactivateItem();}catch{}
  }finally{if(worker)worker.eating=false;bot.__meal=null;release();}
 }
 return {ok:false,reason:reason+' ('+tries+' tries)',attempts:tries};
}
