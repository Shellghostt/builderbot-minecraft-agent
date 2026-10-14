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


## Cloud session round 2 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_2.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **250 passed, 0 failed** (222 at the start
of the round, plus 28 new). Offline Python checks: `tests/combat_damage_check.py` and
`tests/soak_metrics_check.py` both pass. One commit per task on `main`.

1. **Arrows never register hits** (`bf26c2c`). The release path itself looks correct for
   1.21.4: `use_item` carries `hand`, `sequence` and the rotation, and the release is
   `block_dig` status 5 (RELEASE_USE_ITEM). The 0-hit result came from detection, plus one
   aim fault:
   - Bow shots never counted as hits at all. `stats.hits` was only bumped by melee.
   - The probe looked 120 ms after the release for an `arrow` within 6 blocks of the feet. A
     full-draw arrow flies 3 blocks/tick, so by then it was 6+ blocks out, already in the
     target, or stuck past the radius. That is why an arrow name was visible but "not near".
   - `compat.js` drops `position_look` over the 30/s cap. mineflayer records the aim as sent
     before that wrapper runs, and never re-sends an unchanged aim, so the server could
     release along a stale rotation. A dropped rotation now rides the next `position`, and a
     bow release first re-sends the current aim (one `look`) when the server's copy is stale.
   - New `src/arrowShots.js` tracks each shot.
     - **Released:** the inventory arrow count drops, or an arrow spawns within 5 of the eye.
       The spawn `objectData` owner filters out skeleton arrows.
     - **Landed:** `entityHurt` (damage_event) on the target within 3 s, or the target's
       `health` metadata (index 9) drops.
     - **Missed:** `in_ground`, or silence past the window.
     - **Unreleased:** neither a count drop nor a spawn. It logs
       `no arrow left the bow: arrows N->N`, which is the live answer to "is it released?".
   - Landed arrows count as hits. Fight summaries add `released=` and `landed=`.
2. **Combat damage accounting** (`81f4f7a`, `tests/combat_integration.py`).
   - `damage_from()` sums every health drop between consecutive samples. That equals start
     minus end plus anything healed or eaten. A death still counts the hp lost.
   - `settle(m)` adds the live health after the kill checks and sweeps. The lane creeper's
     blast very likely landed after the job settled, outside every old sample.
   - Tests 2-8 now call `record()` before their post-fight asserts. Job status and end
     health are in the notes.
3. **Stuck at canopy spawns** (`86df23e`). Gather failures went into one job-wide counter,
   and only the column of every third failure was blacklisted. Attempts alternating between
   trunks never blacklisted anything. `badColumns` was also lost when the ladder resubmitted
   the gather.
   - `gatherFailed()` counts per block and per column.
   - A reach failure skips the block at once. The reach fallbacks have already run by then.
   - Any other error skips the block on its second failure. Three failures in a column drop
     the column.
   - Skipped blocks also go into the shared worker blacklist for 10 minutes, so the next job
     skips them.
   - A missing harvest tool fails the job at once.
4. **Ladder regressions** (`8158c99`).
   - **Table never collected:** the wooden axe and furnace crafts carry `keepTable` AND
     `collectTable`, but the craft only collected when `!keepTable`. Every step's table
     stayed in the world, which matches hard2 ending with no table held. `collectTable` now
     wins.
   - **normal3 going idle (likely cause):** the autopilot cancels its own food explore when
     animals come into range. `cancel()` went through a user-sourced `stop()`, which set
     `userStopped`, and the next tick switched the autopilot off as "Stop all". The job
     watchdog did the same. `cancel(id,source)` now takes a source, and the
     `autopilot`/`timeout` stops leave `userStopped` alone.
   - **Table left out of reach:** a `keepTable` craft records its table in
     `worker.leftTable`. While that table stands within 32, it counts as the wood step's
     table, and the ladder walks back (`goto`) before a step-kit craft. Two trips that do not
     reach it forget it.
