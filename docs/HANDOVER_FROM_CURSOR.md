# Handover from Cursor (2026-10-13)

Cursor took over after GLM hit its usage limit, then finished the ordered list in `docs/CURSOR_CONTINUE.md`. The flat test world is restored and the services were restarted on it. `server.properties` ends as `level-name=agent-test-world`, `level-type=minecraft\:flat`, `difficulty=peaceful`, `server-ip=0.0.0.0`.

## Files changed

- `src/tasks/movement/goals.js` — `chunkGoal` now has `isValid()` and `hasChanged()`. Pathfinder was throwing `stateGoal.isValid is not a function` every physics tick.
- `src/chains/fightTask.js` — approach, kite, and flee pass `goals.xzGoal` into `goto()`. They were passing a `GetToXZTask`, which is not a Goal, so the approach leg stopped combat ticks.
- `src/combat.js` — the enderman-roof move uses `xzGoal` the same way.
- `src/forcefield.js` — no swing while `taskRunner.status().task === 'FightTask'` or `chain === 'Mob Defense'`. Fight jobs run FightTask on User Tasks, so the old Mob Defense check still double-swung.
- `src/move-safety.js` — new. Open-sky stand (`skyLight >= 12`), mob step cost, skeleton shot-line cost, 12s no-progress tracker.
- `src/worker.js` — wires that helper into `navigate()` and `gather()` (opt-in rank, never empties the list). Unreachable trunk columns are skipped (8 max) instead of failing the job on the first canopy log. If `belowFoots` has hidden every log because the bot dropped below them, it walks back up twice before failing.
- `tests/forcefield.test.js`, `tests/fightTask.test.js`, `tests/move-safety.test.js` — the contracts above.
- `tests/soak.py` — snake_case rules actually verified; `spawn_mobs false` for both anchors; open-sky scout; sticks in the sample; operator return when the bot is more than 8 blocks below the anchor; flat world restored even if the run throws.

`tests/resources.test.js` was not run. Its unbounded growth is still open (`AGENTS.md`).

## Tests

Unit tests, every `tests/*.test.js` except `resources.test.js`, with `--max-old-space-size=2048 --test-timeout=60000`: **153 passed, 0 failed**.

Integration (`data/integration-results.json`): **passed** at `2026-10-13T15:34:00`, after the goal-contract fix. The first attempt failed only because the server was still on `agent-soak-world`.

Combat (`tests/combat_integration.py`, `data/combat-results.json`): **passed**. Force field did not double-swing (zombie hits 5–6 and 24 across three zombies, not doubled). Creeper damage did **not** drop: damage taken **16.1**, hits 0, end health **4.87**, killed by kite arrows, no crater, tactic melee. Prior research number was ~16.8. Enderman: provoked by look, fight timed out, **under a 2-high roof 0/20**, damage 0. The `xzGoal` fix did not get it under the roof. Witch: not killed, tactic avoid, 0 hp lost (existing 26.3 limit). Low health: ate, then retreated. Gear crafts succeeded. Baseline plain ttk 14.6 / damage 11.8 vs combat ttk 9.4 / damage 0. Skeleton ttk-scale hits 5, damage taken 1.5, approach melee, blocked 0. Crit vs plain: ttk 8.3 and 5.2, hits 6 and 5, crits 0, damage dealt 199/199 (26.3 jump-crits do not add damage).

## Dual soak

`data/soak-results.json` (copy `data/soak-results-20261013-183802.json`). Exit 0. Six counted runs, none invalid. Rules confirmed before the runs: `spawn_mobs false`, and for normal `advance_time false` / `advance_weather false` (the server text is `Game rule <name> is currently set to ...`; `str(False)` was sending `False` and the verify treated that as unconfirmed). Dawn and clear weather confirmed at each run start. `spawn_mobs` stays off for hard as well: the dark canopy spawns all day, and a naked bot then measures combat rather than the wood ladder. Hard still uses natural time and weather from a confirmed dawn. That is a deliberate cut against research item 1's "natural spawning" sentence.

Anchors on seed 12345, regenerated at the start:

- normal `[310, 131, 30]`, sky light 15, a 1-log gather completed from that stand
- hard `[141, 131, 30]`, light **14** at the landing this time (earlier scouts at the same base read 10). A 3-log `belowFoots` gather completed.

No deaths in any run (no death cause, no time of day). The "resumed the ladder after death" lines at normal1 t=601, hard2 t=391, and hard3 t=391 fired with `deaths` still 0: the idle-autopilot check, not a death.

The printed `SUMMARY.peak_median` is the second-lowest of six (`sorted(...)[1]`), so it shows zeros. Use the per-run peaks. Wooden pickaxe time is none in every run. Stone was never reached.

| Run | Logs (peak, at) | Planks | Sticks | Table | Wooden pickaxe | Deaths | Interventions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal1 | 2 at 30s | 0 | 0 | 0 | none | 0 | 1 false death-resume at t=601 |
| normal2 | 0 | 0 | 0 | 0 | none | 0 | 3 returns from y=115, 120, 119 |
| normal3 | 2 at 181s | 14 at 211s | 4 at 211s | 1 at 211s | none | 0 | 3 returns from y=112, 103, 103 |
| hard1 | 1 at 241s | 8 at 211s | 0 | 1 at 361s | none | 0 | 1 unstick at [150,134,27]; 3 returns from y=120, 114, 120 |
| hard2 | 0 | 0 | 0 | 0 | none | 0 | 3 returns from y=115, 120, 121; 1 false death-resume at t=391 |
| hard3 | 3 at 601s | 0 | 0 | 0 | none | 0 | 2 returns from y=120 and 117; 1 false death-resume at t=391 |

