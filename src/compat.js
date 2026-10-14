// Minecraft 26.3 requires client tick boundaries between movement packets.
// Upstream diagnosis: PrismarineJS/mineflayer#4128 (pending in 4.39.0).
// Apply per connection; no global package files or server settings are changed.
// While asleep the server rejects client movement, so those packets are suppressed.
export function installMovementFix(bot){
 const client=bot._client,write=client.write.bind(client);
 let enabled=false;
 // Windows timer hiccups make the physics catch-up loop burst position packets (300+/s),
 // which 26.3 servers reject with "You are sending too many packets!". Cap movement and
 // input packets at 30 per second; dropped intermediate positions are superseded by the next.
 let packetCount=0,packetSecond=Date.now(),lastName='';
 let movementSent=0,movementSecond=Date.now(),inputSent=0,inputSecond=Date.now();
 let lastKeepAlive=0,lastTeleportConfirm=0,lastConfirmedTeleportId=null;
 const allowPace=(sentRef,secondRef)=>{
  const now=Date.now();
  if(now-secondRef.second>1000){secondRef.second=now;sentRef.count=0;}
  sentRef.count++;
  return sentRef.count<=30;
 };
 const movementPace={count:0},movementClock={second:Date.now()},inputPace={count:0},inputClock={second:Date.now()};
 const countPacket=name=>{packetCount++;lastName=name;const now=Date.now();if(now-packetSecond>1000){if(packetCount>45)console.log('PACKET_RATE',packetCount,'per second, last:',lastName);packetCount=0;packetSecond=now;}};
 bot.once('inject_allowed',()=>{enabled=bot.registry.version['>=']('1.21.3');});
 bot.once('login',()=>{enabled=bot.registry.version['>=']('1.21.3');});
 // 1.21.11+/26.x servers reject a move whose player box lands exactly on a block edge
 // (isPlayerCollidingWithAnythingNew: a float-exact 0.3 half-width "clips" the neighbour)
 // and snap the bot back silently, 16+ times a second in cluttered terrain, which is why
 // explore legs made no progress and the teleport gate jammed. Keeping the client's box a
 // hair wider than the server's keeps it off the edge (PrismarineJS/mineflayer#3911, #3913;
 // mineflayer-pathfinder#364). prismarine-physics reads these live.
 const padHitbox=()=>{if(bot.physics&&bot.physics.playerHalfWidth===0.3){bot.physics.playerHalfWidth=0.30001;bot.physics.playerHeight=1.80001;}};
 padHitbox();bot.once('login',padHitbox);
 bot.on('physicsTick',()=>{
  if(!enabled||client.state!=='play'||!bot.getControlState||bot.isSleeping)return;
  if(!allowPace(inputPace,inputClock))return;
  write('player_input',{inputs:{forward:bot.getControlState('forward'),backward:bot.getControlState('back'),left:bot.getControlState('left'),right:bot.getControlState('right'),jump:bot.getControlState('jump'),shift:bot.getControlState('sneak'),sprint:bot.getControlState('sprint')}});
 });
 client.write=(name,data)=>{
  countPacket(name);
  // The protocol layer's keep-alive timer also catches up in bursts on Windows; the server
  // only needs one reply per request, so pace those too.
  if(name==='keep_alive'){
   const now=Date.now();
   if(now-lastKeepAlive<500)return undefined;
   lastKeepAlive=now;
  }
  // Physics catch-up sends position_look (not bare position) whenever yaw also changes.
  // That packet was uncapped, so a bed teleport plus a look every tick crossed Paper's
  // packet limit and kicked the bot mid-sleep (integration 2026-10-14 09:22 and 09:39,
  // "You are sending too many packets!"). Pure look stays uncapped so a shot still lands.
  const paced=name==='position'||name==='position_look'||name==='flying';
  const movement=['position','position_look','look','flying'].includes(name);
  if(bot.isSleeping&&movement)return undefined;
  if(paced&&!allowPace(movementPace,movementClock))return undefined;
  if(name==='teleport_confirm'){
   // Every teleport id must be confirmed exactly once. Paper does not re-send an unconfirmed
   // teleport (updateAwaitingTeleport has the resend disabled), so a dropped confirm leaves
   // the server awaiting it for good: it then ignores every movement packet AND every block
   // interaction (handleUseItemOn requires awaitingPositionFromClient == null). Two teleports
   // inside 100 ms ("moved too quickly" bursts) used to lose the second confirm this way,
   // and placements then timed out with "Server did not answer" until the next teleport.
   if(data&&data.teleportId===lastConfirmedTeleportId)return undefined;
   lastConfirmedTeleportId=data&&data.teleportId;
   lastTeleportConfirm=Date.now();
  }
  if(name==='teleport_confirm'&&bot.entity){
   data={...data,x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z,yRot:180-bot.entity.yaw*180/Math.PI,xRot:-bot.entity.pitch*180/Math.PI};
  }
  const result=write(name,data);
  if(enabled&&client.state==='play'&&!bot.isSleeping&&movement)write('tick_end',{});
  return result;
 };
 const timer=setInterval(()=>{if(enabled&&client.state==='play'&&!bot.isSleeping)write('tick_end',{});},50);timer.unref();
 bot.once('end',()=>clearInterval(timer));
}

// Weather from the rain/thunder LEVELS, not from the begin/end flags.
// mineflayer's rain plugin names game event 1 'start_raining' and 2 'stop_raining', but on this
// server (Paper 26.3 through ViaBackwards to a 1.21.4 client) event 1 arrives when the sky
// CLEARS and event 2 when rain BEGINS (the historical protocol table: 1 = end raining,
// 2 = begin raining; the names were measured here with a second bot, 2026-10-14). The plugin's
// level handler only corrects the flag when the level crosses 0, so after `weather clear` the
// flag could stay `isRaining=true` for the rest of the session (the soak's dawn/clear check then
// failed on every run after the first death). Every join/respawn re-sends the levels, so the
// level itself is the reliable signal: raining = rain level past the half-way point of its
// 5-second fade. Falls back to the plugin's flags until the first level packet arrives.
export function installWeatherFix(bot){
 let rainLevel=null,thunderLevel=null,pluginRaining=false,pluginThunder=0;
 Object.defineProperty(bot,'isRaining',{configurable:true,enumerable:true,
  get(){return rainLevel===null?pluginRaining:rainLevel>0.5;},
  set(v){pluginRaining=!!v;}});
 Object.defineProperty(bot,'thunderState',{configurable:true,enumerable:true,
  get(){return thunderLevel===null?pluginThunder:(thunderLevel>0.5?thunderLevel:0);},
  set(v){pluginThunder=v;}});
 bot.weatherLevels=()=>({rain:rainLevel,thunder:thunderLevel});
 bot._client.on('game_state_change',packet=>{
  const reason=packet.reason;
  const value=Number(packet.gameMode)||0;
  if(reason==='rain_level_change'||reason===7)rainLevel=value;
  else if(reason==='thunder_level_change'||reason===8)thunderLevel=value;
 });
}
