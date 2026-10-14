// Ported from AltoClef tasks/resources/SatisfyMiningRequirementTask.java: make sure we
// have a tool at or above a mining level.
// MIT License, Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {Task} from '../task.js';
import {REQUIREMENT_TOOL,miningRequirementMet,taskCtx} from './util.js';
import {getItemTask} from '../catalogue.js';

export class SatisfyMiningRequirementTask extends Task {
 constructor(requirement){
  super('SatisfyMiningRequirement');
  this.requirement=requirement;
 }
 onTick(bot,ctx){
  ctx=taskCtx(this,ctx);
  const tool=REQUIREMENT_TOOL[this.requirement];
  if(!tool)return null; // HAND will never happen if you program this right
  return getItemTask(bot,tool,1,ctx); // catalogue returns null with a warning when unknown
 }
 isFinished(bot){return miningRequirementMet(bot,this.requirement);}
 isEqual(other){return other instanceof SatisfyMiningRequirementTask&&other.requirement===this.requirement;}
 toString(){return 'Satisfy Mining Req: '+this.requirement;}
}