5. **Zombie trio** (`0cc8eed`).
   - `setTarget()` reset the attack charge, so a switch allowed an instant uncharged swing.
     It no longer does.
   - FightTask stays on a target that is in reach, or until another is 1+ block closer.
     A creeper always takes over.
   - Between swings, if another hostile is within `groupReach` 3.5, the controller faces the
     target and steps back or sideways. It picks the open heading that gives the most room
     from the other mobs, never into the target. When walled in, it holds and swings.
   - A full charge with the target in reach still strikes first (the force-field rule).
   - The shield goes through the existing primitive, which stays ablated.
   - A 10 s trio simulation: ticks with 2+ zombies in reach drop from 196 to 49, still 10
     swings.

### Files

`src/arrowShots.js` (new), `src/combat.js`, `src/compat.js`, `src/worker.js`,
`src/autopilot.js`, `src/chains/fightTask.js`; `tests/combat_integration.py`; new tests
`arrows`, `gather-blacklist`, `ladder`, `group` (`.test.js`) and
`tests/combat_damage_check.py`.

### Needs live verification

- **Arrows:** every shot now logs `Combat: arrow <mob> @Ns: released|landed|missed|unreleased (...)`.
  - `unreleased` means the release really fails on this path. Then look at the held slot
    and the draw time.
  - `released` followed by `missed` means aim or ballistics, not detection.
  - Compare `shots=` with `released=` and `landed=` in the fight summary.
  - Watch for a `PACKET_RATE` line from the extra `look` before a release. Expect at most one
    per shot.
- **Combat suite damage:** `4_creeper` `damage_taken` should now match the hp the bot really
  lost (start 20, end 3.86 gives about 16). Failed legs should still appear in
  `data/combat-results.json`.
- **Soak:**
  - hard anchors: `Gather: skipping <block> at x,y,z (Cannot reach ...)` once per block, then
    the gather moves on or explores. It should no longer sit for minutes at [138..141,130,21..23].
  - The wood predicate (table in inventory) should hold after each step's last craft.
  - No `Autopilot stopped (Stop all)` after `food explore cancelled - animals in range`.
- **test2_zombie_triple:** expect `group-spacing` states between swings, fewer hits taken,
  and no retreat at 8. The group step still needs checking in the 12-wide roofed arena,
  where walls limit the headings.
- **Not changed:** bow ballistics constants and the shield ablation. The night soak branch
  (Cursor's harness fix) is still unmeasured from round 1.


## Cloud session round 3 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_3.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **270 passed, 0 failed** (250 at the start
of the round, plus 20 new). Offline Python checks: `tests/soak_metrics_check.py` (now with
iron) and `tests/combat_damage_check.py` both pass. One commit per task on `main`. All five
tasks were done.

