import mineflayer from 'mineflayer';
import pathfinderPackage from 'mineflayer-pathfinder';
import toolPackage from 'mineflayer-tool';
import {Vec3} from 'vec3';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {jobSchema,validateBlueprint} from './schema.js';
import {installMovementFix,installWeatherFix} from './compat.js';
import {craftConfirmedRetry as craftConfirmed} from './crafting.js';
import {survey} from './observe.js';
import {Autopilot} from './autopilot.js';
import {SMELTING} from './smelting.js';
import {buildChain,BREED_FOOD} from './howto.js';
import * as combat from './combat.js';
import {TaskRunner} from './tasks/runner.js';
import {defaultChains} from './chains/index.js';
import {FightTask} from './chains/fightTask.js';
import {createTrackers} from './trackers/index.js';
import {createMoveApi,setDefaultMoveContext} from './tasks/movement/move.js';
import {forceFieldTick} from './forcefield.js';
import {avoidanceActive,pickOpenStand,stepCost,trackProgress} from './move-safety.js';
import {solidSupport,placementCells,softBreakCell,hitsBot,HARD_BREAK} from './place-support.js';
import {createMoveTasks} from './tasks/movement/factories.js';
const {pathfinder,Movements,goals}=pathfinderPackage;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const pos=p=>new Vec3(p.x,p.y,p.z);
const empty=b=>b && ['air','cave_air','void_air'].includes(b.name);
// Diagonal steps past a solid corner wedge the bot on 26.3 (it stops moving); require both sides clear.
function guardDiagonals(movement){
 const diagonal=movement.getMoveDiagonal.bind(movement);
 movement.getMoveDiagonal=(node,dir,neighbors)=>{for(const [x,z]of [[dir.x,0],[0,dir.z]])for(let dy=0;dy<=2;dy++)if(movement.getBlock(node,x,dy,z).physical)return;diagonal(node,dir,neighbors);};
 return movement;
}
const NATURAL_DIG=new Set(['dirt','grass_block','coarse_dirt','rooted_dirt','podzol','mycelium','mud','moss_block','sand','red_sand','gravel','clay','stone','cobblestone','deepslate','cobbled_deepslate','andesite','granite','diorite','tuff','calcite','dripstone_block','sandstone','netherrack','soul_sand','soul_soil','end_stone','snow','snow_block','packed_mud','terracotta']);
// Blocks a gather job may descend for: they live underground when no exposure is in range.
const UNDERGROUND=/(_ore$|^deepslate|^stone$|^cobblestone$|^tuff$)/;
// Neutral mobs trail the bot without attacking; searches and explores ignore them unless
// they crowd the bot (the reflexes answer real aggression).
const NEUTRAL=new Set(['enderman','zombified_piglin','piglin','spider']);
const canSeeTarget=(b,e)=>{
 try{const from=b.entity.position.offset(0,1.62,0),to=e.position.offset(0,1,0);const dir=to.minus(from),range=dir.norm();if(range<0.5)return true;return !b.world.raycast(from,dir.scaled(1/range),range);}catch{return true;}
};
export class Worker extends EventEmitter {
 constructor(root,config){
  super();this.root=root;this.config=config;this.bot=null;this.ready=false;this.busy=false;this.epoch=0;this.events=[];
  this.reflexEnabled=config.reflexes!==false;this.reflexBusy=false;this.reflexStopping=false;this.userStopped=false;this.deathResume=false;this.eating=false;
  this.runSettled=null;this.controlToken=null;this.lastDeath=null;this.combat=combat; // reflex-side ownership token (see reflexes.js)
  this.autopilot=new Autopilot(this,root);
  // Phase 7A: the AltoClef task runner owns survival behaviour (mob defense, food, world
  // survival, respawn) while the verified job queue keeps executing jobs. reflexes.js is
  // retired - its threat policy lives in the ported chains now (COMBAT_SPEC 7f thresholds).
  const trackers=createTrackers({getBot:()=>this.bot,config:this.config});
  this.trackers=trackers.api;this.trackersRaw=trackers;this.blacklist=trackers.blacklist;
  const ctxBase={worker:this,config:this.config,trackers:this.trackers,blacklist:this.blacklist,get bot(){return this.worker.bot;}};
  this.move={...createMoveApi(ctxBase),...createMoveTasks(ctxBase)};
  setDefaultMoveContext({...ctxBase,move:this.move});
  const self=this;
  const gate=chain=>{ // the reflexes toggle gates survival chains; user tasks always run
   let wasActive=false;
   return {
   name:chain.name,
   userService:chain.userService, // the runner's no-preempt contract must survive the wrap
   priority:(bot,ctx)=>{
    // The reflexes toggle gates the SURVIVAL chains only: UserTaskChain is the jobs' own
    // execution vehicle (fight/hunt run through it), so it stays live with reflexes off.
    if(!self.reflexEnabled&&chain.name!=='User Tasks'){wasActive=false;return -1;}
    // The old reflex courtesy rule: never interrupt (or race) jobs that already handle the
    // same survival need - sleep/eat/shelter. Queued counts, and so does a preemption-paused
    // one: the chain must stand down so the paused job gets its turn (otherwise the chain
    // holds the night and the job never resumes).
    const active=self.jobs.find(j=>
     ['running','queued'].includes(j.status)
     ||(j.status==='paused'&&/^(Preempted by|Reflex:)/.test(String(j.message))&&['sleep','eat','shelter'].includes((j.spec||{}).type)));
    if(active&&['sleep','eat','shelter'].includes(active.spec.type)&&chain.name!=='User Tasks'){wasActive=false;return -1;}
    const p=chain.priority(bot,ctx);
    // Observability contract (the suite and the dashboard watch for 'Reflex:'): log each
    // survival chain engagement, exactly like the retired reflex loop announced itself.
    const activeNow=p>=0;
    if(activeNow&&!wasActive)self.log('Reflex: '+chain.name+' engaging');
    wasActive=activeNow;
    return p;
   },
   onTick:(bot,ctx)=>chain.onTick(bot,ctx),
   onStartup:(bot,ctx)=>chain.onStartup&&chain.onStartup(bot,ctx),
   onStopped:(bot,ctx)=>chain.onStopped&&chain.onStopped(bot,ctx)
   };
  };
  const chains=defaultChains();
  this.userChain=chains.find(c=>c.name==='User Tasks')||null; // the real chain: the runner holds gate-wrapped ones
  this.taskRunner=new TaskRunner(this,chains.map(gate));
  this.file=path.join(root,'data/jobs.json');fs.mkdirSync(path.dirname(this.file),{recursive:true});
  this.jobs=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):[];
  for(const job of this.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.message='Paused after restart; resume when ready';}
  // Preemption pauses are only meaningful within the session that made them (the chain that
  // paused the job is gone after a restart): strip the markers so the resume bridge ignores them.
  for(const job of this.jobs)if(job.status==='paused'&&/^(Preempted by|Job interrupted|Reflex:)/.test(String(job.message)))job.message='Paused after restart; resume when ready';
  this.save();
 }
 // jobs.json holds the active jobs (running/queued/paused/failed, with the resume state
 // they need) plus the most recent 200 terminal jobs stripped to their skeleton; everything
 // older moves to the append-only jobs-archive.jsonl. Failed jobs count toward the cap, so
 // a retry storm cannot grow the rewrite-on-every-update file without bound. Prune and
 // strip IN PLACE: the pump, the jobs and the dashboard share these object references, so
 // replacing them with copies would freeze their reported progress.
 save(){
  const terminal=this.jobs.filter(j=>j.status==='complete'||j.status==='cancelled'||j.status==='failed');
  const keepIds=new Set(terminal.slice(-200).map(j=>j.id));
  const archive=[];
  for(let i=this.jobs.length-1;i>=0;i--){
   const job=this.jobs[i];
   const isTerminal=job.status==='complete'||job.status==='cancelled'||job.status==='failed';
   if(isTerminal&&!keepIds.has(job.id)){archive.unshift(job);this.jobs.splice(i,1);continue;}
   if(isTerminal&&job.status!=='failed'){
    for(const key of Object.keys(job))if(!['id','status','spec','created','progress','message','finished'].includes(key))delete job[key];
    continue;
   }
   if(Array.isArray(job.tunnel)&&job.tunnel.length>20)job.tunnel=job.tunnel.slice(-20); // enough to climb the recent shaft
  }
  if(archive.length)fs.appendFileSync(path.join(this.root,'data/jobs-archive.jsonl'),archive.map(j=>JSON.stringify(j)).join('\n')+'\n');
  const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.jobs));
  // Windows: the API's concurrent reads hold jobs.json open and renameSync can EPERM -
  // retry, then fall back to a direct (non-atomic) write rather than crash the process.
  let replaced=false;
  for(let i=0;i<4&&!replaced;i++){try{fs.renameSync(tmp,this.file);replaced=true;}catch{}}
  if(!replaced){try{fs.writeFileSync(this.file,JSON.stringify(this.jobs));replaced=true;}catch{}}
 }
 log(message){this.events.unshift({time:new Date().toISOString(),message});this.events=this.events.slice(0,100);this.emit('event',message);}
 state(){const b=this.bot;return {connected:this.ready,connecting:!!b&&!this.ready,server:this.config.server,position:b?.entity?.position,health:b?.health,food:b?.food,inventory:b?.inventory?.items().map(i=>({name:i.name,count:i.count}))||[],jobs:this.jobs.slice(-100).reverse(),events:this.events,model:this.config.model,reflexes:this.reflexEnabled,busy:this.busy,reflexBusy:this.reflexBusy,autopilot:this.autopilot.status(),runner:this.taskRunner?this.taskRunner.status():null};}
 setReflexes(enabled){this.reflexEnabled=!!enabled;this.log(enabled?'Reflexes enabled':'Reflexes disabled');}
 // Idle-time armour upkeep, kept from the retired reflex loop (COMBAT_SPEC 7f armour gates).
 autoArmour(){
  const b=this.bot;
  if(!b||this.armourBusy)return;
  const TIER={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
  const SLOTS={head:[5,'helmet','head'],chest:[6,'chestplate','torso'],legs:[7,'leggings','legs'],feet:[8,'boots','feet']};
  for(const slot of Object.keys(SLOTS)){
   const [index,suffix,destination]=SLOTS[slot],current=b.inventory.slots[index];
   let best=current?{rank:TIER[current.name.split('_')[0]]||0,item:current,name:current.name}:null;
   for(const i of b.inventory.items()){
    if(!i.name.endsWith('_'+suffix))continue;
    const rank=TIER[i.name.split('_')[0]]||0;
    if(!best||rank>best.rank)best={rank,item:i,name:i.name};
   }
   if(best&&best.item!==current){
    this.armourBusy=true;
    b.equip(best.item,destination).then(()=>this.log('Chains: equipped '+best.name)).catch(()=>{}).finally(()=>{this.armourBusy=false;});
    setTimeout(()=>{this.armourBusy=false;},10000).unref();
    return;
   }
  }
 }
 observe(){
  const running=this.jobs.find(j=>['running','queued'].includes(j.status));
  const summary={connected:this.ready,job:running?{type:running.spec.type,status:running.status,progress:running.progress,message:running.message}:null,autopilot:this.autopilot.status(),
   events:this.events.slice(0,10).map(e=>({time:e.time.slice(11,19),message:e.message.slice(0,80)}))};
  return this.ready&&this.bot?{...summary,...survey(this.bot)}:summary;
 }
 connect(){
  if(this.bot)return;
  const bot=this.bot=mineflayer.createBot({...this.config.server,hideErrors:true});
  installMovementFix(bot);installWeatherFix(bot);
  bot.loadPlugin(pathfinder);bot.loadPlugin(toolPackage.plugin);
  bot.once('spawn',()=>{this.ready=true;const movement=this.movements=this.normalMovements(bot);bot.pathfinder.setMovements(movement);bot.pathfinder.searchRadius=128;// in blocks: bounds searches for unreachable goals; legit paths may still cost up to goal distance + 128
  if(!this.trackersTimer){ // tracker refresh + preemption resume + idle armour, port of the reflex cadence
   this.trackersTimer=setInterval(()=>{
    // Preemption resume first and in its own guard: a chain that yielded must hand control
    // back to the paused job immediately, whatever the trackers are doing.
    try{
     if(this.taskRunner.status().task===null&&!this.userStopped&&!this.deathResume){
      for(const j of this.jobs)if(j.status==='paused'&&/^(Preempted by|Job interrupted|Reflex:)/.test(String(j.message))){this.log('Reflex: resumed the '+j.spec.type+' job');this.resume(j.id);}
      // A job queued behind a tree that has now ended: pump is event-driven (submit/finish),
      // so without this re-pump it would starve until the next submit.
      if(this.jobs.some(j=>j.status==='queued'))this.pump();
     }
    }catch{}
    try{
     const b=this.bot;if(!b)return;
     this.trackersRaw.blocks.tick(b);this.trackersRaw.storage.onTick(b);
     // Legit force field (AltoClef MobDefenseChain.doForceField port): swing at hostiles
     // already within reach while jobs run - research 3. Gated on reflexes + not eating.
     if(this.reflexEnabled)try{forceFieldTick(b,this);}catch{}
    }catch{}
    try{if(!this.jobs.some(j=>['running','queued'].includes(j.status)))this.autoArmour();}catch{}
   },250);
   if(this.trackersTimer.unref)this.trackersTimer.unref();
  }
  this.taskRunner.start();
  if(!this.autopilotTimer)this.autopilotTimer=setInterval(()=>{try{this.autopilot.tick();}catch{}},1000);this.log('Connected to Minecraft');this.pump();});
  // Servers send air metadata only when it changes; mineflayer never sees the initial value, which is always full at spawn.
  bot.on('spawn',()=>{bot.oxygenLevel=20;});
  // Closing a container copies ITS copy of the player slots back over bot.inventory
  // (mineflayer copyInventory). Anything that changed the real inventory while the window
  // was open and was not echoed into that window (console /clear, a death, a plugin) is
  // then resurrected client-side as a ghost: soak 20261014-0239 normal2 closed a furnace
  // after the run's /clear and the ladder saw a stone kit it did not have for 4.5 minutes.
  // One no-op click with an impossible stateId makes the server send window 0 in full.
  bot.on('windowClose',()=>{setTimeout(()=>{if(bot._syncWindow&&bot.inventory&&!bot.currentWindow)bot._syncWindow(bot.inventory).catch(()=>{});},150);});
  // Every server-side position packet is a teleport the client must confirm (an operator
  // tp, a "moved too quickly/wrongly" snap-back, or a silent collision correction). Count
  // and log them, rate limited, so a client/server desync shows up next to its symptoms.
  this.teleports=0;let lastTeleportLog=0;
  bot.on('forcedMove',()=>{
   this.teleports++;const now=Date.now();
   if(now-lastTeleportLog>2000){lastTeleportLog=now;const p=bot.entity.position;this.log('Server set position to '+p.floored()+' (teleport #'+this.teleports+')');}
  });
  bot.on('error',e=>this.log('Connection error: '+e.message));
  bot.on('kicked',reason=>this.log('Server rejected connection: '+JSON.stringify(reason)));
  bot.on('end',()=>{if(this.bot!==bot)return;this.stop('Connection ended');this.bot=null;this.ready=false;this.log('Disconnected. Connect again to retry.');});
  bot.on('death',()=>{
  const at=bot.entity?.position;
  const killer=at?Object.values(bot.entities).filter(e=>e!==bot.entity&&e.type==='hostile'&&e.position&&e.position.distanceTo(at)<=8).sort((x,y)=>x.position.distanceTo(at)-y.position.distanceTo(at))[0]:null;
  this.log('Bot died at '+(at?Math.floor(at.x)+', '+Math.floor(at.y)+', '+Math.floor(at.z):'an unknown position')+(killer?' (killed by '+killer.name+')':''));
  this.lastDeath={pos:at?{x:at.x,y:at.y,z:at.z}:null,t:Date.now()};
  this.deathResume=true;
  this.stop('Bot died; inspect the world before resuming');
  setTimeout(()=>{try{bot.respawn();}catch{}},500);
 });
  bot.on('health',()=>{if(this.busy&&!this.survivalJob&&(bot.health<this.config.limits.minHealth||bot.food<this.config.limits.minFood))this.stop('Health or food is low');});
  bot.on('messagestr',message=>this.log(message.slice(0,500)));
 }
 disconnect(){this.stop('Disconnected by user');this.bot?.quit();this.bot=null;this.ready=false;}
 submit(input){const spec=jobSchema.parse(input);const job={id:crypto.randomUUID(),spec,status:'queued',created:new Date().toISOString(),progress:0,message:'Waiting'};this.jobs.push(job);this.userStopped=false;this.deathResume=false;this.save();this.pump();return job;}
 stop(message='Stopped by user',source='user'){
  if(source!=='reflex')this.userStopped=true;
  this.epoch++;
  // pathfinder.stop() leaves a sticky flag that rejects the next goto; setGoal(null) clears it.
  // The control taker cleans up: whoever stops the job owns the pathfinder reset, so the
  // interrupted job's finally blocks (token!==epoch now) can skip theirs entirely. After the
  // socket ends the pathfinder throws on these calls, so guard them: a disconnect must never
  // take the dashboard process down.
  try{this.bot?.pathfinder.stop();this.bot?.pathfinder.setGoal?.(null);if(this.movements)this.bot?.pathfinder.setMovements?.(this.movements);this.bot?.clearControlStates();try{this.bot?.stopDigging()?.catch?.(()=>{});}catch{}}catch{}
  this.interruptReject?.(new Error(message));this.interruptReject=null;
  for(const job of this.jobs)if(['running','queued'].includes(job.status)){job.status='paused';job.message=message;this.log('Pause trace: '+job.spec.type+' -> '+message);}
  this.save();this.log(message);
 }
 resume(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');if(!['paused','failed'].includes(job.status))throw Error('Only paused or failed jobs can resume');
  // Death-recovery: a job paused by death returns to its work site only when the death is
  // close and fresh (dropped items despawn after 5 minutes); otherwise it is cancelled and
  // the ladder restarts near the respawn point.
  if(String(job.message).startsWith('Bot died')&&this.lastDeath){
   const fresh=Date.now()-this.lastDeath.t<5*60*1000;
   const p=this.lastDeath.pos;
   const near=!p||!this.bot||Math.hypot(this.bot.entity.position.x-p.x,this.bot.entity.position.z-p.z)<64;
   if(!fresh||!near){job.status='cancelled';job.message='Drop site far or stale; the ladder restarts near spawn';this.save();this.pump();return job;}
  }
  job.status='queued';job.message='Resuming';this.userStopped=false;this.deathResume=false;this.save();this.pump();return job;}
 cancel(id){const job=this.jobs.find(j=>j.id===id);if(!job)throw Error('Unknown job');if(job.status==='running')this.stop('Current job cancelled');job.status='cancelled';this.save();}
 check(token){if(token!==this.epoch){this.log('Check: token '+token+' epoch '+this.epoch+' busy '+this.busy);throw Error('Job interrupted');}if(!this.ready)throw Error('Job interrupted');if(Date.now()>this.deadline)throw Error('Time limit reached; resume after inspecting progress');if(!this.survivalJob&&(this.bot.health<this.config.limits.minHealth||this.bot.food<this.config.limits.minFood))throw Error('Health or food is low');}
 async pump(){
  if(this.busy||this.reflexBusy||!this.ready)return;
  // A live task tree owns the bot (survival chain): jobs wait behind it, exactly like the
  // retired reflex loop's reflexBusy gate. Starting a job under the tree's epoch would let
  // its navigation and cleanups fight the tree for the same controls (the A4 lava lesson:
  // the escape lost its controls to a queued gather's walk and the bot burned).
  if(this.taskRunner&&this.taskRunner.status().task)return;
  const job=this.jobs.find(j=>j.status==='queued');if(!job)return;
  this.busy=true;job.status='running';job.message='Working';this.save();const token=this.epoch;
  const minutes=['sleep','shelter'].includes(job.spec.type)?this.config.limits.nightMinutes??13:this.config.limits.jobMinutes;
  this.deadline=Date.now()+minutes*60000;this.survivalJob=['eat','equip','smelt','sleep','shelter','fight'].includes(job.spec.type);
  const watchdog=setInterval(()=>{if(Date.now()>this.deadline)this.stop('Job time limit reached');},1000);
  // runSettled resolves only once run(job) has FULLY unwound (every inner finally). A stop
  // resolves the race below while run is still unwinding; reflexes await runSettled before
  // moving, and every job-side cleanup checks the epoch so a late unwind cannot cancel them.
  const interrupted=new Promise((_,reject)=>{this.interruptReject=reject;});
  const run=this.run(job,token);this.runSettled=run.catch(()=>{});
  try{await Promise.race([run,interrupted]);this.check(token);job.status='complete';
   // A combatTask summary ('Fought: ... hits=N crits=M') rides the job message - keep it.
   if(!/^Fought:/.test(job.message))job.message='Completed and verified';
   else job.message='Completed and verified; '+job.message;
   this.log(`Completed ${job.spec.type}`);}
  catch(e){if(job.status==='running'){job.status='failed';job.message=e.message;for(const next of this.jobs)if(next.status==='queued'){next.status='paused';next.message='Paused because an earlier job failed';}}this.log('Job: '+e.message);if(e.stack)console.error(e.stack);}
  finally{this.interruptReject=null;clearInterval(watchdog);this.survivalJob=false;if(token===this.epoch)this.bot?.clearControlStates();this.save();this.busy=false;setTimeout(()=>this.pump(),100);}
 }
 update(job,progress,message){job.progress=progress;job.message=message;this.save();}
 count(name){return this.bot.inventory.items().filter(i=>i.name===name).reduce((a,i)=>a+i.count,0);}
 async navigate(goal,token,seconds=45){
  this.check(token);const bot=this.bot;
  const reached=()=>bot.entity?.onGround&&goal.isEnd(bot.entity.position.floored());
  if(reached())return;
  try{this.applyMobAvoidance(bot.pathfinder.movements,bot);}catch{}
  let timer,monitor,last='none';
  const onPath=r=>{last=`${r.status}, ${r.path.length} steps, ${r.visitedNodes} nodes`;};bot.on('path_update',onPath);
  let track=trackProgress(bot.entity.position,Date.now());
  try{await Promise.race([bot.pathfinder.goto(goal),new Promise((resolve,reject)=>{monitor=setInterval(()=>{
   if(reached()){resolve();return;}
   // A dig holds the bot still on purpose; a path that never moves and never digs is the silent hang.
   if(this.surfaceFloor!=null&&bot.entity.position.y<this.surfaceFloor){reject(new Error('Navigation left the surface at '+bot.entity.position.floored()));return;}
   if(this.surfaceCeil!=null&&bot.entity.position.y>this.surfaceCeil){reject(new Error('Navigation climbed above the graze cap at '+bot.entity.position.floored()));return;}
   if(bot.targetDigBlock){track=trackProgress(bot.entity.position,Date.now());return;}
   track=trackProgress(bot.entity.position,Date.now(),track);
   if(track.stuck)reject(new Error('Navigation made no progress at '+bot.entity.position.floored()+' (last path: '+last+')'));
  },250);}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Navigation timed out at ${bot.entity.position.floored()} (onGround ${bot.entity.onGround}, last path: ${last})`)),seconds*1000);})]);this.check(token);}
  finally{bot.off('path_update',onPath);clearTimeout(timer);clearInterval(monitor);if(token===this.epoch){bot.pathfinder.setGoal(null);bot.clearControlStates();}}
 }
 async walk(target,token,range=2,seconds=45){await this.navigate(new goals.GoalNear(target.x,target.y,target.z,range),token,seconds);}
 // Research 4: pathfinder mob avoidance while unarmed or low - creepers are hard-avoided
 // (entitiesToAvoid), and an exclusionAreasStep hook adds path cost inside ~8 blocks of any
 // known hostile so routes bend around mobs. Feature-checked: older pathfinder builds
 // silently skip. Refreshed on each build (replans re-read the movements object).
 applyMobAvoidance(movement,bot){
  try{
   if(!movement||!bot)return movement;
   const armed=(this.count('_sword')+this.count('_axe'))>0;
   const active=avoidanceActive(armed,bot.health);
   if(movement.entitiesToAvoid&&typeof movement.entitiesToAvoid.add==='function'){
    if(active)movement.entitiesToAvoid.add('creeper');
    else movement.entitiesToAvoid.delete('creeper');
   }
   if(Array.isArray(movement.exclusionAreasStep)){
    movement.exclusionAreasStep=movement.exclusionAreasStep.filter(fn=>fn!==movement._mobAvoidHook);
    if(active){
     const hook=block=>{
      const hostiles=Object.values(bot.entities||{}).filter(e=>e&&e.type==='hostile'&&e.position&&e.isValid!==false&&!NEUTRAL.has(e.name));
      return stepCost(block,hostiles,bot.entity&&bot.entity.position);
     };
     movement._mobAvoidHook=hook;
     movement.exclusionAreasStep.push(hook);
    }else movement._mobAvoidHook=null;
   }
  }catch{}
  return movement;
 }
 // Blocks the pathfinder treats as passable but that hurt or trap a walking bot. Powder snow
 // is the one that killed soak normal2 (2026-10-14, "froze to death" on a snowy slope).
 avoidHazards(movement,bot){
  if(!movement.blocksToAvoid||typeof movement.blocksToAvoid.add!=='function')return movement;
  for(const name of ['powder_snow','sweet_berry_bush','wither_rose','cactus','magma_block','campfire','soul_campfire','pointed_dripstone']){
   const id=bot.registry.blocksByName[name]?.id;if(id!==undefined)movement.blocksToAvoid.add(id);
  }
  return movement;
 }
 normalMovements(bot){
  const movement=new Movements(bot);movement.canDig=false;movement.allow1by1towers=false;movement.allowParkour=false;movement.allowSprinting=false;movement.canOpenDoors=false;movement.maxDropDown=3;
  this.applyMobAvoidance(movement,bot);this.avoidHazards(movement,bot);
  return guardDiagonals(movement);
 }
 exploreMovements(){
  if(this.exploreMoves)return this.exploreMoves;
  const b=this.bot,m=new Movements(b);
  m.canDig=true;m.allowSprinting=true;m.allow1by1towers=true;m.allowParkour=false;m.canOpenDoors=false;m.maxDropDown=3;
  this.avoidHazards(m,b);
  m.scafoldingBlocks=[b.registry.blocksByName.dirt.id,b.registry.blocksByName.cobblestone.id,b.registry.blocksByName.netherrack?.id].filter(id=>id!==undefined);
  const natural=new Set([...NATURAL_DIG].map(n=>b.registry.blocksByName[n]?.id).filter(id=>id!==undefined));
  // Leaves are natural and passable by digging; logs stay protected because they may be part of builds.
  for(const block of Object.values(b.registry.blocksByName))if(block.name.endsWith('_leaves'))natural.add(block.id);
  const base=m.safeToBreak.bind(m);
  m.safeToBreak=block=>{
   if(!natural.has(block.type))return false;
   // The library already refuses digs beside or above fluids; also refuse digging above a fluid.
   const below=b.blockAt(block.position.offset(0,-1,0));
   if(below&&(below.name==='lava'||below.name==='water'))return false;
   return base(block);
  };
  const down=m.getMoveDown.bind(m);
  m.getMoveDown=(node,neighbors)=>{
   const floor=m.getBlock(node,0,-1,0),before=neighbors.length;
   down(node,neighbors);
   if(!floor)return;
   for(let i=neighbors.length-1;i>=before;i--){const move=neighbors[i];if(move.toBreak.some(p=>p.x===floor.position.x&&p.y===floor.position.y&&p.z===floor.position.z))neighbors.splice(i,1);}
  };
  return this.exploreMoves=guardDiagonals(m);
 }
 async exploreLeg(token,spec){
  const b=this.bot,dirs={north:[0,-1],south:[0,1],east:[1,0],west:[-1,0]};
  const direction=dirs[spec.direction]?spec.direction:['north','south','east','west'][Math.floor(Math.random()*4)];
  const start=b.entity.position.floored(),goalX=start.x+dirs[direction][0]*spec.distance,goalZ=start.z+dirs[direction][1]*spec.distance;
  const previous=this.movements;b.pathfinder.setMovements(this.exploreMovements());
  let watch;const threatened=new Promise((_,reject)=>{watch=setInterval(()=>{
   try{this.check(token);}catch(e){clearInterval(watch);reject(e);return;}
   // Neutral mobs (endermen trail the bot for minutes) must not abort every search; the
   // reflexes answer them when they actually attack or crowd the bot.
   const threat=Object.values(b.entities).find(e=>e&&e.type==='hostile'&&e.position&&e.position.distanceTo(b.entity.position)<6&&!NEUTRAL.has(e.name)&&canSeeTarget(b,e));
   if(threat){clearInterval(watch);reject(new Error('Hostile '+(threat.name||'mob')+' is close; explore stopped early'));}
  },250);});
  try{await Promise.race([this.navigate(new goals.GoalXZ(goalX,goalZ),token,spec.seconds??60+spec.distance*2),threatened]);}
  finally{clearInterval(watch);if(token===this.epoch){try{b.pathfinder.setGoal(null);b.pathfinder.stop();}catch{}b.clearControlStates();b.pathfinder.setMovements(previous);}}
  this.check(token);
  const end=b.entity.position.floored();
  // 60% of the requested distance still counts: the food step scans in 32-block legs and
  // obstacles routinely stop a leg at 24+ blocks - the old distance-1 gate failed the leg
  // (and the step's failure budget) for a perfectly useful scan.
  if(Math.hypot(end.x-start.x,end.z-start.z)<Math.min(spec.distance-1,spec.distance*0.6))throw Error('Explore stopped early at '+end);
  return direction;
 }
 async explore(job,token){
  const b=this.bot;
  if(!job.direction)job.direction=job.spec.direction??'random';
  if(job.direction==='random')job.direction=['north','south','east','west'][Math.floor(Math.random()*4)];
  this.save();
  // surface (wood step): an explore leg honours the same stand-Y cap the gather navigates
  // under - the soak legs walked the bot off the grove and into the ravine while the step
  // was only blocked, not finished (surfaceY comes from the ladder's gather start).
  if(job.spec.surface){
   if(job.surfaceY===undefined)job.surfaceY=job.spec.surfaceY!=null?job.spec.surfaceY:Math.floor(b.entity.position.y);
   this.surfaceFloor=job.surfaceY-4;
  }
  // Food-step graze: abort before a 64-block GoalXZ walks up a peak (soak 5 normal1
  // fell from y=173 at 07:21; soak 4 hard2 fell at y=82). Floor still optional.
  if(job.spec.surfaceCeiling!=null)this.surfaceCeil=job.spec.surfaceCeiling;
  try{await this.exploreLeg(token,{direction:job.direction,distance:job.spec.distance});}
  finally{if(job.spec.surface)this.surfaceFloor=null;if(job.spec.surfaceCeiling!=null)this.surfaceCeil=null;}
 }
 async place(job,token){
  const b=this.bot,s=job.spec,target=pos(s.position);
  if(!b.registry.blocksByName[s.block])throw Error('Unknown block '+s.block);
  if(!b.registry.itemsByName[s.block])throw Error('Unknown building block '+s.block);
  await this.walk(target,token,3);
  const existing=b.blockAt(target);
  if(existing?.name===s.block)return;
  if(!empty(existing))throw Error('Cannot place at '+target+': occupied by '+(existing?.name||'unloaded block'));
  const avoid=block=>block.position.x===target.x&&block.position.z===target.z?100:0;
  this.movements.exclusionAreasStep.push(avoid);b.pathfinder.setMovements(this.movements);
  try{
   let support=null,face=null;
   for(const direction of [new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)]){const neighbor=b.blockAt(target.minus(direction));if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}}
   if(!support)throw Error('No support for block at '+target);
   const standing=[];
   for(const [dx,dz] of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[2,-2],[-2,2],[0,-4],[0,4],[-4,0],[4,0]])for(let dy=0;dy>=-3;dy--){const point=target.offset(dx,dy,dz);if(empty(b.blockAt(point))&&empty(b.blockAt(point.offset(0,1,0)))&&b.blockAt(point.offset(0,-1,0))?.boundingBox==='block')standing.push(point);}
   standing.sort((a,c)=>a.distanceTo(b.entity.position)-c.distanceTo(b.entity.position));
   let approached=false,last='';
   for(const point of standing){try{await this.navigate(new goals.GoalBlock(point.x,point.y,point.z),token,15);if(b.entity.position.offset(0,1.62,0).distanceTo(support.position.offset(.5,.5,.5))>4.4){last='too far from support after navigating';continue;}approached=true;break;}catch(error){this.check(token);last=(error.name&&error.name!=='Error'?error.name+': ':'')+error.message;}}
   if(!approached){this.log('Place: standing candidates were '+JSON.stringify(standing.map(p=>p.floored()))+' and '+last);throw Error('No safe reachable standing spot beside '+target+': '+last);}
   const item=b.inventory.items().find(i=>i.name===s.block);if(!item)throw Error('Need '+s.block+' in the inventory');
   await b.equip(item,'hand');this.check(token);await this.placeBlocks(support,face,target,s.block,token);
  }finally{this.movements.exclusionAreasStep=this.movements.exclusionAreasStep.filter(fn=>fn!==avoid);if(token===this.epoch)b.pathfinder.setMovements(this.movements);}
 }
 async eat(job,token){
  const b=this.bot;
  this.check(token);
  if(b.food>=20)throw Error('Food is already full');
  const unsafe=new Set(['rotten_flesh','spider_eye','poisonous_potato','pufferfish','chicken']);
  const foods=b.inventory.items().map(i=>({item:i,food:b.registry.foodsByName[i.name]})).filter(f=>f.food&&!unsafe.has(f.item.name));
  if(!foods.length)throw Error('No edible food in the inventory');
  foods.sort((x,y)=>y.food.foodPoints-x.food.foodPoints);
  await b.equip(foods[0].item,'hand');
  const before=b.food;
  this.eating=true;
  try{await b.consume();}finally{this.eating=false;}
  await sleep(300);
  if(b.food<=before)throw Error('Eating did not increase food');
 }
 async equip(job,token){
  const b=this.bot,tier={wooden:1,golden:2,stone:3,iron:4,diamond:5,netherite:6},kind={pickaxe:4,axe:3,shovel:2,sword:1},plate={leather:1,golden:2,chainmail:3,iron:4,diamond:5,netherite:6};
  let tool=null;
  for(const i of b.inventory.items()){
   const m=/^(wooden|golden|stone|iron|diamond|netherite)_(pickaxe|axe|shovel|sword)$/.exec(i.name);
   if(m&&(!tool||tier[m[1]]*10+kind[m[2]]>tool.rank))tool={rank:tier[m[1]]*10+kind[m[2]],item:i,name:i.name};
  }
  if(tool){await b.equip(tool.item,'hand');this.check(token);}
  const slots={head:[5,'helmet','head'],chest:[6,'chestplate','torso'],legs:[7,'leggings','legs'],feet:[8,'boots','feet']},expected={};
  for(const slot of Object.keys(slots)){
   const [index,suffix,destination]=slots[slot],current=b.inventory.slots[index];
   let best=current?{rank:plate[current.name.split('_')[0]]||0,item:current,name:current.name}:null;
   for(const i of b.inventory.items()){
    if(!i.name.endsWith('_'+suffix))continue;
    const rank=plate[i.name.split('_')[0]]||0;
    if(!best||rank>best.rank)best={rank,item:i,name:i.name};
   }
   if(best&&best.item!==current){await b.equip(best.item,destination);this.check(token);}
   expected[index]=best?best.name:null;
  }
  if(tool&&b.heldItem?.name!==tool.name)throw Error('Failed to equip '+tool.name);
  for(const [index,name] of Object.entries(expected))if((b.inventory.slots[index]?.name||null)!==name)throw Error('Failed to equip the best armour for slot '+index);
  const shield=b.inventory.items().find(i=>i.name==='shield');
  if(shield){await b.equip(shield,'off-hand');this.check(token);if(b.inventory.slots[45]?.name!=='shield')throw Error('Failed to equip the shield');}
 }
 async collect(job,token){
  const b=this.bot,radius=job.spec.radius??16;
  const before=b.inventory.items().reduce((a,i)=>a+i.count,0);
  const targets=Object.values(b.entities).filter(e=>e.name==='item'&&e.position&&e.position.distanceTo(b.entity.position)<=radius);
  this.update(job,0,`Collecting ${targets.length} drops`);
  for(const drop of targets){
   for(let tries=0;tries<3&&Object.values(b.entities).includes(drop);tries++){
    this.check(token);
    // Range 1, not 0: the item drifts on the ground and an exact-cell goal fails the leg
    // without ever entering the pickup radius (flaky suite failure at (-2,-60,6)).
    try{await this.navigate(new goals.GoalNear(drop.position.x,drop.position.y,drop.position.z,1),token,10);}catch(e){this.check(token);}
    await sleep(400);
   }
   if(Object.values(b.entities).includes(drop))throw Error('Could not reach a dropped item at '+drop.position.floored());
  }
  if(targets.length&&b.inventory.items().reduce((a,i)=>a+i.count,0)-before<targets.length)throw Error('Drops were seen but not picked up');
 }
 async sweepDrops(token){
  const b=this.bot,deadline=Date.now()+10000;
  while(Date.now()<deadline){
   this.check(token);
   const drop=Object.values(b.entities).filter(e=>e.name==='item'&&e.position&&e.position.distanceTo(b.entity.position)<=8).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!drop)return;
   try{await this.navigate(new goals.GoalNear(drop.position.x,drop.position.y,drop.position.z,0),token,8);}catch(e){this.check(token);}
   await sleep(400);
  }
 }
 async fuelPlan(count,preferred){
  const b=this.bot;
  const value=n=>n==='coal'||n==='charcoal'?8:(n.endsWith('_planks')||n.endsWith('_log')?1.5:0);
  if(preferred&&!value(preferred))throw Error(preferred+' is not usable fuel');
  const names=preferred?[preferred]:['coal','charcoal',...b.inventory.items().filter(i=>i.name.endsWith('_planks')).map(i=>i.name),...b.inventory.items().filter(i=>i.name.endsWith('_log')).map(i=>i.name)];
  const seen=new Set();let remaining=count;
  for(const n of names){
   if(seen.has(n))continue;seen.add(n);
   const capacity=value(n);if(!capacity)continue;
   const have=this.count(n);if(have<1)continue;
   const use=Math.min(have,Math.ceil(remaining/capacity));
   remaining-=use*capacity;
   if(remaining<=0)return {id:b.registry.itemsByName[n].id,count:use};
  }
  throw Error('Not enough fuel to smelt '+count+' items; needs coal, charcoal, planks or logs');
 }
 async smelt(job,token){
  const b=this.bot,s=job.spec;
  const input=b.registry.itemsByName[s.item];if(!input)throw Error('Unknown item '+s.item);
  const outputName=SMELTING[s.item]||(s.item.endsWith('_log')?'charcoal':null);
  if(!outputName)throw Error('Unknown smelting output for '+s.item);
  const output=b.registry.itemsByName[outputName];
  if(!output)throw Error('Unknown output item '+outputName);
  const fuel=await this.fuelPlan(s.count,s.fuel);
  const before=this.count(outputName);
  let block=null,placedAt=null;
  try{
   block=b.findBlock({matching:b.registry.blocksByName.furnace.id,maxDistance:16});
   if(!block){
    if(!this.count('furnace')){
     const provisioned=await this.ensureTable(token);
     placedAt=provisioned.created;
     const recipe=b.recipesFor(b.registry.itemsByName.furnace.id,null,1,provisioned.block)[0];
     if(!recipe)throw Error('Missing ingredients: need a furnace, or 8 cobblestone to make one');
     const furnaces=this.count('furnace');
     await craftConfirmed(b,recipe,provisioned.block,()=>this.check(token));
     if(this.count('furnace')<=furnaces)throw Error('Crafting a furnace produced no confirmed item');
    }
    block=b.blockAt(await this.placeBlockNear(token,'furnace'));
   }
   await this.walk(block.position,token,2);
   this.check(token);
   const furnace=await b.openFurnace(block);
   try{
    await furnace.putInput(input.id,null,s.count);
    await furnace.putFuel(fuel.id,null,fuel.count);
    const deadline=Date.now()+s.count*10000+30000;
    while((furnace.outputItem()?.count||0)<s.count){
     if(Date.now()>deadline)throw Error('Smelting timed out waiting for the output');
     await sleep(1000);this.check(token);
    }
    await furnace.takeOutput();
    await sleep(300);
   }finally{try{await b.closeWindow(furnace);}catch{}}
  }finally{
   if(placedAt){try{await this.pickUp(placedAt,'crafting_table',token);}catch(e){this.log('Left the crafting table at '+placedAt);}}
  }
  if(this.count(outputName)<before+s.count)throw Error(`Smelting did not produce ${s.count} ${outputName}`);
 }
 async sleep(job,token){
  const b=this.bot;
  this.check(token);
  if(b.time.timeOfDay<12541){
   // A survival chain may already have slept this night (dusk preparation): the goal was
   // morning, and early morning (dawn to ~09:00) means the night was handled. Noon-plus
   // submissions are still refused.
   if(b.time.timeOfDay<=1200)return this.update(job,1,'Night already slept through');
   throw Error('It is daytime; sleep is only possible at night');
  }
  let bed=job.spec.position?b.blockAt(pos(job.spec.position)):null;
  if(bed&&!/_bed$/.test(bed.name))throw Error('No bed at that position');
  if(!bed)bed=b.findBlock({matching:Object.values(b.registry.blocksByName).filter(bl=>/_bed$/.test(bl.name)).map(bl=>bl.id),maxDistance:16});
  if(!bed){
   const bedItem=b.inventory.items().find(i=>/_bed$/.test(i.name));
   if(!bedItem)throw Error('No bed nearby and none in the inventory');
   bed=b.blockAt(await this.placeBlockNear(token,bedItem.name));
  }
  await this.walk(bed.position,token,2);
  try{await b.sleep(bed);}catch(e){
   // A survival chain may already have walked the bot into this bed (its own night rule);
   // the job's goal is morning either way, so being in bed already is not a failure.
   if(!b.isSleeping)throw Error('Server refused sleep: '+e.message);
  }
  this.update(job,1,'Sleeping until morning');
  while(b.isSleeping){await sleep(1000);this.check(token);}
  if(b.time.timeOfDay>=12541&&b.time.timeOfDay<=23458)throw Error('Woke up before morning');
 }
 async retreatSprint(token,target,seconds=3){
  // Plain sprint away from the threat; no pathfinder goal means nothing left running can
  // fight the flee for control. A reflex or user stop that moved the epoch owns the
  // pathfinder now: leave its navigation alone and just return.
  const b=this.bot;
  if(token!==this.epoch)return;
  b.pathfinder.stop();b.pathfinder.setGoal(null);b.clearControlStates();
  await sleep(60);
  const dir=target?b.entity.position.minus(target.position):new Vec3(1,0,0);
  const away=Math.abs(dir.x)+Math.abs(dir.z)>0?new Vec3(dir.x,0,dir.z).normalize():new Vec3(1,0,0);
  try{await b.look(Math.atan2(-away.x,-away.z),0,false);}catch{}
  b.setControlState('sprint',true);b.setControlState('forward',true);
  const fleeEnd=Date.now()+seconds*1000;
  try{while(Date.now()<fleeEnd&&b.health>0){await sleep(100);this.check(token);}}finally{b.clearControlStates();}
 }
 // Run one combat step through the task tree: the FightTask is returned as a child of the
 // UserTaskChain, whose runner owns the pathfinder and controls (the single-owner rule).
 // The bridge enforces the JOB contract on the side (token, deadline, health < 8 retreat)
 // while the tree drives the CombatController one step per tick. Preemption works like any
 // reflex: a survival chain pauses the job through worker.stop, the runner stops the tree
 // (FightTask.onStop lowers the shield and clears the controls), and the cadence bridge
 // resumes the job when the chain yields.
 async combatTask(job,token,mk,{timeoutMs=0,timeoutMessage='Fight timed out'}={}){
  const b=this.bot;
  const chain=this.userChain||((this.taskRunner&&this.taskRunner.chains||[]).find(c=>c.name==='User Tasks'));
  if(!chain||typeof chain.runTask!=='function')throw Error('User task chain unavailable');
  if(chain.root)try{chain.cancel(b);}catch{} // a superseded task: its stale bridge settles as cancelled
  const task=mk();
  this.update(job,job.progress||0,'Fighting via the task tree');
  const settled=new Promise((resolve,reject)=>{
   chain.runTask(task,result=>{result&&result.cancelled?reject(new Error('Combat task interrupted')):resolve(result);});
  });
  const deadline=timeoutMs>0?Date.now()+timeoutMs:0;
  let timer=null;
  const guard=new Promise((_,reject)=>{
   timer=setInterval(()=>{
    try{
     if(deadline&&Date.now()>deadline){if(timer)clearInterval(timer);timer=null;const err=Error(timeoutMessage);err.code='COMBAT_TIMEOUT';reject(err);return;}
     this.check(token);
    }catch(e){if(timer){clearInterval(timer);timer=null;}reject(e);return;}
    if(b.health<8){if(timer)clearInterval(timer);timer=null;const err=Error('low health');err.code='HEALTH_RETREAT';reject(err);}
   },250);
  });
  if(timer&&timer.unref)timer.unref();
  try{
   await Promise.race([settled,guard]);
  }catch(e){
   if(e.code==='HEALTH_RETREAT'){
    await this.retreatSprint(token,task.controller&&task.controller.target||null);
    throw Error('Health below 8; retreated from '+(task.controller&&task.controller.target&&task.controller.target.name||'the fight'));
   }
   throw e;
  }finally{
   clearInterval(timer);
   // Settled paths leave the tree in place (SingleTaskChain pops a finished root on the
   // runner's next tick); on OUR failure paths nothing owns the fight any more - stop it.
   try{if(chain.root===task)chain.cancel(b);}catch{}
  }
  this.check(token);
  const ctl=task.controller;
  if(ctl){ // the fight summary rides on the job message: event-buffer flushes cannot lose it
   const st=ctl.stats,t=ctl.target;
   this.update(job,100,'Fought: '+(t&&t.name||'no target')+' tactic='+(ctl.tactic&&ctl.tactic.style||'none')
    +' hits='+st.hits+' crits='+st.crits+' sweeps='+st.sweeps+' shots='+st.shots
    +' damage taken='+Math.round(st.damageTaken*10)/10);
  }
  return ctl?ctl.stats:null;
 }
 async fight(job,token){
  const b=this.bot,s=job.spec;
  const tier={wooden:1,golden:2,stone:3,iron:4,diamond:5,netherite:6},kind={sword:4,axe:3,pickaxe:2,shovel:1};
  const weaponOf=name=>{const m=/^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe|pickaxe|shovel)$/.exec(name);return m?tier[m[1]]*10+kind[m[2]]:null;};
  let weapon=null;
  for(const i of b.inventory.items()){
   const rank=weaponOf(i.name);
   if(rank&&(!weapon||rank>weapon.rank))weapon={rank,item:i,name:i.name};
  }
  const shield=b.inventory.items().find(i=>i.name==='shield');
  if(shield){const p=b.equip(shield,'off-hand');p&&p.catch&&p.catch(()=>{});}
  this.check(token);
  // A named passive entity is a HUNT: only that entity type is targeted and hostiles are
  // left to the threat reflex. Without a name (or for a named hostile) it is a FIGHT and
  // COMBAT_SPEC 7f applies: a real weapon is required - the bot never swings holding a
  // block, food or its fist - and an unarmed fight retreats and hands control to the
  // threat policy (flee / shelter / get armed).
  const namedHostile=s.entity&&b.registry.entitiesByName[s.entity]?.type==='hostile';
  const hostileTargets=!s.entity||namedHostile;
  if(hostileTargets&&!weapon){
   await this.retreatSprint(token,null);
   throw Error('Unarmed; retreated from the fight - threat policy takes over (flee/shelter/get armed)');
  }
  // Passive hunts scan far (48): the food step sees animals through animalsNearby at 48,
  // so a 16-block engagement window starved the hunt (the ladder saw a cow, the fight job
  // found nothing inside 16 and timed out - M4 food 0/6 in soaks 4-5).
  const huntRange=hostileTargets?16:48;
  const threats=()=>Object.values(b.entities).filter(e=>e!==b.entity&&e.position&&e.position.distanceTo(b.entity.position)<=huntRange&&(hostileTargets?e.type==='hostile':e.name===s.entity)).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position));
  // Every style runs through the runner-owned FightTask now: the legacy in-job attack loop
  // is retired (parity proven - the full integration suite's fight tests and the measured
  // combat acceptance both ran on this path). style 'plain' = full-charge swings without
  // the crit rhythm; auto/melee/bow pick tactics per docs/COMBAT_SPEC.md 7c.
  const style=s.style||'auto';
  try{
   await this.combatTask(job,token,()=>new FightTask({
    move:this.move,
    log:m=>{try{this.log(m);}catch{}},
    opts:{entityFilter:s.entity||null,range:huntRange,forceStyle:style!=='auto'?style:null,
     // A named enderman fight is provoked by definition (7c: never provoked by looking).
     provoked:s.entity==='enderman'||undefined,
     // The ablation harness toggles primitives per fight (tests/combat_ablation.py).
     primitives:s.primitives||undefined}}),
   {timeoutMs:Math.min(s.maxSeconds??30,120)*1000});
  }catch(e){
   if(e.code==='COMBAT_TIMEOUT'){
    const left=threats();
    throw Error('Fight timed out; '+(left[0]&&(left[0].name||'a hostile')||'a hostile')+' is still standing');
   }
   throw e;
  }
  const left=threats();
  if(left.length)throw Error('Fight timed out; '+(left[0].name||'a hostile')+' is still standing');
  // A passive hunt sweeps its own kills: the next collect job queues behind whatever
  // survival tree is still active (soak 7 hard1: the collect sat queued for 150 s while
  // night mobs kept Mob Defense alive and the drops despawned - food stayed 0/6).
  if(!hostileTargets){try{await this.sweepDrops(token);}catch(e){this.check(token);}}
 }
 async shelter(job,token){
  const b=this.bot;
  this.check(token);
  if(b.time.timeOfDay<12000)return;
  const preference=['cobblestone','dirt','cobbled_deepslate','netherrack'];
  let material=preference.map(n=>b.registry.itemsByName[n]?{name:n,count:this.count(n)}:null).find(m=>m&&m.count>=25);
  if(!material){
   // Empty-handed: dig the shelter material out of the ground before nightfall kills the bot.
   this.update(job,0,'Digging dirt for the shelter');
   while(this.count('dirt')<25){
    this.check(token);
    const spot=b.findBlock({matching:[b.registry.blocksByName.dirt.id,b.registry.blocksByName.grass_block?.id].filter(x=>x!==undefined),maxDistance:24});
    if(!spot)throw Error('Need 25 cobblestone or dirt in the inventory to build a shelter, and none is reachable to dig');
    try{
     await this.walk(spot.position,token,2,20);await b.tool.equipForBlock(spot);this.check(token);
     if(!b.canDigBlock(spot))continue;
     if(['lava','water'].includes(b.blockAt(spot.position.plus(new Vec3(0,1,0)))?.name))continue;
     await b.dig(spot);await sleep(400);await this.sweepDrops(token);
    }catch(e){this.check(token);}
   }
   material={name:'dirt',count:this.count('dirt')};
  }
  const origin=b.entity.position.floored(),botCells=[origin,origin.offset(0,1,0)];
  const shell=[];
  for(let dy=0;dy<=2;dy++)for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
   const point=origin.offset(dx,dy,dz);
   if(!botCells.some(c=>c.equals(point)))shell.push(point);
  }
  // The SHELL is recorded, not just this run's placements: a resumed run skips cells that
  // are already filled (by an interrupted earlier attempt), and the cleanup must dig those too.
  if(!job.shell)job.shell=shell.map(p=>({x:p.x,y:p.y,z:p.z}));
  if(!job.placed)job.placed=[];
  for(const point of shell){
   this.check(token);
   if(b.blockAt(point)?.boundingBox==='block')continue;
   let placed=false;
   for(const direction of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
    const neighbor=b.blockAt(point.minus(direction));
    if(neighbor?.boundingBox!=='block')continue;
    const item=b.inventory.items().find(i=>i.name===material.name);
    if(!item)throw Error('Ran out of '+material.name);
    await b.equip(item,'hand');
    try{await b.placeBlock(neighbor,direction);await sleep(120);}catch(e){this.check(token);continue;}
    if(b.blockAt(point)?.boundingBox==='block'){job.placed.push({x:point.x,y:point.y,z:point.z});placed=true;break;}
   }
   if(!placed)throw Error('Could not place a shelter block at '+point);
  }
  this.save();this.update(job,shell.length,'Waiting for morning');
  while(b.time.timeOfDay>=12000){await sleep(1000);this.check(token);}
  this.update(job,0,'Removing the shelter');
  const cells=Array.isArray(job.shell)&&job.shell.length?job.shell:job.placed;
  for(const key of [...cells].reverse()){
   this.check(token);
   const block=b.blockAt(new Vec3(key.x,key.y,key.z));
   if(block?.boundingBox==='block')await b.dig(block);
   await sleep(80);
  }
  await this.sweepDrops(token);
  for(const key of cells){
   if(b.blockAt(new Vec3(key.x,key.y,key.z))?.boundingBox==='block')throw Error('Shelter block remained at '+key.x+','+key.y+','+key.z);
  }
 }
 // Phase 6b: obtain - plan the full chain with the howto tree, then run it as ordinary
 // verified jobs. The step list and index are persisted, so a restart resumes mid-chain.
 async obtain(job,token){
  const b=this.bot,s=job.spec,key=s.item+'x'+s.count;
  if(!job.chain||job.chainKey!==key){
   const have={};for(const item of b.inventory.items())have[item.name]=(have[item.name]||0)+item.count;
   const chain=buildChain(b,s.item,s.count,have);
   if(/(_shield|_planks|_log)/.test(s.item))this.log('Obtain plan have-tally: '+JSON.stringify(have).slice(0,220));
   job.chainKey=key;job.chain=chain.steps;job.index=0;this.save();
   this.log(`Obtain ${s.count} ${s.item}: `+(chain.steps.map(st=>st.op+' '+(st.block||st.item||st.entity)).join(' -> ')||'nothing to do'));
  }
  while(this.count(s.item)<s.count&&job.index<job.chain.length){
   this.check(token);
   if(this.slotsFull()>0.8)await this.depositSurplus(job,token);
   const step=job.chain[job.index];
   if(step.op==='gather'){
    const drop=this.blockDrop(step.block);
    if(!drop)throw Error('Cannot plan a gather of '+step.block);
    while(this.count(drop)<step.want){
     this.check(token);
     const before=this.count(drop);
     await this.gather({spec:{type:'gather',block:step.block,count:Math.min(128,step.want-before),searchIfMissing:true,targetY:step.targetY}},token);
     if(this.count(drop)<=before)throw Error('Gathering '+step.block+' made no progress toward '+step.want+' '+drop);
    }
   }else if(step.op==='smelt'){
    while(this.count(step.output)<step.want){
     this.check(token);
     const before=this.count(step.output);
     if(this.count(step.item)<1)throw Error('Ran out of '+step.item+' to smelt');
     await this.smelt({spec:{type:'smelt',item:step.item,count:Math.min(48,step.want-before,this.count(step.item))}},token);
     if(this.count(step.output)<=before)throw Error('Smelting '+step.item+' made no progress toward '+step.want+' '+step.output);
    }
   }else if(step.op==='craft'){
    while(this.count(step.item)<step.want){
     this.check(token);
     const before=this.count(step.item);
     await this.craft({spec:{type:'craft',item:step.item,count:Math.min(128,step.want-before)}},token);
     if(this.count(step.item)<=before)throw Error('Crafting '+step.item+' made no progress toward '+step.want);
    }
   }else if(step.op==='hunt'){
    while(this.count(step.item)<step.want){
     this.check(token);
     const before=this.count(step.item);
     await this.hunt({spec:{type:'hunt',entity:step.entity,count:1,maxSeconds:60}},token);
     if(this.count(step.item)<=before)throw Error('Hunting '+step.entity+' produced no '+step.item);
    }
   }else throw Error('Unknown obtain step '+step.op);
   job.index++;this.save();
   this.update(job,job.index,`Obtain step ${job.index}/${job.chain.length} done`);
  }
  if(this.count(s.item)<s.count)throw Error(`Obtain finished its plan with only ${this.count(s.item)}/${s.count} ${s.item}`);
 }
 // Park surplus in the deposit chest (or the autopilot home chest), keeping tools, armour,
 // food and everything the remaining obtain steps still need.
 async depositSurplus(job,token){
  const b=this.bot,at=job.spec.deposit||this.autopilot.home;
  if(!at)throw Error('Inventory nearly full and there is no deposit position: pass deposit or let the autopilot remember a home');
  const needed=new Set();
  for(const step of job.chain.slice(job.index))for(const key of ['item','block'])if(step[key])needed.add(step[key]);
  if(job.chain.slice(job.index).some(step=>step.op==='smelt'))for(const item of b.inventory.items())if(item.name==='coal'||item.name==='charcoal'||item.name.endsWith('_log')||item.name.endsWith('_planks'))needed.add(item.name);
  await this.walk(pos(at),token,2);
  const block=b.blockAt(pos(at));
  if(!block||!['chest','trapped_chest','barrel'].includes(block.name))throw Error('No chest or barrel at the deposit position '+JSON.stringify(at));
  const chest=await b.openContainer(block);
  try{
   for(const item of b.inventory.items()){
    this.check(token);
    if(/(_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(item.name))continue;
    if(b.registry.foodsByName[item.name])continue;
    if(needed.has(item.name))continue;
    await chest.deposit(item.type,item.metadata,item.count);
   }
   await sleep(150);await b._syncWindow(chest);await sleep(150);
  }finally{await chest.close();}
  await sleep(150);await b._syncWindow(b.inventory);
  this.log('Deposited surplus at '+at.x+', '+at.y+', '+at.z);
 }
 // The 26.3 server applies use-item block changes lazily - sometimes for tens of seconds
 // while the bot stands perfectly still. Real movement forces client tick boundaries, so
 // hop in place until the world reflects the change (the caller verifies it afterwards).
 async settleBlockChange(target,expect,token){
  const b=this.bot;
  for(let tries=0;tries<12;tries++){
   const block=b.blockAt(target);
   if(!block||block.name!==expect)return;
   this.check(token);
   b.clearControlStates();b.setControlState('jump',true);
   await sleep(350);
   if(token===this.epoch)b.clearControlStates(); // a reflex may have taken control during the hop
   await sleep(300);
  }
 }
 // Phase 6c: use a held item on a block or entity, verified by the resulting change.
 // The 26.3 server applies use-item block changes lazily until the next client tick
 // boundary; flushTick sends the ground-only update packet (compat appends tick_end to it)
 // so verifications see the change promptly. Safe while standing still, unlike raw position.
 async flushTick(){
  const b=this.bot;
  try{b._client.write('flying',{onGround:b.entity.onGround,flags:{onGround:b.entity.onGround,hasHorizontalCollision:false}});}catch{}
  await sleep(250);
 }
 // The WorldSurvivalChain's douse: pour the held water bucket at the bot's own feet, using
 // the exact sequence the verified use() path equips/confirms/aims with. The chain's task
 // ticks proved too cramped for this (equip never settled, pours fired on a stale rotation
 // and the A4 probe burned to death twice on 2026-10-13).
 async douseFire(){
  const b=this.bot;
  // Deliberately NO global check() here: the douse runs exactly when health is collapsing
  // (the health<10 gate would refuse it every attempt and the bot burned to death - A4
  // probe 2026-10-13). Ownership is checked LIVE at each step: a captured token goes stale
  // because the runner legitimately churns the epoch while the tree owns control.
  const owned=()=>this.controlToken===this.epoch;
  if(!owned())throw Error('Douse interrupted: control changed hands');
  const bucketItem=b.inventory.items().find(i=>i.name==='water_bucket');
  if(!bucketItem)throw Error('No water bucket to douse with');
  if(b.heldItem?.name!=='water_bucket'){
   await b.equip(bucketItem,'hand');
   for(let tries=0;tries<10&&b.heldItem?.name!=='water_bucket';tries++){
    if(!owned())throw Error('Douse interrupted: control changed hands');
    await sleep(150);
   }
   if(b.heldItem?.name!=='water_bucket')throw Error('The water bucket could not be equipped');
  }
  const feet=b.entity.position.floored();
  const here=b.blockAt(feet);
  if(here&&here.name==='water')return; // standing in water already: doused
  const support=b.blockAt(feet.offset(0,-1,0));
  if(!support||support.boundingBox!=='block')throw Error('No ground below to pour against');
  const aim=support.position.offset(0.5,1.0,0.5);
  await b.lookAt(aim,true).catch(()=>{});
  await sleep(250);
  if(!owned())throw Error('Douse interrupted: control changed hands');
  b.activateItem();
  for(let tries=0;tries<10&&this.count('bucket')<1;tries++)await sleep(200);
  if(this.count('bucket')<1)throw Error('The water bucket did not empty');
  await this.settleBlockChange(feet,'water',this.epoch);
  // Into-LAVA pours are a success too: the source turns to obsidian/cobble under the bot
  // (that is the point) - only a dry feet cell means the pour missed.
  const after=b.blockAt(feet)?.name;
  if(after!=='water'&&after!=='obsidian'&&after!=='cobblestone'&&after!=='lava')this.log('Douse: the water did not register at '+feet.floored());
 }
 async use(job,token){
  const b=this.bot,s=job.spec;
  if(!s.position&&!s.entity)throw Error('use needs a block position or an entity type');
  if(!b.registry.itemsByName[s.item])throw Error('Unknown item '+s.item);
  const hold=async name=>{
   if(b.heldItem?.name===name)return; // already in hand; re-equipping would empty the slot mid-race
   const item=b.inventory.items().find(i=>i.name===name);
   if(!item)throw Error('Need '+name+' in the inventory');
   await b.equip(item,'hand');
   for(let tries=0;tries<8&&b.heldItem?.name!==name;tries++)await sleep(250);
   if(b.heldItem?.name!==name)throw Error('The '+name+' could not be equipped');
  };
  if(s.entity)return this.useOnEntity(job,token,s.entity,s.item);
  const target=pos(s.position);
  await this.walk(target,token,3);this.check(token);
  const before=b.blockAt(target);
  if(!before)throw Error('No loaded block at '+target);
  if(s.item==='shears'&&/_leaves$/.test(before.name)){
   await hold('shears');
   await b.dig(before);this.check(token);await this.flushTick();
   // The resulting change is the leaves being gone; the leaf item drop depends on the
   // server's held-item view, which Via translation can differ on.
   for(let tries=0;tries<3&&b.blockAt(target)?.boundingBox==='block';tries++){
    await sleep(400);await this.sweepDrops(token);
   }
   if(b.blockAt(target)?.boundingBox==='block')throw Error('Shearing the leaves at '+target+' failed to remove them');
   return;
  }
  if(s.item==='bucket'){
   if(before.name!=='water')throw Error('Aim the bucket at a water block (never lava); '+before.name+' is not water');
   const buckets=this.count('water_bucket');
   await hold('bucket');
   // Scooping a fluid is an air-use for the server, not a block click.
   await b.lookAt(before.position.offset(.5,.5,.5),true).catch(()=>{});
   await sleep(400);this.check(token);
   b.activateItem();
   for(let tries=0;tries<10&&this.count('water_bucket')<=buckets;tries++){await sleep(300);this.check(token);}
   if(this.count('water_bucket')<=buckets)throw Error('Filling the bucket at '+target+' produced no water bucket');
   await this.settleBlockChange(target,'water',token);
   return;
  }
  if(s.item==='water_bucket'){
   if(before.boundingBox!=='empty')throw Error(target+' is occupied by '+before.name+'; aim at the air cell to fill');
   let support=null,face=null;
   for(const direction of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
    const neighbor=b.blockAt(target.minus(direction));
    if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}
   }
   if(!support)throw Error('No solid block beside '+target+' to pour against');
   const beforeItem=this.count('water_bucket');
   await hold('water_bucket');
   // A filled bucket pours where the eye ray lands, like a player aiming into the hole:
   // aim at the support block's face inside the target cell and use the item in the air.
   const aim=support.position.plus(new Vec3(face.x?face.x*0.5+0.5:0.5,face.y?face.y*0.5+0.5:0.5,face.z?face.z*0.5+0.5:0.5));
   await b.lookAt(aim,true).catch(()=>{});
   await sleep(400);this.check(token);
   b.activateItem();
   for(let tries=0;tries<8&&this.count('bucket')<1;tries++){await sleep(300);this.check(token);}
   await this.settleBlockChange(target,'water',token);
   if(b.blockAt(target)?.name!=='water')throw Error('Emptying the bucket did not place water at '+target);
   if(this.count('water_bucket')>=beforeItem&&this.count('bucket')<1)throw Error('The bucket did not empty');
   return;
  }
  const beforeName=before.name,beforeAge=before.properties?.age;
  await hold(s.item);
  const boneBefore=this.count(s.item);
  await b.activateBlock(before,new Vec3(0,1,0),new Vec3(.5,.5,.5));
  await this.flushTick();this.check(token);
  // Block updates can trail the action for a few seconds on this protocol; poll until the
  // expected change shows up (or fail honestly).
  const verify=async predicate=>{
   let after=b.blockAt(target);
   for(let tries=0;tries<12;tries++){
    if(predicate(after))return after;
    this.check(token);after=b.blockAt(target);await sleep(300);
   }
   return null;
  };
  let after=null;
  if(/_axe$/.test(s.item)){
   after=await verify(bl=>bl?.name.startsWith('stripped_'));
   if(!after)throw Error('The axe did not strip the log at '+target);
  }else if(/_hoe$/.test(s.item)){
   after=await verify(bl=>bl?.name==='farmland');
   if(!after)throw Error('The hoe did not till '+beforeName+' at '+target);
  }else if(s.item==='bone_meal'){
   after=await verify(bl=>bl?.properties?.age!==undefined&&bl.properties.age>beforeAge);
   if(!after){
    if(beforeAge===undefined&&this.count(s.item)<boneBefore)return; // client never shows crop age here; the consumed item and the suite's server-side age check are the evidence
    throw Error('Bone meal did not advance the crop at '+target);
   }
  }else{
   after=await verify(bl=>bl?.name!==beforeName||bl?.properties?.age!==beforeAge);
   if(!after)throw Error('Using '+s.item+' on '+beforeName+' changed nothing');
  }
 }
 // mineflayer's useOn omits the hand field the 1.21.4 interact packet needs, so write the
 // entity interaction directly: INTERACT_AT with a hit point on the hitbox, then INTERACT.
 useEntityInteract(b,target){
  const y=Math.round(target.height*0.6*100)/100;
  b._client.write('use_entity',{target:target.id,mouse:2,x:0,y,z:0,hand:0,sneaking:false});
  b._client.write('use_entity',{target:target.id,mouse:0,hand:0,sneaking:false});
 }
 async useOnEntity(job,token,type,itemName){
  const b=this.bot,wools=Object.keys(b.registry.itemsByName).filter(n=>/_wool$/.test(n));
  const woolCount=()=>wools.reduce((a,n)=>a+this.count(n),0);
  const target=Object.values(b.entities).filter(e=>e.name===type&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
  if(!target)throw Error('No '+type+' within 24 blocks');
  const item=b.inventory.items().find(i=>i.name===itemName);
  if(!item)throw Error('Need '+itemName+' in the inventory');
  await this.walk(target.position,token,1.5);
  await b.equip(item,'hand');this.check(token);
  await b.lookAt(target.position.offset(0,target.height*.6,0));
  const woolBefore=woolCount();
  this.useEntityInteract(b,target);
  await sleep(900);
  if(itemName==='shears'){
   await this.sweepDrops(token);
   if(woolCount()<=woolBefore)throw Error('Shearing the '+type+' produced no wool');
  }
 }
 async shear(job,token){
  const b=this.bot;
  const wools=Object.keys(b.registry.itemsByName).filter(n=>/_wool$/.test(n));
  const held=b.inventory.items().find(i=>i.name==='shears');
  const before=wools.reduce((a,n)=>a+this.count(n),0);
  const deadline=Date.now()+(job.spec.maxSeconds??45)*1000;
  while(wools.reduce((a,n)=>a+this.count(n),0)<=before&&Date.now()<deadline){
   this.check(token);
   const sheep=Object.values(b.entities).filter(e=>e.name==='sheep'&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!sheep)throw Error('No sheep within 24 blocks to shear');
   if(!held)throw Error('Need shears in the inventory');
   await this.walk(sheep.position,token,1.5);
   await b.equip(held,'hand');
   for(let tries=0;tries<8&&b.heldItem?.name!=='shears';tries++)await sleep(250);this.check(token);
   if(b.heldItem?.name!=='shears')throw Error('The shears could not be equipped');
   await b.lookAt(sheep.position.offset(0,sheep.height*.6,0));
   this.useEntityInteract(b,sheep);
   await sleep(900);
   await this.sweepDrops(token);
  }
  if(wools.reduce((a,n)=>a+this.count(n),0)<=before)throw Error('Shearing produced no wool (all nearby sheep may already be shorn)');
 }
 async breed(job,token){
  const b=this.bot,s=job.spec,food=BREED_FOOD[s.entity];
  const foods=Array.isArray(food)?food:[food];
  if(!foods.length)throw Error('No known breeding food for '+s.entity);
  const feed=foods.map(f=>({name:f,have:this.count(f)})).find(x=>x.have>=2);
  if(!feed)throw Error('Need 2 '+foods.join('/')+' to breed '+s.entity);
  const nearby=()=>Object.values(b.entities).filter(e=>e.name===s.entity&&e.position&&e.position.distanceTo(b.entity.position)<=24);
  const item=b.inventory.items().find(i=>i.name===feed.name);
  const deadline=Date.now()+(s.maxSeconds??90)*1000;
  const start=nearby().length;
  while(nearby().length<=start&&Date.now()<deadline){
   this.check(token);
   const pair=nearby().sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position)).slice(0,2);
   if(pair.length<2)throw Error('Need two '+s.entity+' within 24 blocks to breed');
   for(const animal of pair){
    this.check(token);
    await this.walk(animal.position,token,1.5);
    await b.equip(item,'hand');
    await b.lookAt(animal.position.offset(0,animal.height*.6,0));
    this.useEntityInteract(b,animal);
    await sleep(700);
   }
   for(let i=0;i<15&&nearby().length<=start;i++)await sleep(1000);
  }
  if(nearby().length<=start)throw Error('Feeding did not produce a baby '+s.entity);
 }
 async hunt(job,token){
  const b=this.bot,s=job.spec;
  const loot=Object.values(b.registry.entityLoot||{}).find(l=>l.entity===s.entity)?.drops.map(d=>d.item).filter(Boolean)||[];
  if(!loot.length)throw Error('No drop data for '+s.entity);
  const gained=()=>loot.reduce((a,n)=>a+this.count(n),0);
  const before=gained();
  const deadline=Date.now()+(s.maxSeconds??90)*1000;
  while(gained()-before<s.count&&Date.now()<deadline){
   this.check(token);
   const target=Object.values(b.entities).filter(e=>e.name===s.entity&&e.position&&e.position.distanceTo(b.entity.position)<=24).sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position))[0];
   if(!target)throw Error('No '+s.entity+' within 24 blocks to hunt');
   // One animal per task (lockFirst): kill, sweep the drops, repeat - the FightTask
   // equips the best weapon (or the bare hand on a passive animal, never a block/food).
   await this.combatTask(job,token,()=>new FightTask({
    move:this.move,
    log:m=>{try{this.log(m);}catch{}},
    opts:{entityFilter:s.entity,range:24,lockFirst:true,allowHand:true}}),
   {timeoutMs:Math.max(1000,deadline-Date.now()),timeoutMessage:'Hunt timed out fighting '+s.entity});
   await this.sweepDrops(token);
  }
  if(gained()-before<s.count)throw Error(`Hunting collected only ${gained()-before}/${s.count} drops from ${s.entity}`);
 }
 async run(job,token){const spec=job.spec;
  if(spec.type==='goto'){await this.walk(pos(spec.position),token,1);return;}
  if(spec.type==='gather')return this.gather(job,token);
  if(spec.type==='craft')return this.craft(job,token);
  if(spec.type==='deposit')return this.deposit(job,token);
  if(spec.type==='build')return this.build(job,token);
  if(spec.type==='explore')return this.explore(job,token);
  if(spec.type==='place')return this.place(job,token);
  if(spec.type==='eat')return this.eat(job,token);
  if(spec.type==='equip')return this.equip(job,token);
  if(spec.type==='collect')return this.collect(job,token);
  if(spec.type==='smelt')return this.smelt(job,token);
  if(spec.type==='sleep')return this.sleep(job,token);
  if(spec.type==='fight')return this.fight(job,token);
  if(spec.type==='shelter')return this.shelter(job,token);
  if(spec.type==='obtain')return this.obtain(job,token);
  if(spec.type==='use')return this.use(job,token);
  if(spec.type==='shear')return this.shear(job,token);
  if(spec.type==='breed')return this.breed(job,token);
  if(spec.type==='hunt')return this.hunt(job,token);
 }
 blockDrop(name){
  const b=this.bot,id=b.registry.blocksByName[name]?.id;
  if(id===undefined)return null;
  const drops=b.registry.blocks[id]?.drops||[];
  const single=drops.length===1?b.registry.items[drops[0]]?.name:null;
  return name==='stone'?'cobblestone':single;
 }
 slotsFull(){
  const used=this.bot.inventory.items().reduce((a,i)=>a+Math.ceil(i.count/i.stackSize),0);
  return used/36;
 }
 async gather(job,token){
  const b=this.bot,s=job.spec;
  // block:'log' matches every log species: a species pinned at job creation would send the
  // bot hunting oak through a dark-oak forest for the whole session.
  const anyLog=s.block==='log';
  const id=anyLog?undefined:b.registry.blocksByName[s.block]?.id;if(!anyLog&&id===undefined)throw Error('Unknown block '+s.block);
  const denied=/^(bedrock|.*chest|.*shulker_box|.*door|.*bed|.*furnace|.*barrel|.*torch|.*sign|.*portal|.*spawner|.*command_block|water|lava|.*planks|glass.*|.*bricks)$/;
  if(denied.test(s.block))throw Error('Gathering this block is disabled to protect structures');
  if(!job.anchor)job.anchor=b.entity.position.floored();if(job.startCount===undefined)job.startCount=this.count(s.block);
  const logSum=()=>b.inventory.items().filter(i=>i.name.endsWith('_log')).reduce((a,i)=>a+i.count,0);
  if(anyLog)job.dropName='log';
  else{
   // Ore jobs are rejected unless the ore drops the named item; avoid false completion.
   const drops=b.registry.blocks[id]?.drops||[];
   const dropName=drops.length===1?b.registry.items[drops[0]]?.name:null;
   if(!dropName)throw Error('Unsupported drop type; use logs, stone/cobblestone, or simple ores');
   if(s.block==='stone')job.dropName='cobblestone';else job.dropName=dropName;
  }
  const count_=job.dropName==='log'?logSum:()=>this.count(job.dropName);
  if(job.startDrop===undefined)job.startDrop=count_();this.save();
  let failures=0;
  if(job.searches===undefined)job.searches=0;
  if(job.descents===undefined)job.descents=0;
  const radius=s.radius??this.config.limits.radius;
  const previous=b.pathfinder.movements;
  // Natural targets may sit behind dirt or inside a cliff: path with the explore rules.
  b.pathfinder.setMovements(this.exploreMovements());
  try{
   const match=anyLog?Object.values(b.registry.blocksByName).filter(bl=>/_log$/.test(bl.name)).map(bl=>bl.id):id;
   while(count_()-job.startDrop<s.count){
    this.check(token);if(b.inventory.emptySlotCount()<2)throw Error('Inventory nearly full; deposit items first');
    // Wood step: do not follow a trunk down into a ravine. The floor is the Y where the
    // gather started, not wherever a failed path has since dropped the bot.
    if(s.surface){
     if(job.surfaceY===undefined)job.surfaceY=Math.floor(b.entity.position.y);
     this.surfaceFloor=job.surfaceY-4;
    }
    // Prefer same-level trunks: on a canopy spawn the nearest log is often far above or below.
    // Open-sky preference (review directive): wood jobs can ASK for forest-edge work with
    // "openSky":true - a trunk whose column above is clear means daylight and fewer night
    // ambushes. MUST be opt-in: under a dark oak canopy every trunk has leaves above, so
    // an always-on filter emptied the candidate list and starved the hard-anchor gathers
    // (measured: 'No matching blocks' loops, soak 20261013).
    const wantOpen=!!s.openSky;
    const skyOpen=p=>{for(let dy=2;dy<=10;dy++){const bl=b.blockAt(p.offset(0,dy,0));if(bl&&bl.boundingBox==='block'&&bl.name!=='log')return false;}return true;};
    let targets=b.findBlocks({matching:match,point:pos(job.anchor),maxDistance:radius,count:64}).map(p=>b.blockAt(p)).filter(block=>block&&block.position.distanceTo(pos(job.anchor))<=radius);
    // openSky RANKS open trunks first but never empties the list: the dark-canopy hard
    // anchor has no open-sky trunks at all, and a filtered gather starved there (measured).
    if((anyLog||wantOpen) && job.skyKey!==job.anchor.x+','+job.anchor.z){
     job.skyKey=job.anchor.x+','+job.anchor.z;
     const stand=pickOpenStand((x,y,z)=>b.blockAt(new Vec3(x,y,z)),targets.map(t=>t.position),b.entity.position);
     if(stand){
      this.update(job,Math.max(0,count_()-job.startDrop),'Moving to open sky');
      try{await this.walk(new Vec3(stand.x,stand.y,stand.z),token,1,25);}catch(e){this.check(token);}
     }
    }
    if(wantOpen){
     const openFirst=(a,c)=>(skyOpen(c.position)?1:0)-(skyOpen(a.position)?1:0);
     targets.sort((a,c)=>openFirst(a,c)||(a.position.distanceTo(b.entity.position)+Math.abs(a.position.y-b.entity.position.y)*2)-(c.position.distanceTo(b.entity.position)+Math.abs(c.position.y-b.entity.position.y)*2));
    }else{
     targets.sort((a,c)=>(a.position.distanceTo(b.entity.position)+Math.abs(a.position.y-b.entity.position.y)*2)-(c.position.distanceTo(b.entity.position)+Math.abs(c.position.y-b.entity.position.y)*2));
    }
    if(s.surface&&job.surfaceY!==undefined)targets=targets.filter(t=>t.position.y>=job.surfaceY-4);
    if(!targets.length){
     if(s.searchIfMissing&&job.searches<3){
      job.searches++;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),`Searching further afield (${job.searches}/3)`);
      // belowFoots (soak ladder jobs): short search hops - a 48+ block wander is how the
      // bot lost the clearing and ended up lost at the world spawn in the baseline soaks.
      const leg=s.belowFoots?24:Math.max(48,radius);
      await this.exploreLeg(token,{direction:['east','north','west','south'][job.searches-1],distance:leg,seconds:90+leg*2});
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     const targetY=s.targetY??(s.block.includes('diamond')?-58:48);
     if(UNDERGROUND.test(s.block)&&b.entity.position.y>targetY&&job.descents<3){
      job.descents++;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),`Digging a staircase down to y=${targetY}`);
      await this.staircase(job,token,targetY);
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     if(s.strip&&b.entity.position.y<=targetY&&!job.stripped){
      job.stripped=true;this.update(job,Math.max(0,this.count(job.dropName)-job.startDrop),'Digging a strip mine');
      await this.stripMine(job,token,32);
      job.anchor=b.entity.position.floored();this.save();continue;
     }
     throw Error('No matching blocks within the allowed radius');
    }
    // Player-style trunk strip: group the targets into columns (same x,z), pick the nearest
    // column, and strip it from the highest reachable log DOWN - a player chops the band
    // they can stand beside, then walks to the next trunk. Reach band: with belowFoots (soak
    // ladder jobs) the strip is limited to feet+4 (a jump or one pillar reaches it);
    // other callers may take the whole column. The block under the feet stays allowed when
    // it is itself natural or a log (the dig-and-drop branch), refused for anything else.
    const underBot=b.entity.position.floored().offset(0,-1,0);
    const naturalUnder=t=>NATURAL_DIG.has(t.name)||/_leaves$/.test(t.name)||/_log$/.test(t.name);
    const maxY=s.belowFoots?b.entity.position.y+4:Infinity;
    const columns=new Map();
    for(const t of targets){
     if(t.position.y>maxY)continue;
     const k=t.position.x+','+t.position.z;
     if(!columns.has(k))columns.set(k,[]);
     columns.get(k).push(t);
    }
    if(!job.badColumns)job.badColumns=[];
    let bestCol=null,bestDist=Infinity;
    for(const col of columns.values()){
     const ck=col[0].position.x+','+col[0].position.z;
     if(job.badColumns.includes(ck))continue; // one unreachable trunk must not abort the whole job
     const d=Math.min(...col.map(t=>t.position.distanceTo(b.entity.position)));
     const base=Math.min(...col.map(t=>t.position.y));
     const penalty=(s.surface&&job.surfaceY!==undefined&&base<job.surfaceY-1)?6:0;
     if(d+penalty<bestDist){bestDist=d+penalty;bestCol=col;}
    }
    if(!bestCol){
     if(job.badColumns.length)throw Error('Cannot gather safely: nearby trunks could not be reached');
     // belowFoots hides trunks above feet+3. After a drop into a ravine every log is
     // "above", and reporting an empty floor made the wood step dig in the hole (soak
     // normal1: bot at y=108, logs still at y=131, 0 collected).
     const above=targets.filter(t=>t.position.y>b.entity.position.y+3);
     if(above.length&&(job.climbs||0)<2){
      job.climbs=(job.climbs||0)+1;
      above.sort((a,c)=>a.position.distanceTo(b.entity.position)-c.position.distanceTo(b.entity.position));
      this.update(job,Math.max(0,count_()-job.startDrop),'Climbing back up to the trunks');
      try{await this.walk(above[0].position,token,3,25);}catch(e){this.check(token);}
      continue;
     }
     this.log('Gather: no diggable target left; bot at '+b.entity.position.floored()+' and remaining targets at '+JSON.stringify(targets.map(t=>t.position.floored())));
     throw Error('Only the block under the bot is in reach; gathering would dig its own floor');
    }
    // Top-down within the trunk: the highest reachable log first, then descend.
    bestCol.sort((a,b)=>b.position.y-a.position.y);
    const diggable=bestCol.filter(t=>!t.position.equals(underBot)||naturalUnder(t));
    const target=diggable[failures%diggable.length];
    try{
     if(target.position.equals(b.entity.position.floored().offset(0,-1,0))){
      // The last target sits directly under the feet and its cover is natural: dig the floor
      // block and drop onto it (the fluid and fall guards below still apply to the target).
      for(const delta of [new Vec3(0,-1,0),new Vec3(1,-1,0),new Vec3(-1,-1,0),new Vec3(0,-1,1),new Vec3(0,-1,-1)])if(['lava','water'].includes(b.blockAt(target.position.plus(delta))?.name))throw Error('Fluid under target');
      await b.tool.equipForBlock(target);
      await b.dig(target);this.check(token);await sleep(700);failures=0;
      this.update(job,Math.max(0,count_()-job.startDrop),`Collected ${Math.max(0,count_()-job.startDrop)}/${s.count} ${job.dropName}`);
      continue;
     }
      try{await this.walk(target.position,token,2,20);}catch(e){this.check(token);}
      const underFoot=b.blockAt(b.entity.position.floored().offset(0,-1,0));
      if(underFoot&&/_log$/.test(underFoot.name)&&count_()-job.startDrop<s.count){
       // The walk reached a trunk column and the bot now stands ON it: mine the logs under
       // the feet downward - dark oak trunks are tall, so this is the common canopy harvest.
       await this.mineColumnUnder(token);
      }else{
       await b.tool.equipForBlock(target);this.check(token);
       if(!b.canDigBlock(target)){
        if(target.position.y>b.entity.position.y)await this.reachUp(token,target);
        else{
         // Out of reach (canopy spawns put the trunks below the leaf surface): dig down toward it.
         await this.descendToReach(target,token);
         // Standing on the leaf canopy itself (heightmap tps land there): pathfinding cannot
         // route through it, so dig the natural column under the feet and drop to the floor.
         if(!b.canDigBlock(target))await this.canopyDrop(token,target);
        }
       }
       if(!b.canDigBlock(target))throw Error('Cannot reach or harvest this block');
       const harvest=b.registry.blocks[target.type]?.harvestTools;if(harvest&&!harvest[b.heldItem?.type])throw Error('A suitable harvesting tool is required');
       if(target.position.equals(b.entity.position.floored().offset(0,-1,0)))throw Error('Walked onto the target; it is under the bot now');
       for(const delta of [new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)])if(['lava','water'].includes(b.blockAt(target.position.plus(delta))?.name))throw Error('Fluid beside target');
       if(target.material==='incorrect_for_wooden_tool')target.material='mineable/pickaxe';
       await b.dig(target);this.check(token);await sleep(600);
       // The walk to the freshly dropped log is best effort on canopy shelves: the dig itself
       // already counts, unreachable drops stay for a later sweep from better footing.
       try{await this.walk(target.position,token,0.8);}catch(e){this.check(token);}
       await this.sweepDrops(token);
       const nowUnder=b.blockAt(b.entity.position.floored().offset(0,-1,0));
       if(nowUnder&&/_log$/.test(nowUnder.name)&&count_()-job.startDrop<s.count)await this.mineColumnUnder(token);
      }
      failures=0;
     }catch(e){this.check(token);failures++;this.log('Gather: attempt '+failures+' on '+target.name+' at '+target.position.floored()+' failed: '+e.message);if(failures>=3){const ck=target.position.x+','+target.position.z;if(!job.badColumns.includes(ck))job.badColumns.push(ck);failures=0;if(job.badColumns.length>=8)throw Error('Cannot gather safely: '+e.message);}}
    this.update(job,Math.max(0,count_()-job.startDrop),`Collected ${Math.max(0,count_()-job.startDrop)}/${s.count} ${job.dropName}`);
   }
   await this.sweepDrops(token);
  }finally{
   // A reflex or user stop owns the pathfinder now: skip the tunnel climb and the restore,
   // so they cannot fight the new owner's navigation. The resumed job climbs after gathering.
   if(token===this.epoch){
    if(job.tunnel?.length){try{await this.climbTunnel(job,token);}catch(e){this.log('Could not climb back up the tunnel: '+e.message);}}
    b.pathfinder.setMovements(previous);
   }
   this.surfaceFloor=null;
  }
 }
 // Safe staircase: a 2-high 45-degree descending tunnel, dug by hand so every block is
 // checked. Stops (and fails honestly) at fluids and bedrock; records the tunnel so the
 // bot can walk back up the way it came. A stall guard turns a stuck descent into a clear
 // failure instead of looping.
 async staircase(job,token,targetY){
  const b=this.bot;
  if(!job.tunnel)job.tunnel=[];
  const start=b.entity.position.floored();
  const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(start.x*3+start.z)%4];
 let lastY=start.y,stalls=0;
 for(let steps=0;b.entity.position.floored().y>targetY&&steps<200;steps++){
  this.check(token);
  const next=b.entity.position.floored().plus(dir).offset(0,-1,0);
  const before=job.tunnel[job.tunnel.length-1];
   if(before&&before.x===next.x&&before.y===next.y&&before.z===next.z)throw Error('Staircase stalled at '+next);
   // Corner cut: without digging the cell above the target's head the bot wedges against
   // the ceiling when it walks over the edge to drop one level.
   await this.digTunnelStep(job,token,next,true);
  await this.stepInto(next,dir,token);
  job.tunnel.push({x:next.x,y:next.y,z:next.z});
  if(steps%6===5)await this.placeTorch(token);
  const nowY=b.entity.position.floored().y;
  if(nowY>=lastY){if(++stalls>=2)throw Error('Staircase stalled at '+b.entity.position.floored());}
  else{stalls=0;lastY=nowY;}
  this.save();
  }
 }
 // Move one cell along dir: try the pathfinder first, then walk straight in. The pathfinder
 // sometimes refuses (or fakes) the single step down a dug staircase.
 async stepInto(next,dir,token){
  const b=this.bot;
  const at=()=>b.entity.position.floored().equals(next);
  if(at())return;
  try{await this.navigate(new goals.GoalBlock(next.x,next.y,next.z),token,8);}catch(e){this.check(token);}
  if(at())return;
  await sleep(200);
  try{await b.look(Math.atan2(-dir.x,-dir.z),0);}catch{}
  b.setControlState('forward',true);
  const deadline=Date.now()+2500;
  try{while(Date.now()<deadline&&!at()){await sleep(80);this.check(token);}}finally{if(token===this.epoch)b.clearControlStates();}
 }
 // A 1x2 horizontal strip mine at the current level, used after descending for diamonds.
 async stripMine(job,token,length){
  const b=this.bot;
  if(!job.tunnel)job.tunnel=[];
  const start=b.entity.position.floored();
  const dir=[new Vec3(1,0,0),new Vec3(0,0,1),new Vec3(-1,0,0),new Vec3(0,0,-1)][Math.abs(start.x+start.z*5)%4];
  let last=start.floored(),stalls=0;
  for(let steps=0;steps<length;steps++){
   this.check(token);
   const next=b.entity.position.floored().plus(dir);
   const before=job.tunnel[job.tunnel.length-1];
   if(before&&before.x===next.x&&before.y===next.y&&before.z===next.z)throw Error('Strip mine stalled at '+next);
   await this.digTunnelStep(job,token,next);
   await this.stepInto(next,dir,token);
   job.tunnel.push({x:next.x,y:next.y,z:next.z});
   if(steps%8===7)await this.placeTorch(token);
   const now=b.entity.position.floored();
   if(now.x===last.x&&now.z===last.z){if(++stalls>=2)throw Error('Strip mine stalled at '+now);}
   else{stalls=0;last=now;}
   this.save();
  }
 }
 // A canopy or ledge can leave the target in sight but out of reach. Dig straight down
 // through natural blocks (leaves, dirt) until the target comes within reach - never into
 // fluids, never more than a few blocks.
 // Standing on a trunk column: mine the logs under the feet downward. Each dig drops the bot
 // one log lower and its drops are swept where the bot lands. Dark oak trunks are 2x2 and
 // tall, so one walked-on column usually yields several logs without any pathfinding.
 async mineColumnUnder(token){
  const b=this.bot;
  for(let i=0;i<12;i++){
   this.check(token);
   const feet=b.entity.position.floored(),below=b.blockAt(feet.offset(0,-1,0));
   if(!below||!/_log$/.test(below.name))return;
   for(const delta of [new Vec3(0,-2,0),new Vec3(1,-2,0),new Vec3(-1,-2,0),new Vec3(0,-2,1),new Vec3(0,-2,-1)])if(['lava','water'].includes(b.blockAt(feet.plus(delta))?.name))return;
   await b.tool.equipForBlock(below);
   await b.dig(below);this.check(token);await sleep(700); // fall through and land on the next log
  }
 }
 // The bot is standing on the leaf canopy of a dark forest (heightmap teleports land there):
 // trunks stand below, surrounded by leaves the pathfinder refuses to route through. Dig the
 // natural column directly under the feet and drop, one layer at a time - no pathfinding -
 // until real ground (not leaves/logs) is under the feet. A column whose next landing is a
 // deep hollow is left alone and a neighbouring leaf column with a shallow one is used
 // instead, so the descent costs no fall damage.
 async canopyDrop(token,target,depth=16){
  const b=this.bot;
  for(let i=0;i<depth;i++){
   this.check(token);
   if(target&&b.canDigBlock(target))return;
   const feet=b.entity.position.floored();
   const below=b.blockAt(feet.offset(0,-1,0));
   if(!below||below.boundingBox!=='block')return;
   if(!/_leaves$/.test(below.name)&&!/_log$/.test(below.name))return;
   for(const delta of [new Vec3(0,-2,0),new Vec3(1,-2,0),new Vec3(-1,-2,0),new Vec3(0,-2,1),new Vec3(0,-2,-1)])if(['lava','water'].includes(b.blockAt(feet.plus(delta))?.name))return;
   let air=0,probe=feet.offset(0,-2,0);
   while(air<4&&b.blockAt(probe)?.boundingBox!=='block'){air++;probe=probe.offset(0,-1,0);}
   if(air>=4){
    let moved=false;
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
     const side=feet.offset(dx,0,dz),sideBlock=b.blockAt(side);
     if(!sideBlock||sideBlock.boundingBox!=='block'||!/_leaves$/.test(sideBlock.name))continue;
     let a2=0,p2=side.offset(0,-1,0);
     while(a2<4&&b.blockAt(p2)?.boundingBox!=='block'){a2++;p2=p2.offset(0,-1,0);}
     if(a2>=4)continue;
     await b.tool.equipForBlock(sideBlock);
     await b.dig(sideBlock);await sleep(300);
     await this.walk(side,token,0.4,6).catch(()=>{});
     moved=true;break;
    }
    if(!moved)return; // hemmed in by deep hollows: try another target
    continue;
   }
   await b.tool.equipForBlock(below);
   await b.dig(below);await sleep(700); // fall through the dug layer and land
  }
 }
 async descendToReach(target,token){
  const b=this.bot;
  for(let descended=0;descended<8&&!b.canDigBlock(target);descended++){
   this.check(token);
   const feet=b.entity.position.floored();
   if(feet.y<=target.position.y+1)return; // at or below the target: descending cannot help
   if(Math.hypot(target.position.x-feet.x,target.position.z-feet.z)>4)return; // not overhead: descending moves away from it
   const below=b.blockAt(feet.offset(0,-1,0));
   if(!below||below.boundingBox!=='block'||!NATURAL_DIG.has(below.name)&&!/_leaves$/.test(below.name))return;
   for(const delta of [new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1)])if(['lava','water'].includes(b.blockAt(feet.offset(0,-2,0).plus(delta))?.name))return;
   // The dig must not open a long fall: count the air below and refuse deep drops.
   let air=0;let probe=feet.offset(0,-2,0);
   while(air<4&&!b.blockAt(probe)?.boundingBox==='block'&&probe.y>-60){air++;probe=probe.offset(0,-1,0);}
   if(air>=4)return;
   await b.tool.equipForBlock(below);
   await b.dig(below);await sleep(250);
   await sleep(400); // let the bot land
  }
 }
 async digTunnelStep(job,token,next,corner){
  const b=this.bot;
  const fluidAt=p=>['lava','water'].includes(b.blockAt(p)?.name);
  const feetBlock=b.blockAt(next),head=b.blockAt(next.offset(0,1,0)),floor=b.blockAt(next.offset(0,-1,0));
  const targets=[feetBlock,head,corner?b.blockAt(next.offset(0,2,0)):null].filter(bl=>bl&&bl.boundingBox==='block');
  for(const spot of [next,next.offset(0,1,0),...(corner?[next.offset(0,2,0)]:[])])for(const delta of [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)]){
   const p=spot.plus(delta);
   if(fluidAt(p))throw Error('Tunnel stopped: '+(b.blockAt(p)?.name||'fluid')+' at '+p.floored());
  }
  if(floor&&fluidAt(floor.position))throw Error('Tunnel stopped: '+floor.name+' at '+floor.position.floored());
  if(feetBlock?.name==='bedrock'||head?.name==='bedrock')throw Error('Tunnel stopped: bedrock at '+next);
  for(const block of targets){
   this.check(token);
   // Digging without the required tool destroys the block for nothing; refuse instead.
   if(block.harvestTools&&!Object.keys(block.harvestTools).some(id=>b.inventory.items().some(i=>i.type===+id)))throw Error('Tunnel needs a suitable tool in the inventory for '+block.name);
   await b.tool.equipForBlock(block);
   if(block.material==='incorrect_for_wooden_tool')block.material='mineable/pickaxe';
   await b.dig(block);await sleep(80);
  }
 }
 async placeTorch(token){
  const b=this.bot;
  if(!this.count('torch'))return;
  try{
   const ground=b.blockAt(b.entity.position.floored().offset(0,-1,0));
   if(ground?.boundingBox!=='block')return;
   await b.equip(b.inventory.items().find(i=>i.name==='torch'),'hand');
   await b.placeBlock(ground,new Vec3(0,1,0));
  }catch{}
 }
 // Walk back up a recorded tunnel; every point is clear air by construction.
 async climbTunnel(job,token){
  const b=this.bot,tunnel=job.tunnel||[];
  const previous=b.pathfinder.movements;
  b.pathfinder.setMovements(this.movements);
  try{
   for(let i=tunnel.length-1;i>=0;i--){
    this.check(token);
    const point=tunnel[i];
    // A diagonal 1-up step is 1.41 away, so the skip threshold must stay below that.
    if(b.entity.position.floored().distanceTo(new Vec3(point.x,point.y,point.z))>0.9)await this.navigate(new goals.GoalBlock(point.x,point.y,point.z),token,10);
   }
  }finally{if(token===this.epoch)b.pathfinder.setMovements(previous);}
 }
 // Pick the first recipe variant whose ingredients the inventory actually satisfies, and
 // rewrite planks-family ingredients to the held species: minecraft-data lists one variant
 // PER SPECIES (sticks: oak, dark_oak, birch, ...), recipesFor(...)[0] is just the first,
 // and craftConfirmed places ingredients by exact id - a dark-oak kit with an oak-first
 // variant threw 'Missing ingredient' forever (measured: soak sticks stayed 0 in all runs).
 usableRecipe(b,variants,table){
  const plankIds=new Set(Object.values(b.registry.itemsByName).filter(i=>/_planks$/.test(i.name)).map(i=>i.id));
  const count=id=>this.count(b.registry.items[id]?.name);
  for(const recipe of variants){
   const cells=recipe.inShape?recipe.inShape.flat().filter(x=>x&&x.id!==-1):(recipe.ingredients||[]);
   const tally={};
   for(const x of cells){const id=typeof x==='number'?x:x.id;tally[id]=(tally[id]||0)+1;}
   const subst={};let ok=true;
   for(const [id,need] of Object.entries(tally)){
    let have=count(Number(id));
    if(have<need&&plankIds.has(Number(id))){
     const held=(b.inventory.items()||[]).find(i=>plankIds.has(i.type)&&this.count(i.name)>=need);
     if(held){subst[Number(id)]=b.registry.itemsByName[held.name].id;have=this.count(held.name);}
    }
    if(have<need){ok=false;break;}
   }
   if(ok)return {recipe,subst};
  }
  return null;
 }
 withSubstitutions(recipe,subst){
  if(!Object.keys(subst).length)return recipe;
  const clone=Object.assign(Object.create(Object.getPrototypeOf(recipe)),recipe);
  if(clone.inShape)clone.inShape=clone.inShape.map(row=>row.map(x=>(x&&subst[x.id]!==undefined)?{...x,id:subst[x.id]}:x));
  if(clone.ingredients)clone.ingredients=clone.ingredients.map(x=>(subst[x.id]!==undefined)?{...x,id:subst[x.id]}:x);
  return clone;
 }
 async craft(job,token){
  const b=this.bot,s=job.spec,item=b.registry.itemsByName[s.item];if(!item)throw Error('Unknown item');
  if(job.targetCount===undefined)job.targetCount=this.count(s.item)+s.count;this.save();
  let placedAt=null,usedTable=null;
  try{
   while(this.count(s.item)<job.targetCount){
    this.check(token);
    // A table already in the world is REUSED, not re-placed (the soak's sword craft kept
    // failing placement while its table stood 5 blocks away): find it within 6 and walk to it.
    let table=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
    if(table&&b.entity.position.distanceTo(table.position)>3){
     try{await this.walk(table.position,token,2,15);}catch(e){this.check(token);}
     table=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
    }
    let picked=this.usableRecipe(b,b.recipesFor(item.id,null,1,table),table);
    if(!picked&&!table){
     const provisioned=await this.ensureTable(token);
     table=provisioned.block;placedAt=provisioned.created||placedAt;
     picked=this.usableRecipe(b,b.recipesFor(item.id,null,1,table),table);
    }
    if(table)usedTable=table;
    if(!picked)throw Error('Missing ingredients or a nearby crafting table');
    const before=this.count(s.item);
    await craftConfirmed(b,this.withSubstitutions(picked.recipe,picked.subst),table,()=>this.check(token));this.check(token);
    if(this.count(s.item)<=before)throw Error('Crafting produced no confirmed items');
    this.update(job,this.count(s.item),`Crafted ${s.item}`);
   }
  }finally{
   // keepTable (wood-step ladder jobs): leave the placed table standing for the next craft;
   // collectTable (the step's last craft): pick the used table back up even if this job only
   // reused it. Plain crafts keep the old contract: what they placed, they take back.
   const collectAt=placedAt||(s.collectTable&&usedTable?usedTable.position:null);
   if(collectAt&&!s.keepTable){try{await this.pickUp(collectAt,'crafting_table',token);}catch(e){this.log('Left the crafting table at '+collectAt);}}
  }
 }
 async placeBlocks(support,face,target,name,token){
  const b=this.bot;
  for(let tries=0;tries<2;tries++){
   this.check(token);
   try{await b.placeBlock(support,face);}catch(e){await sleep(300);} // the client chunk can lag the server; retry once
   await sleep(120);
   if(b.blockAt(target)?.name===name)return;
  }
  throw Error('Placement was not verified at '+target);
 }
 async ensureTable(token){
  const b=this.bot;
  // One table within 6 blocks serves every craft (the soak's normal1 placed one and then
  // burned 15 jobs re-placing): walk to it instead of placing a second one.
  let existing=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6});
  if(existing){
   if(b.entity.position.distanceTo(existing.position)>3){
    try{await this.walk(existing.position,token,2,15);}catch(e){this.check(token);}
    existing=b.findBlock({matching:b.registry.blocksByName.crafting_table.id,maxDistance:6})||existing;
   }
   return {block:existing,created:null};
  }
  if(!this.count('crafting_table')){
   const picked=this.usableRecipe(b,b.recipesFor(b.registry.itemsByName.crafting_table.id,null,1,null),null);
   if(!picked)throw Error('Missing ingredients: need a crafting table, or 4 planks to make one');
   const before=this.count('crafting_table');
   await craftConfirmed(b,this.withSubstitutions(picked.recipe,picked.subst),null,()=>this.check(token));
   if(this.count('crafting_table')<=before)throw Error('Crafting a table produced no confirmed item');
  }
  const placedAt=await this.placeBlockNear(token,'crafting_table');
  return {block:b.blockAt(placedAt),created:placedAt};
 }
 async reachUp(token,target){
  const b=this.bot;
  const dx=target.position.x+0.5-b.entity.position.x,dz=target.position.z+0.5-b.entity.position.z;
  if(Math.hypot(dx,dz)>1.8)return;
  if(target.position.y>b.entity.position.y+4||target.position.y<=b.entity.position.y)return;
  b.setControlState('jump',true);await sleep(350);b.setControlState('jump',false);await sleep(150);
  if(b.canDigBlock(target))return;
  const mat=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name)||i.name==='cobblestone');
  const below=b.blockAt(b.entity.position.floored().offset(0,-1,0));
  if(!mat||!solidSupport(below))return;
  await b.equip(mat,'hand');this.check(token);
  b.setControlState('jump',true);await sleep(200);
  try{await b.placeBlock(below,new Vec3(0,1,0));}catch{}
  await sleep(250);b.setControlState('jump',false);
 }
 async placeBlockNear(token,name){
  const b=this.bot;
  const id=b.registry.blocksByName[name]?.id;
  const seen=new Set((id?b.findBlocks({matching:id,maxDistance:6,count:16}):[]).map(p=>p.x+','+p.y+','+p.z));
  const foundNew=()=>{
   if(!id)return null;
   const spots=b.findBlocks({matching:id,maxDistance:4,count:8});
   for(const p of spots)if(!seen.has(p.x+','+p.y+','+p.z)&&b.blockAt(p)?.name===name)return p;
   return null;
  };
  const eyeReach=cell=>b.entity.position.offset(0,1.62,0).distanceTo(new Vec3(cell.x+0.5,cell.y+0.5,cell.z+0.5));
  // Voyager/ADAM placeItem: one click per candidate - the cell only needs to be air (or a
  // replaceable plant the server swaps out), the bot must not stand in it, and ANY solid
  // non-replaceable neighbour works as the reference face. The dark-oak floor failed the old
  // 12-fixed-cells top-face-only scan ("No clear spot" x15 per run) because trunks, ferns and
  // mushrooms filled every top-face slot.
  const tryCell=async(cell,support,face)=>{
   this.check(token);
   const item=b.inventory.items().find(i=>i.name===name);
   if(!item)throw Error('Ran out of '+name);
   await b.equip(item,'hand');
   // Diagnostic: what the server sent back during this click. A block_changed_ack without a
   // block update means the server received the click and rejected it (reach/hit check);
   // nothing at all means the packet never got through.
   const seenPackets={};const onPacket=(data,meta)=>{if(/^(block_change|multi_block_change|acknowledge_player_digging|block_changed_ack|position|entity_status|open_window)$/.test(meta.name))seenPackets[meta.name]=(seenPackets[meta.name]||0)+1;};
   b._client.on('packet',onPacket);
   try{await b.placeBlock(b.blockAt(new Vec3(support.x,support.y,support.z))||support,face);}catch(e){
    const p=b.entity.position;
    this.log('place '+name+' on '+(b.blockAt(new Vec3(support.x,support.y,support.z))?.name||support.name||'support')+' threw '+e.message+' | bot '+p.floored()+' held '+(b.heldItem?.name||'none')+' reach '+eyeReach(cell).toFixed(2)+' onGround '+b.entity.onGround+' packets '+JSON.stringify(seenPackets));
   }finally{b._client.removeListener('packet',onPacket);}
   await sleep(200);
   const point=new Vec3(cell.x,cell.y,cell.z);
   if(b.blockAt(point)?.name===name)return point;
   const scan=foundNew();if(scan)return scan;
   this.log('place '+name+' failed at '+point.floored()+' (support '+(b.blockAt(new Vec3(support.x,support.y,support.z))?.name||'?')+' face '+JSON.stringify(face)+'); cell is '+(b.blockAt(point)?.name||'missing'));
   return null;
  };
  const plan=()=>placementCells((x,y,z)=>b.blockAt(new Vec3(x,y,z)),b.entity.position.floored(),
   {eye:b.entity.position.offset(0,1.62,0),maxReach:4.4,botPos:b.entity.position});
  const attempt=async()=>{
   let cells=plan();
   // In reach first.
   let failed=0;
   for(const c of cells.filter(c=>c.inReach)){
    if(failed>=3)break;
    const got=await tryCell(c.cell,c.support,c.face);
    if(got)return got;
    failed++;
   }
   // Only far cells left: walk to the nearest and rescan once - placement needs reach.
   if(failed===0&&cells.length){
    const far=cells[0];
    try{await this.navigate(new goals.GoalNear(far.cell.x,far.cell.y,far.cell.z,2),token,12);}catch(e){this.check(token);}
    for(const c of plan().filter(c=>c.inReach)){
     if(failed>=3)break;
     const got=await tryCell(c.cell,c.support,c.face);
     if(got)return got;
     failed++;
    }
   }
   // Nothing fits: break one natural soft block beside the bot (leaves, grass, fern, dirt)
   // and place into the opened cell - the cluttered dark-oak floor's last honest resort.
   const soft=softBreakCell((x,y,z)=>b.blockAt(new Vec3(x,y,z)),b.entity.position.floored(),{radius:3,minY:-1,maxY:1});
   // Boxed in by stone (a gather pit): with a pickaxe, open the wall right beside the feet
   // instead - a player does exactly that - as long as no fluid sits behind the wall.
   const fluidBehind=p=>[[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]].some(([dx,dy,dz])=>['water','lava'].includes(b.blockAt(new Vec3(p.x+dx,p.y+dy,p.z+dz))?.name));
   const hasPick=b.inventory.items().some(i=>/_pickaxe$/.test(i.name));
   const hard=!soft&&hasPick?softBreakCell((x,y,z)=>{const bl=b.blockAt(new Vec3(x,y,z));return bl&&!fluidBehind({x,y,z})?bl:null;},b.entity.position.floored(),{radius:1,minY:0,maxY:1,matcher:HARD_BREAK}):null;
   const open=soft||hard;
   if(open){
    const block=b.blockAt(new Vec3(open.x,open.y,open.z));
    if(block&&eyeReach(open)<=4.4){
     this.check(token);
     this.log('place '+name+': breaking a '+open.name+' at '+new Vec3(open.x,open.y,open.z).floored()+' for room'+(hard?' (boxed in)':''));
     try{if(hard)await b.tool.equipForBlock(block);await b.dig(block);}catch(e){this.log('soft-break threw '+e.message);}
     await sleep(300);
     for(const c of plan().filter(c=>c.inReach&&c.cell.x===open.x&&c.cell.y===open.y&&c.cell.z===open.z)){
      const got=await tryCell(c.cell,c.support,c.face);if(got)return got;
     }
    }
   }
   // Still nothing: lay one dirt/plank on real ground and put the block on that pad.
   const mat=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name));
   if(!mat)throw Error('No clear spot to place a '+name);
   const feet=b.entity.position.floored();
   for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[2,0],[-2,0],[0,2],[0,-2]]){
    const point=feet.offset(dx,0,dz),ground=b.blockAt(point.offset(0,-1,0)),above=point.offset(0,1,0);
    if(point.equals(feet)||point.equals(feet.offset(0,1,0)))continue;
    if(hitsBot(b.entity.position,point.x,point.y,point.z)||hitsBot(b.entity.position,above.x,above.y,above.z))continue;
    if(!solidSupport(ground)||!empty(b.blockAt(point))||!empty(b.blockAt(above)))continue;
    if(eyeReach(point)>4.4)continue;
    this.check(token);
    const padItem=b.inventory.items().find(i=>i.name==='dirt'||/_planks$/.test(i.name));
    if(!padItem)break;
    await b.equip(padItem,'hand');
    try{await b.placeBlock(ground,new Vec3(0,1,0));}catch(e){this.log('pad on '+ground.name+' threw '+e.message);}
    await sleep(200);
    const pad=b.blockAt(point);
    if(!pad||pad.name!==padItem.name)continue;
    const got=await tryCell({x:above.x,y:above.y,z:above.z},{x:point.x,y:point.y,z:point.z,name:pad.name},{x:0,y:1,z:0});
    if(got)return got;
    break;
   }
   throw Error('No clear spot to place a '+name);
  };
  try{return await attempt();}
  catch(e){
   this.check(token);
   if(String(e.message).startsWith('Ran out'))throw e;
   // Harvested canopies decay under the candidate cells (the client's view goes stale);
   // move a few blocks over and scan a fresh patch once.
   const feet=b.entity.position.floored();
   try{await this.navigate(new goals.GoalNear(feet.x+3,feet.y,feet.z+1,1),token,12);}catch(err){this.check(token);}
   return await attempt();
  }
 }
 async pickUp(point,name,token){
  const b=this.bot,before=this.count(name);
  await this.walk(point,token,1);
  const block=b.blockAt(point);if(block?.name!==name)return;
  await b.dig(block);this.check(token);await sleep(600);await this.walk(point,token,0.8);await sleep(400);await this.sweepDrops(token);
  if(b.blockAt(point)?.name===name)throw Error('Could not pick up the '+name);
  if(this.count(name)<=before)throw Error('The '+name+' drop was not collected');
 }
 async deposit(job,token){
  const b=this.bot,p=pos(job.spec.position);await this.walk(p,token,2);const block=b.blockAt(p);
  if(!block||!['chest','trapped_chest','barrel'].includes(block.name))throw Error('No chest or barrel at that position');
  const chest=await b.openContainer(block);
  try{for(const item of b.inventory.items()){this.check(token);if(job.spec.item&&item.name!==job.spec.item)continue;if(!job.spec.item&&/(_pickaxe|_axe|_shovel|_sword|_helmet|_chestplate|_leggings|_boots)$/.test(item.name))continue;await chest.deposit(item.type,item.metadata,item.count);}await sleep(150);await b._syncWindow(chest);await sleep(150);}finally{await chest.close();}
  await sleep(150);await b._syncWindow(b.inventory);this.check(token);
  if(job.spec.item&&this.count(job.spec.item)>0)throw Error('Some items were not deposited');
 }
 async build(job,token){
  const b=this.bot,s=job.spec,blueprint=validateBlueprint(JSON.parse(fs.readFileSync(path.join(this.root,'blueprints',s.blueprint+'.json'),'utf8')));
  const entries=blueprint.blocks.map(block=>({...block,target:pos(s.origin).offset(block.x,block.y,block.z)})).sort((a,c)=>a.y-c.y);
  const footprint=new Set(entries.map(entry=>`${entry.target.x},${entry.target.z}`));
  const bounds={minX:Math.min(...entries.map(e=>e.target.x)),maxX:Math.max(...entries.map(e=>e.target.x)),minZ:Math.min(...entries.map(e=>e.target.z)),maxZ:Math.max(...entries.map(e=>e.target.z))};
  const around=async(point)=>{
   let start=b.entity.position.floored();const via=async(x,z)=>{await this.navigate(new goals.GoalBlock(x,point.y,z),token,15);start=b.entity.position.floored();};
   const xOutside=x=>x<bounds.minX||x>bounds.maxX,zOutside=z=>z<bounds.minZ||z>bounds.maxZ;
   // Use clear orthogonal lanes; diagonal corner cuts can collide with a placed block.
   if(zOutside(point.z)){
    if(!xOutside(start.x)&&((start.z<bounds.minZ)!==(point.z<bounds.minZ))){await via(bounds.minX-2,start.z);}
    await via(start.x,point.z);await via(point.x,point.z);
   }else if(xOutside(point.x)){
    if(!zOutside(start.z)&&((start.x<bounds.minX)!==(point.x<bounds.minX))){await via(start.x,bounds.minZ-2);}
    await via(point.x,start.z);await via(point.x,point.z);
   }else throw Error('Standing position intersects the build');
  };
  const avoidBuild=block=>footprint.has(`${block.position.x},${block.position.z}`)?100:0;
  this.movements.exclusionAreasStep.push(avoidBuild);b.pathfinder.setMovements(this.movements);
  try{
  if(!job.plan)job.plan=entries.map(({target,name})=>({position:target,name}));
  if(JSON.stringify(job.plan)!==JSON.stringify(entries.map(({target,name})=>({position:target,name}))))throw Error('Blueprint changed since job started; create a new job');this.save();
  // Preflight every mismatch and supply before changing any block.
  const need={};for(const e of entries){this.check(token);await this.walk(e.target,token,3);const existing=b.blockAt(e.target);if(existing?.name===e.name)continue;if(!empty(existing))throw Error('Build blocked by existing '+(existing?.name||'unloaded block')+' at '+e.target);need[e.name]=(need[e.name]||0)+1;}
  for(const [name,count]of Object.entries(need)){if(!b.registry.itemsByName[name])throw Error('Unknown building block '+name);if(this.count(name)<count)throw Error(`Need ${count} ${name}; inventory has ${this.count(name)}`);}
  const directions=[new Vec3(0,1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,-1,0)];
  let complete=0;for(const e of entries){this.check(token);await this.walk(e.target,token,3);let current=b.blockAt(e.target);
   if(current?.name!==e.name){if(!empty(current))throw Error('Another block appeared at '+e.target);let support=null,face=null;
    for(const direction of directions){const neighbor=b.blockAt(e.target.minus(direction));if(neighbor?.boundingBox==='block'){support=neighbor;face=direction;break;}}
    if(!support)throw Error('No support for block at '+e.target);
    const occupied=new Set(entries.map(entry=>entry.target.toString()));const standing=[];
    // Farther columns are tried too: fixture clutter can occupy every near one. The reach
    // check below (4.4 blocks to the support face) still filters anything too distant.
    for(const [dx,dz]of [[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[2,-2],[-2,2],[0,-4],[0,4],[-4,0],[4,0]])for(let dy=0;dy>=-3;dy--){const point=e.target.offset(dx,dy,dz);if(footprint.has(`${point.x},${point.z}`)||occupied.has(point.toString())||occupied.has(point.offset(0,1,0).toString()))continue;if(empty(b.blockAt(point))&&empty(b.blockAt(point.offset(0,1,0)))&&b.blockAt(point.offset(0,-1,0))?.boundingBox==='block')standing.push(point);}
    standing.sort((a,c)=>a.distanceTo(b.entity.position)-c.distanceTo(b.entity.position));let approached=false;
    let lastApproachError='';for(const point of standing){try{await around(point);if(b.entity.position.offset(0,1.62,0).distanceTo(support.position.offset(.5,.5,.5))>4.4)continue;approached=true;break;}catch(error){this.check(token);lastApproachError=error.message;}}
    if(!approached)throw Error('No safe reachable standing spot beside '+e.target+': '+lastApproachError);
    const item=b.inventory.items().find(i=>i.name===e.name);if(!item)throw Error('Ran out of '+e.name);
    await b.equip(item,'hand');this.check(token);await this.placeBlocks(support,face,e.target,e.name,token);current=b.blockAt(e.target);if(current?.name!==e.name)throw Error('Placement was not verified at '+e.target);
   }this.update(job,++complete,`Verified ${complete}/${entries.length} blocks`);
  }
  }finally{this.movements.exclusionAreasStep=this.movements.exclusionAreasStep.filter(fn=>fn!==avoidBuild);if(token===this.epoch)b.pathfinder.setMovements(this.movements);}
 }
}
