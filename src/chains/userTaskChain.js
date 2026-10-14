// Port of adris/altoclef chains/UserTaskChain.java: holds the user's task at priority 50
// (below every survival chain, above nothing else), times it, and reports completion
// through the onFinish callback instead of AltoClef's EventBus. Interruption by a higher
// chain keeps the task: when control returns the runner restarts it (SingleTaskChain's
// _interrupted convention, handled by the runner).
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {SingleTaskChain} from './singleTaskChain.js';
import {inGame,Stopwatch} from './settings.js';
export class UserTaskChain extends SingleTaskChain{
 constructor({idle=null}={}){
  super('User Tasks');
  this.idle=idle; // optional idle task factory, port of shouldRunIdleCommandWhenNotActive
  // The runner's contract for this chain: it executes jobs (runTask), it never preempts
  // them - see TaskRunner.tick's userService branch.
  this.userService=true;
  this._runningIdleTask=false;
  this._onFinish=null;
  this._watch=new Stopwatch(()=>Date.now()/1000);
 }
 priority(bot,ctx){
  if(!inGame(bot))return -1;
  return 50;
 }
 runTask(task,onFinish,{idle=false}={}){
  this._runningIdleTask=idle;
  this._onFinish=onFinish||null;
  this._watch.begin();
  this.setTask(task);
 }
 cancel(bot){
  if(this.root){
   try{this.root.onStop(bot,true);}catch{}
   this.root=null;
   this._finish({cancelled:true});
  }
 }
 isRunningIdleTask(){return this._runningIdleTask&&!!this.root;}
 onTick(bot,ctx){
  if(this.root&&(this.root.isFinished(bot,ctx)||this.root.stopped))this._finish({cancelled:false});
  if(!this.root&&this.idle){
   const t=this.idle(bot,ctx);
   if(t){this._runningIdleTask=true;this.setTask(t);this._watch.begin();}
  }
  return this.root;
 }
 _finish({cancelled}){
  const seconds=this._watch.time();
  const task=this.root;
  this.root=null;
  const cb=this._onFinish;
  this._onFinish=null;
  if(cb)try{cb({task,seconds,cancelled});}catch{}
  // keep _runningIdleTask semantics: a fresh user task resets it (runTask), idle refills here
  if(!cancelled&&this.idle)this._runningIdleTask=true;
 }
}
