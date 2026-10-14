# Phase 7: weapons and expert combat

Goal: BuilderBot makes its own weapons and armour and fights each mob the way experienced survival players do, measured in game, not assumed. All work and tests happen on the private test server (25569) only.

Ground rules from AUTONOMY_SPEC.md still apply (verified results, no generated code at runtime, keep existing tests green, report honestly). Verify every mechanic below on this server (26.3 via ViaBackwards at protocol 1.21.4) with a measurement before relying on it; if a mechanic behaves differently here, follow what the server actually does and note it in the report.

## 7a. Gear: make weapons, armour and ammunition

Use the Phase 6 `obtain` chain so the bot can make these itself, and add them to the autopilot ladder at the right tier:
- Swords and axes in every tier it can reach (wood, stone, iron, diamond). Keep one sword and one axe of the best tier.
- Shield (planks + iron ingot). Always in the off hand when fighting.
- Bow (sticks + string from spiders) and arrows (flint from gravel + sticks + feathers from chickens). Keep 32+ arrows when possible.
- Full armour set of the best tier available; repair-by-replacement when durability is low (check item durability, craft a new piece before it breaks).
- Food for combat: keep cooked food; eat golden apples only in emergencies if it has any.

## 7b. Core combat technique (src/combat.js)

Implement these as reusable primitives used by the `fight` job and the threat reflex:
1. **Attack cooldown**: never spam-click. Wait for the weapon's full attack charge (sword about 0.625 s, axe about 1.0 s or more, read from item attack speed) before each hit. Measure that full-charge hits deal more damage than spam hits.
2. **Critical hits**: jump, and strike while falling (not on the way up, not sprinting, not in water or on a ladder). Use crits as the default melee hit when there is room to jump (2 blocks of headroom).
3. **Knockback and spacing**: sprint-hit to knock a mob back, release and re-press forward (sprint reset) for the next knockback hit. Back-pedal while the weapon recharges, so melee mobs walk into the next hit instead of hitting the bot.
4. **Sweep attacks**: with a sword, standing on the ground and not sprinting, a full-charge hit sweeps nearby mobs. Use it against groups and slimes.
5. **Shield**: raise the shield (activate the off-hand item) while waiting for the attack cooldown and whenever a projectile or creeper blast is incoming; lower it to strike. Detect incoming arrows and tridents from projectile entities whose velocity points at the bot.
6. **Bow**: draw fully (about 1 s) before releasing; aim with gravity drop and lead the target's velocity (check whether mineflayer-hawkeye works with mineflayer 4.39; pin it if so, otherwise implement the ballistic aim). Use the bow against creepers, skeletons at range, witches, and anything across water or a gap.
7. **Positioning**: never fight surrounded. Retreat into a 1-wide corridor or doorway so only one mob reaches at a time, keep a wall at the back, and avoid fighting at cliff edges or above lava. Against several melee mobs, a 2-block pillar is an option (melee mobs cannot reach) but not against skeletons.
8. **Health discipline**: disengage, block with the shield and eat when health drops to 12 or below with mobs still alive; retreat home or shelter below 8. Never start a fight at night in the open without armour; shelter instead.
9. **Target priority**: creeper close by > skeleton/witch with line of sight > nearest melee mob. Ignore mobs without a path or line of sight (already in the reflex).

## 7c. Per-mob tactics

| Mob | Expert approach |
|---|---|
| Zombie, husk, zombie villager | Melee with crits and knockback; back-pedal between hits; sweep groups. Baby zombies are fast and small: keep the shield up and aim lower. |
| Drowned | Fight from land; a drowned with a trident is ranged: shield up, close distance or use the bow. |
| Skeleton, stray, bogged | Shield up while closing the distance, zig-zag strafing; use cover between hits; or bow duel from behind cover. Stray arrows slow, bogged arrows poison: prioritise. |
| Creeper | Best: bow from 8+ blocks. Melee: sprint-hit for knockback, immediately back off 3+ blocks while it recovers, repeat; if it starts to fuse (swells, hiss), retreat beyond 7 blocks or raise the shield facing it. Never stand still next to one. |
| Spider, cave spider | Crits; spiders jump, so watch for leaps. Neutral in daylight: ignore unless attacked. Cave spiders poison: kill fast, retreat to eat if poisoned. |
| Enderman | Avoid; never look at its head. If attacked: stand under a 2-block-high roof (it cannot follow) or next to water, and hit its legs with crits. |
| Witch | Rush and kill quickly or use the bow; it heals itself, so keep up pressure. Back off if poisoned or slowed. |
| Slime, magma cube | Sweep attacks; small slimes are harmless; do not chase into water or lava. |
| Phantom | Avoid by sleeping. If present: shield up, strike when it swoops, or shoot it with the bow. |
| Pillager, vindicator | Pillager: shield against crossbow bolts, close distance. Vindicator: hits hard, keep the shield up and knock it back; retreat if health is low. |
| Silverfish | Do not break more infested blocks; fight on solid ground with sweeps. |

