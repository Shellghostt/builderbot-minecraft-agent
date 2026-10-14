// Port of adris/altoclef/tasksystem/Task.java (AltoClef, commit af22e3bc2f03dde45da703f5f7535baae18ea486),
// translated to the frozen docs/TASK_API.md contract. The ITaskCanForce / ITaskRequiresGrounded /
// ITaskOverridesGrounded interfaces become duck-typed conventions (see forceWhileAirborne); the marker
// ITaskUsesCraftingGrid is a crafting-task (P3) concern and is not modelled here. The Java file only
// touches AltoClef's mod, which becomes the explicit `bot` argument - no Baritone API is involved.
// MIT License, Copyright (c) 2020 Adris Jautakas (full text: third_party/ALTOCLEF_LICENSE).
// child/started/stopped are runner-managed (tasks must not set them); started tasks form the live tree.
export class Task{
 constructor(name){this.name=name;this.child=null;this.started=false;this.stopped=false;}
 onStart(bot){}
 onTick(bot){return null;} // return the child Task to switch to, or null to do this task's own work
 onStop(bot,interrupt){this.stopped=true;} // interrupt=true when superseded/stopped
 isFinished(bot){return true;}
 isEqual(other){return other instanceof this.constructor;} // same goal? override and compare args
 setDebugState(state){this.debugState=state==null?'':state;} // port of Task.setDebugState, for status logs
 toString(){return '<'+this.name+'> '+(this.debugState||'');}
 // Port of Task.thisOrChildSatisfies: walks the live child links.
 thisOrChildSatisfies(pred){let t=this;while(t){if(pred(t))return true;t=t.child;}return false;}
}
// ITaskCanForce / ITaskRequiresGrounded as duck typing: a task with a shouldForce(bot,toInterruptWith)
// method cannot be switched out for that candidate. This is ITaskRequiresGrounded's default: force while
// airborne, unless the interrupting task overrides grounded (ITaskOverridesGrounded -> overridesGrounded),
// which is how AltoClef lets the MLG bucket task take over in mid air.
export function forceWhileAirborne(bot,toInterruptWith){
 if(toInterruptWith&&toInterruptWith.overridesGrounded)return false;
 const e=bot&&bot.entity;
 return !!e&&!(e.onGround||e.isInWater||e.inWater||e.isClimbing);
}
// Port of Task.canBeInterrupted: a switch into toInterruptWith may proceed only if no task in the
// current subtree forces itself over it.
export function canBeInterrupted(bot,sub,toInterruptWith){
 if(!sub)return true;
 return !sub.thisOrChildSatisfies(t=>typeof t.shouldForce==='function'&&t.shouldForce(bot,toInterruptWith));
}
// Port of Task.stop(mod,interruptTask) with one deliberate change: deepest first. The leaf owns the
// pathfinder/controls (its P4 movement helpers check worker.controlToken), so it must release before
// its parents clean up. Clearing `started` before unwinding makes stopping exactly-once; `interrupt`
// stands for Java's interruptTask!=null.
export function stopTask(bot,task,interrupt){
 if(!task||!task.started)return;
 task.started=false;
 if(task.child)stopTask(bot,task.child,interrupt);
 task.onStop(bot,interrupt);
 task.stopped=true;
}
// Port of Task.tick(mod,parentChain) plus the contract's completion rule: a started task whose
// isFinished is true pops cleanly (interrupt=false), is cleared from its parent and the parent
// re-decides on its next tick. Child switching keeps an isEqual child running (this is what prevents
// AltoClef's subtask-restart storms) and stops the old child exactly once otherwise.
export function tickTask(bot,task,parent){
 if(task.started&&task.isFinished(bot)){
  stopTask(bot,task,false);
  if(parent)parent.child=null;
  return;
 }
 if(!task.started){task.onStart(bot);task.started=true;task.stopped=false;}
 if(task.stopped)return; // a stop swept this subtree during onStart (Java re-checks after start too)
 const next=task.onTick(bot);
 if(next!=null){
  if(!task.child||!task.child.isEqual(next)){
   if(canBeInterrupted(bot,task.child,next)){
    if(task.child)stopTask(bot,task.child,true); // superseded by a different goal
    next.child=null;next.started=false;next.stopped=false; // fresh adoption: onStart fires again
    task.child=next;
   }
  }
  if(task.child)tickTask(bot,task.child,task);
 }else if(task.child&&canBeInterrupted(bot,task.child,null)){
  stopTask(bot,task.child,false); // Java drops the sub cleanly when the parent stops needing it
  task.child=null;
 }
}
