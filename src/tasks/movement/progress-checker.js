// Port of adris/altoclef/util/progresscheck/MovementProgressChecker.java with its
// DistanceProgressChecker, LinearProgressChecker and ProgressCheckerRetry
// (MIT License, Copyright (c) 2020 Adris Jautakas).
// The Java breaking-block branch used client ControllerExtras; here `check` accepts an
// optional {breaking,progress} report from the caller instead. The food-chain pause hook
// (Java: mod.getFoodChain().isTryingToEat()) is the `shouldPause` option.
import {Vec3} from 'vec3';
class LinearProgressChecker {
 constructor(timeout,minimum){this.timeout=timeout*1000;this.minimum=minimum;this.reset();}
 reset(){this.start=null;this.progress=null;}
 setProgress(v){if(this.start==null){this.start=Date.now();this.progress=v;}this.current=v;}
 failed(){return this.start!=null&&Date.now()-this.start>=this.timeout&&Math.abs(this.current-this.progress)<this.minimum;}
}
class DistanceProgressChecker extends LinearProgressChecker {
 setProgress(pos){super.setProgress({x:pos.x,y:pos.y,z:pos.z});}
 failed(){
  if(this.start==null||this.current==null)return false;
  const dx=this.current.x-this.progress.x,dy=this.current.y-this.progress.y,dz=this.current.z-this.progress.z;
  return Date.now()-this.start>=this.timeout&&Math.sqrt(dx*dx+dy*dy+dz*dz)<this.minimum;
 }
}
class ProgressCheckerRetry {
 constructor(checker,attempts){this.checker=checker;this.attempts=attempts;this.failures=0;this.lastFailed=false;}
 reset(){this.checker.reset();this.failures=0;this.lastFailed=false;}
 setProgress(v){this.checker.setProgress(v);if(!this.lastFailed)return;this.lastFailed=false;}
 failed(){
  const failed=this.checker.failed();
  if(!failed){this.lastFailed=false;return false;}
  if(!this.lastFailed)this.failures++;
  this.lastFailed=true;
  return this.failures>=this.attempts;
 }
}
export class MovementProgressChecker {
 // Java defaults: MovementProgressChecker(6, 0.1, 0.5, 0.001, 1)
 constructor(distanceTimeout=6,minDistance=0.1,mineTimeout=0.5,minMineProgress=0.001,attempts=1,{shouldPause}={}){
  this.distanceChecker=new ProgressCheckerRetry(new DistanceProgressChecker(distanceTimeout,minDistance),attempts);
  this.mineChecker=new LinearProgressChecker(mineTimeout,minMineProgress);
  this.shouldPause=shouldPause;
  this.lastBreakingBlock=null;
 }
 check(bot,{breaking,progress}={}){
  // Allow pause on eat.
  if(this.shouldPause&&this.shouldPause()){this.reset();}
  if(breaking){
   // A completed break counts as progress; keep the distance checker frozen until then.
   if(this.lastBreakingBlock&&this.isAir(bot,this.lastBreakingBlock)){this.distanceChecker.reset();this.mineChecker.reset();}
   this.lastBreakingBlock=this.lastBreakingBlock||breaking;
   this.mineChecker.setProgress(progress??0);
   return !this.mineChecker.failed();
  }
  this.mineChecker.reset();
  this.lastBreakingBlock=null;
  this.distanceChecker.setProgress(bot.entity.position);
  return !this.distanceChecker.failed();
 }
 isAir(bot,pos){
  try{const p=pos&&pos.floored?pos.floored():new Vec3(pos.x,pos.y,pos.z);return ['air','cave_air','void_air'].includes(bot.blockAt(p)?.name);}catch{return false;}
 }
 reset(){this.distanceChecker.reset();this.mineChecker.reset();}
}
