# Cloud session round 10 (code only) - FINAL ROUND on the credit, Claude, 2026-10-16

Same rules as `docs/CLOUD_TASK.md`. Read the newest sections of `docs/TEST_REPORTS.md` (round-9 results) first. 

## Round 9 live results (best yet)
Integration green, both creepers 0 damage. **Iron pickaxe 3/3 normal runs at 361-512 s**, torches 16-19, iron armour worn (normal1 full set at 632 s; normal2/3 helmet+chestplate), meals now eaten and counted, food step no longer blocks. 1 death in 6 runs.

## Fix first (bugs from round 9)
A. **Diamond staircase drops the bot.** normal2 `fell from a high place` at (444,13,10) on the diamond rung (lost the iron pick, sword, tools); normal3 on `diamond-rung` (targetY -58) took falls 18.4 -> 12.4 -> 3.5 hp and the operator pulled it back from y=20. Find where the descent falls (stepping off a ledge into a cave/ravine opening? digging the block under the feet? a staircase step onto air?) and make the deep descent never drop more than 1 block: check the 2 cells below every step, place a block over cave openings, stop and route around ravines. Diamonds stayed 0 in both diamond-rung runs.
B. **No bed in any run** (no `[night] sleep`): the bed step never produced wool/bed. Find why (no sheep found? the step gated behind something?) - also listed as habit 5 below.
C. Minor: 3 of 7 meals started above bar 14 (`17 -> 20`, then a `19 -> 20` fill-up 13 s later; `16 -> 20` during the falls). Only the critical-health path may eat above 14.
D. Hard runs: furnace 1/3, stone 2/3, wood as late as 543 s (`searching further afield`). Lower priority than A-B.


## Efficiency: play like a real player (observed live by the user during the round-9 soak)
1. **Don't stand and stare at a working furnace.** While smelting iron, the bot stood looking at the furnace with exposed coal all around it. A furnace works on its own: load it (input + fuel), then do other useful work nearby (mine visible coal/ore, gather logs, collect drops, craft) and come back when the output is ready (`8 items x 10 s` per smelt cycle; check the output slot on return or when passing within reach). Implement this as "parallel" work in the ladder/smelt job: a smelt job that loads the furnace, hands control back with a "collect at T" reminder, and a later collect step. Keep safety (stay within ~24 blocks, never leave it at night).
2. **Batch, don't ping-pong.** On the food step it killed one animal, picked up the meat, placed a furnace, cooked, broke the furnace, then walked to the next animal right next to it and repeated. A player would kill all nearby animals first (within ~24 blocks, up to the meat target), collect all drops, then cook everything in one furnace run, and keep the furnace placed (or carried) while more cooking is likely. Apply the same batching idea generally: gather everything of a kind in range before switching tasks; reuse an already-placed furnace/table within range instead of placing and breaking one each time.
3. **Opportunistic pickups.** When walking or mining, mine valuable exposed blocks in easy reach that the ladder will need soon (coal ore, iron ore, logs when low), without derailing the current step (time cap per detour, skip at night or with hostiles near).
Unit-test the scheduling decisions (fake clock + fake furnace).

## More real-player habits (user request: go all out; do them in this order, as many as fit, each unit-tested)
Sources: Wikibooks "How to Survive in Minecraft/Day 1", The Backdash first-night tips, Shockbyte diamond Y-level guide (1.20/1.21), Sportskeeda/CreeperHost/GGServers survival tips.

4. **Use the night instead of idling.** Experienced players spend the first nights in a staircase mine (safe underground) collecting coal/iron instead of standing in a box. If the bot is sealed and has a pickaxe, dig a 1x2 tunnel/staircase *from inside the shelter* (the tunnel stays sealed behind it), mine coal/iron, then come back up at dawn. Keep all dig-safety rules (no straight down, lava/water checks, falling blocks).
5. **Bed and spawn point.** Get 3 wool early (kill sheep with the sword or shear them), craft a bed, place it at the base, sleep through nights (skips the night entirely, no mobs) and set the respawn point there. Prefer bed over shelter whenever a bed is held.
6. **Home base and inventory management.** Pick a base spot (near the first table/furnace/bed), remember its coordinates, put a chest there, deposit surplus (dirt overflow, cobble beyond a stack, gravel, seeds, rotten flesh, extra saplings) when the inventory is >75% full or when passing by; drop pure junk when full and far from base. Keep tools/food/torches/blocks in the hotbar.
7. **Light and mark mines.** Craft torches as soon as coal (or charcoal) and sticks exist; place a torch every ~7 blocks in tunnels and inside the shelter/base, and on one consistent side so the way back is known. Charcoal fallback: smelt logs when no coal is found.
8. **Diamonds the safe way.** Branch-mine at Y -53 (lava lakes are at -54, diamonds peak near -59; -53 is the safer layer): a main 1x2 tunnel with side branches every 3 blocks, torches, and a cobble plug for any lava seen; needs the iron pickaxe.
9. **Water bucket safety.** After the iron core: craft a bucket, fill it with water, keep it. Use it to put out fire on self, to turn lava to obsidian/cobble when lava blocks the path, and for fall breaks (the MLG chain exists - make sure it uses the held bucket).
10. **Health management like a player.** Natural regeneration needs the hunger bar >= 18: after damage, eat to top up to >= 18 when safe, and retreat to heal before resuming risky work (mining near lava, caves at night).
11. **Food security beyond hunting.** Collect seeds from grass, plant a small wheat patch near the base when hoe + water are available, craft bread; breed 2 animals of a kind when their food is held. Loot hay bales / bread from a village if one is seen (no griefing beyond what a player would do).
12. **Know which mobs to leave alone.** Don't look at or hit endermen (unless cornered), leave neutral spiders alone in daylight, never melee a creeper, back off from a witch.
