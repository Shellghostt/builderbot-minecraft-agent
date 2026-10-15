# Cloud session round 7 (code only) - Claude, 2026-10-15 14:35

Same rules as `docs/CLOUD_TASK.md`. Read the newest sections of `docs/TEST_REPORTS.md` (round-6 integration, combat 12:13, dual soak 12:18-14:26) first.

## Round 6 live results
- Integration green (reflex-pause fixture works). Combat: both creepers killed at 0 damage (lane: perch knock-back, 5 hits; roofed: 2/2 arrows + knock-back).
- Soak: 2 deaths (hard2 spider after being knocked off the night pillar; hard3 skeleton during a night gather). Iron pickaxe only 1/3 (normal1, 692 s, survived to the end). Hard furnace 1/3. Death counter matches the server log.

## Tasks, in order
1. **Eating fails.** normal3: `EAT FAILED (due 3, failed 4, Promise timed out.)` with 4 cooked food held; normal2: bar fell to 5, `due 1, failed 0`, cooked 0 (probably no food held - then the verdict should say "no food held", not EAT FAILED). Find why `bot.consume`/the eat path times out on this server (ViaBackwards 26.3 -> 1.21.4: the finish-using-item / entity_status 9 event may never arrive). Judge success by the food bar rising (and the item count dropping) rather than the consume promise; retry with the item re-equipped; fix the verdict logic.
2. **Night pillar is not safe from spiders.** hard2 was `knocked off the pillar` four times and killed by a spider (spiders climb). Before that: `Could not seal the shelter: 2 open cells, first at 158,154,-8`. Make the shelter seal those last cells (try other supports / dig a notch / place against any face), and make the night refuge spider-proof: a 3-high pillar with a 1-block overhang ring on top (spiders cannot climb past an overhang), or a sealed 1x1x2 pod; while perched, hit anything that reaches the top.
3. **Leaving the shelter at night.** hard3 sealed at 08:45Z, then was shot by a skeleton at 08:56Z *during a gather* at night. Find why the bot left the sealed shelter before morning (shelter job completion condition? ladder resuming day work?) - stay inside until the sky is light (time of day < 23000 wraps / >= 0 and skylight safe).
4. **Hard furnace / stone kit at dusk.** No `sunset - finishing the stone kit` line in any run; hard1's and hard3's dusk job was `gather grass_block x25` (shelter dirt) instead of the furnace; hard1 and hard3 never got a stone pickaxe at all. Fix the ordering so an affordable kit piece (and the cobble to finish it) comes before shelter dirt, and find why hard1/hard3 stayed on wood/stone so long (hard3 wood at 542 s).
5. **Iron slower and unsmelted.** Iron pickaxe 1/3 (was 2-3/3); normal3 went down to y=19 and was returned by the operator; normal1 ended with 30 raw iron unsmelted. Smelt as soon as 3+ raw iron is held (in batches, while mining continues), cap the staircase target to the iron band near the surface (y 16..64 per 1.18+ ore distribution, prefer the nearest exposed/cave ore first), and keep stone picks in stock (craft a spare when one breaks; two broke this run).

Finish with a "Cloud session round 7" section appended to `docs/HANDOVER_FROM_GLM.md`.
