// Port of AltoClef Settings defaults read by the chains, plus small time/state helpers.
// Original: src/main/java/adris/altoclef/Settings.java and util/time/{TimerGame,Stopwatch}.java
// (https://github.com/gaucho-matrero/altoclef, commit af22e3bc2f03dde45da703f5f7535baae18ea486),
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
export const CHAIN_DEFAULTS={
 mobDefense:true,autoEat:true,autoMLGBucket:true,autoRespawn:true,dodgeProjectiles:true,
 avoidDrowning:true,extinguishWithWater:true,
 // AltoClef Settings.java line 215: killAnnoyingHostileWhenCloseForSeconds = 12
 killAnnoyingHostileWhenCloseForSeconds:12,
 minimumFoodAllowed:0,foodUnitsToCollect:0,
 // DeathMenuChain.java: wait 2s on the death screen, retry every 8s
 respawnDelayMs:2000,respawnRetryMs:8000,
 // FoodChain.java FoodChainConfig defaults
 food:{
  alwaysEatWhenWitherOrFireAndHealthBelow:6,
  alwaysEatWhenBelowHunger:10,
  alwaysEatWhenBelowHealth:14, // 7f: eat to full, return to the task at health >= 14
  alwaysEatWhenBelowHungerAndPerfectFit:15, // 20 - 5 in Java
  prioritizeSaturationWhenBelowHealth:8,
  foodPickPrioritizeSaturationSaturationMultiplier:8,
  foodPickSaturationWastePenaltyMultiplier:1,
  foodPickHungerWastePenaltyMultiplier:2,
  foodPickHungerNotFilledPenaltyMultiplier:1,
  foodPickRottenFleshPenalty:100,
  runDontEatMaxHealth:3,runDontEatMaxHunger:3,
  canTankHitsAndEatArmor:15,canTankHitsAndEatMaxHunger:3}
};
// Chains read their knobs from ctx.config.chains so the main wiring/tests can override.
export const chainConfig=ctx=>{
 const c=(ctx&&ctx.config&&ctx.config.chains)||{};
 return {...CHAIN_DEFAULTS,...c,food:{...CHAIN_DEFAULTS.food,...(c.food||{})}};
};
// Port of util/time/TimerGame.java (seconds; now injected so tests can freeze time).
export class TimerGame{
 constructor(now,period){this.now=now;this.period=period;this.last=-1e12;}
 reset(){this.last=this.now();}
 elapsed(){return this.now()-this.last>=this.period;}
}
export class Stopwatch{
 constructor(now){this.now=now;this.start=0;}
 begin(){this.start=this.now();}
 time(){return this.now()-this.start;}
}
export const inGame=bot=>!!(bot&&bot.entity&&typeof bot.health==='number');
// Mineflayer does not expose a fire flag directly; entity.isOnFire when present, else metadata flags bit 0.
export const onFire=bot=>{
 const e=bot&&bot.entity;if(!e)return false;
 if(typeof e.isOnFire==='boolean')return e.isOnFire;
 return !!(e.metadata&&e.metadata[0]&&(e.metadata[0]&1));
};
export const EFFECT_IDS={fire_resistance:12,wither:20,levitation:25};
export const hasEffect=(bot,nameOrId)=>{
 const effects=bot&&bot.entity&&bot.entity.effects;if(!effects)return false;
 const want=typeof nameOrId==='string'?EFFECT_IDS[nameOrId]:nameOrId;
 return Object.values(effects).some(e=>e&&e.id===want);
};
export const dist=(a,b)=>{
 if(!a||!b)return Infinity;
 if(a.distanceTo)return a.distanceTo(b);
 const dx=a.x-b.x,dy=a.y-b.y,dz=a.z-b.z;
 return Math.sqrt(dx*dx+dy*dy+dz*dz);
};