Neutral or passive mobs (endermen, piglins, wolves, bees, golems, villagers) are never attacked first.

## 7d. Fight job and reflex integration
- Extend the `fight` job: `{type:'fight', entity?, maxSeconds, style?: 'auto'|'melee'|'bow'}`; `auto` picks the tactic per mob from the table above and the available gear.
- The threat reflex uses the same combat primitives and target priority, and still flees when the fight is not winnable (no weapon, low health, too many mobs, creeper without bow).
- Log each fight: mob, tactic used, hits, crits, damage taken, result.

## 7e. Tests (private flat world, an enclosed arena, normal difficulty, restore peaceful and doMobSpawning afterwards)
- Unit tests: tactic selection per mob and gear; target priority; cooldown timing; ballistic aim maths.
- Integration, each with measured numbers in the report:
  - Crit vs non-crit: same zombie setup, crits kill in fewer hits.
  - Zombie x3 in the arena: bot wins, health lost recorded, uses sweep/corridor.
  - Skeleton at 15 blocks: bot closes with the shield up (or uses the bow) and wins; blocked arrows counted.
  - Creeper: killed without exploding near the bot (bow, or hit-and-retreat), bot health above 14.
  - Spider and cave spider: killed; poison handled.
  - Enderman: not provoked when ignored; when provoked, bot survives using the 2-high roof.
  - Witch: killed.
  - Low health mid-fight: disengages, eats, re-engages or retreats.
  - Gear: the bot crafts a stone sword, a shield and a bow + arrows from fixture materials.
- Compare against the Phase 3 baseline (plain attack loop) for zombie and skeleton: report time to kill and damage taken for both.

## 7f. When NOT to fight: how experienced players survive without good gear

Observed bug (2026-10-10): the bot fought a zombie holding a dirt block. Cause: the `fight` job attacks with whatever is in hand (no weapon required), and when the autopilot hunts an animal (`fight` with `entity: "cow"`) its target list also includes every nearby hostile. Experienced players almost never fight unequipped. Implement this decision policy and use it everywhere (fight job, hunt, reflexes, autopilot):

**Fight only if all are true**: a real weapon (sword or axe; a pickaxe only as a last resort when cornered), health >= 14 (>= 10 if armoured), at most 2 melee mobs, no creeper within 5 blocks without a bow, daylight or a lit/enclosed area. Never attack while holding a block or food: equip the weapon first, verify `heldItem`, otherwise do not swing.

**Hunting animals**: target only the named animal, never hostiles; hunt only in daylight; abort the hunt and hand control to the threat policy if a hostile comes within 8 blocks.

**No weapon (or the fight is not winnable), in this order of preference:**
1. *Get armed first*: with logs/planks and sticks available, craft a wooden sword (and axe) immediately, placing a crafting table if needed. The autopilot ladder must make a wooden sword right after the wooden pickaxe, and a stone sword right after the stone pickaxe, before anything else.
2. *Walk away*: zombies are slower than a sprinting player. Sprint (needs food > 6) on a path away from the mob, break line of sight behind trees/hills for skeletons, keep 16+ blocks. Water slows zombies.
3. *Daytime threats burn*: in early morning undead burn in sunlight; staying out of reach (or in shade they cannot reach) is often enough.
4. *Night without bed or weapon* (the classic first night), chosen by terrain:
   - Hillside/cliff nearby: dig 2 blocks into the hillside (1 wide, 2 high, horizontal, never straight down), seal the entrance with a block behind you, wait for morning, place a torch inside if available.
   - Flat ground: build a 3x3x3 dirt/cobblestone shelter (existing `shelter` job), or pillar up 3+ blocks and place blocks at head height on the sides so skeletons cannot shoot (a bare pillar is only safe from zombies/spiders).
   - Bed available: sleep (skips the night).
   Start this preparation at dusk (time ~12000), not when the first mob arrives.
5. *Cornered with no escape path*: block the gap with a block (zombies cannot break it on normal difficulty), pillar up 2 blocks, or as the very last resort fight with the best item available (axe > sword-less pickaxe > fist; never a block).

**Creepers**: never melee without a shield or bow when unarmoured; walk away; if it starts fusing, run to 7+ blocks.

**After a dangerous encounter**: eat to full, return to the task only when health >= 14.

Tests (arena on the flat world): unarmed bot + zombie in daylight -> walks away, takes no hits; unarmed bot at dusk -> builds/digs a shelter before mobs arrive; bot holding dirt with a sword in inventory -> equips the sword before the first swing (verify heldItem at every attack); hunting cows with a zombie nearby -> never attacks the zombie with a non-weapon, aborts the hunt; autopilot with planks + sticks and a zombie approaching -> crafts a wooden sword first.
