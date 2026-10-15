# Cloud session round 8 (code only) - Claude, 2026-10-15 17:55

Same rules as `docs/CLOUD_TASK.md`. Read the newest sections of `docs/TEST_REPORTS.md` (round-7 integration, combat 15:34, dual soak 15:40-17:49) first.

## Round 7 live results (best so far)
- Integration green; both creepers 0 damage.
- **Iron pickaxe 3/3 normal runs (903, 993, 1204 s), all still held at the end** with an iron sword. Kiln smelting while mining works. Stone picks broke twice and were recrafted.
- **Night: shelters sealed in 6-11 s and held until morning** (`dawn ... staying sealed`, `morning ... opening up`). Hard furnace 2/3 (`sunset - finishing the stone kit first (furnace)` fired).
- 1 death: hard3 `blown up by Creeper` during a craft (12:05Z, daytime, before its shelter). Counter matches the log.
- Still 0 meals eaten.

## Tasks, in order
1. **The bot still never eats.** All three normal runs: `bar 14..20: EAT FAILED (due 1, failed 0, food min 14)` (and due 2 at 15, due 1 at 16) with 8-10 cooked food held. `failed 0` and no reason means no eat attempt was made at all after a meal became "due". Trace the path from `meals.due` to an actual `consume`: is the FoodChain's threshold (<= 10) inconsistent with what counts as due (<= 14/16)? Is the chain outranked by the running job? Make the bot eat whenever its bar is <= 14 and it holds food, while idle or between job steps (not mid-fight), and make the verdict reflect what happened ("not hungry enough", "ate N", "attempted and failed: reason"). Unit tests.
2. **Creeper death while crafting** (hard3, (138,123,39), daytime). Check that Mob Defense / the creeper fuse band can interrupt a craft (open crafting window, table walk) and that a creeper within ~6 always takes over, closing any window first.
3. **Next rung: iron armour, torches, bed.** With the iron pickaxe held: mine coal (surface/cave first), craft torches; collect enough iron for an iron helmet + chestplate (or the full set when affordable) and equip it; craft a bed when 3 wool are cheap (shear or kill sheep) and prefer sleeping to the shelter at night when a bed is held. Follow the existing ladder structure in `src/autopilot.js` and AltoClef's order; unit-test the step decisions.
4. **Toward diamonds (if time):** after the iron kit, a diamond step: staircase/strip-mine at y -58..-54 (1.18+ distribution), with the existing safety rules (lava checks, no straight down), light with torches, mine diamond ore with the iron pickaxe; craft a diamond pickaxe when 3 are held. Unit tests for the decisions; it will be live-measured in a longer soak later.
5. **Soak reporting:** add armour pieces, torches, bed and diamonds to the soak samples/summary (like the iron columns).

Finish with a "Cloud session round 8" section appended to `docs/HANDOVER_FROM_GLM.md`.