1. **Hard-mode stone step** (`669b652`, new `src/digDown.js`).
   - Cause: on the dirt hill under the canopy, `findBlocks` returns stone *buried* under
     the dirt. Every walk to it failed "Cannot reach or harvest", and the round-2 blacklist
     skipped the next buried block within milliseconds.
   - Stone-family gathers without `targetY` (the ladder's stone step) now go through
     `stonePlan`:
     1. Exposed stone (a face open to air) within 16 of the bot: mine those.
     2. Otherwise, when the scan saw stone under the bot (up to 12 below, 16 across) and
        dig-downs are left (3 per job): dig down where it stands with the existing staircase.
     3. Otherwise: the old list (exposed first).
   - `pickStairDir` simulates the 2-high 45-degree staircase in the four directions. A
     direction is refused at bedrock, at fluid touching a cell, at a non-natural block (logs
     count as non-natural), or at a missing floor. It needs 3+ clear steps and takes the
     deepest, then the one through the most stone.
   - The staircase takes `dir`, `natural` and `stopWhen`. It stops early (3+ down) once a
     side wall is stone, then the walls are mined from inside the tunnel. `digTunnelStep`
     can refuse non-natural cells and missing floors. The bot climbs the recorded tunnel at
     the job's end as before.
   - The block under the feet is never a stone target, so repeated floor drops cannot make
     a shaft. Nothing digs straight down.
   - The gather loop rescans at most once per second (`GATHER_RESCAN_MS`) while it collects
     nothing.
   - Integration legs that gather stone (stone sealed behind dirt, the planks shell,
     `targetY` staircase) go down the same paths as before: exposed-near or `targetY`.
2. **Roofed creeper: no pillar** (`9c70135`).
   - Precondition that failed: headroom. While drawing, the bow backpedals away from the
     creeper. From (1496,1497) that heading leads into the arena's 2-high corner pocket
     (ceiling y-58 over x/z 1494..1496, the enderman patch). `_pillarSpot` found no room
     there, so `_losBreak` built the wall.
   - Held item and `bowMode` were not the cause: the climb already switches to blocks, and
     `_pillarTick` runs before the bow branch.
   - Fixes:
     - The creeper backpedal (draw and `_creeperBack`) never leaves a cell where a pillar
       fits for one where none does (`_backKeepsPillar`).
     - New `step` pillar phase. Inside the wall's range (12) with no room here, walk to the
       nearest cell within 2 where a pillar fits, then climb. The path must be open and
       floored, and the creeper must stay 4.5+ from the new cell. It gives up after 1.5 s
       with a 5 s retry block.
   - Tests:
     - "bow shot, then a creeper closing next to a low pocket": no backpedal, pillar 3,
       no wall.
     - "bot already in the pocket": steps out, then pillars.
     - No step toward a close creeper; the step timeout.
   - One test fixture changed: the old headroom-fallback test put a ceiling over the bot's
     cell only, and that is now (correctly) a step. Its ceiling now covers the whole patch,
     so the wall-fallback assertion still means "no room anywhere".
3. **Soak length for iron** (`90be045`, `tests/soak.py`).
   - `NORMAL_SECONDS=1200` (frozen-day rules unchanged). `HARD_SECONDS=1250`. A full soak is
     now about 30 min longer.
   - Samples carry `iron_ore` (raw iron + ore items), `ingots` and `iron_pick`. Per run:
     `iron`, `iron_ore_peak`, `ingots_peak`, `iron_pick_at`. The summary adds `iron_runs`
     and the per-run lists. The run line prints them.
   - The operator unstuck (+4 teleport) now fires only within 8 of the anchor height.
     Underground, on the iron staircase, it would land the bot inside rock.
4. **A4 lava fixture** (`adf41c8`).
   - The fixture race: the lava was filled on top of the bot. Its escape poured the water
     bucket into the trench before `execute if block` ran, and the cell read water.
   - New order: sweep, park the bot 2 blocks off the trench, wait until it is idle
     (`wait_bot_idle`: no running/queued job, no acting survival tree, not moving), fill,
     verify both trench ends, then tp the bot in.
   - The escape predicate is read only after the first lava damage. Right after the tp the
     bot is at 20 hp and would satisfy the `health>=18` clause before it ever burned. A lost
     douse is printed as a NOTE.
   - **The douse interruption is a real ownership bug.** `runner.tick()` claims control
     *after* `tickChain()`. A task that calls `worker.douseFire()` from the first `onTick`
     of a fresh tree therefore failed the synchronous `owned()` check, and one of the two
     bucket attempts was lost.
   - `douseFire` now waits up to about 200 ms for the claim. A real owner change mid-pour
     still throws.
   - `tests/douse-ownership.test.js` reproduces the live message with the real `TaskRunner`,
     `WorldSurvivalChain` and `EscapeFromLavaTask`.
5. **Bed before dusk** (`f6fe921`, `bedPrepJob` in `src/autopilot.js`).
   - Window: tod 9000 until dusk, with no bed held or placed.
   - Wool is cheap only when a sheep is within 32 and the bot holds shears (`shear`) or a
     sword (`hunt` sheep, one wool each, capped at the sheep near). The planks for the bed
     (+4 when no table is held or within 4) must come from what is held.
   - Order: 3 wool of one colour, then planks, then the bed. Step name `bed-prep`, at most
     5 jobs a day. A failed prep job ends it for the day.
   - Otherwise the dusk dirt and the shelter are unchanged. A held bed already turns the
     night job into `sleep`.

### Files

`src/digDown.js` (new), `src/worker.js`, `src/combat.js`, `src/autopilot.js`;
`tests/soak.py`, `tests/soak_metrics_check.py`, `tests/integration.py`; new tests
`stone-step`, `douse-ownership`, `bed-prep` (`.test.js`), plus three new cases and one widened
fixture in `tests/combat.test.js`.

### Needs live verification

- **Soak, hard anchor (stone):**
  - Expect `Gather: No exposed stone within reach; digging down to y=N (staircase x, 0, z)`.
    Then cobble from the tunnel, the step finishing, and the climb back up.
  - The `skipping stone` bursts should be gone, at most one rescan a second.
  - Watch for `dig-down stopped: Tunnel stopped: ... is not natural terrain` or
    `no floor` (canopy roots, caves). After 3 dig-downs the job falls back to the old list.
- **Soak, normal runs at 1200 s:** the iron step should start (`[iron]` lines), with
  `iron_ore_peak`, `ingots_peak` and `iron_pick_at` in the summary. Confirm no operator
  teleport fires underground.
- **Soak, hard nights:** look for `[bed-prep] {"type":"hunt","entity":"sheep",...}` (or
  `shear`) before dusk, then `craft *_bed`, then `[night] {"type":"sleep"}`. No sheep means
  the dusk dirt and the shelter, as before.
- **Combat `4b_creeper_roofed`:**
  - Expect no backpedal into the corner pocket, then `pillar-up 2` at 8. Or, if the bot
    starts there, `Combat: pillar step to x,y,z (no headroom here; ...)` and then
    `pillar-up`.
  - Damage should be under 10 if the 2-high perch holds. The roof leaves no room for 3.
- **Integration A4:**
  - The verify should pass now. Then measure the escape hp.
  - `Bucket-into-lava skipped: Douse interrupted` should not appear. If the NOTE prints
    anyway, the remaining cause is a later owner change (a tp or a job), not the first tick.
- **Not changed:** the lane `4_creeper` repelled-in-1.1 s case, the bow ballistics, and
  MobDefenseChain's wild-creeper flee. The pillar still runs only inside fight jobs.

## Cloud session round 4 (Claude, 2026-10-14, code only - `docs/CLOUD_TASK_4.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **304 passed, 0 failed** (270 at the start
of the round, plus 34 new). `tests/soak_metrics_check.py` and `tests/combat_damage_check.py`
pass. One commit per task on `main` (`0ac0ea8`..`9058977`). All six tasks were done.

