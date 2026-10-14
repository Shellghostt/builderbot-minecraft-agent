# Cloud session round 5 (code only) - Claude, 2026-10-15 03:10

Same rules as `docs/CLOUD_TASK.md`. Read the newest sections of `docs/TEST_REPORTS.md` first (round-4 integration, combat, and the 00:42-02:58 dual soak).

## Round 4 live results
- Wins: integration green; roofed creeper 3/3 arrows, 0 damage; **iron pickaxe in 3/3 normal runs (11-13 min)**, ingots reach the inventory; no suffocation, no self-stop, no packet kick.
- Open: dark-forest nights kill the bot (4 deaths, 3 by skeletons, 1 drowned, then a connection timeout); hard runs never craft a furnace; the soak death counter recorded 1 of those 4.

## Tasks, in order
1. **Night survival in the dark forest.** Dashboard: `Pause trace: shelter -> Reflex: preempted by Mob Defense`, `Reflex: fleeing` dozens of hostiles at once, then `shot by Skeleton` during `shelter` twice. Fix so a night is safe:
   - Start the shelter at sunset (before mobs spawn, ~12000 ticks), not when it is already night, and finish sealing it before dusk ends; the shelter must be fully enclosed (no gaps at head height, roof included) so skeletons have no line of sight.
   - Once sealed, Mob Defense must NOT pull the bot out of its shelter (no flee, no fight, unless a mob is inside or the bot is on fire/drowning); attack only what is adjacent through a gap, then re-seal.
   - If caught outside at night: flee toward the shelter or pillar up 3 and shield/wait, rather than fleeing through a crowd.
   - After a respawn at night, shelter immediately at the spawn point before anything else.
   Unit tests for each decision.
2. **Drowned** (02:46, during the night chaos). Check the flee/pathing never enters deep water at night and that the drowning escape (swim up) wins over Mob Defense.
3. **Soak death counter.** It recorded 1 death where the server log has 4. Count deaths from the bot's death event / server "BuilderBot was ..." lines per run, including deaths during flee/shelter and after a respawn.
4. **Hard runs never craft a furnace.** Stone pickaxe arrives at 541-631 s but the furnace never does. Find why (cobble consumed by shelter/pillar? the 8-cobble furnace step blocked by night?) and make the kit finish.
5. **Connection timeout at the end** (`BuilderBot lost connection: Timed out` at 02:46 right after the drowning). Check the main loop can't block the event loop (keep-alive starvation) during the drowning/flee storm; add a watchdog log line if a tick takes > 500 ms.
6. Low priority: the lane creeper test (`4_creeper`) always ends "repelled" with no combat - make the fixture provoke a real approach (e.g. spawn the creeper at 10 blocks with the bot in its line of sight) so it measures something; keep the roofed case unchanged.

Finish with a "Cloud session round 5" section appended to `docs/HANDOVER_FROM_GLM.md`.
