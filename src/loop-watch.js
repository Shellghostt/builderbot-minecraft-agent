// Event-loop watchdog (cloud round 5). Round 4 ended with 'BuilderBot lost connection: Timed
// out' right after the drowning: a client that stops answering keep-alives for ~30 s is
// dropped, and every keep-alive answer waits behind whatever synchronous work holds the
// event loop. Two probes, both rate limited and both cheap:
// - timeTick: wraps a periodic tick (runner, trackers, autopilot) and names it, with its own
//   breakdown, when one call takes longer than SLOW_TICK_MS;
// - startLagMonitor: a 250 ms timer that reports when it fires late by more than
//   SLOW_TICK_MS (a stall from anywhere: a pathfinder search, a sync write, GC).
// Lines start with LOOP_SLOW / LOOP_STALL, like PACKET_BUDGET, so a soak grep finds them.
import {performance} from 'node:perf_hooks';
export const SLOW_TICK_MS=500,LOG_EVERY_MS=5000;
const clock=()=>performance.now();
function limiter(now){
 const last=new Map(),dropped=new Map();
 return (key,emit)=>{
  const t=now(),prev=last.get(key);
  if(prev!=null&&t-prev<LOG_EVERY_MS){dropped.set(key,(dropped.get(key)||0)+1);return;}
  last.set(key,t);const n=dropped.get(key)||0;dropped.set(key,0);
  emit(n);
 };
}
export function createLoopWatch({log=()=>{},now=clock,limit=SLOW_TICK_MS}={}){
 const gate=limiter(now);
 const out=line=>{try{console.log(line);}catch{}try{log(line);}catch{}};
 const watch={
  slow:0,stalls:0,worst:0,
  // detail: optional () => string, read only when the tick was slow.
  timeTick(name,fn,detail){
   const t0=now();
   try{return fn();}
   finally{
    const ms=now()-t0;
    if(ms>limit){
     watch.slow++;watch.worst=Math.max(watch.worst,ms);
     gate('tick:'+name,n=>out('LOOP_SLOW '+name+' tick '+Math.round(ms)+' ms'+(detail?' ('+detail()+')':'')+(n?' [+'+n+' more]':'')));
    }
   }
  },
  stall(ms){
   watch.stalls++;watch.worst=Math.max(watch.worst,ms);
   gate('stall',n=>out('LOOP_STALL event loop '+Math.round(ms)+' ms late (keep-alive answers wait behind it)'+(n?' [+'+n+' more]':'')));
  },
  start(intervalMs=250){
   if(watch.timer)return watch.timer;
   let last=now();
   watch.timer=setInterval(()=>{const t=now(),late=t-last-intervalMs;last=t;if(late>limit)watch.stall(late);},intervalMs);
   if(watch.timer.unref)watch.timer.unref();
   return watch.timer;
  },
  stop(){if(watch.timer){clearInterval(watch.timer);watch.timer=null;}}
 };
 return watch;
}
