# Cloud session round 2 (code only) - Claude, 2026-10-14 17:55

Same setup and rules as `docs/CLOUD_TASK.md` (no game access, unit tests only, no fixture coordinates in `src/`, never make tests easier, commit + push after each task with `git pull --rebase` first). Read `docs/TEST_REPORTS.md` (Cursor's live results on your round-1 code) and your own "Cloud session" section in `docs/HANDOVER_FROM_GLM.md` first.

## What the live tests showed on round 1
- Pillar-up works: roofed creeper killed, bot ended at 20 hp. Movement no longer looks mirrored.
- 0 deaths in all 6 soak runs, BUT the hard runs never had a night: `apply_rules('dawn')` left `advance_time` frozen from the normal runs (Cursor fixed the harness, not yet soaked). Night behaviour is still unmeasured.
- Iron: `gather iron_ore targetY 32` crashed (`Cannot read properties of undefined (reading 'name')`, worker.js ~1354); Cursor patched the column skip, unmeasured.
- Food: cooked meat in 4/6 runs, eaten 0 because hunger never dropped in 10 min. Fine.

## Tasks, in order
1. **Arrows never register hits.** Combat log: `arrow no arrow entity found near the release` after a full draw; 0 hits across all runs, before and after the yaw fix. Find out from mineflayer + the server path (ViaBackwards 26.3 -> 1.21.4) whether the shot is actually released (`bot.deactivateItem` timing, held-item slot, arrows in inventory, `use_item` sequence numbers on 1.21.4) and how the hit is detected (arrow entity spawn, `entityHurt` on the target, target health metadata). Fix the release or the detection, whichever is wrong, with unit tests on the logic.
2. **Combat damage accounting.** `tests/combat_integration.py` recorded `damage_taken=0` for the lane creeper while the bot ended at 3.86 hp. Compute damage from the bot's real health (start minus end, plus any healing/eating in between) and make the record step run before any asserts.
3. **Stuck at canopy spawns.** hard1/hard2 sat for minutes on `Cannot reach or harvest this block` at [138..141,130,21..23]. Find the loop (blacklist not applied? same block retried?) and make the gather blacklist the block and move on, with a test.
4. **Ladder regressions.** hard2 lost its crafting table before the furnace (end predicate failed); normal3 autopilot went idle twice. Check the keep/collect table logic and why the ladder idles.
5. **Zombie trio** (`test2_zombie_triple`: `Health below 8; retreated`): review the multi-mob logic (target the nearest, back off to keep only one in reach, use the force field/shield) and add a unit test.

Finish with a "Cloud session round 2" section appended to `docs/HANDOVER_FROM_GLM.md` (files changed, unit totals, what needs live verification).
