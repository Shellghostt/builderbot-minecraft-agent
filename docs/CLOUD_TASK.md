# Cloud session task (code only) - Claude, 2026-10-14

You are running in a cloud sandbox on a clone of this repo. The Minecraft test server, the bot's services and all live tests run on the user's PC, not here, so **you cannot run live tests** (`tests/integration.py`, `tests/combat_integration.py`, `tests/soak.py`) and must not try to download or start a Minecraft server. Do code + unit tests only; another agent verifies your work in the game afterwards.

Read first: `AGENTS.md`, `docs/HANDOVER_FROM_CURSOR.md` (Rounds 3-6), `docs/HANDOVER_FROM_GLM.md`, `docs/CLAUDE_REVIEW.md`, `docs/RESEARCH_FIXES.md` (2026-10-14 sections), `docs/TASK_API.md`.

Setup: `npm ci` (node 22). Unit tests: `node --max-old-space-size=2048 --test --test-timeout=60000 $(ls tests/*.test.js | grep -v resources.test.js)`. Keep every existing test green.

Rules: no test-fixture coordinates or names in `src/`; don't make tests easier; no new dependencies without a strong, written reason; small edits in the existing style (ES modules, compact); never weaken the hard rules in AGENTS.md.

## Tasks, in order
1. **Review GLM's last, unmeasured changes** (`git log -p -3 -- src/autopilot.js src/worker.js`): the raw world-age -> time-of-day fix for the dusk/night branch, hunts sweeping their own drops, the anchored food-explore ceiling. Fix bugs you find; add unit tests that would have caught the raw-age bug.
2. **Creeper defence: pillar up.** Arrows miss on this server's ViaVersion path and walls get flanked (both arena variants still take ~16 damage). Implement the human answer: when a creeper is within ~6 blocks (or fusing, `entity.metadata[16]===1`) and the bot has 2+ placeable blocks, jump-place 2-3 blocks under itself (creepers cannot climb; the blast at 3+ blocks up through solid blocks is far weaker), wait until the creeper wanders off or despawns its fuse, then attack it from above only if it stays (or come down when it is > 8 away). Unit-test with the fake bot used in `tests/combat.test.js`. Keep the wall logic as a fallback when no blocks are available.
3. **Bow aim (optional, if time):** port drag-aware arrow ballistics (gravity 0.05/tick, drag 0.99/tick, launch speed 3 at full draw, lead by target velocity x flight ticks; see RESEARCH_FIXES 07:10, minecrafthawkeye / mineflayer-projectile) into `src/combat.js` with unit tests on the math.
4. **Iron step (M5):** make sure the autopilot ladder's iron step is complete and testable: find iron ore (stone/deepslate) by observe/scan or a safe staircase down to y 16..64, mine with the stone pickaxe, smelt raw iron with the existing furnace + fuel, craft iron pickaxe then iron sword; with unit tests on the ladder decisions.
5. **Soak food metric:** `tests/soak.py` reports `edible_peak 0` even when a run hunted, cooked and ate meat. Make the summary count food eaten (food-bar increases after an `eat`/auto-eat, smelt outputs of meat) so food is measured honestly.

Commit after each task with a clear message and push to `origin main` (pull --rebase first). Finish with a short "Cloud session" section appended to `docs/HANDOVER_FROM_GLM.md`: files changed, unit-test totals, what still needs live verification.
