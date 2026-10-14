// Port of adris/altoclef/tasksystem/TaskRunner.java (AltoClef, commit af22e3bc2f03dde45da703f5f7535baae18ea486).
// Java wrapped the tick loop in Baritone's control push/pop (mod.getBehaviour()...); there is no Baritone here.
// Instead the runner is the SINGLE owner of mineflayer-pathfinder and the bot controls through the worker
// ownership token (worker.controlToken / worker.epoch, the same pattern as src/reflexes.js withControl /
// gotoPoint): taken while a task tree is active, released with an epoch bump when it stops so cleanups
// captured by a previous owner (a reflex or a torn-down tree) skip themselves. Task code never calls
// pathfinder.setGoal/setMovements/clearControlStates directly - it goes through the P4 movement helpers,
// which are ownership-guarded the same way the reflex gotoPoint is.
// MIT License, Copyright (c) 2020 Adris Jautakas (full text: third_party/ALTOCLEF_LICENSE).
import {tickTask,stopTask} from './task.js';
export class TaskRunner{
 constructor(worker,chains,options={}){
  this.worker=worker;
  this.chains=[...chains];
  this.intervalMs=options.intervalMs??50;
  this.running=false;
  this.timer=null;
  this.current=null; // Java _cachedCurrentTaskChain
  this.roots=new Map(); // per chain: the root task actually running (chain.onTick may build fresh equal ones)
  const w=worker;
  this.ctx={
   worker:w,
   get bot(){return w?w.bot:null;}, // live getter: the bot instance can change on reconnect
   config:(options&&options.config)||(w&&w.config)||{},
   trackers:(w&&w.trackers)||{}, // P4, {} until it lands (chains must tolerate {})
   blacklist:(w&&w.blacklist)||{}, // P4, {} until it lands
   move:(w&&w.move)||{} // P4 movement helpers, {} until they land
  };
 }
 addTaskChain(chain){this.chains.push(chain);}
 start(){
  if(this.running)return;
  this.running=true;
  this.timer=setInterval(()=>{
   try{this.tick();}catch(e){try{this.worker.log('TaskRunner error: '+e.message);}catch{}}
  },this.intervalMs);
  if(this.timer.unref)this.timer.unref();
 }
 // Stops the clock AND the active tree: deepest first with interrupt=true (contract lifecycle rule 4).
 stop(){
  this.running=false;
  if(this.timer){clearInterval(this.timer);this.timer=null;}
  if(this.current)this.teardownChain(this.worker?this.worker.bot:null,this.current);
  this.releaseControl(true);
 }
 // One decision cycle. Also callable directly (manual clock in unit tests); start() only automates it.
 tick(){
  const w=this.worker,bot=w?w.bot:null;
  if(!bot){ // disconnected: no tree can run; drop state without task callbacks
   if(this.current){this.roots.delete(this.current);this.current.onStopped(null,this.ctx);this.current=null;}
   this.releaseControl();
   return;
  }
  // Highest active chain wins; strict > keeps the earlier chain on ties (Java TaskRunner.tick).
  let max=null,maxP=-Infinity;
  for(const chain of this.chains){
   const p=chain.priority(bot,this.ctx);
   if(typeof p!=='number'||!(p>=0))continue; // -1/NaN: inactive
   if(!max||p>maxP){maxP=p;max=chain;}
  }
  if(this.current&&max!==this.current){
   // Yield/switch: the old tree stops synchronously, so no epoch bump is needed here - a
   // bump would fail the job queue's running jobs, which are exactly what we yield TO when
   // the new chain is idle (null root).
   this.teardownChain(bot,this.current);
  }
  this.current=max;
  if(!max){this.releaseControl(false);return;} // no tree active: nothing holds control through us
  if(!max.started)max.onStartup(bot,this.ctx);
  this.tickChain(bot,max);
  const tree=this.roots.get(max);
  if(tree){
   // Re-consult the chain's priority: the worker's gate may have stood it down since (a
   // sleep/eat/shelter job started while the tree was being built) - yield, never preempt.
   if(max.priority&&max.priority(bot,this.ctx)<0){
    if(w.log)try{w.log('Runner: yielding '+max.name+' (gate stood down)');}catch{}
    this.teardownChain(bot,max);
    this.current=null;
    this.releaseControl(false);
    return;
   }
   if(w.controlToken!==w.epoch&&w.log&&!max.userService)try{w.log('Runner: claim-bump for '+max.name+' (a job was running)');}catch{}
   // A real tree runs: a reflex chain preempts a running job - paused through worker.stop
   // (reflex semantics: resumed by the worker's cadence bridge when this tree ends), never
   // failed by a raw epoch bump. The user-service chain (UserTaskChain) IS the running
   // job's execution vehicle: it inherits the job's epoch with no bump and no pause, so the
   // job's checks keep passing while the tree drives it. Without a running job the plain
   // withControl claim (bump + take) is safe and keeps the ownership contract.
   if(w.jobs&&w.jobs.some&&w.jobs.some(j=>j.status==='running')&&!max.userService){
    if(w.stop)w.stop('Reflex: preempted by '+max.name,'reflex');
    else{w.epoch++;w.controlToken=w.epoch;}
   }else if(!max.userService&&w.controlToken!==w.epoch)w.epoch++;
   w.controlToken=w.epoch; // the tree owns control from here
  }else this.releaseControl(false);
 }
 // Chain switch/stop: the previous chain's whole tree dies with interrupt=true, then onStopped fires.
 teardownChain(bot,chain){
  const root=this.roots.get(chain);
  if(root){
   if(bot!=null)stopTask(bot,root,true);
   else for(let t=root;t;t=t.child){t.started=false;t.stopped=true;} // no bot: no callbacks to fail on
  }
  this.roots.delete(chain);
  chain.onStopped(bot,this.ctx);
  if(this.current===chain)this.current=null;
 }
 // Per-chain root bookkeeping: the port of SingleTaskChain.setTask feeding the Task.tick descent.
 tickChain(bot,chain){
  const root=chain.onTick(bot,this.ctx);
  let cached=this.roots.get(chain)||null;
  if(cached&&cached.stopped)cached=null; // popped last tick: the chain re-decides from scratch
  if(root==null){
   if(cached)stopTask(bot,cached,false); // Java setTask(null): clean stop
   this.roots.set(chain,null);
   return;
  }
  if(!cached||!cached.isEqual(root)){
   if(cached)stopTask(bot,cached,true); // superseded by a different root goal (Java setTask: stop(mod,task))
   root.child=null;root.started=false;root.stopped=false;
   this.roots.set(chain,root);
  }
  tickTask(bot,this.roots.get(chain),null);
 }
 // worker.controlToken / worker.epoch (cf. src/reflexes.js withControl): taking bumps the epoch so
 // cleanups captured under a previous owner skip themselves; releasing nulls the token and bumps the
 // epoch so OUR stale cleanups skip themselves once the tree is gone.
 takeControl(force){
  const w=this.worker;
  if(!w||typeof w.epoch!=='number')return;
  if(force||w.controlToken!==w.epoch){
   // A real claim/switch while a job runs is a PREEMPTION: pause the job through worker.stop
   // (the reflex semantics - the job must resume when the chain yields), not a raw epoch bump
   // which would fail the job outright on its next check.
   if(force&&w.jobs&&w.jobs.some(j=>j.status==='running'))w.stop('Reflex: preempted by '+(this.current?this.current.name:'chains'),'reflex');
   else w.epoch++;
   w.controlToken=w.epoch;
  }
 }
 releaseControl(bump=false){
  const w=this.worker;
  if(!w||typeof w.epoch!=='number')return;
  // A yield releases WITHOUT a bump: the job queue's running jobs share this epoch and must
  // keep their tokens (stale helpers of the old tree skip on controlToken=null anyway).
  // runner.stop() passes bump=true: nothing yielded - everything must stand down.
  if(bump&&w.controlToken===w.epoch)w.epoch++;
  w.controlToken=null;
 }
 // {running,chain,task} for the API/dashboard; task is the active leaf's name.
 status(){
  const chain=this.current;
  let task=null;
  if(chain){let t=this.roots.get(chain)||null;while(t&&t.child)t=t.child;task=t?t.name:null;}
  return {running:this.running,chain:chain?chain.name:null,task};
 }
}