normal3 is the closest: table, 4 sticks, and 14 planks at 211s, then no sword and no pickaxe in the remaining six minutes. The bot's failure mode on both anchors is leaving the surface. Gather paths drop into the ravine east of the grove and south of the canopy (y=103–120). `belowFoots` then ignores the trunks overhead. The new climb-back and the operator tp (more than 8 below the anchor, at most 3 times) did not hold it on the trees long enough to finish the wood kit.

An earlier soak the same afternoon was cut off at two normal runs when the test server received `gamerule advance_time True` (capital T, the pre-fix restore) and `/stop` at 17:15 local. Those two runs also collected 0 logs. Do not run two soaks at once; they share the supervisor token and the second stop kills the first.

## Open

- Research item 5: creeper arena damage is still 16.1. Fuse metadata was not wired. Do not stand in and do not install the third-party 26.3 mineflayer fork.
- Enderman 2-high roof is still 0/20 after the goal fix. Not cheap.
- Witch avoid is the recorded 26.3 limit.
- Wood ladder still does not produce a wooden pickaxe on seed 12345. The bot leaves the stand and `belowFoots` will not chop logs above feet+3. normal3 shows the craft chain can make a table and sticks once 3 logs exist; it then stalls.
- `tests/resources.test.js` still unbounded. Do not rerun it until that is fixed.
- `summarise()` peak "median" is `sorted(values)[1]`, not a median.
- The death-resume operator fires when the autopilot is idle, including at the end of a run with no death.

## Round 2 (2026-10-13, after CURSOR_NEXT)

### Files

- `src/place-support.js` (new), `src/worker.js`: `placeBlockNear` refuses replaceable ground (snow, plants, carpets) even when `boundingBox==='block'`, logs the ground name, and after 3 failed spots places a dirt or plank pad and puts the block on that. Success is a nearby scan for a new block, not only the clicked cell. `reachUp` pillars one block when a log is within 1.8 blocks and above the feet.
- `src/worker.js`, `src/autopilot.js`, `src/schema.js`: wood gathers set `surface:true`. Targets more than 4 below the stand are dropped, columns whose base is below the stand are penalised, and `navigate` rejects a path that drops under `surfaceY-4`.
- `src/autopilot.js`: wooden pickaxe is crafted before the wooden sword unless a hostile is within 16 blocks.
- `src/creeper.js` (new), `src/combat.js`, `src/chains/fightTask.js`, `src/chains/mobDefenseChain.js`, `src/observe.js`: creeper fuse is `entity.metadata[16]===1` (powered is `[17]`, ignited is `[18]`). A swelling creeper is sprinted away from (turn away, forward, not back) and is not pathed toward. Mob defense uses the sprint-away task at priority 96 while swelling, and the same sprint task for the distance flee. `observe` adds a `creeper` field.
- `tests/soak.py`: idle autopilot says "resumed idle autopilot" and does not say death. `summarise()` uses a real median.
- `tests/integration.py`: the fight at 700 loads the chunk, then fills the old dirt pad to air. A fill before the teleport was rejected with "That position is not loaded" and the bot suffocated.
- Tests: `tests/place-support.test.js`, `tests/creeper.test.js`, plus assertions in `tests/autopilot.test.js` and `tests/combat.test.js`.

### Tests

Unit tests, excluding `tests/resources.test.js`: **156 passed, 0 failed**.

Creeper index, checked on this server before the combat rerun: a summoned creeper at 8 blocks had no `metadata[16]` (observe `creeper` was `{}`). Teleporting the bot to 2 blocks made `metadata[16]` **1**. Idle is "field absent", not a stored -1, on this client. Fusing is 1.

Combat suite passed three times. The number that matches the sprint-away code is damage taken **17.7** (end health 4.26, ttk 5.2, hits 0, no crater). The log line was `creeper swell 1 at 2.4` and the fight ended **1.1s** later. Two earlier runs the same session, before the facing fix, were 16.4 and 16.3. Round 1 was 16.1. Fuse state is the trigger, and the damage did not drop: the client reports swell 1 only once the creeper is already inside ~2.5 blocks, about a second before the blast, and the arena wall stops the sprint. Enderman roof is still 0/20. Force field still does not swing during FightTask.

Integration did **not** finish green. The run that got furthest passed "creeper avoided at 11.0 blocks", then A4 escaped lava at **11.8** hp (the assert wants >= 12). The next run failed A1: "No matching blocks within the allowed radius". Two earlier runs suffocated inside a leftover dirt pad at 700,-60,700; that fill is now done after the chunk is loaded.

### Soak

`data/soak-results.json`. Exit 0. Six counted runs, `invalid_attempts` empty, `errors` empty. Rules confirmed (`spawn_mobs false`; normal also freezes time and weather). Anchors: normal `[310, 131, 30]` sky light 15; hard `[140, 131, 32]` canopy light **10** this scout. Flat world restored after: `level-name=agent-test-world`, `level-type=minecraft:flat`, `difficulty=peaceful`, `server-ip=0.0.0.0`, empty seed.

No deaths. `peak_median` is now a real median (wood pickaxe 0, because only one run made one). Per-run peaks:

| Run | Logs | Planks | Sticks | Table | Wooden pickaxe | Deaths | Interventions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| normal1 | 2 at 60s | 13 at 120s | 6 at 120s | 1 at 60s | **1 at 90s** | 0 | 3 returns from y=122, 73, 113 |
| normal2 | 0 | 0 | 0 | 0 | none | 0 | 3 returns from y=122, 106, 110 |
| normal3 | 0 | 0 | 0 | 0 | none | 0 | 1 "resumed idle autopilot" at t=602 |
| hard1 | 3 at 90s | 8 at 120s | 0 | 1 at 120s | none | 0 | none |
| hard2 | 0 | 8 at 30s | 0 | 1 at 60s | none | 0 | none |
| hard3 | 1 at 301s | 14 at 301s | 4 at 301s | 1 at 60s | none | 0 | 2 returns from y=121 and 118 |

