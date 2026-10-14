# Handover from GLM (ZCode/Claude)

## 2026-10-13 session (GLM_NEXT: integration green, table placement, dual soak)

Owned the folder after Cursor's rounds 1-2. Work done (all measurements live on the private
test server, model off where required, one soak at a time):

- **A4 lava escape root-caused and fixed** (hp 11.8 -> 18.8 in-suite). Three stacked causes,
  each live-measured with `tests/a4-probe.py` (250 ms health/position timeline):
  1. `bot.entity.isInLava` STICKS TRUE after exiting on this ViaVersion stack (same failure
     mode Cursor documented for `isInWater`), so EscapeFromLavaTask never popped and the
     WorldSurvivalChain sat at priority 100 with a zombie root while the bot burned.
     `inLava()` now trusts block data (feet/-1/+1) and only falls back to the flag when no
     blocks are loaded (`src/tasks/movement/escape-from-lava-task.js`,
     `src/chains/worldSurvivalChain.js`).
  2. `equipSafe` passed bare `{name}` objects to mineflayer's `equip`, which reads
     `item.slot` - the equip threw silently and the water bucket never reached the hand
     (`src/chains/fallbackTasks.js`).
  3. The douse is now the worker's verified `use()`-style pour (`worker.douseFire`: equip ->
     confirm heldItem -> forced lookAt -> settle -> activateItem; NO global health gate - the
     gate refused the douse exactly when it was needed). The escape task pours the bucket
     INTO the lava (source turns to obsidian under the bot; probe min hp 16).
  Stale-root guard: a SingleTaskChain whose priority drops to -1 never runs onTick, so a
  finished root blocked the next band forever - the chain retires finished roots in
  `priority()` now.