1. **Suffocation during the dig-down** (`0ac0ea8`).
   - Cause: `digTunnelStep` dug the step feet -> head -> corner. The bot stepped in 80 ms
     later without re-reading the cells. Sand or gravel over the corner fell into the step,
     onto the bot. Then the low-health stop (task 2) froze the job, and nothing in the code
     ever freed a head stuck in a block.
   - Steps are now dug top-down and settled (`clearCells`): re-dig until every cell is air,
     nothing that falls sits on the top cell, and no `falling_block` entity is still dropping
     in that column. After 12 rounds the step is refused instead of entered.
   - After every staircase and strip-mine step, the bot's own head and feet are freed again
     (a late fall).
   - `pickStairDir` skips steps with sand or gravel on top.
   - New `EscapeSuffocationTask` in `WorldSurvivalChain`, priority 100, after the head has
     been in a solid block for 0.3 s. It runs after a Stop too, like the lava escape.
     - It digs natural or falling blocks, one dig at a time.
     - Inside a built block it pushes toward an open side and never breaks it.
   - Stop/cancel mid-tunnel: each staircase step records the tunnel on the worker
     (`strandedTunnel`).
     - The next gather adopts it and climbs it at its end.
     - Surface jobs (goto, explore, hunt, collect, shear, breed, deposit, build, place)
       climb it before they start.
     - A user stop still halts on the spot (the hard rule). The cells around the bot are air
       by construction, and the escape covers anything that falls later.
   - `NATURAL_DIG` moved to `src/digDown.js`.