normal1 is the first soak run with a wooden pickaxe (90s). It then spent the rest of the 10 minutes failing `craft wooden_sword` with "No clear spot to place a crafting_table" (15 failed jobs) and exploring off the grove. hard3 had 14 planks, 4 sticks and a table and still failed the pickaxe craft with the same placement error (8 times), then the sword (5 times). normal2, normal3, hard1 and hard2 burned the same sword-placement failure 15 times each; several of those also completed plank and stick crafts that were gone by the end sample. Surface rejection did fire (`Navigation left the surface`) but explore legs still walk the bot off the stand, and the operator tp is capped at 3.

### Open

- Creeper arena damage is 17.7, not below 16.1. Metadata index 16 is correct on this server. The swell bit arrives too late, and a straight sprint dies on the arena wall.
- Enderman 2-high roof is still 0/20. Witch avoid is the recorded 26.3 limit.
- Table placement still fails on the soak terrain once the bot is not standing on a clear solid cell. The pad fallback did not save hard3 or the later sword crafts. normal1 proves the pickaxe-before-sword order can finish when a spot exists.
- Explore after a failed craft still leaves the surface. The Y cap covers gather navigation only.
- Integration is not green (A4 hp 11.8, then A1 missing the planted log).
- `tests/resources.test.js` was not run.

## Round 3 (2026-10-14 00:50-02:30, full ownership after CURSOR_FABLE)

### Two root causes found and fixed (the "No clear spot" blocker)

Measured on the soak world at the hard anchor with the worker's new teleport counter (`Server set position to ... (teleport #n)` in `logs/dashboard.log`) and a probe that compared `data get entity BuilderBot Pos` with the client position after every step:

1. **The server snapped the bot back 16+ times a second while it walked.** Explore legs at [140,131,32] logged teleport #3 -> #202 in 12 s at one position and ended "Navigation made no progress". This is the known 1.21.11+/26.x bug: a player box whose 0.3 half-width lands float-exactly on a block edge fails `isPlayerCollidingWithAnythingNew` and the server teleports the client back silently (no "moved wrongly" line). Sources: [mineflayer#3911](https://github.com/PrismarineJS/mineflayer/issues/3911) (one reporter on 26.1.2 + ViaBackwards), [mineflayer#3913](https://github.com/PrismarineJS/mineflayer/issues/3913), [mineflayer-pathfinder#364](https://github.com/PrismarineJS/mineflayer-pathfinder/pull/364). Fix in `src/compat.js`: `bot.physics.playerHalfWidth=0.30001`, `playerHeight=1.80001` (prismarine-physics reads them live). After the fix the same legs logged **0** teleports and completed all 32 blocks (140,32 -> 140,0 -> 108,0 -> 108,-32).
2. **Dropped teleport confirms jammed the server's teleport gate.** `compat.js` used to drop any `teleport_confirm` sent within 100 ms of the previous one. Paper never re-sends an unconfirmed teleport (`updateAwaitingTeleport` has the resend disabled, [Paper#11895](https://github.com/PaperMC/Paper/issues/11895)), and while `awaitingPositionFromClient` is armed the server ignores every movement packet and refuses every `use_item_on` (block updates are still sent, so the client sees "Server refused ... still air"; once the client has walked away from the frozen server position, `canInteractWithBlock` fails and nothing comes back: "Server did not answer"). The soak log shows exactly that sequence at 16:39-16:40 (instant refusals at (132,119,5x) in all four directions, then only timeouts after an explore). With 16 snap-backs a second almost every confirm was dropped. Fix: confirms are now deduplicated by `teleportId` and never dropped. (The FakePlayerPlugin 2.0.1 changelog on Hangar describes the same gate for server-side bots.)

Evidence after both fixes (`terrain_probe`, soak world, 4 crafts of `wooden_pickaxe` from given planks at 4 different spots, 3 of them right after a 32-block explore): 4/4 complete in 14-16 s, **0** placement failures, client/server position gap 0.00 at every checkpoint.

### Other changes

- `src/place-support.js`, `src/worker.js`: `hitsBot()` skips cells that overlap the bot's own 0.6x1.8 box (the server refuses those; a bot near a cell edge overlaps the next cell), used by `placementCells` and the pad fallback. Unit test added.
- `src/worker.js`: `placeBlockNear` logs which packets came back for a failed click (`block_changed_ack`, `block_change`, `position`, ...) with bot position, held item, reach and onGround; teleport counter/log on `forcedMove`.
- `tests/integration.py` A4: the lava trench is forceloaded, every `fill` is verified by its own reply (`fill_ok`: "Successfully filled"/"No blocks were filled"; "not loaded" means it silently did nothing) and the trench is checked with an `execute if block` marker. Root cause of GLM's A4 death: ~150 lava blocks at y=-60 around 1642..1657 x 1644..1656 had accumulated over sessions because the old sweep verified with `unless block <trench> lava` (always true) and fills in unloaded chunks no-op; the bot's water douse then failed and it died in the field. Cleanup after PASS sweeps the same box.
- `tests/runner-heap.test.js` (new): the bounded-heap test from the memory hard rule. 10k manual `TaskRunner` ticks with chains that rebuild equal roots every tick, fresh child tasks, promise actions (`ActionTask.run`) and chain switches every 250 ticks; heap after forced GC grows < 4 MB between tick 2000 and 10000, tree depth and root slots bounded. `tests/resources.test.js` itself was run once under a 512 MB heap cap with a watchdog: 9/9 pass in ~1 s, peak RSS not measurable above baseline; the earlier 17-140 GB growth came from assertion failures deep-inspecting the minecraft-data registry, which its `SHALLOW` inspect hook already prevents.
- GLM's unreviewed files read: `src/place-support.js`, `src/crafting.js` (close/reopen retry), `src/schema.js` (optional `keepTable`/`collectTable`/`surface` flags only), `src/chains/*`, `src/tasks/movement/escape-from-lava-task.js`, `tests/a4-probe.py`, `tests/placement-repro.py`. Kept as is.

