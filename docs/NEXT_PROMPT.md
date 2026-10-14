Claude review of Phase 3: approved, great persistence on the packet flood.

Small fixes first:
1. The threat reflex must ignore hostiles the bot cannot reach or see. Require |dy| <= 3 and a clear line of sight (raycast from the bot's eyes to the mob's eyes with bot.world.raycast), otherwise mobs in caves below or above will constantly pre-empt jobs.
2. Never auto-attack neutral mobs (enderman, zombified_piglin, piglin; spiders in daylight can be ignored too) unless they are within 2 blocks or damaged the bot in the last 5 s (track entityHurt / health drops with a nearby attacker).
3. respondThreat ranks weapons with the ARMOUR tier table (no wooden/stone). Use the tool tier table (wooden 1, golden 2, stone 3, iron 4, diamond 5, netherite 6; sword above axe).
4. Add an integration test for death handling: kill BuilderBot with a console command while a job runs. Check that the death position and cause are logged, jobs are paused, a flag requires explicit Resume, and the bot respawned.
5. Stabilise tests: use 'gamerule doMobSpawning false' in the fixtures (restore afterwards) instead of hunting for slime-free coordinates.

Then Phase 4 (autopilot) from docs/AUTONOMY_SPEC.md:
- New src/autopilot.js with the deterministic progression ladder (steps 1-7). Build each step ONLY from existing verified job types queued through the normal worker queue, so Stop, reflexes and failure handling all keep working.
- Choose the first unmet step each cycle, with sensible retry/backoff and a 'blocked' state when a step fails 3 times (then explore elsewhere and try again).
- Night: sleep if a bed is available, otherwise shelter.
- Remember a home position (first bed/chest) in data/autopilot.json.
- POST /api/autopilot {enabled, goal?}, MCP tools minecraft_autopilot_start/stop, autopilot state in observe and on the dashboard. Stop-all stops autopilot.
- Tests: unit tests for step selection from fake inventories; an integration test on the flat world with fixtures showing it picks and completes step 1 (wood -> planks -> sticks -> table -> wooden pickaxe) by itself.
- 10-minute soak test on normal terrain: create a SEPARATE world folder (e.g. test-server/agent-soak-world, normal terrain, normal difficulty, a fixed seed) by temporarily switching level-name in the test server's server.properties, and restore level-name=agent-test-world afterwards. Never delete the flat world. Report the soak results honestly: what it achieved, deaths, stuck points.
- Update README/AGENTS.md. Then STOP and report.