2. **`Autopilot stopped (Stop all)` on its own** (`fd062a0`).
   - Cause: the low-health stop (`bot.on('health')`), the death stop and the connection-end
     stop still used `stop()`'s default `'user'` source. Every hard hit mid-job switched the
     ladder off: normal2 twice, hard1 and hard2, each just before a death.
   - Fix: they are now `onHealth`, `onDeath` and `onEnd`, with the sources `'health'`,
     `'death'` and `'connection'` (`LADDER_SAFE_STOPS`, exported). Death still holds the
     ladder through `deathResume` ('paused: died').
   - `app.js` passes `'user'` explicitly for `/api/stop` and `/api/cancel`, and so does
     `disconnect()`.
   - Follow-through, because a health stop now leaves the ladder on: below minHealth the
     autopilot eats once (when food < 18, since regen needs it) and waits up to 60 s. It
     does not submit jobs that `check()` refuses, which would burn 3 failures and block the
     step. The night job still goes out.
   - `tests/stop-sources.test.js`:
     - one test per caller: health, death, connection, watchdog, runner preemption, and the
       API/disconnect;
     - a source scan that fails on any new internal stop/cancel call without a ladder-safe
       source.
3. **Packet kick** (`40cbb1d`, `9058977`).
   - `src/compat.js` now budgets every serverbound play packet: a 1 s sliding window of 200.
     Paper's limit is 500/s averaged over 7 s.
   - Over the budget:
     - movement, look, input, the timer `tick_end` and swings are dropped (a later packet
       supersedes them);
     - digs, uses, attacks, clicks and chat queue in order and drain as the window frees
       (256 deep, newest dropped beyond that).
   - Always sent: `keep_alive`, `teleport_confirm`, and the tick boundary after a movement
     that went out.
   - Swings are capped at 10/s. A dropped look still marks the rotation stale.
   - `bot.packetStats` and a rate-limited `PACKET_BUDGET <queued|dropped> <name>` console
     line name the packet that hit the cap.
   - Flood found: `digSafe` in the powder-snow and fire escapes called `bot.dig` on every
     20 Hz tick. Each call restarted the dig (dig start, abort, swing, look), so the block
     never broke. It now runs one dig at a time per bot.
   - The 17:58Z record itself (which packet flooded) was not in the repo. The next kick, or
     near-kick, will print it.
4. **Hard stone: cobble but no pickaxe** (`b491fee`).
   - Cause: the stone step crafted nothing until 32 cobble was held. On the hard anchor the
     dig-down gather failed short every time, so the ladder kept resubmitting the gather.
   - Fix: the kit is crafted in order as soon as the next piece is affordable. The pickaxe
     comes at 3 cobble, then the sword (2), axe (3), shovel (1), then the furnace (8).
     Only a shortfall gathers (still up to 32), and the order never skips ahead.
   - Table and furnace provisioning (`placementCells` `avoid`) keeps the open tunnel's
     cells free, so a craft at the bottom of a dig-down cannot block the climb out.
5. **Skeleton death in a cave** (`b1b17d2`).
   - Fix: the food explore gets `surfaceFloor` = anchor - 6, mirroring the +8 ceiling (a bot
     already under it stays level).
     - `explore()` arms the navigation's surface check with it.
     - It also adds a pathfinder cost of 100 per step below the floor.
     - The schema accepts the field.
   - Shot at with no shield in the off hand: `exploreLeg` stops the leg when health drops
     while a skeleton, stray or bogged within 24 has line of sight.
     - It then walks (normal movements, no digging) to the nearest cell within 5 that no
       shooter can see (`coverCell` and `lineBlocked` in `move-safety.js`).
     - The job then fails with the reason, and the ladder backs off and re-decides.
   - With a shield, the leg is left to the shield and the fight chains.
6. **Small ones** (`fa3f98c`).
   - Snow: tunnels dig a block without its harvest tool when its hardness is at most 0.5
     (snow, snow blocks, netherrack; about 2.5 s by hand). Stone and ores still need the
     pickaxe.
   - Furnace output: the smelt job takes its output every 8 items. When it ends early (stop,
     reflex, time limit, the soak bell), it takes the finished output and the unsmelted
     input back before the window closes, because the furnace it placed is picked up next.

### Files

`src/worker.js`, `src/compat.js`, `src/autopilot.js`, `src/digDown.js`, `src/move-safety.js`,
`src/place-support.js`, `src/schema.js`, `src/app.js`, `src/chains/fallbackTasks.js`,
`src/chains/worldSurvivalChain.js`.

