# Live test reports (Cursor)

Local verifier for whatever is on `origin main`. Model off. No name-kills. No second soak. Test server stays `server-ip=0.0.0.0`, world `agent-test-world`.

## 2026-10-14 15:18–15:52 IST — units and integration (`7cecac9` + local fixes)

`git pull --rebase` was already up to date at `7cecac9` (cloud commits `c3c0ce6`..`10112de` plus the tester brief). Unit tests, every `tests/*.test.js` except `resources.test.js`, `--max-old-space-size=2048 --test-timeout=60000`: **222 passed, 0 failed**.

Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`. Port 8081 closed.

### Integration

| Run | Result | Where it stopped |
| --- | --- | --- |
| 1 | fail | Sleep. Dashboard: `Mob Defense engaging`, armor equips, `Server set position to (452, -63, 450)`, `Sleeping through this night`, then **You are sending too many packets!** The job never reached `Sleeping until morning`. |
| 2 | fail | First gather, `badColumns ["3,4"]`. The bot had been kicked at the bed and the origin floor had been filled solid at foot level while recovering the world. Not a code failure. |
| 3 | fail | Fresh restart. Gather, explore, chest craft passed. **Same packet kick** at the sleep site (09:39:37Z). Reproduced. |
| 4 | fail | After pacing `position_look`. Sleep, shelter, fight passed. Smelt died in 1 s: `destination full` on a leftover furnace within 16 of (800, -60, 800). |
| 5 | fail | That furnace removed. Smelt **completed** and the ingots were real. `pickUp` then dug the furnace with no pickaxe (`give_kit` is leather only) and the drop never entered the inventory (`Left the furnace at (800, -60, 799)`, block gone, `furnace` count 0). The nearby-furnace assert failed. A trial edit of that assert was reverted. |
| 6 | **pass** | `All in-game integration tests passed` at 10:22:40Z, 1081 s. A4 lava escape hp 18.8. |

### Fixes (loaded for run 6, not yet the cloud commits)

- `src/compat.js` — `position_look` shares the 30/s movement cap. A look every tick was turning the physics flood into uncapped `position_look` packets. Pure `look` stays uncapped.
- `src/worker.js` — a furnace this job placed is picked up only when a pickaxe is in the inventory. With no pickaxe it stays in the world, which is what the smelt assert checks. The ladder still picks it up after the stone step.

Combat and the dual soak are next. At most 3 combat runs.

## 2026-10-14 15:54 IST — combat run 1 of 3 (`5c2ff8d`)

`python tests/combat_integration.py`, model off, same services as the green integration. Exit 1. Two failures, neither is a mirrored-heading symptom:

- `test2_zombie_triple`: `Health below 8; retreated from zombie`.
- `test4b_creeper_roofed`: the spawn-corner dirt assert passed; the arena-center dirt assert timed out (execute-if stayed silent). The fight itself had already finished.

### Yaw / pillar / arrows

Lane creeper (`4_creeper`): one shot at d=14.1, then the gap opened 14.1 → 16.0 in 0.5 s. The job finished as **repelled** (creeper left alive, no crater on the three dirt samples). Recorded `damage_taken=0`, `hits=0`, `shots=1`. **End health was 3.86**, so the bot lost about 16 hp that the scoreboard did not count. No `pillar` line on this leg (it built the LOS wall instead).

Roofed creeper (`4b`): `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.9)`, perched 2 up (the roof leaves no third block), one shot, `hits=0`. The log says `arrow no arrow entity found near the release` while an arrow name was visible. Server confirmed the creeper dead, end health **20**, recorded damage 0. The pillar fired. The arrow still did not count as a hit.

Movement did not look mirrored: the lane gap grew after the shot, and the roofed bot went up instead of walking into the creeper. Arrows still do not register hits. No second combat run — the same suite would not add a yaw sample, and two of the three allowed runs are still unused.

## 2026-10-14 16:01–17:39 IST — dual soak (`e34c364`)

`AGENT_MODEL=off`, one soak, exit 0, 5866 s. `SOAK DONE (clean)`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, difficulty peaceful). Supervisor still skipping llama-server. Anchors: normal [310, 131, 30], hard [138, 130, 21]. Deaths 0. No `No clear spot`. No second soak.

Times are seconds to the first sample that held the item. Wood/stone/food are the soak's end predicates (wooden pickaxe and table still in inventory; full stone kit plus a furnace; any edible food).

| Run | Wood | Stone pick | Furnace | Food peak | Eaten | Food points | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 391 | 6 | 0 | 0 | 6 | 0 |
| normal2a2 | 120 | 301 | 421 | 8 | 0 | 0 | 8 | 0 |
| normal3a3 | 120 | 421 | 451 | 4 | 0 | 0 | 3 | 0 |
| hard1a1 | 180 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard2a2 | pick at 150, end predicate no | 1233 | — | 0 | 0 | 0 | 0 | 0 |
| hard3a3 | 210 | 481 | 511 | 6 | 0 | 0 | 6 | 0 |

Totals: wood 5/6, stone 4/6, food 4/6. Median furnace at the end is 1. The cooked column is a real meal count (the old `_edible` key is gone). Eaten and food points are real zeros: the food bar stayed at 20 on every normal sample. hard3a3 ended at food 15 with 6 edible items and still eaten 0, stuck on `working: fight`.

### Night

Zero `[night]` lines in the dashboard for the whole soak. `tod_end` was `day` on all six runs. Hard runs are 1250 s from dawn, which is long enough to cross dusk, and none did. `apply_rules('dawn')` never sets `advance_time` back to true after the normal runs freeze it, so the clock stayed stopped. First night was not measured. The harness now sets and verifies `advance_time` and `advance_weather` on that branch. That change was not soaked again.

### Iron

Only normal2a2 reached the iron step. At 10:53:29Z it submitted `gather iron_ore` x6 with `targetY` 32. The job threw `Cannot read properties of undefined (reading 'name')` at `Worker.gather` (`worker.js` 1354) three times in 8 seconds, then `iron failed 3 times; exploring before retry`. The bot was still on the surface at [304, 159, 13] when the run ended. Ore 0, ingots 0, iron pickaxe 0. The empty-column index was undefined, and the catch logged `target.name` and replaced the real error, so the staircase never started. Gather now skips that column and an ore job above its `targetY` still digs down. Not remeasured. Unit tests after that change, every `tests/*.test.js` except `resources.test.js`: 222 passed, 0 failed. The smelt unit now holds a stone pickaxe for the pickup it asserts, and checks that a bare hand leaves the placed furnace in the world.

### Other

- hard1a1: one unstuck at the canopy spawn [138, 130, 21], then parked at [141, 130, 23] for the rest of the run with 0 cobble. The gather message is `Cannot reach or harvest this block`, over and over. Stone and food failed.
- hard2a2: same unstuck, then the same reach failure until it finally moved. Stone pickaxe and sword were in inventory at 1233 s. The table was gone by the end, so the wood predicate failed, and the furnace was never crafted, so stone failed. The run ended on `working: craft`.
- normal1a1: the operator returned the bot from below the anchor at [316, 112, 45] twice. It still finished wood, stone, and food. 0 deaths.
- normal3a3: autopilot went idle twice (resumed at t=541 and t=601) and still finished wood, stone, and food.
- Interventions 7, resumes 2, errors 0. Combat runs 2 and 3 were not used.

## 2026-10-14 18:17–18:34 IST — integration (`409f594`)

`git pull --rebase` was already at `409f594` (round 2, `bf26c2c`..`409f594`). Unit tests, every `tests/*.test.js` except `resources.test.js`: **250 passed, 0 failed**. Services restarted with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py` exit 1, 1053 s. Every leg through A3 passed: sleep, shelter, smelt, the melee zombie fight (`released=0 landed=0`, server confirmed the kill), and A1–A3.

A4 failed before the escape was measured: `A4 the lava trench is not in the world`. The server had just reported `Successfully filled 3 block(s)` after teleporting the bot to (1650, -60, 1648), and the water sweep in that box had removed 75 water blocks a second earlier. `execute if block 1650 -60 1648 minecraft:lava` never said the marker. The same cell reads as water now. At 13:04:32Z the dashboard logged `Reflex: Misc World Survival Chain engaging` and `Bucket-into-lava skipped: Douse interrupted: control changed hands`. The trench did not stay lava long enough to verify, so the escape hp was not measured.

## 2026-10-14 18:38–18:42 IST — combat run 1 of 3 (`82b1747`, code `409f594`)

`python tests/combat_integration.py`, model off, same services. Exit 0, 291 s. `All combat acceptance tests passed`. No second run: the arrow, the roofed damage, and the trio are already measured.

### Arrows

One shot in the whole suite. Roofed creeper, 13:10:18Z: `Combat: arrow creeper @0s: released (arrow entity 2319 at 3.03 b/t)`, inventory 32 → 31, then `@0.15s: landed (hurt event)`. Fight summary: `shots=1 released=1 landed=1`. No `unreleased`, no `missed`, no `PACKET_RATE` on that release. The skeleton leg never drew; it closed and melee'd (`approach=melee`).

### Creepers

`4_creeper` (lane, bot teleported to 1496, -60, 1518): the job completed at 13:10:00Z, 1.1 s, with no combat line at all. Recorded **repelled**, `damage_taken=0`, end health **20**, tactic not reported. No pillar, no wall, no shot. The creeper was still alive and the three dirt samples had no crater.

`4b_creeper_roofed`: the shot above, then `los-break` while the gap closed 9.6 → 2.8. **No pillar line.** Suite `damage_taken=17.1`, end health **3.89**. The fight summary still says `damage taken=0`; the new health-series number is the one that matches the hp lost. The creeper died. The suite printed `roofed creeper damage 17.1 >= 10` and still exited 0. Damage under 10 is not met.

The landed hurt event is a real hit, so this release was not a mirrored miss. After the shot the bot walked in to build the wall.

### Zombie trio

`2_zombie_x3`: ttk 22.6 s, hits 13, sweeps 10, `damage_taken=0`, end health 20, all three dead, tactic melee. Four `Combat: group-spacing zombie` lines between swings. No retreat.

## 2026-10-14 18:44–20:22 IST — dual soak (`e84fa05`, bot code `409f594`)

`AGENT_MODEL=off`, one soak, exit 0, 5862 s. `SOAK DONE (clean)`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`, difficulty peaceful). Anchors: normal [310, 131, 30], hard [142, 131, 31]. Deaths 0, no death lines. Resumes 0. No `Autopilot stopped (Stop all)`. No second soak.

| Run | Wood | Stone pick | Furnace | Food peak | Eaten | Points | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 331 | 361 | 1 | 0 | 0 | 0 | 0 |
| normal2a2 | 90 | 331 | 391 | 1 | 0 | 0 | 0 | 0 |
| normal3a3 | 90 | 331 | 391 | 6 | 0 | 0 | 6 | 0 |
| hard1a1 | 150 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard2a2 | 150 | — | — | 0 | 0 | 0 | 0 | 0 |
| hard3a3 | 271 | 632 | — | 0 | 0 | 0 | 0 | 0 |

Totals: wood 6/6, stone 3/6, food 3/6. Every run ended with a crafting table still in the inventory (2, 2, 2, 2, 1, 1), so the wood predicate held. Eaten and food points are 0. Only normal3 cooked anything.

### Night

All three hard runs submitted `[night] {"type":"shelter"}` and the shelter completed: 13:58Z→14:08Z, 14:19Z→14:29Z, 14:41Z→14:51Z. No `[night]` sleep, and no `Sleeping` line. `tod_end` is `day` on all six because each hard run outlasted the night. hard1 spent that shelter stuck at [149, 132, 42] from t=632 to t=1233, then went back to stone gather with 22 cobble and no stone pickaxe.

### Iron

The iron step never started. No `[iron]` line, no ore, no ingots, no iron pickaxe. The three normal runs were still on food when the 600 s clock ended. The three hard runs never finished the stone kit.

### Stuck, table, idle

- Unreachable blocks are skipped in a burst now (`Gather: skipping stone at … (Cannot reach or harvest this block)` dozens of times in one second at 13:56Z and 14:14Z) instead of one column for the whole run. hard2 still finished with 0 cobble, backing off on stone. hard3 got a stone pickaxe and nothing else in the kit (`queued: gather` at the end).
- hard1 was unstuck four times, at [135, 129, 31], [139, 129, 34], [145, 126, 38], and [147, 130, 40].
- normal3's food explore went down to y=62 at [308, 62, 105] with health still 20, then climbed. No idle resumes.
- No deaths.

## 2026-10-14 21:22–21:40 IST — integration (`d4e3aac`)

`git pull --rebase` was already at `d4e3aac` (round 3, `669b652`..`d4e3aac`). Unit tests, every `tests/*.test.js` except `resources.test.js`: **270 passed, 0 failed**.

The first start failed: port 8765 was held by an orphaned `python -m http.server 8765` (pid 58972, parent already dead, not the agent). That pid was stopped, then `Start-Agent.ps1 -NoBrowser` with `AGENT_MODEL=off`. Supervisor: `model server disabled`.

`python tests/integration.py` exit 0, 1069 s. `All in-game integration tests passed`. A4: `escaped the lava trench (hp 18.8, at [1652, -59, 1650])`. No `Bucket-into-lava skipped` line on this run, and the suite printed no douse NOTE.

## 2026-10-14 21:41–21:46 IST — combat run 1 of 3 (`46a174b`, code `d4e3aac`)

`python tests/combat_integration.py`, model off, same services. Exit 0, about 5 min. `All combat acceptance tests passed`. No second run.

`4b_creeper_roofed`: `Combat: pillar-up 2 at 1496,-60,1497 (creeper at 7.8)`, perched 2 up, then two shots. `arrow creeper @0s: released` (entity at 3.01 b/t) and `@0.1s: landed (hurt event)`, then a second release at 3.03 b/t that also landed. Summary: `shots=2 released=2 landed=2`. Suite `damage_taken=0`, end health **20**, ttk 5.2 s, creeper killed, no crater. No `pillar step` line and no `los-break` on this leg. Damage under 10 is met.

`4_creeper` (lane) is unchanged: ttk 0.0, recorded repelled, damage 0, end health 20, no combat line. The cloud session left that case alone.

## 2026-10-14 21:46–23:36 IST — dual soak (`90c35d3`, bot code `d4e3aac`)

`AGENT_MODEL=off`, one soak, exit 0, 6617 s. `SOAK DONE (with errors)`. The clean copy was not promoted; the record is `data/soak-results-20261014-233621.json`. Flat world restored (`level-name=agent-test-world`, `server-ip=0.0.0.0`). Anchors: normal [310, 131, 30], hard [141, 131, 30]. Three normal runs counted. hard3 was invalid three times (`timeOfDay=None`), so hard is 2 attempts and the second one lost the dashboard before the final read.

| Run | Wood | Stone pick | Furnace | Ore peak | Ingots peak | Iron pick | Cooked | Deaths |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| normal1a1 | 90 | 301 | 361 | 30 | 1 | 812 | 9 | 0 |
| normal2a2 | 150 | 301 | 361 | 0 | 0 | — | 3 | 0 |
| normal3a3 | 90 | 301 | 361 | 0 | 0 | — | 2 | 1 |
| hard1a1 | 60, empty at the end | cobble at 150, no pick | — | 0 | 0 | — | 0 | 2 |
| hard2a2 | 90, final read failed | cobble at 241, no pick | — | 0 | 0 | — | — | suffocated; counter unread |

`iron_runs` 1. Eaten and food points are 0 on every counted run. normal1's stone predicate is no because the furnace was out of the inventory at the bell (it was smelting); the stone kit and the iron pickaxe were held. normal3's stone predicate is no because the death emptied the inventory.

### Iron

Only normal1 reached it. `[iron] gather iron_ore` x6 at 16:29Z, then coal, smelt 6, craft iron pickaxe at 16:32Z (sample t=812), iron sword, shield, then `gather iron_ore` x30. It ended `working: smelt` with 30 raw iron still in the furnace and 0 ingots in the inventory. normal2 was still backing off on food. normal3 died before any ore.

### Hard stone

The dig-down fired. `Gather: No exposed stone within reach; digging down to y=130` and again to y=125 on hard1, and to y=123 on hard2. Neither run crafted a stone pickaxe or a furnace. hard1 suffocated in a wall at [149, 129, 36] at 17:30Z, respawned at [89, 76, -22], and the operator returned it. A normal-anchor dig-down at 16:42Z stopped in 2 s: `Tunnel needs a suitable tool in the inventory for snow_block`. That run still got its stone pickaxe at 301 s.

### Night

No `[bed-prep]` line and no `[night] sleep`. Two shelters: 17:30Z (hard1, after the suffocation) and 17:51Z (hard2). `tod_end` was day on the runs that could still be read.

### Deaths

- normal3, 17:14Z, [355, 41, 81]: `shot by Skeleton`. The operator resumed the ladder. The stone kit was gone afterward.
- hard1, 17:30Z, [149, 129, 36]: `suffocated in a wall`, during the dig-down, right after `Autopilot stopped (Stop all)`.
- hard1, 17:39Z, [143, 128, 31]: `slain by Zombie`.
- hard2, 17:46Z, [140, 129, 34]: `suffocated in a wall`, again right after `Stop all`. The run record never stored it; the dashboard connection was already failing.
- 17:58Z the server kicked the bot: `You are sending too many packets!` After that every sample is `connection refused`, and hard3 could not confirm dawn.

`Stop all` also fired twice on normal2 (16:48Z and 16:53Z). The soak resumed an idle autopilot at t=541 and t=872. No second soak.
