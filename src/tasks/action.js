// Shared base for tasks that drive Mineflayer's promise-based actions from synchronous
// ticks (docs/TASK_API.md "Async actions", binding for P1-P4 and the main agent).
// Mineflayer actions (attack, activateItem, dig, placeBlock, ...) are Promises; a task
// that starts one records it here. Rules implemented:
// 1. onStart/onTick/onStop/isFinished stay synchronous and never await.
// 2. run(promise) records the in-flight action once; the result or error is recorded when
//    it settles; onTick returns null while in flight; isFinished reports true when it
//    settled without an error.
// 3. A settled action's error is exposed as this.failed={reason} so parents can blacklist
//    or retry instead of throwing.
// 4. No promise is held across a chain switch: onStop(interrupt) cancels through
//    ownership-guarded stops and ignores any late settlement.
// MIT License, Copyright (c) 2020 Adris Jautakas applies to the ported parts of subclasses;
// this base is original wiring (project code).
export class ActionTask{
 constructor(name){this.name=name;this.inflight=null;this.failed=null;this._result=null;}
 // Record an in-flight action. A newer action supersedes an older one; late settlements
 // of superseded or stopped actions are ignored.
 run(promise){
  const mine=promise;
  this.inflight=promise;this.failed=null;this._result=null;
  Promise.resolve(promise).then(
   result=>{if(this.inflight===mine&&!this.stopped){this.inflight=null;this._result=result;}},
   error=>{if(this.inflight===mine&&!this.stopped){this.inflight=null;this.failed={reason:error&&error.message||String(error)};}}
  );
 }
 // While an action is in flight the task does nothing: onTick returns null.
 inFlight(){return this.inflight!=null;}
 lastResult(){return this._result;}
 // Task-lifecycle default (the runner-managed stopped flag); subclasses call super.onStop.
 onStop(bot,interrupt){this.stopped=true;}
 // Ownership-guarded stops for subclasses' onStop: only the current owner token touches
 // the bot (the same rule as src/tasks/movement/move.js).
 guardedStops(bot,worker){
  if(!bot)return;
  if(worker&&worker.controlToken!==worker.epoch)return;
  try{bot.pathfinder.stop();bot.pathfinder.setGoal(null);}catch{}
  try{bot.stopDigging();}catch{}
  try{bot.clearControlStates();}catch{}
  try{bot.deactivateItem();}catch{}
 }
}