New tests: `tunnel-safety`, `stop-sources`, `packet-budget`, `cave-graze` (`.test.js`), plus
new cases in `stone-step` and `iron`. Fakes in `gather-blacklist`, `stone-step` and `iron`
gained the new worker methods. One fake `dig` in `stone-step` now really opens the cell,
because the step verifies it.

### Needs live verification

- **Soak, hard dig-down:**
  - No `suffocated in a wall`.
  - In gravel: `Tunnel stopped: gravel keeps falling into ...` only for bottomless stacks,
    and steps dug while gravel lands.
  - If a head ever ends up in a block: `WorldSurvival: head in <block> at ..., digging out`.
  - After a stop or cancel mid-tunnel: `Climbing out of the tunnel an interrupted gather left`
    at the next surface job.
- **Soak, Stop all:** expect no `Autopilot stopped (Stop all)` without an operator stop. After
  a hit to below 10 hp: `recovering: health N` (or a `[recover] {"type":"eat"}`), then the
  ladder carries on.
- **Packets:**
  - No `You are sending too many packets!`.
  - Watch the bot console for `PACKET_BUDGET`. Any line names the flooding packet, so report
    it.
  - Normal play should print none. 200/s is well above the about 80/s baseline.
- **Hard stone:** `craft stone_pickaxe` within seconds of the first 3 cobble, then
  sword/axe/shovel. Expect the furnace before the 32-cobble top-up finishes.
- **Food graze:**
  - Explores carry `surfaceFloor` (anchor - 6), and `Navigation left the surface` ends a leg
    that drops below it.
  - Under skeleton fire with no shield: `Explore: shot at by skeleton; taking cover at ...`.
- **Normal dig-down in snow:** no `needs a suitable tool ... snow_block`.
- **Iron:** with a long smelt at the bell, ingots should already be held. `Smelt ended early:
  took N iron_ingot ...` appears when the job is cut off.
- **Not changed:** the combat pillar and bow, the shelter, the bed prep, the soak harness.

## Cloud session round 5 (Claude, 2026-10-15, code only - `docs/CLOUD_TASK_5.md`)

No game access. Unit tests only, every `tests/*.test.js` except `resources.test.js`,
`--max-old-space-size=2048 --test-timeout=60000`: **343 passed, 0 failed** (304 at the start
of the round, plus 39 new). `tests/soak_metrics_check.py` (now with deaths) and
`tests/combat_damage_check.py` pass. One commit per task on `main` (`d96b59f`..`b4b71d2`).
All six tasks were done.

1. **Night survival in the dark forest** (`d96b59f`, new `src/night.js`).
   - Cause of `Pause trace: shelter -> Reflex: preempted by Mob Defense`: the survival gate
     took the *first* running/queued job in the array. A gather that Mob Defense had paused
     was resumed by the cadence bridge (queued, earlier in the array than the night
     shelter), so the pump ran it first and the gate let Mob Defense preempt both.
     - The gate now asks `worker.survivalHold()`: the running job when it is one, else (nothing
       running) a queued or reflex-paused sleep/eat/shelter anywhere in the queue.
     - The pump runs a queued survival job before any other queued job.
     - World threats (lava, fire, a wall, powder snow, drowning) still pass the gate.
   - **Sunset start.** The night job goes out at `SUNSET` 12000, about 50 s before the first
     spawns (a bed still waits for 12541). Dusk dirt runs 10000..12000 and bed prep stops at
     sunset. The shelter job itself starts at 12000.
   - **Sealed box.** `shelterShell` is the feet ring, the head ring, the full 3x3 roof and the
     floor under the feet when it is open (26 cells).
     - Placement runs in passes, so a cell anchors on one placed earlier.
     - On a pillar top or a ledge, a support ring goes under the feet ring first.
     - A mob standing in a cell is hit, never built into. A cell that still cannot close fails
       the job with its position (`Could not seal the shelter: N open cells, first at x,y,z`).
     - The night job is retried up to 3 times while it is dark. After that there is no day work
       until morning (`night: no shelter; holding for morning`), and a failing night job never
       turns into a ladder "blocked" explore.
   - **Staying in.** Once sealed (`worker.shelterSealed`), Mob Defense is off. The job's guard
     loop (every 250 ms) only hits a mob inside the box or standing at an open cell within
     reach, then re-seals the gap. The Food chain may eat inside a sealed box (side effect
     only; its collect band stays off). A shelter resumed somewhere else (after a water or fire
     escape) builds a new box there.
   - **FoodChain never ate.** It passed `{name,fills}` to `bot.equip`, which moves `item.slot`.
     It now equips the real stack. This is likely why eaten/food points read 0 on every soak
     run, and why hard3 sat in its shelter at 8.3 hp.
   - **Caught outside after dark** (no shelter job), with a crowd (3+ hostiles within 16, or one
     within 8 that the fight policy refuses), 3+ blocks held and room for a 3-high column:
     `NightPillarTask` (Mob Defense, 72).
     - Climb as in the combat pillar, then hold until morning or 15 s with nothing within 16.
     - Shield toward archers. Hit only what reaches the top.
     - A perched bot stays up even when a creeper fuses at the base. A failed climb waits 10 s.
   - **Flee heading.** RunAway tasks steer away from the whole crowd, weighted by closeness,
     not just the nearest mob. They never head into water, lava, a drop deeper than 3 or
     through another mob within 8; with every heading wet they stand. When tonight's shelter
     spot is within 24, headings toward it get a small bonus.
   - **Respawn at night** (death within the last minute, alive again, autopilot on, no user
     Stop): shelter (or sleep, at a bed spawn) at the spawn point first.
     `submit(spec,{keepHolds:true})` keeps the death hold, so the ladder still reads
     `paused: died` afterwards.
   - `tests/night.test.js` (22).