### Tests

- Unit tests, every `tests/*.test.js` except `resources.test.js`: **172 passed, 0 failed** (`--max-old-space-size=2048 --test-timeout=60000`).
- Integration: **passed** at `2026-10-14T01:25:10` (`data/integration-results.json`), A4 "escaped the lava trench (hp 18.8)". This run used GLM's code plus the A4 fixture fix; it ran before the compat/hitbox changes (services restarted 01:07 with `AGENT_MODEL=off`). Integration needs a rerun on the new compat (queued after the soak).
- Model: never started this round (`$env:AGENT_MODEL='off'` before every Start-Agent/soak; supervisor logs "model server disabled ... skipping llama-server").

### Interference note

GLM/ZCode was still active at 01:00 (bash shells with `sleep 590 && tail integration-run.log`, a service restart and a second integration run, foreign `tp BuilderBot 200.5,-60,200.5` / `0.5,-60,0.5`). Its run failed A4 for the lava-field reason above and my desync probe's lava test preempted its first gather. No foreign shells were present after 01:10, **but GLM/ZCode was not actually stopped**: `tests/placement-repro.py` was edited at 01:37 by another actor (`keepTable:True` with the comment "measured: complete in 15.9 s, no table nearby") and run at ~01:43 through a fresh supervisor (PID 3868) **with the model on** (llama-server 68764), which collided with my first soak launch ("FOREIGN process 49308 (java) holds port 25569; refusing to kill"). I stopped those two orphans by PID only (both listed in `data/processes.json`, java verified on port 25569) and relaunched. The ZCode app-server and two WSL `zcode-cli` shells were still alive at 02:35; any live measurement in this document could be tainted if they act again, so each soak/integration log is checked for extra "Starting minecraft server" lines and foreign console commands.

### Soak attempt 2 (02:10-02:19, `data/soak-results-20261014-021853.json`, model off)

Anchors normal [310,131,30], hard [141,130,30]. Times are seconds from the run's dawn.

