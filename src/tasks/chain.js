// Port of adris/altoclef/tasksystem/TaskChain.java and chains/SingleTaskChain.java (AltoClef, commit
// af22e3bc2f03dde45da703f5f7535baae18ea486), collapsed to the frozen docs/TASK_API.md interface: the
// chain only reports priority() and builds/keeps `root`; SingleTaskChain's setTask / onTaskFinish /
// onInterrupt bookkeeping became the runner's root-switching and tree-teardown rules instead. A chain
// that wants its root to end must return null (or a different task) once root.isFinished / root.stopped -
// the runner restarts an equal-but-stopped root fresh, the way SingleTaskChain.setTask replaces tasks.
// Neither Java file calls Baritone; AltoClef's mod becomes (bot, ctx).
// MIT License, Copyright (c) 2020 Adris Jautakas (full text: third_party/ALTOCLEF_LICENSE).
export class TaskChain{
 constructor(name){this.name=name;this.root=null;this.started=false;}
 priority(bot,ctx){return -1;} // >=0 active, higher wins; -1 inactive (skipped this tick)
 onTick(bot,ctx){return this.root;} // the root Task for this tick (chain builds/keeps it)
 onStartup(bot,ctx){this.started=true;} // became the runner's current chain
 onStopped(bot,ctx){this.started=false;} // lost the runner to another chain, or runner.stop()
}