- **Table placement, Voyager/ADAM style** (`src/place-support.js` `placementCells` /
  `softBreakCell`, `src/worker.js` `placeBlockNear`): candidate cells radius 3 around the
  bot (y feet-1..+1), cell only needs to be air/replaceable, ANY solid non-replaceable
  neighbour as the reference face (never a crafting_table), walk-to-reach, break one natural
  soft block as fallback (never the bot's own column), dirt-pad last resort. Fake-world unit
  tests (`tests/place-support.test.js`).
- **Table reuse**: crafts find a standing table within 6 blocks and walk to it;
  `keepTable` leaves it standing between wood-step crafts, `collectTable` picks it up at the
  step's end (`src/worker.js`, `src/autopilot.js`, `src/schema.js`). The soak's 8-15
  "No clear spot" failures per run went to 0 (also confirmed by Cursor's later soaks).
- **Explore surface cap**: the wood step's unblock explore carries `surface:true` +
  `surfaceY` so it cannot walk off the stand (`src/autopilot.js`, `worker.explore`).
- **Schema**: craft jobs accept `keepTable`/`collectTable`; explore accepts
  `surface`/`surfaceY`/`surfaceCeiling` (the ladder's jobs were being REJECTED as
  unrecognized keys - found because the autopilot wood step stalled on submit failures).
- **A1 fixture**: `tests/integration.py` plants blocks with a verified `plant_block`
  (server-side marker check, far-tp reload on failure, client-cache refresh on success).
- **Integration GREEN**: all tests passed including A1 and A4 (hp 18.8)
  (`data/integration-results.json`).
- **Placement repro** (`tests/placement-repro.py`): seed 12345, hard anchor [140,131,32],
  cluttered dark-oak floor - table placed at (140,131,31), wooden pickaxe in 10.8 s,
  0 "No clear spot".
- **Creeper hit-and-run** (`src/combat.js`): the fuse-ring guard at d<3 sat ABOVE the 2.9
  strike window so melee creepers were NEVER hit (all ablation rows read hits=0 - the old
  "kills" were noise). Replaced with strike-once-then-reopen-past-4, wall-aware retreat.

Note: the dual soak of that session was killed by the user handover to Cursor; Cursor's
rounds 3-6 (hitbox 0.30001, teleport-confirm dedupe, weather tracking, powder snow, soak
hardening) supersede and are documented in `docs/HANDOVER_FROM_CURSOR.md`.

## 2026-10-14 session (GLM_CONTINUE: food, falls, first night, creeper)

Started from Cursor's soak 5 state: M1-M3 met (wooden pickaxe 6/6 first-seen, stone+furnace
6/6 first-seen, 0 "No clear spot"; 1 normal fall death; food 0/6; creeper 17.1 best).

### Files changed

- `src/combat.js` - creeper defence is now a **3-wide 2-high wall** across the creeper's
  heading (center on the ray at steps 2/3/1 + one flank cell each side, ground permitting;
  per-column place/stack state machine `_losCells`/`_losTried`; `_placeColumn` equips,
  places the feet and chains the head). Wall trigger moved out to **d<12** so the ~1.2 s
  build finishes before the 3-block fuse ring. Behind complete cover the bot now walks back
  (open-heading scored) while the creeper circles, instead of standing at the flank corner
  (73194 ate 17.1 standing). `_losTried`/`_losCells` reset on target change and on a column
  that never lands. Unit test extended: flanks are placed after the center column
  (`tests/combat.test.js`), 42/42.
- `src/worker.js` - passive HUNTS (fight cow/pig/sheep/chicken) scan **48** blocks, not 16
  (`huntRange`): the food step saw animals at 30+ blocks but the fight job found nothing
  inside 16 and timed out - part of why food was 0/6. FightTask candidate range follows.
- `tests/soak.py`:
  - `apply_rules('normal')` = `spawn_mobs true` + `spawn_monsters false` + frozen
    daylight/clear, every rule verified back (both rule names confirmed live on this
    server before use). Animals finally exist for the food step.
  - `apply_rules('dawn')` (hard) = `spawn_mobs true` + `spawn_monsters true` + confirmed
    dawn: natural spawning, so the first night is real.
  - Hard runs span **1250 s** (20+ min): dusk is at t=600 s, so the bed/shelter night is
    actually measured (a 600 s run never leaves daytime). Normal stays 600 s.
  - Summary gains `food_runs` / `edible_peak` / `edible_end` / `tod_end` (eating is the
    point, so the end inventory alone under-reports food; `tod_end` shows the hard runs
    crossed night).
- `tests/combat_integration.py` - **both creeper variants reported** per CLAUDE_REVIEW
  2026-10-14 07:01: `4_creeper` (lane spawn) and new `4b_creeper_roofed` (the old roofed
  12x12 hard case). A third honest outcome recorded when the wall cancels the fuse and the
  creeper leaves alive: REPELLED (swept afterwards), next to KILLED and SURVIVED.

### Measurements (all live, model off via `config.model.enabled=false`)

- Unit tests excluding `tests/resources.test.js`: **189 passed, 0 failed**
  (`node --max-old-space-size=2048 --test-timeout=60000`).
- Creeper remeasure (3 combat suite runs, all exit 0; the whole suite passed each time):

| wall trigger | lane 4_creeper | roofed 4b_creeper_roofed |
|---|---|---|
| run 1 (d<8) | REPELLED, damage **0** (fuse cancelled by the wall, creeper left alive) | killed, 17.7 (hp 4.3) |
| run 2 (d<8) | killed, 16.2 (hp 5.8) | killed, 17.4 (hp 4.6) |
| run 3 (d<12) | survived by retreat (health floor), 16.3 (hp 9.7) | killed, 15.6 (hp 5.4) |

  The wall goes up in ~1.2 s (log: "los-break creeper wall at x | y | z"). When it
  completes before the creeper closes, the fuse cancels and the bot takes **0**; when the
  creeper rounds a flank first, the blast still lands ~16. **M4 creeper damage <10 is NOT
  met** (best single outcome 0, typical 15.6-17.7). Budget spent (6 variant attempts);
  next hypothesis for whoever continues: pillar up 2-3 blocks (creepers cannot climb)
  instead of / in addition to the wall.

### Soak 6 (2026-10-14, ended 12:00 IST, `data/soak-results-20261014-120028.json`, SOAK DONE clean, model off)

First soak with animals: normal = `spawn_mobs true` + `spawn_monsters false` (verified);
hard = natural spawning + **1250 s runs** (dusk at t=600 s, so the night happens). Anchors
normal [310,131,30], hard [142,131,31]-ish (scouted). Flat world restored.

| run | wood | stone | food (peak/end) | deaths | causes / notes |
|---|---|---|---|---|---|
| normal1a1 | YES 90 s | YES 331 s | 0 / 0 | 0 | clean run |
| normal2a2 | YES 120 s | YES 271 s | 0 / 0 | 0 | clean run |
| normal3a3 | no | no | 0 / 0 | 0 | all 5 wood tools + stone kit crafted but the table was collected at the end (official wood flag artifact, same as Cursor's hard3) |
| hard1a1 | YES 180 s | YES 572 s | 0 / 0 | 1 | **blown up by a creeper at t=662, daytime, light 14**, during the stone step; run resumed and finished |
| hard2a2 | YES 361 s | YES 752 s | 0 / 0 | 0 | slow wood (contested night terrain) |
| hard3a3 | no (table 0 at end) | YES 782 s | 0 / 0 | 1 | **fell from a high place** t=211 during the wood step |

- **First night: SURVIVED.** All three 1250 s hard runs crossed dusk/night and ended
  `tod_end='day'` with the kit intact - but without sleeping or sheltering: the autopilot's
  night branch sat BEHIND the active-job return and a continuously busy ladder never
  reached it (fixed after this soak - see below). The nights were tanked on stone gear.
- **Normal deaths 0/3** (the falls target); the 2 deaths are both hard mode (1 creeper, 1
  fall). The food-explore fall surface ceiling held (no peak walks this soak).
- **Food 0/6** - but the mechanism now exists: hard3's food step found chickens, killed
  one, smelted it and ATE it (job trail: `fight chicken complete hits=4` ->
  `smelt chicken complete`; the bot's food stat later drained to 6 with nothing left).
  The other five hunts failed `Fight timed out; chicken is still standing` - **maxSeconds
  30 is too short for panic-running chickens**, and two `smelt`/`explore` legs died to
  navigation races.
- Wood 4/6 / stone 5/6 official (the two "no" rows are the table-collected-at-end artifact;
  both runs held the full tool kit during the run).

### Fixes after soak 6 (loaded for soak 7)

- `src/autopilot.js`: night prep outranks day jobs - when `timeOfDay` enters night and the
  day's night job has not run, the active job is cancelled and sleep/shelter is submitted
  (it previously only fired on an idle ladder, which a healthy ladder never is).
- `src/autopilot.js`: passive hunts get **maxSeconds 90** (chicken chases); food explore
  legs are 32 blocks (re-decide every ~20 s); the tick CANCELS a running food explore the
  moment animals come into the 48-block hunt range (normal1/2 walked 200+ blocks past).
- `src/autopilot.js` `grazeDirection` samples biomes at 16/48/96/160 and scores far graze
  highest (soak 6 walked into a taiga river valley on a near-sample "meadow").
- `src/worker.js` `exploreLeg`: a leg counts when it covers >= 60% of the requested
  distance (32-block scan legs failed the old distance-1 gate on any obstacle).
- `tests/soak.py`: `job_evidence` records the LAST 40 session jobs (jobs[:40] recorded run
  1's trail forever; later runs' evidence was being lost).

### Soak 7 (2026-10-14 12:07-13:46 IST, `data/soak-results-20261014-134647.json`, SOAK DONE clean, model off)

With the soak-6 fixes loaded (90 s hunts, 32-block legs, cancel-on-animals, far biome
probes, anchored... not yet: the anchored ceiling landed mid-soak and is loaded AFTER).

| run | wood | stone | food (peak/end) | deaths | notes |
|---|---|---|---|---|---|
| normal1a1 | YES 90 s | YES 331 s | 0 / 0 | 0 | food explore walked to frozen_peaks (see ratchet bug below) |
| normal2a2 | YES 90 s | no | 0 / 0 | 0 | stone unfinished (1 resume) |
| normal3a3 | YES 90 s | YES 241 s | 0 / 0 | 0 | best stone time yet |
| hard1a1 | YES 271 s | YES 902 s | 0 / 0 | 0 | survived the whole night unsheltered; **food fight ran at t=963-1083 (hits landed) but the follow-up collect sat `queued` for 150+ s and the drops despawned** |
| hard2a2 | no | no | 0 / 0 | 1 | **fell from a high place**; 8 interventions; the wood step never recovered the kit |
| hard3a3 | no (table 0) | YES 1113 s | 0 / 0 | 1 | cause not captured (event window overflow) |

- **Food 0/6 again**, but the loop is now proven end to end: kills happen, meat cooks, the
  bot eats it. What kills it each time is logistics, and soak 7 exposed two real bugs
  (both fixed after this soak, see below):
  1. **Passive hunts did not sweep their own kills.** The follow-up `collect` job queues
     behind whatever survival tree is still alive (night mobs keep Mob Defense running)
     and sat queued for 150 s while the drops despawned (hard1 t=1113-1263 all
     `queued: collect`).
  2. **The dusk/night branch never fired.** ViaVersion delivers `bot.time.timeOfDay` as the
     RAW world age in ticks; observe.js moduloes it (`%24000`) but the autopilot's
     `>=12541 && <=23458` window compared the raw value, which sits OUTSIDE that window
     almost always. No [night] submission in either soak's hard nights.
- **Normal deaths 0/3 again** (falls target met in normal both soaks). The 2 hard deaths:
  1 fall (hard2), 1 uncaptured (hard3).
- **First night: survived in every hard run across both soaks** (tod_end='day' each time),
  still unsheltered.
- Normal anchor note: the normal anchor's surroundings are an animal desert (the bot
  walked 200+ blocks without a sighting) while the HARD anchor's dark forest has
  chickens/pigs in view. Food should be measured primarily on the hard runs until the
  scout picks an animal-verified normal anchor.

### Fixes after soak 7 (loaded; NOT yet soak-measured)

- `src/autopilot.js`: **raw-age fix** - every dusk/night window now uses
  `((timeOfDay % 24000)+24000)%24000` like observe.js. This is the fix that should make
  the night branch actually submit sleep/shelter.
- `src/worker.js` `fight()`: **passive hunts sweep their own kills** (`sweepDrops` after a
  won hunt) - the drops no longer depend on a collect job getting pump time.
- `src/autopilot.js`: the food explore's ceiling is **anchored to the wood step's stand Y**
  (`min(standY,lastSurfaceY)+8`); the old per-leg standY+8 ratcheted the bot up a peak +8
  per leg (soak 7 normal1: y=156 on frozen_peaks).

### Milestone status (GLM_CONTINUE)

- M1-M3: met and stable (wood 4/6 and stone 4-5/6 official here, but every failure is the
  table-collected-at-end flag artifact or a hard-mode fall - the first three normal runs
  in soak 7 went wood 90 s / stone 241-331 s with 0 deaths and 0 "No clear spot").
- M4 food: **not met** (0/6, 0/6) - the loop works, logistics were the blocker, fixes
  loaded. Next session: rerun the dual soak; expect `food_runs >= 4/6` on the hard runs.
- M4 first night: **survived 6/6 hard runs** (the milestone's sleep/shelter half should
  now fire with the raw-age fix - verify a `[night] shelter` line appears in the next
  soak's dashboard log).
- M4 creeper <10: **not met** (lane 0/16.2/16.3, roofed 17.7/17.4/15.6). Next hypothesis:
  pillar up 2-3 (creepers cannot climb). Note: a WILD creeper killed the bot in soak 6
  hard1 (daytime, during the stone step) - the defense chain flees creepers but has no
  wall logic outside FightTask.
- M5 iron: not started (the iron step is written in the ladder; it needs the food step
  green ahead of it).

### Suggested next-session order

1. Rerun the dual soak with the three post-soak-7 fixes (raw-age night, hunt drop-sweep,
   anchored ceiling). Judge food on the hard runs; check for `[night]` submissions.
2. If food still 0: the remaining suspects are (a) the normal anchor has no animals -
   make the scout verify animals within 64 of an anchor like it verifies logs, and
   (b) `collect` radius 16 vs scattered drops.
3. Creeper pillar-up variant (one combat run), then M5 iron.

Model never started this session (`config.model.enabled=false`, guarded by Start-Agent).
No name-kills. No test made easier: the roofed creeper variant was ADDED alongside the
lane variant, and the "repelled" outcome records a real event rather than relaxing the
damage metric.

## Cloud session (Claude, 2026-10-14, code only - `docs/CLOUD_TASK.md`)

No game access: nothing below is live-measured. Unit tests only (every `tests/*.test.js`
except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000`):
**189 -> 222 passed, 0 failed**. Each new test was checked to fail on the code before its
fix. Model never started, no server, no processes touched. Five commits on `main`:
`c3c0ce6`, `9b3b897`, `8833466`, `ea86ca2`, `10112de`.

### What changed

1. **GLM's last changes reviewed** (`c3c0ce6`). mineflayer 4.39 already reduces
   `time.timeOfDay` modulo 24000, so the raw-age theory is unconfirmed; the modulo is now one
   shared helper (`src/daytime.js`) used everywhere, because `worker.sleep`/`shelter`,
   `SleepTask`/`ShelterTask` and `combatPolicy` still read the raw clock: if raw ages do
   arrive, the night job GLM's fix submits would refuse to sleep or wait for morning
   forever. Also fixed:
   - Night prep no longer cancels a running fight, eat, sleep or shelter job.
   - Hunts lock one animal (`lockFirst`): "clear every chicken in 48" timed out on any
     flock, and a timeout threw before the drop sweep. They now sweep radius 16 on success
     and on timeout.
   - The shelter digs out only cells that were empty when it started (it used to dig a
     hillside's natural blocks at dawn).
   - Food-graze ceiling: the anchor is fixed for the run. `min(current, anchor)` ratcheted
     down into valleys. With no surface gather, the anchor is latched once. A bot already
     above the cap gets `cap=current`, because navigation rejects any position above the
     cap, so every leg used to fail at once.
   - Tests: `tests/daytime.test.js`, `tests/hunt.test.js`, plus the anchor tests.
2. **Creeper pillar-up** (`9b3b897`, `CombatController._pillarTick`).
   - **Trigger:** a creeper within 8, or fusing; the bot on solid ground, not in fluid,
     holding 2+ blocks (cobble > deepslate > planks > netherrack > dirt) with headroom.
   - **Climb:** 3 up (2 under a low ceiling). Hold jump, look down, place on the block under
     the feet at the apex.
   - **Perch:** hold while it fuses. If it stays, shoot it (bow) or strike down when its box
     is within 3 of the eyes.
   - **Descend:** after it stays past 8 for 1 s, step off a side with a drop of 3 or less
     (no fall damage, never into fluid). With no such side, dig only its own column.
   - **Fallbacks:** a climb that fails or takes longer than 4 s falls back to the wall. A bot
     that can pillar no longer builds the 12-block wall in bow mode. The wall stays the
     fallback with no blocks or no headroom.
3. **Bow aim / look convention** (`8833466`), probably the main finding of this session.
   `combat.js` and `fallbackTasks.js` used the Notchian yaw and pitch (z=+cos(yaw),
   positive pitch looks down) with `bot.look`. mineflayer's convention is yaw 0 -> -z and
   positive pitch up (`ray_trace.js` getViewDirection, `physics.js` lookAt; `compat.js`
   already sends yRot=180-yaw). The effects:
   - Every heading with a z component was mirrored, and every bow pitch was inverted. That
     matches "arrows 0 hits" and the kite/away legs that "walked into the fuse" in
     73176-81. `RunAwayTask` (the MobDefense creeper flee) ran toward z-axis creepers, which
     is a plausible factor in soak 6's wild-creeper death.
   - Fixed through `src/heading.js`, with a test that reads the installed mineflayer source.
   - Ballistics follow vanilla `AbstractArrow.tick` order: move, then drag 0.99, then
     gravity 0.05. Arrows launch from eye height minus 0.1. The shooter's own motion is aimed
     out exactly, since the flight is linear in the launch velocity.
   - `_openAlong` probes the 0.6-wide body, not only its centre line.
   - Earlier combat-log conclusions about "look-relative walk-ins" should be re-read with
     this in mind.
4. **Iron step (M5)** (`ea86ca2`).
   - The core comes first: 6 ore, smelt, then iron pickaxe, iron sword, shield.
   - Ore comes from a staircase to y=32 (an explicit `targetY` now goes down before any
     surface search), and gathers also match `deepslate_*_ore`.
   - Smelting burns coal first and keeps an 8-plank reserve. After the core: 16 coal and the
     remaining 30 ingots.
   - `smelt` picks up a furnace it placed itself; a furnace left behind made the stone step
     regress. `pickUp` equips the right tool first.
5. **Soak food metric** (`10112de`). Root cause of `edible_peak 0`: `soak.py` read
   `observe.inventory['_edible']`, a key observe never had.
   - observe now reports `edible`.
   - The worker counts meals (a food-bar rise within 5 s of any `bot.consume`, which covers
     eat jobs, auto-eat, FoodChain and the fight's disengage-eat; respawns don't count) and
     food smelted (`cooked`). `/api/state.meals` exposes both.
   - `soak.py` diffs them per run and the summary gains `eaten`, `food_points` and
     `cooked`. `tests/soak_metrics_check.py` is an offline check.

### Files

`src/daytime.js` (new), `src/heading.js` (new), `src/autopilot.js`, `src/worker.js`,
`src/combat.js`, `src/observe.js`, `src/chains/fallbackTasks.js`,
`src/chains/combatPolicy.js`; tests `daytime`, `hunt`, `iron`, `meals` (new),
`autopilot`, `combat` (back to LF line endings), `chains`; `tests/soak.py`,
`tests/soak_metrics_check.py` (new).

### Needs live verification (Cursor / `docs/CURSOR_TESTER.md`)

- **Look convention, first:** in any fight log, confirm the bot faces and walks away from a
  mob that is off the x axis, and that bow arrows now land (`shots` vs `hits`). Combat units
  pass, but every yaw-dependent behaviour has changed.
- **Combat suite `4_creeper` and `4b_creeper_roofed`:** expect "Combat: pillar-up 3",
  "pillar perched", then strikes or shots from above. Measure damage on both. Unknowns to
  watch: the apex place timing on ViaVersion (`pillarClear` 0.1); whether 3 up stops the
  fuse; whether the roofed arena's ceiling leaves room for 2+. The arena's roof height
  decides that.
- **Soak:** `[night]` sleep/shelter submissions in the hard runs; the food columns `eaten`
  and `cooked` versus `edible_peak`; hunts now end after one kill and sweep; the iron step
  (staircase to y=32, smelt, iron pickaxe and sword) if a run gets that far.
- **Not done:** MobDefenseChain (reflexes on, autopilot) still only flees a wild creeper;
  the pillar runs only inside fight jobs. If the corrected flee still loses to creepers in
  soaks, a `CreeperPillarTask` in the swelling-creeper branch is the next step.
