# Phase 7A: port AltoClef's core into BuilderBot

## Why
BuilderBot runs a queue of long blocking jobs: when one fails, later work pauses, and survival behaviour lives in a separate reflex loop that races the jobs. AltoClef (the first bot to beat Minecraft fully autonomously) instead runs a tree of small tasks that is re-evaluated every game tick, with prioritised chains (mob defense, food, world survival, user task) that take control the moment they matter. Port that architecture and its proven logic, then rebuild our behaviour on top of it.

## Source and licence
- Reference source (read-only, never build or run it): `D:\Usefu Shi\Epic\SGSMP\reference\altoclef\` (commit af22e3bc2f03dde45da703f5f7535baae18ea486, 2023-12-21). Java, Fabric client mod, built on Baritone.
- Licence: MIT, Copyright (c) 2020 Adris Jautakas. Every ported file must start with a header naming the original AltoClef file(s) it was ported from and the MIT copyright notice. Add the full licence text as `minecraft-agent/third_party/ALTOCLEF_LICENSE`.
- Do NOT port Baritone code (separate project, LGPL). Where AltoClef calls Baritone (pathing, mining processes, block placement), use our mineflayer-pathfinder based helpers instead.
- This is a translation from Java (Minecraft client + Baritone APIs) to JavaScript (Mineflayer). Translate the logic and decisions; map each client/Baritone call to the Mineflayer equivalent; write small adapters where needed.

## What to port (paths relative to src/main/java/adris/altoclef/)

1. **Task system** (`tasksystem/Task.java`, `TaskRunner.java`, `TaskChain.java`, `ITask*.java`, `chains/SingleTaskChain.java`) -> `src/tasks/task.js`, `src/tasks/runner.js`, `src/tasks/chain.js`.
   - Task lifecycle: onStart / onTick (returns the subtask to run, or null) / onStop(interruptTask) / isFinished / isEqual, with automatic subtask switching when the returned subtask is not equal to the current one, exactly as AltoClef does.
   - TaskRunner ticks every physics tick (or every 50 ms), asks every chain for its priority, and runs the highest-priority chain; switching chains stops the previous chain's task cleanly. This replaces Worker.pump's job queue as the scheduler, and it is the ONLY owner of the pathfinder and controls (reuse the ownership rules from the race fix).
2. **Chains** (`chains/MobDefenseChain.java`, `FoodChain.java`, `WorldSurvivalChain.java`, `MLGBucketFallChain.java`, `UserTaskChain.java`, `DeathMenuChain.java` as respawn handling) -> `src/chains/*.js`. These replace src/reflexes.js. Port their priority values and decision logic, adapting thresholds to docs/COMBAT_SPEC.md section 7f (never fight unarmed, flee/shelter/get armed first).
3. **Resource tasks** (`tasks/ResourceTask.java`, `tasks/resources/*` for the overworld items we need: planks, sticks, cobblestone, wood, flint, food, wool, wheat/seeds, sand/sandstone, fuel, coal/iron via MineAndCollect, SatisfyMiningRequirement, CraftWithMatchingMaterials/Planks/Wool, KillAndLoot, ShearAndCollect, CollectBucketLiquid, CollectBed; `tasks/container/*` for crafting/smelting/storage; `TaskCatalogue.java` for the item -> task mapping) -> `src/tasks/resources/*.js` and `src/tasks/catalogue.js`. Keep our minecraft-data based howto as the recipe source of truth for this server version.
4. **Trackers** (`trackers/BlockTracker.java`, `EntityTracker.java`, `storage/*`, `blacklisting/*`) -> `src/trackers/*.js`. The blacklisting (give up on unreachable blocks/entities for a while) directly fixes our "gather attempt N failed" loops.
5. **Movement helpers** from `tasks/movement/*` that do not depend on Baritone internals (get-to-block/entity/xz, run away from entities/creepers, escape from lava, get out of water, timeout/stuck wanderer, search chunks) -> `src/tasks/movement/*.js` on top of mineflayer-pathfinder, keeping our safe dig rules (natural blocks only, never straight down, never next to fluids, never player-made blocks) and the canopy/trunk handling just added.

Skip: speedrun/Nether/End tasks, butler, piglin trading, UI, mixins, commands, chat, and anything multiplayer-griefing related.

## Integration rules
- Our existing verified jobs (gather, craft, smelt, deposit, build, place, use, shear, breed, hunt, obtain, explore, sleep, shelter, equip, eat) must keep working through the API/MCP with the same JSON. Re-implement each as a task (or a thin task wrapping existing tested code) run by UserTaskChain. Verification of results stays.
- The autopilot ladder becomes a top-level task (like AltoClef's goal tasks) re-evaluated every tick, not a queue.
- Stop / Resume / cancel / death handling keep the same API behaviour.
- Safety rules from AUTONOMY_SPEC.md, AGENTS.md and the no-kill-by-name rule all still apply.

## Work split (subagents, disjoint files; only the main agent restarts services and runs live tests)
- **P1 task system**: src/tasks/task.js, runner.js, chain.js + unit tests (fake bot).
- **P2 chains**: src/chains/*.js + unit tests.
- **P3 resource tasks + catalogue**: src/tasks/resources/*, src/tasks/container/*, src/tasks/catalogue.js + unit tests.
- **P4 trackers + movement**: src/trackers/*, src/tasks/movement/* + unit tests.
- **Main agent**: defines the shared interfaces first (task/chain/tracker JS interfaces in a short docs/TASK_API.md) so subagents agree, then wires the runner into src/worker.js and src/app.js (main agent owns those), migrates jobs to tasks, retires src/reflexes.js and the old queue only when parity tests pass.

## Acceptance
- All existing unit tests and the full integration suite pass (45+ groups), plus new unit tests for the task system, chains and blacklisting.
- New integration tests: a job interrupted by a zombie resumes automatically with no 'Resume' needed; an unreachable log is blacklisted and another tree is used; food chain eats mid-task; world-survival chain escapes lava/water.
- The fair 3-run soak (same protocol) is re-run and compared with the pre-port baseline: report wood/stone milestones, deaths and interventions for both.
- Report honestly, including which AltoClef files were ported, which were adapted, and which were skipped.
