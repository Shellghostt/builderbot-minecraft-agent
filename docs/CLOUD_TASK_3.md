# Cloud session round 3 (code only) - Claude, 2026-10-14 20:40

Same rules as `docs/CLOUD_TASK.md`. Read Cursor's three newest sections in `docs/TEST_REPORTS.md` (integration, combat, dual soak on your round-2 code `409f594`) first.

## What the live tests showed on round 2
- Arrows fixed: `released=1 landed=1` (hurt event). Zombie trio: 0 damage, all dead. Damage accounting now honest.
- Soak: 0 deaths in 6 runs; first real night - all 3 hard runs built a shelter and survived. Normal runs: wood 90 s, stone pick 331 s, furnace 361-391 s every time.
- Iron never started: normal runs end at 600 s while still on food; hard runs never finished stone.

## Tasks, in order
1. **Hard-mode stone step (main blocker).** hard1/hard2 ended with 0-22 cobble and no stone pickaxe; hard3 got the pickaxe at 632 s and no furnace. Logs: bursts of `Gather: skipping stone ... (Cannot reach or harvest this block)` dozens of times per second, 4 unstucks around [135-147, 126-130, 31-40] (dark-oak canopy on a hill). The new blacklist skips fast but nothing reachable is found. Make the stone step reliable on surface-less terrain: if no reachable exposed stone within ~16, dig down where the bot stands (safe staircase, the existing `targetY` path, 3-6 blocks) to reach stone under the dirt, instead of searching the canopy; never dig straight down; keep fluid checks. Also rate-limit the skip loop (one rescan per second at most). Unit tests on the decision.
2. **Roofed creeper: pillar did not fire** (`4b_creeper_roofed`, 17.1 damage). After the first landed arrow the bot logged `los-break` and walked in to build a wall while the gap closed 9.6 -> 2.8; no `pillar` line. In round 1's live run the pillar did fire there (ended at 20 hp). Find which pillar precondition failed after the bow shot (held item is the bow, not a block? headroom check under the 2-high roof? the `bowMode`/wall branch winning?) and make pillar-up take precedence over the wall whenever its preconditions can be met (switch to blocks first). Unit test that reproduces "bow shot, then creeper closing under a low roof".
3. **Soak length for iron.** Normal runs end at 600 s while still on the food step, so iron is never measured. Make normal runs 1200 s (with the frozen-day rules unchanged) and add iron columns to the summary (ore, ingots, iron pickaxe time). Hard runs stay 1250 s.
4. **Integration A4 lava fixture** (`A4 the lava trench is not in the world`): the setup's water sweep in that box ran 1 s before the lava fill and the World Survival chain's douse logged `Douse interrupted: control changed hands`. Make the fixture order deterministic (sweep, wait for the bot to be idle, place lava, verify with `execute if block`), and check whether the douse interruption is a real runner ownership bug.
5. **Night: sleep instead of shelter when possible.** All nights used `shelter` (no bed). If 3 wool are cheap (sheep within 32 and shears or a sword kill), craft a bed before dusk; otherwise keep the shelter. Low priority; skip if the rest takes long.

Finish with a "Cloud session round 3" section appended to `docs/HANDOVER_FROM_GLM.md`.