2. **Drowned** (`2fd5e2b`).
   - The drowning jump was only a side effect inside the world chain's priority, and Mob
     Defense's blind forward sprint kept steering the submerged bot.
     - Drowning is now a band at 97 (the creeper fuse is 96, lava/fire 100), latched from air
       6 or less until air 18 or the head is out. It runs `ctx.move` GetOutOfWaterTask (path to
       land plus jump), or `SwimUpTask` without it.
   - A swimming bot's flee heading goes to the shore (water costs per cell instead of ruling a
     heading out). `KeepDistanceTask` and the fight job's `retreatSprint` use the same heading.
   - The pathfinder gets a deep-water step hook (water with water above or below): banned after
     dark, cost 12 by day, off while the bot itself is in the water.
   - `tests/drowning.test.js` (5) and the updated chains drowning test.
3. **Soak death counter** (`389c496`).
   - Causes of 1 counted where the log had 4:
     - the `Bot died at` count read a 100-event window that the flee storm scrolls in one sample;
     - the log regex `was|blew up|fell|died` missed `drowned`;
     - the per-death parse moved `logmark`, so the final parse saw only the tail;
     - the final log parse shared a `try` with the dashboard read, which timed out on hard3.
   - The worker keeps `deaths` (monotonic) and `deathLog` (position, nearby killer, running job)
     in `/api/state`.
   - `soak.py` takes the max of three sources: that counter's rise, the run's whole log slice
     (fixed start, every vanilla death message, chat/leave/kick lines excluded) and the window.
     It does this at every sample and once more, dashboard-free, at the end. The run record
     adds `death_sources` and `death_log`.
4. **Hard runs never craft a furnace** (`2d8d031`).
   - Cause: on a dawn start the hard stone pickaxe lands at sunset (541 s / 631 s; sunset is
     600 s). The night branch cancelled the stone gather and the shelter held the rest of the
     run, so hard2 slept on 24 cobble with 14 needed.
     - The shelter also preferred cobble, and its dawn cleanup dug bare-handed, so cobble
       dropped nothing (and took about 7 s a block).
   - Fixes:
     - The stone gather asks for the remaining kit cost + 4 (21 from zero), not 32.
     - In a 600-tick sunset grace with no hostile within 16, any stone-kit craft affordable
       right now (`duskKitJob`) runs before the shelter. A running craft is never cut by the
       night branch.
     - `worker.cobbleReserve` (published by the autopilot) keeps the kit's cobble out of the
       shelter: dirt first, reserved cobble only as a last resort. The shelter counts every
       block kind together (26), and dusk dirt counts only spare cobble.
     - The cleanup equips the right tool per block.
   - `tests/hard-kit.test.js` (7). Two gather-count expectations changed (32 to 21, 27 to 7).
