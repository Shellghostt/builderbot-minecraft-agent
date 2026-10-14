// Port of adris/altoclef chains/SingleTaskChain.java — the convention for chains that run
// one root task at a time. With the frozen TASK_API the runner (src/tasks/runner.js) owns
// the task lifecycle (start/stop/child switching), so this base only holds the root and the
// cached priority that MobDefenseChain reuses while a run-away keeps going.
// Original AltoClef (https://github.com/gaucho-matrero/altoclef,
// commit af22e3bc2f03dde45da703f5f7535baae18ea486), MIT License,
// Copyright (c) 2020 Adris Jautakas. See third_party/ALTOCLEF_LICENSE.
import {TaskChain} from '../tasks/chain.js';
export class SingleTaskChain extends TaskChain{
 constructor(name){super(name);this._cachedLastPriority=-1;this._doingFunkyStuff=false;}
 onTick(bot,ctx){
  // contract: a chain whose root has ended returns null so the runner stops it cleanly
  // (Java SingleTaskChain.onTaskFinish bookkeeping lives here instead of the runner).
  if(this.root&&(this.root.isFinished(bot,ctx)||this.root.stopped))this.root=null;
  return this.root;
 }
 setTask(task){this.root=task;return task;}
 isCurrentlyRunning(bot,ctx){return !!this.root&&!this.root.isFinished(bot,ctx);}
 // AltoClef: chains expose acrobatics so FoodChain pauses eating mid-dodge.
 isDoingAcrobatics(){return this._doingFunkyStuff;}
}
