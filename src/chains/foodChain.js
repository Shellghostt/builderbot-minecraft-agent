// Port of adris/altoclef chains/FoodChain.java. Eating stays asynchronous to the chain
// system: priority() runs on every chain every tick, so the eat action (equip + consume,
// the mineflayer equivalent of force-equipping and holding right click) fires from here
// even while another chain owns the task tree. Collection (CollectFoodTask) keeps
// AltoClef's priority 55. Config values are FoodChainConfig.java's defaults.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {chainConfig,inGame,hasEffect} from './settings.js';
import {inventoryItems,armorValue} from './combatPolicy.js';
import {CollectFoodTask} from './fallbackTasks.js';
import {eatMeal} from '../eating.js';
export const EAT_RETRY_MS=5000; // a failed meal waits this long before the next try
const UNSAFE=new Set(['spider_eye','poisonous_potato','pufferfish']);
export class FoodChain extends SingleTaskChain{
 constructor({mobDefense=null,mlg=null}={}){
  super('Food');
  this.mobDefense=mobDefense;this.mlg=mlg;
  this._isTryingToEat=false;
  this._requestFillup=false;
  this._needsFood=false;
  this._eating=false;
  this.cachedFoodScore=0;
  this.cachedPerfectFood=null;
 }
 priority(bot,ctx){
  const cfg=chainConfig(ctx);
  if(!inGame(bot)||cfg.autoEat===false){this.stopEat();return -1;}
  // do NOT eat while escaping lava (FoodChain.java's lava guard)
  if(bot.entity.isInLava){this.stopEat();return -1;}
  // in danger or falling: don't eat now
  if((this.mobDefense&&this.mobDefense.isDoingAcrobatics&&this.mobDefense.isDoingAcrobatics())
   ||(this.mlg&&this.mlg.isFallingOhNo&&this.mlg.isFallingOhNo(bot))){this.stopEat();return -1;}
  const {total,best}=this.calculateFood(bot,cfg.food);
  this.cachedFoodScore=total;this.cachedPerfectFood=best;
  const hasFood=total>0;
  if(this._requestFillup&&(bot.food|0)>=20)this._requestFillup=false;
  if(!hasFood)this._requestFillup=false;
  const want=hasFood&&(this.needsToEat(bot,cfg.food)||this._requestFillup)&&!!best;
  // Soak accounting (round 6): 'due' counts each episode a meal was wanted with food held,
  // so 'eaten 0' reads as never hungry (due 0) or a broken eat path (due > 0, failed > 0).
  const meals=ctx&&ctx.worker&&ctx.worker.meals;
  if(want&&!this._wanted&&meals)meals.due=(meals.due||0)+1;
  this._wanted=want;this._meals=meals||null;this._worker=ctx&&ctx.worker||null;
  // Round 7: normal2's bar fell to 5 with `due 1, failed 0` and nothing to eat. A hungry
  // episode with no food held is counted apart, so the verdict reads "no food held".
  const starving=!hasFood&&(bot.food|0)<=cfg.food.alwaysEatWhenBelowHunger;
  if(starving&&!this._starving&&meals)meals.noFood=(meals.noFood||0)+1;
  this._starving=starving;
  if(want)this.startEat(bot,best);
  else this.stopEat();
  if(this._needsFood||total<cfg.minimumFoodAllowed){
   this._needsFood=total<cfg.foodUnitsToCollect;
   if(total<cfg.foodUnitsToCollect){
    this.root=new CollectFoodTask(cfg.foodUnitsToCollect);
    return 55;
   }
  }
  // eating is handled asynchronously (FoodChain.java returns NEGATIVE_INFINITY here)
  return -1;
 }
 // FoodChain.needsToEat: ported with FoodChainConfig defaults (14-health/10-hunger rules).
 needsToEat(bot,f){
  f=f||chainConfig(null).food;
  const foodLevel=bot.food|0,health=bot.health;
  if(foodLevel>=20)return false;
  if(onFireOrWither(bot)||health<f.alwaysEatWhenWitherOrFireAndHealthBelow)return true;
  if(foodLevel>f.alwaysEatWhenBelowHunger){
   if(health<f.alwaysEatWhenBelowHealth)return true; // 7f: eat to full, return at health >= 14
  }else return true; // half hunger or worse
  if(foodLevel<f.alwaysEatWhenBelowHungerAndPerfectFit&&this.cachedPerfectFood){
   const need=20-foodLevel;
   const fills=this.cachedPerfectFood.fills;
   return fills===need;
  }
  return false;
 }
 // FoodChain.needsToEatCritical: RUN NOT EAT vs tank-hits-and-eat.
 needsToEatCritical(bot){
  const f=chainConfig(null).food;
  const foodLevel=bot.food|0,health=bot.health;
  const armor=armorValue(bot);
  if(health<f.runDontEatMaxHealth&&foodLevel<f.runDontEatMaxHunger)return false;
  return armor>=f.canTankHitsAndEatArmor&&foodLevel<f.canTankHitsAndEatMaxHunger;
 }
 isTryingToEat(){return this._isTryingToEat;}
 startEat(bot,food){
  this._isTryingToEat=true;
  this._requestFillup=true;
  if(this._eating||Date.now()<(this._retryAt||0))return;
  this._eating=true;
  (async()=>{
   // Round 4: equip the real stack (the picked {name,fills} has no slot). Round 7: the meal
   // is judged by the bar/stack, not by consume's promise (src/eating.js).
   const m=this._meals;
   try{
    const r=await eatMeal(bot,food.name,{worker:this._worker});
    if(!r.ok&&r.reason!=='Food is already full')throw Error(r.reason);
   }
   catch(e){this._retryAt=Date.now()+EAT_RETRY_MS;if(m){m.failed=(m.failed||0)+1;m.lastError=String(e&&e.message||e).slice(0,120);}}
   finally{this._eating=false;}
  })();
 }
 stopEat(){
  // mineflayer's consume is one-shot, so there is no input hold to release (Java releases
  // right click and unpauses interaction here).
  this._isTryingToEat=false;
  this._requestFillup=false;
 }
 // FoodChain.calculateFood: pick the best-fitting food and total the food units available.
 calculateFood(bot,f){
  f=f||chainConfig(null).food;
  const foods=bot.registry&&bot.registry.foodsByName;
  let bestFood=null,bestScore=-Infinity,total=0;
  const health=bot.health??20,hunger=bot.food|0,saturation=bot.saturation??20;
  for(const stack of inventoryItems(bot)){
   const meta=foods&&foods[stack.name];
   if(!meta||!meta.foodPoints)continue;
   if(UNSAFE.has(stack.name))continue;
   const count=stack.count||1;
   const hungerVal=meta.foodPoints;
   const saturationModifier=meta.saturation??0;
   const hungerIfEaten=Math.min(hunger+hungerVal,20);
   const saturationIfEaten=Math.min(hungerIfEaten,saturation+saturationModifier);
   const gainedSaturation=saturationIfEaten-saturation;
   const gainedHunger=hungerIfEaten-hunger;
   const hungerNotFilled=20-hungerIfEaten;
   const saturationWasted=saturationModifier-gainedSaturation;
   const hungerWasted=hungerVal-gainedHunger;
   const prioritizeSaturation=health<f.prioritizeSaturationWhenBelowHealth;
   const saturationGoodScore=prioritizeSaturation?gainedSaturation*f.foodPickPrioritizeSaturationSaturationMultiplier:gainedSaturation;
   const saturationLossPenalty=prioritizeSaturation?0:saturationWasted*f.foodPickSaturationWastePenaltyMultiplier;
   const hungerLossPenalty=hungerWasted*f.foodPickHungerWastePenaltyMultiplier;
   const hungerNotFilledPenalty=hungerNotFilled*f.foodPickHungerNotFilledPenaltyMultiplier;
   let score=saturationGoodScore-saturationLossPenalty-hungerLossPenalty-hungerNotFilledPenalty;
   if(stack.name==='rotten_flesh')score-=f.foodPickRottenFleshPenalty;
   if(score>bestScore){bestScore=score;bestFood={name:stack.name,fills:hungerVal};}
   total+=hungerVal*count;
  }
  return {total,best:bestFood};
 }
}
const onFireOrWither=bot=>{
 if(bot.entity&&typeof bot.entity.isOnFire==='boolean')return bot.entity.isOnFire;
 if(bot.entity&&bot.entity.metadata&&bot.entity.metadata[0]&&(bot.entity.metadata[0]&1))return true;
 return hasEffect(bot,'wither');
};