5. **Connection timeout** (`a2bd234`, new `src/loop-watch.js`).
   - Nothing in the repo blocks for the ~30 s a keep-alive timeout needs (keep-alives are exempt
     from the packet budget).
   - The new drowning path would have added a real hot loop: `GetOutOfWaterTask` rescanned for
     land (~17k `blockAt` at radius 24) on every 50 ms tick when no shore was reachable. It now
     searches at most once a second, radius 16.
   - Watchdog:
     - `LOOP_SLOW <runner|cadence|autopilot> tick N ms (...)` over 500 ms. The runner line adds
       each chain's priority time and the active chain/task.
     - `LOOP_STALL event loop N ms late` from a 250 ms lag timer.
     - Both go to the console and the event log, one line per 5 s per source.
   - `tests/loop-watch.test.js` (4).
6. **Lane creeper** (`b4b71d2`, `tests/combat_integration.py`).
   - Cause: the bot (1496,1518) and the creeper (1504,1504) were 16.1 apart, past the fight's
     16-block range, and the line crossed the wall beside the gate. The job completed at ttk 0
     and the creeper never saw the bot.
   - Now both are on the lane's centre line, 10 apart (bot 1499,-60,1518, creeper
     1499,-60,1508), and the open lane between them is asserted. Crater checks are on the
     lane's glowstone floor. `4b_creeper_roofed` is unchanged.

### Files

`src/night.js` (new), `src/loop-watch.js` (new), `src/worker.js`, `src/autopilot.js`,
`src/chains/{mobDefenseChain,worldSurvivalChain,fallbackTasks,foodChain}.js`,
`src/tasks/runner.js`, `src/tasks/movement/get-out-of-water-task.js`; `tests/soak.py`,
`tests/soak_metrics_check.py`, `tests/combat_integration.py`. New tests: `night`, `drowning`,
`deaths`, `hard-kit`, `loop-watch` (`.test.js`); updated cases in `chains`, `autopilot`,
`stone-step`.

### Needs live verification

- **Soak, hard nights (dark forest):**
  - The night job at about 600 s: `Autopilot [night] {"type":"shelter"}` at tod 12000, then
    `Shelter: sealed at x,y,z (N blocks placed)` before the first spawns.
  - There should be no `Pause trace: shelter -> Reflex: preempted by Mob Defense` and no
    `Reflex: fleeing` while sealed. `Shelter: hitting <mob> at a gap` and `re-sealing` only
    after a blast.
  - No `shot by Skeleton` during `shelter`.
- **Food inside the shelter:** the meals counter should rise (`eaten` > 0 in the soak record)
  now that FoodChain's equip works. Watch that chain eating does not disturb fights or crafts.
- **Hard kit:** `Autopilot: sunset - finishing the stone kit first (stone_sword)` and the
  rest, then the furnace before the shelter. At dawn the cleanup should return the cobble (a
  pickaxe equip per block).
- **Respawn at night:** `Autopilot: respawned at night; shelter at the spawn point first`,
  while the state still reads `paused: died` until the operator resumes.
- **Caught outside:** `Reflex: night crowd (N hostiles); pillaring up instead of fleeing`,
  `Night: perched 3 up; holding until morning`. On a failed climb: `Night: pillar-up failed`.
- **Water:** `WorldSurvival: drowning (air N), swimming up`. No `drowned` in the server log.
  Flee lines should not end in a lake.
- **Deaths:** the soak run line should match the server log. Check `death_sources`
  (counter/log/window) in the results JSON.
- **Loop:** grep the bot console for `LOOP_SLOW` / `LOOP_STALL` and report any line. Normal play
  should print none.
- **Combat `4_creeper`:** expect real engagement now (`arrow creeper`, pillar 2 under the lane
  roof, or the wall) and non-zero ttk. The numbers are new and not comparable with earlier
  lane runs.
- **Not changed:** the combat pillar and bow, the bed prep (it now ends at sunset), the iron
  step.