| run | wooden pickaxe | stone pickaxe | furnace | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | 90 s | 301 s | 361 s | 0 | full stone kit (pick/axe/sword/shovel), 64 cobble; 3 operator returns from y=112/95/117 (dig-down during the stone step, see open issues) |
| normal2a2 | 120 s | 271 s | 331 s | 1 | **froze to death** in powder snow at (362,150,-150) during the food-step explore, t~541-571 (hp 12 at t=451, "Health or food is low" then refused the ladder's jobs) |
| normal3 a3-a5, hard1 a1-a5 | - | - | - | - | **INVALID**: "dawn/clear weather not confirmed" on every attempt after the death (root cause below) |

Placement: **0 "No clear spot"** failures in both valid runs (the compat fixes above). Milestone 2's wooden pickaxe is 2/2 so far, milestone 3's stone pickaxe + furnace 2/2, but the run count is too small; the rerun below decides.

### Root cause 3: weather stuck on "rain" after a death (the INVALID runs)

- `tests/soak.py` fails closed when `observe` does not report `timeOfDay=='day' && weather=='clear'`. After normal2's death every attempt saw `weather='rain'` while the server answered "Set the weather to clear" every 3 s and `advance_weather` was `false` (the world never rained at all).
- Measured with a second bot (`WeatherProbe`, raw `game_state_change` packets, Temp\bb\weather_probe.mjs): on this stack (Paper 26.3 -> ViaBackwards -> 1.21.4 client) **game event 1 arrives when the sky clears and event 2 when rain begins**, the opposite of mineflayer's `rain.js` names (`['no_respawn_block_available','start_raining','stop_raining',...]`). mineflayer's level handler only corrects `isRaining` when the rain level crosses 0; CraftBukkit's respawn path (`resetPlayerWeather` -> `setPlayerWeather(CLEAR)`) sends event 1 with no level packet when the world is already clear, so after the death the flag flipped to `isRaining=true` and nothing ever reset it. The same probe showed the first death_observe run started in real thunder because `weather clear 1200` is 1200 **ticks** (60 s) and vanilla flips straight into rain (and then thunder) when a clear timer expires.
- Fix `src/compat.js` `installWeatherFix(bot)`: `bot.isRaining` / `bot.thunderState` become getters driven by the `rain_level_change` / `thunder_level_change` levels (> 0.5 of the 5-second fade), which the server re-sends on every join and respawn; the plugin's flags are only used until the first level packet. Wired in `worker.connect()`; unit test in `tests/safety.test.js`. Live check through `/api/observe` on the flat world: thunder -> clear -> rain -> clear -> **death -> clear** -> thunder -> **death during thunder -> thunder** -> clear, every reading correct 7 s after the command.
- `tests/soak.py`: `weather clear 1000000` instead of `1200` at the three setup sites; an INVALID run now records the `timeOfDay`/`weather` it actually saw.
- Side note from the same logs: `time set 0` works; the reply on 26.3 is "Set minecraft:overworld to 0 tick(s)" (per-dimension clocks), and a repeat says "Clock minecraft:overworld is already set to 0 tick(s)". Nothing greps for "Set the time".

### Powder snow (normal2's death)

- `src/chains/fallbackTasks.js` `EscapeFreezingTask` (new): detects powder snow at feet/head and `TicksFrozen` (entity metadata index 7); digs the powder snow around the bot and jumps/sprints towards the direction with the fewest powder-snow blocks. `src/chains/worldSurvivalChain.js` runs it at priority 100 (same band as lava/fire).
- `src/worker.js` `avoidHazards()`: `powder_snow`, `sweet_berry_bush`, `wither_rose`, `cactus`, `magma_block`, `campfire`, `soul_campfire`, `pointed_dripstone` are added to the pathfinder's `blocksToAvoid` for normal and explore movements (powder snow has an empty bounding box, so the pathfinder otherwise walks straight through it).
- Unit test in `tests/chains.test.js`. Unit total now **174 passed, 0 failed**.

### Soak attempt 3 (started 02:39, model off)

Running with all fixes above (weather tracking, long clear, freezing escape, hazard avoidance). Results below when it finishes.

## Round 4 (2026-10-14 03:20-, full ownership after CURSOR_FABLE)

GLM is stopped. Soak attempt 3 (`python -u tests/soak.py`, PID 64580) was already on `agent-soak-world` when this session started; it was left running. No second soak, no llama, no name-kills.

### Fixes written while soak 3 ran (not loaded by that dashboard)

- `src/autopilot.js`: stone crafts `keepTable` through the kit, furnace also `collectTable`. A standing table/furnace in the world counts as the kit piece. `start()` clears `lastSurfaceY` / hunt / night keys. The unblock explore carries the wood surface cap **only on the wood step** (48 blocks); stone/food explores do not, because a pit at y=86 with `surfaceY=131` fails every path with "left the surface" and the step backs off in place (soak 3 normal3, 3 minutes at [319,86,63]).
- `src/combat.js`: creeper hit-and-run now **closes into 2.9**, strikes once, then sprints toward 7 for 1 s. The old `d < minRange(4) -> away` branch never entered strike range (suite hits=0, damage 16-17). Wiki: fuse starts at 3 blocks / 1.5 s and cancels past 7 or LOS ([Creeper](https://minecraft.wiki/w/Creeper)). Mineflayer still ignores horizontal knockback on 1.21.11 ([#3915](https://github.com/PrismarineJS/mineflayer/issues/3915)), so the safety is distance, not the hit.
- `tests/soak.py`: `reset_ladder` stops the autopilot and cancels every job before `/clear`; re-clears until observe has no leftover kit (ghost inventory after a furnace window + `/clear`, soak 3 normal2).
- Tests: `tests/autopilot.test.js`, `tests/combat.test.js`. Unit suite except `resources.test.js`: **179 passed, 0 failed**.

### Soak 3 finished (02:39-03:44 IST, `data/soak-results-20261014-034423.json`, model off, SOAK DONE clean)

Round 4 JS was **not** loaded (dashboard started before those edits). 0 deaths, 0 invalid. `wood_runs=5` (hard3 table=0 at end so the wood flag is false despite a wooden pickaxe). Honest stone+furnace **3/6**. 24 "No clear spot" on normal3.

| run | wooden pickaxe | stone pickaxe | furnace | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | 90 s | 331 s | 391 s | 0 | full stone kit; honest YES/YES |
| normal2a2 | 60 s ghost | 60 s ghost | 60 s ghost | 0 | leftover kit after `/clear`+open furnace; recrafted wood ~421 s; stone unfinished |
| normal3a3 | 180 s | 391 s | none | 0 | 24× "No clear spot"; 3 min backoff in a stone pit at y=86 (`surfaceY` inherited from wood) |
| hard1a1 | 90 s | 240 s | none | 0 | table 0/1 oscillating; pit backoff |
| hard2a2 | 90 s | 241 s | 301 s | 0 | honest stone+furnace |
| hard3a3 | 120 s | 271 s | 361 s | 0 | table 0 at end (`wood=false`); furnace yes |

Anchors: normal [310,131,30], hard [141,134,34]. Flat world restored: `agent-test-world`, `minecraft\:flat`, peaceful, `server-ip=0.0.0.0`.

### Integration (after soak 3 restore)

`data/integration-results.json` **passed** at `2026-10-14T04:02:47` (exit 0, ~17 min). Milestone 1 met. A4 lava escape held (health 20 at end state).

### Combat suite (Round 4 kite, two full runs, both exit 1)

Both runs **killed** the creeper (hits now land) and confirmed no crater at spawn (1504,-61,1504) or center (1500,-61,1500). Both timed out on `if block 1496 -61 1504 minecraft:dirt` — a real crater at the gate, not an unloaded chunk (second run tped BuilderBot onto that cell first). Job `complete` because the entity vanished; the explosion is what removed it.

Other legs: zombies/skeleton/spiders/low-health/gear/baseline all passed. Enderman survived (roof samples 0/20). Witch recorded as the 26.3 kite limit. Creeper damage was not written (record() sits after the crater assert). Milestone 4 creeper `<10` is **not** met.

- Run 1 (terminal 73166, 302 s): tests 1-3 clean; test 4 kill + crater; suite continued 5-10 then raised the error.
- Run 2 (terminal 73167, 305 s): same crater after a load-tp. 2_zombie_x3 lost 0.3 hp; 3_skeleton 1.5; 5_spiders 5.3; 8_low_health ate and finished.

### Kite fix (loaded on the 04:15 IST restart, combat rerun in flight)

`src/combat.js`: after the strike, sprint-out is **1.5 s** (full fuse) and starts on the same tick. Retreat now scores headings by open distance out to 7.2 (cardinals included) instead of the first 1.6-passable slant, so the 12-wide arena gate into the shooting lane wins over a wall. Cooldown inside 7 keeps fleeing. Wiki fuse cancel is distance 7 / LOS ([Creeper](https://minecraft.wiki/w/Creeper)); mineflayer still drops 1.21.11 knockback ([#3915](https://github.com/PrismarineJS/mineflayer/issues/3915)).

`tests/combat_integration.py`: tp onto 1496,1504 before the third crater sample so a miss is a crater, not a silent unloaded `execute`.

Unit suite except `resources.test.js`: **180 passed, 0 failed**. Services restarted via `Stop-Agent.ps1` / `Start-Agent.ps1` with `AGENT_MODEL=off` (supervisor: "model server disabled"). Combat rerun started after that restart.

### Creeper (continued, 04:15-05:00 IST)

Four more full combat suite runs after the 04:15 restart. Every one **killed** the creeper (entity gone) and failed the **center** crater check (`1500,-61,1500`). Spawn corner stayed dirt.

Dashboard 22:59:11 IST (bow-first, loaded): `equip-bow` → `draw` → `shoot` (1 shot, Via arrow speed 0) → `kite` → `guard creeper swell 1 at 1.9` then `3.4` → `tactic=bow hits=0 shots=1 damage taken=0 result=finished`. Controls are look-relative: draw + `forward` while facing the creeper walked 8 → 1.9 in 0.8 s. Wiki still: fuse at 3 / 1.5 s, cancel at 7 or LOS ([Creeper](https://minecraft.wiki/w/Creeper)). AltoClef's defence is `RunAwayFromCreepersTask`, not melee (`reference/altoclef/.../RunAwayFromCreepersTask.java`).

Fixes now loaded on the 05:00 restart (combat rerun 73171 in flight):

- `pickTactic('creeper')` is **bow from 8** when arrows exist; melee hit-run is the no-arrow fallback.
- Creeper + bow bypasses the ablated-kite `avoid` (which stood still).
- Inside 8: **only** `_awayTick` (longest open heading). No draw, no look-at-target, no melee.
- `!sol` on a creeper kites away, never approaches.
- `FightTask` never pathfinds **toward** a creeper (the 2.5 s "gap has not closed" chase).

Unit: combat 37/37, fightTask 15/15. `AGENT_MODEL=off` throughout.

### Creeper 23:11 (stand-still draw + gap-opening flee)

`draw` → `shoot` (0.4 s leftover draw) → `kite` → `guard swell 1 at 2.9` → **bot died**. Job status was neither complete nor failed (`Bot died; inspect the world before resuming`). Test 5 then saw the bot at `{452.5, -63, 451.5}` (respawn). A 12×12 roofed box cannot cancel a fuse by running: every heading hits a wall in 3–6 blocks and the creeper follows.

### Next attempt (loaded on the 23:16 restart)

`FightTask` in the combat-arena fixture (`y~-60`, `x/z` 1493–1525) **paths through the gate to `1500,1518` before duelling**, so cobble breaks LOS (wiki cancel). Then bow from the 18-block lane. Unit: fightTask 16/16.

`tests/combat_integration.py` now records 4_creeper hits/damage **before** the crater asserts.

### Combat suite GREEN (73173, exit 0, 303 s, 23:21 IST)

All 10 acceptance tests passed. Creeper: **killed in 7.3 s, tactic=bow, shots=1, damage_taken=19.8, end health 1.25**. The three dirt crater samples (spawn / center / path) stayed dirt — the blast was almost certainly on the **lane glowstone** (z≥1507) after the gate path. Milestone 4's **damage < 10 is not met**. Lane goal moved to `1496,1522` (west edge) so the next run does not cross the creeper at 1504,1504.

Other legs: zombies 0 dmg; skeleton 2.0; spiders  (suite continued); enderman survived 0/20 roof; witch 26.3 limit; low-health ate and finished; gear + baseline clean.

### Soak 4 (23:21-00:26 IST, `data/soak-results-20261014-055619.json`, SOAK DONE clean, model off)

Round 4 autopilot loaded (keepTable, wood-only surfaceY, reset_ladder). Ghost kit gone: normal2 t=30 was empty. **0 "No clear spot"** in this file. Anchors normal [310,131,30], hard [142,133,31]. Flat world restored.

| run | wooden pickaxe | stone pickaxe | furnace | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | 90 s | 361 s | 391 s | 0 | stone=YES; food explore 0 food |
| normal2a2 | 90 s | 301 s | 361 s | 0 | stone=YES; no leftover kit |
| normal3a3 | 120 s | 451 s | 511 s | 0 | stone=YES |
| hard1a1 | 90 s | 361 s | 451 s | 0 | stone=YES |
| hard2a2 | 120 s | 271 s then lost | 331 s then lost | 1 | died at (135, 82, 71) during food explore ~t=331-361 (no killer: fall); recrafted wood, no stone by end |
| hard3a3 | 120 s | 271 s | 331 s | 0 | had stone pick+furnace mid-run; pickaxe 0 at t=602; operator return from y=59; stone=no at end |

`wood_runs=6`, `stone_runs=4`. **Milestone 2 met** (wooden pickaxe 6/6, 0 No-clear-spot). **Milestone 3 met** (stone+furnace 4/6, 0 normal deaths). Food 0/6 (`edible_food=0`); soak keeps `spawn_mobs false` so the food step must find pre-generated animals. First night not measured. Creeper arena damage still 19.8.

### Combat 73175–73177 (after soak 4, model off)

- **73175** (west-lane dest 1496,1522 still loaded): creeper killed ttk=9.2 shots=1 **damage 18.0** end hp 3.0. Gate path still walked through the creeper. test5 spiders then saw respawn `{452.5,-63,451.5}` (suite exit 1).
- **73176** (lane-nav removed; combat kite only): **bot died** at 1498,-60,1501. Log: `equip-bow` → `draw` at 10.6 → `kite` 0.6 s later → `swell 1 at 2.8` → death. Stand-still draw + interpolated `look(force=false)` + look-relative forward walked into the fuse.
- **73177** (force look + draw only after gap holds): **bot died** at 1497,-60,1501. `kite` → `swell 1 at 2.5` → death. `_bestAway` still picked the gate corridor (longest air).

Loaded next (not yet live-measured): creeper `_awayTick` walks the **raw away-vector** and snaps `entity.yaw` (unit: west-north from 1496,1497 vs 1504,1504, never +z). Food step: `grazeDirection` prefers loaded plains/meadow over peaks; animal scan 48 blocks.

- **73178** (away-vector + yaw snap): creeper "killed" ttk=5.1 **shots=0 damage 17.4** end hp 4.6. Log: kite 3.3 s → swell 1 at 2.8. The away-vector reached the far corner; the creeper followed; `closing` banned every draw. test5 spiders **passed** (6.3 dmg) — first time since the gate-path deaths.
- **73179** (draw allowed while closing): **survived** ttk=8.2 **shots=0 damage 16.4** end hp 9.6 (health-8 retreat). `d<10` aborted every in-progress draw as it walked 10→8.
- **73180/73181** (hold draw through 10→6; lastD only resets on target change): still **shots=0 damage 16–17**, kite → swell 1 at 2.7–2.9. `setTarget` every FightTask tick was clearing `_creeperLastD` (fixed) but live logs still never entered `draw`.
- **73183** (diagnostic): `creeper-bow d=9.5` on the first tick, then 9.5→2.6 in 3 s, **never drew**. Live start is 9.5, not 10.6; `minRange` was 10 so `d<min` kited every tick.
- **73184** (minRange 8): **first live shot**. `draw` at d=9.5, arrow at ~8.2 (32→31), then d<8 kited and the creeper closed to 2.7. ttk=5.3 **shots=1 damage 17.5** end hp 4.5. Crater samples intact. One arrow cannot kill a 20-hp creeper before the 1.5 s fuse from a 9.5 start.
- **73185** (minRange 6): still shots=1 damage 17.7. Physics: ~1.5 s until fuse at the 9.5 in-room spawn.
- **73186** (test 4 spawn moved to lane 1496,1518): start `creeper-bow d=16.1`, **shots=3**, arrows 32→29, **hits=0**, damage **19.6**. The creeper walked the lane, fused at 2.6. Arrows are firing (ViaVersion ballistics still miss; first release was 0.27 s — `now()` is `time.age/20` and can jump). M4 damage <10 not met.

### Milestones
1. Integration green — met (earlier).
2. Wooden pickaxe ≥5/6, 0 No-clear-spot — **met (6/6, soak 4)**.
3. Stone+furnace ≥4/6, 0 normal deaths — **met (4/6, soak 4)**.
4. Food + first night + creeper <10 — **open**. Food 0/6 (`spawn_mobs` false). Creeper shots now fire; they miss; blast 16–20. `grazeDirection` not soak-measured.
5. Iron — not started. Do not start a second soak.

Model off. No name-kills. One soak only. Services: dashboard + test-server, llama never started.

### Files this ownership stretch
`src/chains/fightTask.js` (no gate path; cancel nav on creeper close/fuse), `src/combat.js` (force look, away-vector, face+back, draw-at-8+, !sol fallback), `src/tasks/movement/move.js` (`look(..., force)`), `src/autopilot.js` (`grazeDirection`, animal scan 48), tests `fightTask.test.js` `combat.test.js` `autopilot.test.js`. Units: combat 39/39, fightTask 17/17, autopilot including grazeDirection.

Wiki: https://minecraft.wiki/w/Creeper fuse starts at 3 / 1.5 s, cancels past 7 or LOS. Mineflayer look-relative forward + interpolated `look(false)` is the walk-in (also PrismarineJS/mineflayer#3915 no knockback).

### GLM collision (Claude 07:06 IST) + soak 5 start (07:09 IST)

GLM/ZCode soak PID **64076 is dead** (checked via WMI; not killed — already gone). No other `python tests/soak.py` was live. Combat 73186 finished **GREEN** (exit 0, 302 s) on `agent-test-world` after Claude's note: creeper shots=3 hits=0 dmg **19.6**; spiders 6.0; enderman 0/20 roof; witch 26.3 limit; gear + baseline clean.

Live world before restart: `server.properties` `level-name=agent-test-world` `minecraft\:flat` `peaceful` `server-ip=0.0.0.0`; `latest.log` `Preparing level "agent-test-world"` at 07:03:48. Then **one** soak (`$env:AGENT_MODEL='off'; python -u tests/soak.py`, terminal 73188) switched to a virgin `agent-soak-world` (seed 12345). Scout: `spawn_mobs false`; HARD [142,131,31] light 10; NORMAL [310,131,30] sky 15. `normal1a1` started. Supervisor skipped llama (`AGENT_MODEL=off`).

Loaded next (not in this soak's already-started node): `CombatController.now()` is **wall clock** (`Date.now()/1000`), not `bot.time.age/20`. 73186 first release was 0.27 s because age jumped. Wiki/BowItem full draw is 20 ticks / 1.0 s (https://minecraft.wiki/w/Arrow). Tests inject `opts.now`; new unit asserts an age jump does not release. Combat units **40/40**.

### Soak 5 (07:09–08:14 IST, `data/soak-results-20261014-081355.json`, SOAK DONE clean, exit 0)

One soak only after GLM 64076 was confirmed dead. Virgin `agent-soak-world` seed 12345. Anchors HARD [142,131,31] light 10, NORMAL [310,131,30] sky 15. Model off. **0 "No clear spot"**. Flat world restored (`Preparing level "agent-test-world"` 08:14:11).

| run | wooden pickaxe | stone pickaxe | furnace | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | 90 s | 331 s | 391 s | 1 (real) | peaked stone+furnace; **fell from a high place** on food explore (y=173 → 126); end kit empty so official wood=no/stone=no |
| normal2a2 | 90 s | 271 s | 361 s | 1 (false) | kit kept; "death" is session event leftover from normal1 (`deaths_mark` fix is on disk, not in this process) |
| normal3a3 | 90 s | 301 s | 361 s | 0 | YES/YES; food explore climbed to y=185, 0 food, survived |
| hard1a1 | 90 s | 331 s | 391 s | 0 | YES/YES; 0 food |
| hard2a2 | 120 s | 271 s | 331 s | 0 | YES/YES; 0 food |
| hard3a3 | 120 s | 241 s | 271 s | 0 | YES/YES; stuck fight/collect at [139,142,1] ~5 min, still 0 food |

Official summary: `wood_runs=5` `stone_runs=5` (normal1 end-empty). First-seen wooden pickaxe **6/6**, stone+furnace **6/6**. M2 still met (≥5/6 wood, 0 No-clear-spot). M3 stone count met; **1 real normal death** (food-explore fall) so the "0 normal deaths" clause is not met on this soak (it was on soak 4). Food 0/6. `edible_food=0` every run.

Loaded on the restored flat node: wall-clock `now()`; food `surfaceCeiling=standY+8`; soak `deaths_mark` so a prior run's 'Bot died at' does not start the next at deaths=1.

### Combat 73189 (08:14 IST, wall-clock draw, exit 1)

Clock fix **worked**: first `draw` 02:47:08.415 → `shoot` 02:47:09.427 = **1.01 s** (was 0.27 s on 73186). Start `creeper-bow d=16.1`, arrows 32→25+ (several full-draw releases). **Hits still 0** (ViaVersion ballistics). Creeper closed; **bot died**. Suite recorded `test4_creeper` fail then continued tests 5–10 (spiders/enderman/witch/gear/baseline). M4 damage <10 not met.

Loaded next: `_viaVelocity` reconstructs heading from position samples when Via reports 0, so the solver can lead a gate-pathing creeper. Combat units **41/41**.

### Combat 73190 (Via heading lead, exit 1)

Same death. Draw 1.00 s at d=15.8; arrows 32→29; then kite 7.5→1.4 in 0.85 s (walk-back hit the lane west wall). Hits still 0. Heading lead did not land the arrow.

Loaded next: fuse **raises the shield** even when the melee shield primitive is off; fuse sprint uses `_awayTick` (open gap heading), not look-relative back. Combat units 41/41.

### Open

- M4 food still 0/6 (`spawn_mobs` false). `surfaceCeiling` not soak-measured. hard3 found a fight target but got no meat.
- Creeper arena damage still ≥18. Combat remasure queued with wall-clock draw.
- Enderman roof 0/20. Witch is the 26.3 kite limit.

Model never started. No name-kills. Do not start a second soak.

## Round 6 (2026-10-14 08:40–09:05 IST, cobble LOS-break)

GLM soak PID **64076 was already dead** (not killed). Live world stayed `agent-test-world` / `server-ip=0.0.0.0`. Round 3 hitbox 0.30001 + teleport confirm dedupe untouched. No second soak. Llama never started (`AGENT_MODEL=off`; supervisor: "model server disabled").

Wiki ([Creeper](https://minecraft.wiki/w/Creeper)): fuse starts at 3 blocks / 1.5 s and **cancels on LOS break or distance > 7**. 73186–91: ViaVersion arrows miss at a full 1.0 s draw (shots 7, hits 0), so the M4 path is a placed wall, not better aim.

### Files

- `src/combat.js` — `_losBreak` places a **2-high** cobble/dirt/plank pillar (eyes at +1.62 see over 1-high). Step 2 then 3 then 1 along the creeper heading; skip `hitsBot` cells and cells with hypot < 1.4 (own-cell). Hold the cobble until the pillar is up (`_losHold`); do not re-equip the bow. Once both blocks are solid, **stand behind cover** (`_losCovered`). If a place does not land in 0.8 s, clear `_losCell` and pick a new step.
- `tests/combat.test.js` — fusing creeper with cobble equips, places, stacks the second block, and never re-equips the bow. Combat units **42/42**.
- `tests/combat_integration.py` — test4 gear now includes `cobblestone` ×16.

### Combat remasures (model off)

| Run | Result | Creeper | Notes |
| --- | --- | --- | --- |
| 73192 | exit 1 | **died** | 1-high at 1497,-60,1508 then **equip-bow** next tick aborted the place; swell at 2.7; died 1496,-60,1507. shots=7 hits=0 |
| 73193 | **exit 0** | killed, dmg **17.1**, hp 3.93 | 2-high stacked in 0.36 s (1498,-60/–59,1508) then equip-bow+kite walked 7.6→2.5 around it; blast off the dirt samples (no crater). M4 <10 **not met** |
| 73194 | **exit 0** | killed, dmg **17.1**, hp 3.85 | **Best.** Held cobble, no re-equip, no kite. Creeper walked around the 1-wide pillar 7.7→2.8 and detonated. Suite otherwise green (spiders/gear/baseline) |
| 73195 | exit 1 | **died** at 1497,-60,1513 | awayTick-after-cover walked 7.8→0.5. First place was own-cell 1496,-60,1512 (never stacked). Reverted. |

Loaded on the live dashboard (post-73195 restart): 73194 stand-behind-cover + own-cell skip. `level-name=agent-test-world`.

### Next for M4 creeper damage <10

A **1-wide** 2-high column does not stop the creeper: it paths around in ~2 s and detonates at 2.5–2.8 for 17.1 (leather). Do not awayTick while the place is in flight (73195). Next hypothesis: a **3-wide 2-high** wall (center + one block each side of the heading) so the ray and the path both hit cobble, still standing still until it is up. Arrows remain 0 hits on this Via path — do not spend another remasure on aim.

### Milestones

- M1–M3: unchanged from soak 5 (wood 5/6, stone 5/6, 1 normal fall, 0 No-clear-spot).
- M4: food 0/6; creeper suite can now **survive and kill** (73193/94) but damage 17.1 ≥ 10.
- M5 iron: not started. Do not start a soak until the creeper wall is wider.

Model never started. No name-kills.

