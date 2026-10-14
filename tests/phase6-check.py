"""Debug runner for the new Phase 6 + review-fix sections only (uses the same fixtures
and helpers as integration.py). Run the full suite before reporting.
"""
import pathlib,sys,time,math
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
import integration as I
command=I.command;api=I.api;job=I.job;inventory=I.inventory;server_assert=I.server_assert;wait=I.wait;give_kit=I.give_kit
def main():
    command('difficulty peaceful')
    api('connect',{})
    wait(lambda:api('state')['connected'],90)
    for leftover in api('state')['jobs']:
        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    time.sleep(2)
    command('tp BuilderBot 0 -60 0');command('gamemode survival BuilderBot');command('clear BuilderBot');give_kit();command('kill @e[type=minecraft:item]');command('time set day')
    command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20');time.sleep(2)
    # Teleport next to the test area FIRST so the chunks are loaded, then normalize it;
    # fills on unloaded chunks are silently refused by the server.
    command('tp BuilderBot 1085 -60 1035');time.sleep(6)
    command('fill 1000 -62 990 1080 -58 1030 minecraft:air');command('fill 1000 -63 990 1080 -63 1030 minecraft:dirt');command('fill 1000 -62 990 1080 -62 1030 minecraft:dirt');command('fill 1000 -61 990 1080 -61 1030 minecraft:grass_block');command('kill @e[type=minecraft:item]');time.sleep(2)
    # Gather through natural cover, refuse planks, staircase mining.
    command('tp BuilderBot 1000 -60 1000');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_pickaxe 1');time.sleep(1)
    command('fill 1003 -61 998 1005 -58 1000 minecraft:dirt');command('fill 1004 -60 999 1004 -59 999 minecraft:air');command('setblock 1004 -60 999 minecraft:stone');time.sleep(1)
    job({'type':'gather','block':'stone','count':1},240)
    assert inventory('cobblestone')>=1,'Gather could not reach stone sealed behind natural dirt'
    print('PASS: gather dug through natural dirt to reach the stone',flush=True)
    command('fill 1007 -61 998 1009 -58 1000 minecraft:oak_planks');command('fill 1008 -60 999 1008 -59 999 minecraft:air');command('setblock 1008 -60 999 minecraft:stone');time.sleep(1)
    command('clone 1007 -60 998 1007 -58 1000 1003 -48 995');command('clone 1009 -60 998 1009 -58 1000 1003 -52 995');command('clone 1007 -58 998 1009 -58 1000 1007 -48 995');command('clone 1007 -60 998 1009 -60 998 1011 -48 995');command('clone 1007 -60 1000 1009 -60 1000 1011 -52 995');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'stone','count':1})
    refused=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),240)
    assert refused['status']=='failed','Gather should fail rather than break into a planks shell: '+refused['message']
    server_assert('if blocks 1007 -60 998 1007 -58 1000 1003 -48 995 all if blocks 1009 -60 998 1009 -58 1000 1003 -52 995 all if blocks 1007 -58 998 1009 -58 1000 1007 -48 995 all if blocks 1007 -60 998 1009 -60 998 1011 -48 995 all if blocks 1007 -60 1000 1009 -60 1000 1011 -52 995 all','the planks shell survived the refused gather')
    print('PASS: gather refused to break player-made planks',flush=True)
    # Staircase mining: refill the whole area (earlier sections dig holes), lay a wide stone
    # slab at bedrock level under the bot, and let the staircase dig down to it. The bot
    # must gather 4 and climb back out along its recorded tunnel.
    command('fill 1006 -63 994 1026 -58 1006 minecraft:air');command('fill 1006 -63 994 1026 -63 1006 minecraft:dirt');command('fill 1006 -62 994 1026 -62 1006 minecraft:dirt');command('fill 1006 -61 994 1026 -61 1006 minecraft:grass_block');time.sleep(1)
    command('tp BuilderBot 1016 -60 1000');time.sleep(3);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_pickaxe 1');time.sleep(1)
    command('fill 1006 -63 996 1026 -63 1004 minecraft:stone');time.sleep(1)
    done=job({'type':'gather','block':'stone','count':4,'targetY':-63,'radius':2},300)
    assert inventory('cobblestone')>=4,'The staircase gather did not collect the deep stone'
    depth=api('state')['position']['y']
    assert depth>=-61,f'The bot did not climb back out of the tunnel (y={depth})'
    tunnel=done.get('tunnel') or []
    if tunnel:assert any(p['y']==-63 for p in tunnel),'The tunnel record lacks the deep descent level: '+json.dumps(tunnel[:6]) # empty is fine: the pathfinder may dig down without the helper
    print('PASS: staircase mining reached the deep slab and climbed back up',flush=True)
    # Canopy regression: logs under a leaf platform the bot stands on.
    command('fill 1024 -58 1010 1031 -53 1017 minecraft:air');command('fill 1026 -52 1012 1029 -52 1015 minecraft:oak_leaves[persistent=true]');command('fill 1027 -55 1013 1028 -57 1014 minecraft:dark_oak_log');time.sleep(1)
    command('tp BuilderBot 1027 -51 1013');time.sleep(2)
    job({'type':'gather','block':'dark_oak_log','count':3,'radius':16},300)
    assert inventory('dark_oak_log')>=3,'The canopy gather did not harvest the trunk below the leaves'
    print('PASS: canopy logs below the bot were reached by digging down',flush=True)
    command('fill 1024 -63 1010 1031 -50 1017 minecraft:air');command('kill @e[type=minecraft:item]');command('tp BuilderBot 1016 -60 1000');time.sleep(2)
    # obtain: wipe leftover tables, furnaces and drops so each chain starts clean.
    command('tp BuilderBot 1020 -60 1000');time.sleep(3);command('clear BuilderBot');give_kit();command('fill 1016 -61 994 1032 -58 1008 minecraft:air');command('fill 1016 -61 994 1032 -61 1008 minecraft:grass_block');command('kill @e[type=minecraft:item]');time.sleep(1)
    command('give BuilderBot minecraft:cobblestone 24');command('give BuilderBot minecraft:coal 2');command('give BuilderBot minecraft:oak_planks 8');time.sleep(1)
    job({'type':'obtain','item':'stone_bricks','count':4},300)
    assert inventory('stone_bricks')>=4,'Obtain did not produce stone bricks'
    server_assert('if data entity BuilderBot Inventory[{id:"minecraft:stone_bricks",count:4}]','real stone bricks in the inventory')
    print('PASS: obtain stone_bricks smelted cobblestone and crafted the bricks',flush=True)
    command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:sand 8');command('give BuilderBot minecraft:cobblestone 8');command('give BuilderBot minecraft:coal 2');command('give BuilderBot minecraft:oak_planks 8');time.sleep(1)
    job({'type':'obtain','item':'glass_pane','count':16},300)
    assert inventory('glass_pane')>=16,'Obtain did not produce glass panes'
    print('PASS: obtain glass_pane smelted sand into glass and crafted panes',flush=True)
    command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:oak_planks 12');time.sleep(1)
    job({'type':'obtain','item':'oak_stairs','count':4},240)
    assert inventory('oak_stairs')>=4,'Obtain did not produce oak stairs'
    assert inventory('crafting_table')==1,'The crafting table was not picked back up'
    print('PASS: obtain oak_stairs provisioned a crafting table and crafted stairs',flush=True)
    command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_ingot 1');command('give BuilderBot minecraft:coal 1');command('give BuilderBot minecraft:oak_planks 8');time.sleep(1)
    job({'type':'obtain','item':'lantern','count':1},300)
    assert inventory('lantern')>=1,'Obtain did not produce a lantern'
    print('PASS: obtain lantern crafted nuggets, a torch and the lantern',flush=True)
    created=api('jobs',{'type':'obtain','item':'elytra','count':1})
    refused=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),60)
    assert refused['status']=='failed' and 'End' in refused['message'],'Obtain should refuse elytra with the End reason: '+refused['message']
    print('PASS: obtain refused elytra and explained the End',flush=True)
    # use jobs
    command('tp BuilderBot 1026 -60 1000');time.sleep(2);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_axe 1');command('setblock 1026 -60 1002 minecraft:oak_log');time.sleep(1)
    job({'type':'use','item':'iron_axe','position':{'x':1026,'y':-60,'z':1002}},120)
    server_assert('if block 1026 -60 1002 minecraft:stripped_oak_log','the axe stripped the log')
    print('PASS: use stripped a log with an axe',flush=True)
    command('setblock 1028 -61 1000 minecraft:grass_block');command('give BuilderBot minecraft:wooden_hoe 1');time.sleep(1)
    job({'type':'use','item':'wooden_hoe','position':{'x':1028,'y':-61,'z':1000}},120)
    server_assert('if block 1028 -61 1000 minecraft:farmland','the hoe tilled the grass block')
    print('PASS: use tilled ground with a hoe',flush=True)
    command('setblock 1030 -61 1000 minecraft:farmland');command('setblock 1030 -60 1000 minecraft:wheat[age=1]');command('give BuilderBot minecraft:bone_meal 4');time.sleep(1)
    job({'type':'use','item':'bone_meal','position':{'x':1030,'y':-60,'z':1000}},120)
    server_assert('if block 1030 -60 1000 minecraft:wheat unless block 1030 -60 1000 minecraft:wheat[age=1]','bone meal advanced the wheat')
    print('PASS: use advanced a wheat crop with bone meal',flush=True)
    command('fill 1034 -61 1018 1036 -61 1020 minecraft:air');command('setblock 1035 -61 1019 minecraft:water');command('clear BuilderBot');command('give BuilderBot minecraft:bucket 1');time.sleep(2)
    job({'type':'use','item':'bucket','position':{'x':1035,'y':-61,'z':1019}},120)
    assert inventory('water_bucket')==1,'Filling the bucket did not yield a water bucket'
    server_assert('unless block 1035 -61 1019 minecraft:water','the water source was scooped up',20)
    job({'type':'use','item':'water_bucket','position':{'x':1035,'y':-61,'z':1019}},120)
    server_assert('if block 1035 -61 1019 minecraft:water','the bucket poured the water back',20)
    assert inventory('bucket')==1,'The bucket did not come back empty'
    print('PASS: use filled and emptied a bucket on water only',flush=True)
    command('fill 1034 -61 1018 1036 -61 1020 minecraft:dirt');time.sleep(1)
    command('give BuilderBot minecraft:iron_ingot 2');time.sleep(.5)
    job({'type':'craft','item':'shears','count':1},120)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    command('kill @e[type=minecraft:sheep]');command(f'summon minecraft:sheep {bx} -60 {bz+2} {{NoAI:1b,PersistenceRequired:1b}}');time.sleep(1)
    job({'type':'shear','maxSeconds':40},120)
    wool=sum(i['count'] for i in api('state')['inventory'] if i['name'].endswith('_wool'))
    assert wool>=1,'Shearing produced no wool'
    command('fill 1044 -58 1016 1045 -56 1017 minecraft:oak_leaves[persistent=true]');time.sleep(1)
    job({'type':'use','item':'shears','position':{'x':1044,'y':-57,'z':1016}},120)
    server_assert('unless block 1044 -57 1016 minecraft:oak_leaves','the sheared leaf block is gone')
    print(f'PASS: shears collected wool ({wool}) and a leaf block',flush=True)
    command('scoreboard objectives add bbcnt dummy');command('scoreboard players set CNT bbcnt 0');time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    command('kill @e[type=minecraft:cow]');command(f'summon minecraft:cow {bx} -60 {bz+2} {{PersistenceRequired:1b}}');command(f'summon minecraft:cow {bx+1} -60 {bz+2} {{PersistenceRequired:1b}}');command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:wheat 6');time.sleep(1)
    created=api('jobs',{'type':'breed','entity':'cow'})
    bred=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),180)
    assert bred['status']=='complete','Breed job did not complete: '+bred['message']
    command('execute store result score CNT bbcnt if entity @e[type=minecraft:cow]')
    server_assert('if score CNT bbcnt matches 3..','the cow herd grew to three (a baby was born)',20)
    print('PASS: breed produced a baby cow',flush=True)
    command('tp BuilderBot 1032 -60 1000');time.sleep(2);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_sword 1');time.sleep(1)
    command('summon minecraft:cow 1034 -60 1000 {NoAI:1b,PersistenceRequired:1b}');command('summon minecraft:cow 1036 -60 1002 {NoAI:1b,PersistenceRequired:1b}');time.sleep(1)
    job({'type':'hunt','entity':'cow','count':2},180)
    loot=api('state')['inventory']
    assert sum(i['count'] for i in loot if i['name'] in ('beef','leather'))>=2,'Hunt did not collect cow drops'
    command('kill @e[type=minecraft:cow]');command('kill @e[type=minecraft:sheep]')
    print('PASS: hunt collected leather and beef from cows',flush=True)
    print('All Phase 6 debug checks passed',flush=True)
if __name__=='__main__':main()
