// Cloud round 5, task 3: the soak recorded 1 death where the server log had 4. The bot keeps
// a monotonic death counter in /api/state that no event window can scroll away, including
// deaths during a flee or a shelter and after a respawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {Worker} from '../src/worker.js';
console.error=()=>{};
test('every death counts once in state().deaths with where, what killed it and the running job',()=>{
 const root=fs.mkdtempSync(path.join(process.env.TEMP||os.tmpdir(),'deaths-'));
 const timers=[];const realSet=global.setTimeout;
 try{
  const worker=new Worker(root,{limits:{minHealth:10,minFood:6,jobMinutes:5}});
  const bot=new EventEmitter();
  Object.assign(bot,{entities:{},health:0,entity:{position:new Vec3(145,127,34)},clearControlStates(){},stopDigging(){return {catch(){}};},
   pathfinder:{stop(){},setGoal(){},setMovements(){}},respawn(){}});
  bot.entities[2]={name:'skeleton',type:'hostile',position:new Vec3(150,127,34)};
  worker.bot=bot;worker.log=()=>{};
  global.setTimeout=(fn,ms)=>{timers.push(fn);return {unref(){}};}; // no real respawn timer
  worker.jobs.push({id:'s',spec:{type:'shelter'},status:'running',message:'Waiting for morning'});
  worker.onDeath(bot);
  // Respawned, then shot again before the next sample (hard3, 21:11Z and 21:14Z).
  for(let i=0;i<50;i++)worker.log('Reflex: fleeing zombie,zombie,skeleton (unarmed)');
  worker.jobs.push({id:'f',spec:{type:'explore'},status:'running',message:'Working'});
  delete bot.entities[2];
  worker.onDeath(bot);
  const st=worker.state();
  assert.equal(st.deaths,2);
  assert.equal(st.deathLog.length,2);
  assert.deepEqual(st.deathLog.map(d=>[d.killer,d.job]),[['skeleton','shelter'],[null,'explore']]);
  assert.equal(Math.floor(st.deathLog[0].pos.x),145);
 }finally{global.setTimeout=realSet;fs.rmSync(root,{recursive:true,force:true});}
});
