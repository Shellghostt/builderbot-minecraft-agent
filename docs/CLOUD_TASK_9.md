# Cloud session round 9 (code only) - Claude, 2026-10-15 21:05

Same rules as `docs/CLOUD_TASK.md`. Read the newest sections of `docs/TEST_REPORTS.md` (round-8 integration, combat, dual soak 18:49-20:57) first.

## Round 8 live results: a regression
Integration green, both creepers 0 damage, 0 deaths in all 6 runs, shelters held. But **no iron pickaxe in any run** (round 7: 3/3), and so no torches/armour/bed/diamonds.

## Claude's diagnosis from logs/dashboard.log (normal1, 13:22-13:42Z)
The ladder reached `[stone]` and crafted the furnace at 13:27:29Z, then sat on `[food]` for the rest of the run: 27 `[food] explore` legs, `food failed 3 times; exploring before retry` x12, one `fight pig` + `smelt porkchop x3`. Meanwhile the dashboard logged `Food: ate cooked_porkchop (bar 20)` twice (13:33Z, 13:38Z) - **the bot ate its cooked food at a full bar**, so the food step's "hold edible food" condition was never met and the ladder looped on food instead of moving to iron. The soak verdict for normal1 was `EAT FAILED: never attempted (due 2 ...)`, which is also wrong.

## Tasks, in order
1. **Eating at a full bar.** Find why FoodChain/eatMeal ate at bar 20 (is the bar read stale or from the wrong field after round 8's eatAtHunger change? is the "due" latch never cleared?). Never eat above the threshold (14) except the critical-health case; never eat the last food item the ladder's food step is collecting unless hungry. Fix the meal/verdict accounting so an eaten meal is counted as eaten. Unit tests reproducing "bar 20 + cooked food held -> no meal".
2. **Food step must not block progress.** Make the food step complete once the bot has hunted/cooked enough (e.g. >= 4 edible items held OR eaten this run counts toward it), cap its retries (after N failed explores, move on to iron and retry food later when hungry), and never let it loop for the rest of the run. Unit tests.
3. **hard2 never gathered a log** (`Short of shelter blocks ... night pillar` then `timed out at 0/3` every 3 s for 9 minutes before perching). Find why the wood step got nothing at the hard anchor and why the night pillar retried every 3 s (back off, or seal a smaller pod).
4. **Soak length for the iron rung.** Normal runs end at 1200 s, right when the iron pickaxe arrives (15-20 min), so torches/armour/bed/diamonds can never be measured. Make normal runs 2400 s (frozen day), keep hard at 1250 s, and make the summary print the new rung columns.

Finish with a "Cloud session round 9" section appended to `docs/HANDOVER_FROM_GLM.md`.
