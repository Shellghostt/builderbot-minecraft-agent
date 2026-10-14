// Port of adris/altoclef chains/DeathMenuChain.java as RespawnChain. The client-side parts
// (death screen class, reconnect screens) have no mineflayer equivalent: death is
// bot.health <= 0, and respawn is the client_command packet (or a bot.respawn helper when
// the wiring provides one). Faithful timings: wait 2s on the death screen before
// respawning, retry every 8s, count deaths, and cancel the user task when auto-respawn is
// disabled (via the onDeath callback instead of mod.cancelUserTask).
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {TaskChain} from '../tasks/chain.js';
import {chainConfig,inGame} from './settings.js';
export class RespawnChain extends TaskChain{
 constructor({onDeath=null}={}){
  super('Respawn');
  this.onDeath=onDeath;
  this._deadSince=null;
  this._lastAttempt=-1e12;
  this._deathCount=0;
  this.now=()=>Date.now()/1000;
 }
 get deathCount(){return this._deathCount;}
 priority(bot,ctx){
  if(!inGame(bot))return -1;
  if(bot.health>0){this._deadSince=null;return -1;}
  // Death outranks every survival chain: Java handles it outside the priority race, we
  // put it at the top of the survival band. With auto-respawn off the chain stays active
  // anyway so onTick can announce the death (DeathMenuChain's cancel path).
  return 100;
 }
 onTick(bot,ctx){
  const cfg=chainConfig(ctx);
  if(!inGame(bot))return null;
  if(bot.health>0){this._deadSince=null;return null;}
  if(cfg.autoRespawn===false){
   if(!this._announced){this._announced=true;if(this.onDeath)this.onDeath(bot,ctx);}
   return null;
  }
  this._announced=false;
  const now=this.now();
  if(this._deadSince==null)this._deadSince=now;
  if(now-this._deadSince<cfg.respawnDelayMs/1000)return null;
  if(now-this._lastAttempt<cfg.respawnRetryMs/1000)return null;
  this._lastAttempt=now;
  this._deathCount++;
  this._respawn(bot);
  return null;
 }
 _respawn(bot){
  if(typeof bot.respawn==='function'){const p=bot.respawn();p&&p.catch&&p.catch(()=>{});return;}
  try{bot._client.write('client_command',{actionId:0});}catch{}
 }
}
