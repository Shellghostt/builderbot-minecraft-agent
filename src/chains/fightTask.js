// FightTask: the combat task built on src/combat.js's CombatController (docs/COMBAT_SPEC.md
// 7b/7c/7d). Per docs/TASK_API.md "Async actions": onStart/onTick/onStop/isFinished are
// synchronous and never await - the controller drives the fight one step per tick, and each
// swing/shield/bow action is the controller's fire-and-forget in-flight action (late
// settlements are ignored). The controller receives only the bot and the ownership-guarded
// move helper; it never touches controlToken/epoch - the TaskRunner is the single owner and
// this task runs only while its chain owns control.
// opts: {entityFilter:'cow'|null (hunt/species mode; null = any hostile), lockFirst:true
// (kill exactly the nearest candidate, for hunts), range:16, forceStyle:'melee'|'bow'|null,
// allowHand:true (hand strikes on passive animals), move, log}.
// MIT License, Copyright (c) 2020 Adris Jautakas applies to the ported CombatController.
import {ActionTask} from '../tasks/action.js';
import {CombatController} from '../combat.js';
import {creeperSwell} from '../creeper.js';
import {eatMeal} from '../eating.js';
export class FightTask extends ActionTask{
 constructor({move=null,log=null,opts={}}={}){
  super('FightTask');
  this.move=move;this._log=log||null;this.opts=opts||{};
  this.entityFilter=opts.entityFilter||null; // hunt/species mode: only this entity name
  this.lockFirst=!!opts.lockFirst;           // kill exactly the nearest candidate (hunts)
  this.range=opts.range||16;                 // scan/chase radius (the controller strikes at ~3)
  this.controller=null;this._reported=false;this._eating=false;this._locked=null;
  this._chaseFor=null;this._chase=null;this._approachStart=0;this._kiteStart=null;this._laneNav=false;
  this._ignore=new Map();this._targetSince=0;this._targetId=null;this._hitsAtStart=0;
 }
 ensureController(bot,ctx){
  if(!this.controller){
   const move=ctx&&ctx.move||this.move;
   const log=this._log||undefined;
   // Controller events (disengage/arrow calibration/...) ride the same log as the states:
   // _emit is internally rate-limited, so this cannot flood the event buffer.
   this.controller=new CombatController(bot,move,{...this.opts,log,
    onEvent:(type,detail)=>{if(log&&type!=='damage')try{log('Combat event: '+type+' '+(detail||''));}catch{}}});
  }
  return this.controller;
 }
 candidates(bot){
  const me=bot&&bot.entity&&bot.entity.position;
  if(!me)return [];
  const nowMs=Date.now();
  for(const [id,until] of [...this._ignore])if(nowMs>until)this._ignore.delete(id);
  return Object.values(bot.entities||{}).filter(e=>e&&e!==bot.entity&&e.position&&e.isValid!==false
   &&e.position.distanceTo(me)<=this.range
   &&!this._ignore.has(e.id)
   &&(this.entityFilter?e.name===this.entityFilter:e.type==='hostile'));
 }
 isFinished(bot){
  if(this.lockFirst){
   if(!this._locked)return this.candidates(bot).length===0;
   return !bot.entities[this._locked.id]; // the hunted animal is gone (dead or despawned)
  }
  return this.candidates(bot).length===0; // threat/species mode: the area is clear
 }
 onStart(bot,ctx){
  this._reported=false;this._eating=false;this._locked=null;
  this.ensureController(bot,ctx);
  // 7a: the shield lives in the off hand while fighting (fire-and-forget equip; verified
  // later by the controller's gear read like every other hand action).
  try{
   const off=bot.inventory&&bot.inventory.slots&&bot.inventory.slots[45];
   const has=(bot.inventory&&bot.inventory.items()||[]).find(i=>i.name==='shield');
   if(has&&(!off||off.name!=='shield')){const p=bot.equip(has,'off-hand');p&&p.catch&&p.catch(()=>{});}
  }catch{}
 }
 _cancelNav(bot){
  // Drop a pathfinder leg so the controller can sprint. Late goto settlements are
  // ignored once inflight is cleared (ActionTask run() already drops superseded work).
  if(!this.inflight&&!this._laneNav)return;
  this.inflight=null;this._laneNav=false;
  try{bot.pathfinder&&bot.pathfinder.stop();bot.pathfinder&&bot.pathfinder.setGoal(null);}catch{}
  try{bot.clearControlStates();}catch{}
 }
 onTick(bot,ctx){
  const ctl=this.ensureController(bot,ctx);
  if(this.isFinished(bot)){this._report(ctl,'finished');return null;}
  const list=this.candidates(bot).sort((a,b)=>a.position.distanceTo(bot.entity.position)-b.position.distanceTo(bot.entity.position));
  if(this.lockFirst&&!this._locked)this._locked=list[0]||null;
  let target=this.lockFirst?this._locked:list[0]||null;
  // Groups: stay on the current target while it is in reach or the nearest is not clearly
  // (1+ block) closer. Flipping between three zombies every few ticks reset the controller
  // state each time and spread the damage over all three. A creeper always takes over.
  const cur=ctl.target;
  if(!this.lockFirst&&target&&cur&&cur!==target&&target.name!=='creeper'&&list.includes(cur)){
   const me=bot.entity.position,dc=cur.position.distanceTo(me);
   if(dc<=3||target.position.distanceTo(me)>dc-1)target=cur;
  }
  if(!target){if(this.inFlight())return null;return null;}
  // Beyond straight-line walking range, chase with the pathfinding getToEntity child
  // (the controller only walks straight at a target - a mob that paths around a wall
  // would otherwise sit just outside the scan radius while the job reports victory).
  const d=target.position.distanceTo(bot.entity.position);
  const moveApi=ctx&&ctx.move||this.move;
  // A swelling creeper (metadata 16 === 1) is not a duel. The controller turns away and
  // sprints; a pathfinder leg here steals that sprint and the blast still lands.
  const swelling=target.name==='creeper'&&creeperSwell(target).fusing;
  // Wiki (https://minecraft.wiki/w/Creeper): fuse starts at 3, cancels past 7 or LOS.
  // The roofed 12x12 gate (1498-1501,z=1506) sits next to the creeper spawn (1504,1504).
  // Pathing to the lane (combat 73173 dest 1500,1518 → 19.8 hp; 73175 dest 1496,1522
  // → 18.0 hp) walked through that gate with combat OFF (inFlight short-circuit) and
  // detonated. Opposite-corner kite + bow from 8 is the only move that opens the gap.
  if(target.name==='creeper'&&(swelling||d<8||this._laneNav)){
   this._cancelNav(bot);
   ctl.setTarget(target);
   ctl.tick();
   return null;
  }
  if(this.inFlight())return null; // the disengage-eat (bot.consume) is settling
  // Chase ONLY fleeing/hunted animals (lockFirst hunts): a HOSTILE closes distance by
  // itself, so standing ground and swinging beats chasing - a pathfinder chase runs with
  // the controller off (no shield, no swings) and lets the mob land free hits while both
  // of you hover at knockback range (measured: 7 swings and 33 damage taken in one duel).
  // A bowkite likewise needs no chase: the controller kites and shoots from range.
  const bowTactic=(bot.heldItem&&bot.heldItem.name==='bow')||ctl.gear&&ctl.gear.bow&&ctl.gear.arrows>0;
  const hunted=this.lockFirst||(target.type&&target.type!=='hostile');
  if(hunted&&!bowTactic&&d>4&&moveApi&&typeof moveApi.getToEntity==='function'){
   if(this._chaseFor!==target.id||!this._chase){this._chaseFor=target.id;this._chase=moveApi.getToEntity(target,1);}
   return this._chase;
  }
  this._chaseFor=null;this._chase=null;
  // No-progress watch (the unreachable-hostile blacklist in candidates()): a mob the bot
  // cannot reach (cave ledge, fence maze) would hold the tree forever and every paused
  // job behind it starves - 20 s without a landed hit benches it for 60 s.
  const nowMs=Date.now();
  if(target){
   if(this._targetId!==target.id){this._targetId=target.id;this._targetSince=nowMs;this._hitsAtStart=ctl.stats?ctl.stats.hits:0;}
   else if(ctl.stats&&ctl.stats.hits===this._hitsAtStart&&nowMs-this._targetSince>20000){
    this._ignore.set(target.id,nowMs+60000);
    this._log&&this._log('Combat: benching unreachable '+(target.name||'hostile')+' for 60s');
    ctl.setTarget(null);this._targetId=null;this._targetSince=0;
    return null;
   }
  }else{this._targetId=null;this._targetSince=0;}
  // The tactic says avoid (witch: it kites and out-potions every rush): bench the hostile
  // for 60 s AND physically leave - break line of sight with one bounded pathfinder leg
  // along the away-vector; standing still in throw range just dies (measured).
  if(target&&ctl.state==='avoid'&&target.type==='hostile'){
   this._ignore.set(target.id,Date.now()+60000);
   this._log&&this._log('Combat: avoiding '+(target.name||'hostile')+' - benched for 60s, breaking line of sight');
   ctl.setTarget(null);this._targetId=null;
   if(moveApi&&moveApi.awayFrom&&moveApi.goals&&moveApi.goals.xzGoal&&moveApi.goto){
    const dest=moveApi.awayFrom(bot.entity.position,target.position,16);
    // goto() wants a pathfinder Goal. getToXZ() is a Task; handing that to
    // pathfinder.goto throws 'stateGoal.isValid is not a function' every tick.
    if(dest){const goal=moveApi.goals.xzGoal(dest.x,dest.z);this.run((async()=>{try{await moveApi.goto(goal,{seconds:4});}catch{}})());}
   }
   return null;
  }
  // A straight-line KITE corners the bot exactly like a straight approach: backing into a
  // wall while a creeper closes is the death. When kiting/retreating makes no distance for
  // 1.5 s, take one bounded pathfinder leg along the away-vector (it routes through gates).
  // Creepers never take that leg: awayFrom still walked through the arena gate.
  if(target&&target.name==='creeper')this._kiteStart=null;
  else if(target&&(ctl.state==='kite'||ctl.state==='retreat'||ctl.state==='guard')){
   if(!this._kiteStart)this._kiteStart={t:nowMs,d};
   else if(nowMs-this._kiteStart.t>1500&&d>=this._kiteStart.d-0.5){
    this._kiteStart={t:nowMs,d};
    if(moveApi&&moveApi.awayFrom&&moveApi.goals&&moveApi.goals.xzGoal&&moveApi.goto){
     const dest=moveApi.awayFrom(bot.entity.position,target.position,10);
     if(dest){const goal=moveApi.goals.xzGoal(dest.x,dest.z);this.run((async()=>{try{await moveApi.goto(goal,{seconds:3});}catch{}})());}
     return null; // the escape leg is the in-flight action
    }
   }
  }else this._kiteStart=null;
  // Hostile duels stand and swing, but a straight-line approach stalls on walls (the
  // arena gate, terrain): if the gap has not closed for 2.5 s, take ONE bounded
  // pathfinder leg toward the target and hand control straight back to the controller.
  // Never path TO a creeper: the 2.5 s "gap has not closed" chase walks into the fuse
  // (bow kite wants to HOLD 8+, not close). Away-vector escape above still runs.
  if(d>4&&!swelling&&target.name!=='creeper'){
   if(!this._approachStart)this._approachStart=nowMs;
   if(nowMs-this._approachStart>2500){
    this._approachStart=nowMs;
    if(moveApi&&moveApi.goals&&typeof moveApi.goals.xzGoal==='function'&&typeof moveApi.goto==='function'){
     const goal=moveApi.goals.xzGoal(target.position.x,target.position.z);
     if(goal&&typeof goal.isValid==='function')this.run((async()=>{try{await moveApi.goto(goal,{seconds:3});}catch{}})());
    }
    return null; // the leg is the in-flight action (Async actions contract)
   }
  }else this._approachStart=0;
  ctl.setTarget(target);
  ctl.tick();
  // 7b.8: the driver eats while disengaged (health <= 12) - the controller covers up and
  // backs off; this fires the consume and waits through inFlight().
  if(ctl.state==='disengage')this._tryEat(bot);
  return null;
 }
 _tryEat(bot){
  if(this._eating||!bot.inventory)return;
  const reg=bot.registry;
  const food=(bot.inventory.items()||[]).find(i=>{
   try{const f=reg&&reg.foodsByName&&reg.foodsByName[i.name];return !!f&&f.foodPoints>0&&!f.negative;}catch{return false;}
  });
  if(!food)return;
  this._eating=true;
  this.run(eatMeal(bot,food.name,{tries:1}).catch(()=>{}).then(()=>{this._eating=false;}));
 }
 // 7d: log each fight - mob, tactic, hits, crits, damage taken, result. Once per task.
 _report(ctl,result){
  if(this._reported||!ctl)return;
  this._reported=true;
  if(!this._log)return;
  const s=ctl.stats,t=ctl.target;
  this._log('Fight result: '+(t&&t.name||'no target')+' tactic='+(ctl.tactic&&ctl.tactic.style||'none')
   +' hits='+s.hits+' crits='+s.crits+' sweeps='+s.sweeps+' shots='+s.shots+' released='+(s.released||0)+' landed='+(s.landed||0)
   +' damage taken='+Math.round(s.damageTaken*10)/10+' disengages='+s.disengages+' result='+result);
 }
 onStop(bot,interrupt){
  this._report(this.controller,interrupt?'stopped':'finished');
  if(this.controller)try{this.controller.stop();}catch{}
  super.onStop(bot,interrupt);
 }
 isEqual(o){return o&&o.constructor===this.constructor;}
}
