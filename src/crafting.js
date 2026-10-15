import {once} from 'node:events';
// Confirm every click against the server, including the final inventory slot.
// Mineflayer's optimistic personal crafting currently loses results through Via.
// Round 8 (hard3 `blown up by Creeper` during a craft): the table's windowOpen and
// mineflayer's crafting-window click (it waits for the result slot with no timeout) could
// hold the craft past every check(). Each wait now polls check() - a reflex preemption throws
// at once and the finally closes the window - and gives up after `ms`.
export const CRAFT_WAIT_MS=5000;
export async function interruptible(promise,check,what,ms=CRAFT_WAIT_MS){
 let poll,timer;
 try{
  return await Promise.race([promise,new Promise((_,reject)=>{
   poll=setInterval(()=>{try{check();}catch(e){reject(e);}},100);
   timer=setTimeout(()=>reject(Error(what+' timed out')),ms);
  })]);
 }finally{clearInterval(poll);clearTimeout(timer);}
}
export async function craftConfirmed(bot,recipe,table,check){
 let window=bot.inventory;
 if(recipe.requiresTable){const opened=once(bot,'windowOpen');opened.catch(()=>{});bot.activateBlock(table);[window]=await interruptible(opened,check,'Opening the crafting table');}
 const sync=async()=>{check();await new Promise(r=>setTimeout(r,120));await interruptible(bot._syncWindow(window),check,'Window sync');await new Promise(r=>setTimeout(r,120));check();};
 const click=async(slot,button=0)=>{check();await interruptible(bot.clickWindow(slot,button,0),check,'Crafting click on slot '+slot);await sync();};
 const putCursor=async()=>{
  const held=window.selectedItem;if(!held)return;
  let target=null;
  for(let i=window.inventoryStart;i<window.inventoryEnd;i++){const item=window.slots[i];if(item?.type===held.type&&item.count+held.count<=item.stackSize){target=i;break;}}
  if(target===null)target=window.firstEmptySlotRange(window.inventoryStart,window.inventoryEnd);
  if(target===null)throw Error('No room for crafting result');await click(target);
  if(window.selectedItem)throw Error(`Server did not accept ${held.name} transfer to slot ${target}; cursor has ${window.selectedItem.name}`);
 };
 try{
  await sync();await putCursor();
  const width=recipe.requiresTable?3:2,area=width*width;
  for(let i=1;i<=area;i++)if(window.slots[i]){await click(i);await putCursor();}
  const ingredients=[];
  if(recipe.inShape){for(let y=0;y<recipe.inShape.length;y++)for(let x=0;x<recipe.inShape[y].length;x++){const ingredient=recipe.inShape[y][x];if(ingredient.id!==-1)ingredients.push({slot:1+x+y*width,id:ingredient.id});}}
  else recipe.ingredients.forEach((ingredient,index)=>ingredients.push({slot:index+1,id:ingredient.id}));
  for(const ingredient of ingredients){
   const source=window.findInventoryItem(ingredient.id,null);if(!source)throw Error('Missing ingredient');
   await click(source.slot);await click(ingredient.slot,1);await putCursor();
  }
  await sync();if(window.slots[0]?.type!==recipe.result.id)throw Error('Server did not produce the expected recipe');
  await click(0);await putCursor();await sync();
 }finally{if(recipe.requiresTable&&bot.currentWindow)try{await bot.closeWindow(window);}catch{}}
}
// One window-sync retry: the 26.3/Via crafting window occasionally rejects a legitimate
// move ("destination full" on a half-empty inventory) - a close-and-reopen clears it
// (measured: the smelt section died one second into the table craft, 2026-10-13).
export async function craftConfirmedRetry(bot,recipe,table,check,tries=2){
 let last;
 for(let attempt=0;attempt<tries;attempt++){
  try{
   check();
   await craftConfirmed(bot,recipe,table,check);
   return;
  }catch(e){
   last=e;
   const message=String(e&&e.message);
   if(/Missing ingredient|No room|Time limit|interrupted|low/i.test(message))throw e;
   if(bot.currentWindow){try{await bot.closeWindow(bot.currentWindow);}catch{}}
   await new Promise(r=>setTimeout(r,500));
  }
 }
 throw last;
}
