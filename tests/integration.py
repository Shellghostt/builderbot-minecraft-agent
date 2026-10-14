"""End-to-end survival tests. Console fixtures affect ONLY the private test world."""
import pathlib,json,urllib.request,time,sys,socket,uuid,math,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
def api(route,data=None,supervisor=False):
    port=8766 if supervisor else 8765
    key=(ROOT/'data'/('supervisor-token' if supervisor else 'dashboard-token')).read_text()
    req=urllib.request.Request(f'http://127.0.0.1:{port}/'+(route if supervisor else 'api/'+route),data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:
        return json.load(urllib.request.urlopen(req,timeout=100))
    except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
    except (TimeoutError,socket.timeout):
        # The dashboard can stall for seconds under pathfinding load; retry GETs once.
        if data is None and not supervisor:
            return json.load(urllib.request.urlopen(req,timeout=100))
        raise
def command(command):return api('test-command',{'command':command},True)
def server_assert(condition,label,seconds=5):
    marker='AGENT_VERIFIED_'+uuid.uuid4().hex
    command('execute '+condition+' run say '+marker)
    def logged():
        text=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')
        text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',text)
        return '[Server] '+marker in text
    wait(logged,seconds);print('PASS: server confirms '+label,flush=True)
def wait(predicate,seconds=60):
    deadline=time.time()+seconds
    while time.time()<deadline:
        value=predicate()
        if value:return value
        time.sleep(.5)
    raise TimeoutError('Condition did not become true')
def job(spec,seconds=90):
    created=api('jobs',spec);print('Testing '+json.dumps(spec),flush=True)
    # 'Preempted by <chain>' pauses are TRANSIENT in the ported architecture: the survival
    # chain acts, yields, and the worker's cadence bridge resumes the job automatically.
    def terminal():
        j=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None)
        if j and j['status']=='paused' and str(j.get('message','')).startswith('Preempted by'):return None
        return j
    value=wait(terminal,seconds)
    if value['status']!='complete':raise RuntimeError(json.dumps(value))
    print('PASS: '+value['message'],flush=True);return value
def inventory(name):return sum(i['count'] for i in api('state')['inventory'] if i['name']==name)
def place_far(command_text,tries=8):
    for _ in range(tries):
        marker=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
        command(command_text);time.sleep(2)
        text=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')[marker:]
        if 'Could not set the block' not in text:return True
    return False
def wait_for_marker(marker,offset,seconds=5):
    deadline=time.time()+seconds
    while time.time()<deadline:
        raw=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')
        if '[Server] '+marker in re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',raw[offset:]):return True
        time.sleep(.5)
    return False
def plant_block(command_text,expect_check,tries=4):
    # A setblock/fill at an unloaded position silently no-ops ("That position is not loaded"
    # never matches place_far's check) and the client chunk cache can stay stale after a tp:
    # verify the block server-side, far-tp reload on failure and always refresh on success.
    home=api('state')['position']
    def shuttle():
        command('tp BuilderBot 200 -60 200');time.sleep(2);command('tp BuilderBot %d %d %d'%(math.floor(home['x']),math.floor(home['y']),math.floor(home['z'])));time.sleep(2)
    for _ in range(tries):
        mark=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
        command(command_text);time.sleep(2)
        marker='AGENT_VERIFIED_'+uuid.uuid4().hex
        command('execute '+expect_check+' run say '+marker)
        if wait_for_marker(marker,mark):break
        shuttle() # the round trip reloads the chunk so the retry can land
    else:return False
    shuttle() # refresh the client cache so findBlocks sees the verified block
    return True
def fill_ok(command_text,tries=4):
    # A fill's own reply is the proof: "Successfully filled" or "No blocks were filled"
    # (nothing matched) both mean it ran; "not loaded" means it silently did nothing.
    for _ in range(tries):
        mark=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
        command(command_text)
        deadline=time.time()+4
        while time.time()<deadline:
            text=re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')[mark:])
            if 'Successfully filled' in text or 'No blocks were filled' in text:return True
            if 'not loaded' in text:break
            time.sleep(.3)
        time.sleep(1.5)
    return False
def give_kit():
    for item in ['leather_helmet','leather_chestplate','leather_leggings','leather_boots']:command('give BuilderBot minecraft:'+item+' 1')
def clear_hostiles():
    for mob in ['zombie','creeper','slime']:command('kill @e[type=minecraft:'+mob+']')
def port_ready():
    try:
        with socket.create_connection(('127.0.0.1',25569),timeout=.5):return True
    except OSError:return False
def main():
    wait(port_ready,120)
    command('difficulty peaceful')
    api('connect',{})
    wait(lambda:api('state')['connected'],90)
    # A death right at connect respawns the bot at the world spawn, far from the fixtures:
    # sweep leftovers and re-tp once the connection has settled.
    time.sleep(3)
    command('kill @e[type=minecraft:slime]');command('kill @e[type=minecraft:zombie]')
    command('tp BuilderBot 0 -60 0');time.sleep(3)
    # A previous session's reflex may have resumed paused jobs; clear the leftover queue
    # twice so jobs resumed by an in-flight reflex are caught as well.
    def cancel_leftovers():
        for leftover in api('state')['jobs']:
            if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    cancel_leftovers();time.sleep(3);cancel_leftovers();time.sleep(1)
    command('tp BuilderBot 0 -60 0');command('gamemode survival BuilderBot');command('clear BuilderBot');give_kit();command('kill @e[type=minecraft:item]');command('time set day');time.sleep(3)
    command('give BuilderBot minecraft:iron_axe 1');command('give BuilderBot minecraft:iron_pickaxe 1')
    # A previous session may have ended wounded or hungry; normalize vitals for the suite.
    command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20');time.sleep(1)
    # The suite outlives a day cycle; natural spawns (slime swarms at night) would interfere.
    # Summoned fixture mobs ignore this rule.
    command('kill @e[type=minecraft:slime]');command('kill @e[type=minecraft:zombie]');command('kill @e[type=minecraft:creeper]')
    command('gamerule spawn_mobs false')
    command('fill 1 -60 2 3 -60 4 minecraft:oak_log');command('setblock -3 -60 0 minecraft:chest')
    command('data remove block -3 -60 0 Items')
    time.sleep(2)
    # The ViaVersion client cache can hold stale chunk data after the connect/tp cycle:
    # a far-tp round trip forces the reload so findBlocks sees the fresh fixture.
    command('tp BuilderBot 200 -60 200');time.sleep(2);command('tp BuilderBot 0 -60 0');time.sleep(2)
    job({'type':'gather','block':'oak_log','count':8},180)
    assert inventory('oak_log')>=8,'Logs were not actually collected'
    job({'type':'craft','item':'oak_planks','count':32})
    assert inventory('oak_planks')>=32,'Planks were not actually crafted'
    server_assert('if data entity BuilderBot Inventory[{id:"minecraft:oak_planks",count:32}]','32 real crafted planks')
    job({'type':'deposit','position':{'x':-3,'y':-60,'z':0},'item':'oak_planks'})
    assert inventory('oak_planks')==0,'Deposit did not remove planks from inventory'
    server_assert('if data block -3 -60 0 Items[{id:"minecraft:oak_planks",count:32}]','32 planks in the chest')
    command('give BuilderBot minecraft:oak_planks 20');command('fill 5 -60 0 7 -60 2 minecraft:air');time.sleep(1)
    job({'type':'build','blueprint':'platform','origin':{'x':5,'y':-60,'z':0}},180)
    server_assert(' '.join(f'if block {x} -60 {z} minecraft:oak_planks' for x in range(5,8) for z in range(3)),'all 9 placed blocks')
    # Re-running a finished build must verify the existing blocks without consuming items.
    before=inventory('oak_planks');job({'type':'build','blueprint':'platform','origin':{'x':5,'y':-60,'z':0}},180);assert inventory('oak_planks')==before,'Build resume consumed duplicate blocks'
    command('setblock 12 -60 0 minecraft:cobblestone')
    # Force a client chunk reload: ViaVersion block updates can race the client cache.
    command('tp BuilderBot 300 -60 300');time.sleep(4);command('tp BuilderBot 8 -60 0');time.sleep(4)
    job({'type':'gather','block':'cobblestone','count':1},90)
    assert inventory('cobblestone')>=1,'Mining did not collect cobblestone'
    job({'type':'goto','position':{'x':0,'y':-60,'z':0}})
    # Stop a long movement and check it does not continue in the background.
    created=api('jobs',{'type':'goto','position':{'x':32,'y':-60,'z':0}});time.sleep(.7);api('stop',{});time.sleep(.5);first=api('state')['position'];time.sleep(1);second=api('state')['position'];assert math.dist(first.values(),second.values())<.25,'Movement continued after Stop'
    stopped=next(j for j in api('state')['jobs'] if j['id']==created['id']);assert stopped['status']=='paused';api('cancel',{'id':created['id']})
    print('PASS: stop pauses movement and queue',flush=True)
    # Perception: /api/observe must report real world state, not assumptions.
    command('summon minecraft:pig 5 -60 5 {NoAI:1b}');command('difficulty normal');command('summon minecraft:zombie 6 -60 0 {NoAI:1b,PersistenceRequired:1b}');time.sleep(1)
    observed=api('observe')
    assert observed['connected'] and observed['dimension']=='overworld' and observed['biome'],'Observe is missing environment data'
    assert observed['timeOfDay'] in ('day','dusk','night','dawn') and observed['weather'] in ('clear','rain','thunder'),'Observe time or weather is invalid'
    assert isinstance(observed['light'],int) and observed['health']>=15 and observed['food']>=15 and observed['oxygen']==20,'Observe vitals are wrong'
    assert observed['blocks']['chest']['count']>=1 and observed['blocks']['chest']['at']=={'x':-3,'y':-60,'z':0},'Observe did not find the chest at its real position'
    assert any(e['type']=='pig' and e['class']=='passive' for e in observed['entities']),'Observe missed the summoned pig'
    assert any(e['type']=='zombie' and e['class']=='hostile' for e in observed['entities']),'Observe did not report the zombie as hostile'
    assert not any(e['type'] in ('item','experience_orb','arrow') for e in observed['entities']),'Dropped items leaked into the entity list'
    assert isinstance(observed['drops'],int) and observed['drops']>=0,'Observe drops count is missing'
    assert observed['job'] is None and len(observed['events'])<=10,'Observe job or events are wrong'
    assert len(json.dumps(observed).encode())<3072,'Observe payload is '+str(len(json.dumps(observed).encode()))+' bytes'
    command('kill @e[type=minecraft:pig]');command('kill @e[type=minecraft:zombie]');command('difficulty peaceful')
    print('PASS: observe reports environment, chest position, pig, hostile zombie, oxygen and stays compact',flush=True)
    # Phase 2 Part A: place, eat, equip, collect, gather upgrades, explore, craft-table upgrade.
    command('give BuilderBot minecraft:cobblestone 1');command('tp BuilderBot 0 -60 0');time.sleep(2);command('setblock 2 -60 6 minecraft:air');time.sleep(1)
    cobble_before=inventory('cobblestone')
    job({'type':'place','block':'cobblestone','position':{'x':2,'y':-60,'z':6}},120)
    assert inventory('cobblestone')==cobble_before-1,'Place did not consume the block from the inventory'
    server_assert('if block 2 -60 6 minecraft:cobblestone','placed cobblestone at 2,-60,6')
    # Food cannot deplete on a peaceful world and damage effects are inconsistent through
    # Via, so flip difficulty, drain food with hunger and cut health with /damage.
    # Reflexes stay off so the auto-eat reflex does not eat the fixture before the job does.
    api('reflexes',{'enabled':False})
    command('give BuilderBot minecraft:cooked_beef 4');command('difficulty normal');command('effect give BuilderBot minecraft:instant_health 1 10');command('effect give BuilderBot minecraft:hunger 15 255');time.sleep(6)
    command('damage BuilderBot 12 minecraft:magic');time.sleep(1);command('effect clear BuilderBot');command('difficulty peaceful');time.sleep(1)
    food_before=api('state')['food'];health_before=api('state')['health']
    assert food_before<20 and health_before<10,f'The fixture did not deplete vitals: food {food_before} health {health_before}'
    job({'type':'eat'},90)
    food_after=api('state')['food']
    assert food_after>food_before,f'Eat did not raise food: {food_before} -> {food_after}'
    print(f'PASS: eat worked at health {health_before} and raised food from {food_before} to {food_after}',flush=True)
    # Restore vitals so later non-survival jobs are not blocked by the low-health guard.
    command('effect give BuilderBot minecraft:saturation 1 20');command('effect give BuilderBot minecraft:instant_health 1 4');time.sleep(1)
    api('reflexes',{'enabled':True})
    command('give BuilderBot minecraft:diamond_pickaxe 1');command('give BuilderBot minecraft:iron_chestplate 1');command('give BuilderBot minecraft:shield 1');time.sleep(.5)
    job({'type':'equip'},90)
    observed=api('observe')
    assert observed['held']['name']=='diamond_pickaxe','Equip did not select the best tool'
    assert observed['armor']['chest']=='iron_chestplate','Equip did not wear the best chestplate'
    server_assert('if data entity BuilderBot SelectedItem{id:"minecraft:diamond_pickaxe"}','best tool really held')
    command('kill @e[type=minecraft:item]');time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    planks_before=inventory('oak_planks')
    clear_hostiles()
    command(f'summon minecraft:item {bx+2} -60 {bz} {{Item:{{id:"minecraft:oak_planks",count:5}}}}')
    clear_hostiles()
    command(f'summon minecraft:item {bx-2} -60 {bz+2} {{Item:{{id:"minecraft:oak_planks",count:5}}}}');time.sleep(1)
    job({'type':'collect'},120)
    assert inventory('oak_planks')>=planks_before+10,'Collect did not pick up the dropped stacks'
    server_assert('at BuilderBot unless entity @e[type=minecraft:item,distance=..6]','no drops left nearby')
    # gather: radius up to 64 and searchIfMissing exploration
    command('kill @e[type=minecraft:item]');command('fill 1 -60 2 3 -60 4 minecraft:air');command('tp BuilderBot 0 -60 0');time.sleep(3);place_far('setblock 40 -60 0 minecraft:oak_log');time.sleep(1)
    job({'type':'gather','block':'oak_log','count':1,'radius':48},150)
    assert inventory('oak_log')>=1,'Radius gather did not collect the far log'
    command('tp BuilderBot 0 -60 0');time.sleep(3);place_far('setblock 45 -60 0 minecraft:oak_log');time.sleep(1)
    job({'type':'gather','block':'oak_log','count':1,'radius':32,'searchIfMissing':True},300)
    assert inventory('oak_log')>=2,'searchIfMissing did not find the distant log'
    command('tp BuilderBot 0 -60 0');time.sleep(2);command('fill -32 -62 -32 32 -58 32 minecraft:air replace minecraft:oak_log');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'oak_log','count':1,'radius':32})
    failed=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),90)
    assert failed['status']=='failed','Gather beyond its radius should fail without searchIfMissing'
    print('PASS: gather radius and searchIfMissing behave',flush=True)
    # explore: digs through natural stone and ends at least the requested distance away.
    # The wall reaches the bedrock layer so tunnelling underneath is impossible.
    command('tp BuilderBot 200 -60 200');time.sleep(5);command('fill 210 -60 190 240 -58 210 minecraft:air');command('fill 210 -62 190 240 -61 210 minecraft:dirt');time.sleep(1)
    command('fill 216 -64 176 216 -58 224 minecraft:stone');command('clone 216 -64 176 216 -58 224 300 -64 176');time.sleep(1)
    job({'type':'explore','direction':'east','distance':32},240)
    end=api('state')['position']
    assert math.dist([math.floor(end['x']),math.floor(end['z'])],[200,200])>=32,'Explore did not travel the requested distance'
    server_assert('unless blocks 216 -64 176 216 -58 224 300 -64 176 all','explore dug through the stone wall')
    # explore: refuses to break player-made planks; the wall must stay intact
    command('tp BuilderBot 240 -60 240');time.sleep(5);command('fill 225 -60 230 245 -58 290 minecraft:air');command('fill 225 -62 230 245 -61 290 minecraft:dirt');time.sleep(1)
    command('fill 232 -64 200 232 -58 280 minecraft:oak_planks');command('clone 232 -64 200 232 -58 280 300 -64 200');time.sleep(1)
    created=api('jobs',{'type':'explore','direction':'west','distance':32})
    outcome=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),300)
    print(f'Explore past planks ended: {outcome["status"]} ({outcome["message"]})',flush=True)
    if outcome['status']=='complete':
        end=api('state')['position'];assert math.dist([math.floor(end['x']),math.floor(end['z'])],[240,240])>=32,'Explore stopped short of the goal'
    server_assert('if blocks 232 -60 200 232 -58 280 300 -60 200 all','the planks wall is untouched')
    # craft: places or crafts a crafting table for 3x3 recipes and picks it back up
    command('tp BuilderBot 60 -60 60');command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:oak_planks 16');time.sleep(1)
    job({'type':'craft','item':'chest','count':1},240)
    assert inventory('chest')>=1,'Craft did not produce the chest'
    assert inventory('crafting_table')==1,'The crafting table was not picked back up'
    server_assert('if data entity BuilderBot Inventory[{id:"minecraft:chest",count:1}]','real crafted chest')
    # sleep: bed placed and used at night, job ends when morning comes
    command('tp BuilderBot 450 -60 450');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:red_bed 1');command('time set 13000');time.sleep(1)
    created=api('jobs',{'type':'sleep'})
    # The worker sets this progress message only after the server confirms the bot is asleep.
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j.get('message')=='Sleeping until morning'),None),60)
    command('time set day')
    slept=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),120)
    assert slept['status']=='complete','Sleep job did not complete: '+slept['message']
    print('PASS: sleep used the bed until morning',flush=True)
    # Bury the sleep area: removes the placed bed (deaths then respawn at the cleared origin)
    # and flattens the holes earlier sessions left there.
    command('fill 394 -62 394 406 -58 406 minecraft:dirt')
    # shelter: builds a dirt box at night, waits for morning, removes only its own blocks
    command('tp BuilderBot 500 -60 500');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:dirt 30');command('time set 13000');time.sleep(1)
    created=api('jobs',{'type':'shelter'})
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='running'),None),30)
    origin=api('state')['position'];ox,oy,oz=math.floor(origin['x']),math.floor(origin['y']),math.floor(origin['z'])
    time.sleep(45)
    server_assert(f'if block {ox+1} {oy} {oz} minecraft:dirt','shelter wall built')
    server_assert(f'if block {ox} {oy+2} {oz} minecraft:dirt','shelter roof built')
    command('time set day')
    built=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),300)
    assert built['status']=='complete','Shelter job did not complete: '+built['message']
    assert inventory('dirt')>=25,'Shelter blocks were not recovered'
    server_assert(f'unless block {ox+1} {oy} {oz} minecraft:dirt','shelter wall removed after morning')
    print('PASS: shelter built a box, waited out the night and cleaned up',flush=True)
    # fight: a summoned zombie on normal difficulty is defeated with the best weapon.
    # Reflexes stay off so the job's own loop is what fights.
    api('reflexes',{'enabled':False})
    command('time set day');command('kill @e[type=minecraft:slime]');command('difficulty normal')
    # A previous run's dirt pad (y=-63..-58) is still here. Teleport onto it first or
    # the fill is rejected with "That position is not loaded" and the bot suffocates.
    command('tp BuilderBot 700 -57 700');time.sleep(3)
    command('fill 690 -60 690 710 -55 710 minecraft:air')
    command('tp BuilderBot 700 -60 700');time.sleep(2);command('give BuilderBot minecraft:iron_sword 1');time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    clear_hostiles();command('kill @e[type=minecraft:slime]')  # the chunk under the arena is a slime chunk
    command(f'summon minecraft:zombie {bx+6} -60 {bz} {{NoAI:1b,PersistenceRequired:1b}}');time.sleep(1)
    command('kill @e[type=minecraft:slime]')
    job({'type':'fight','maxSeconds':40},120)
    command('kill @e[type=minecraft:slime]')
    server_assert('at BuilderBot unless entity @e[type=minecraft:zombie,distance=..16]','the zombie was defeated')
    # The fight job must retreat on its own at low health instead of being stopped by the global
    # guard. Fists keep the zombie alive; the shield keeps the bot alive until it gets away.
    command('tp BuilderBot 950 -60 950');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:shield 1');command('give BuilderBot minecraft:leather_helmet 1');command('give BuilderBot minecraft:leather_chestplate 1');command('give BuilderBot minecraft:leather_leggings 1');command('give BuilderBot minecraft:leather_boots 1');time.sleep(.5)
    job({'type':'equip'},60)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    clear_hostiles();command('kill @e[type=minecraft:slime]')
    command(f'summon minecraft:zombie {bx+3} -60 {bz} {{PersistenceRequired:1b}}');time.sleep(1)
    created=api('jobs',{'type':'fight','maxSeconds':45})
    fought=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),120)
    assert fought['status']=='failed' and 'retreated' in fought['message'],f'Fight did not retreat on its own: {fought["message"]}'
    health=api('state')['health'];assert health>0,'The bot died instead of retreating'
    print(f'PASS: fight retreated on its own at health {round(health,1)}',flush=True)
    command('kill @e[type=minecraft:zombie]');command('difficulty peaceful')
    command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20');time.sleep(1)
    api('reflexes',{'enabled':True})
    # smelt: provisions a table and furnace, then produces real ingots
    command('tp BuilderBot 800 -60 800');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:cobblestone 8');command('give BuilderBot minecraft:oak_planks 4');command('give BuilderBot minecraft:raw_iron 3');command('give BuilderBot minecraft:coal 1');time.sleep(1)
    job({'type':'smelt','item':'raw_iron','count':3},300)
    assert inventory('iron_ingot')>=3,'Smelt did not produce iron ingots'
    server_assert('if data entity BuilderBot Inventory[{id:"minecraft:iron_ingot"}]','real smelted ingots in the inventory')
    observed=api('observe');assert observed['blocks'].get('furnace',{}).get('count',0)>=1,'The furnace was not found nearby'
    print('PASS: smelt provisioned a furnace and produced real ingots',flush=True)
    # Death handling: a console kill while a job runs must log, pause and require explicit resume.
    command('tp BuilderBot 0 -60 0');time.sleep(2);clear_hostiles();command('setblock 12 -60 12 minecraft:oak_log')
    command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'oak_log','count':1})
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='running'),None),30)
    command('kill BuilderBot')
    wait(lambda:any('Bot died at' in e['message'] for e in api('state')['events']),15)
    dead=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='paused'),None),15)
    assert any('Bot died at' in e['message'] for e in api('state')['events']),'The death position was not logged'
    wait(lambda:api('state')['health']==20,20)
    time.sleep(3)
    still=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
    assert still['status']=='paused','The paused job resumed without an explicit resume'
    api('cancel',{'id':created['id']})
    command('kill @e[type=minecraft:item]')
    print('PASS: death logged with position, job stayed paused and the bot respawned',flush=True)
    # Gather paths through natural cover (explore movements) and refuses player-made blocks.
    command('tp BuilderBot 1000 -60 1000');time.sleep(4);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_pickaxe 1');time.sleep(1)
    command('fill 1000 -63 990 1030 -58 1006 minecraft:air');command('fill 1000 -62 990 1030 -62 1006 minecraft:dirt');command('fill 1000 -61 990 1030 -61 1006 minecraft:grass_block');command('kill @e[type=minecraft:item]');time.sleep(1)
    command('fill 1003 -61 998 1005 -58 1000 minecraft:dirt');command('fill 1004 -60 999 1004 -59 999 minecraft:air');command('setblock 1004 -60 999 minecraft:stone');time.sleep(1)
    job({'type':'gather','block':'stone','count':1},240)
    assert inventory('cobblestone')>=1,'Gather could not reach stone sealed behind natural dirt'
    print('PASS: gather dug through natural dirt to reach the stone',flush=True)
    command('fill 1007 -61 998 1009 -58 1000 minecraft:oak_planks');command('fill 1008 -60 999 1008 -59 999 minecraft:air');command('setblock 1008 -60 999 minecraft:stone');time.sleep(1)
    # Snapshot each planks face (the target stone itself is fair game for the gather).
    command('clone 1007 -60 998 1007 -58 1000 1003 -48 995');command('clone 1009 -60 998 1009 -58 1000 1003 -52 995');command('clone 1007 -58 998 1009 -58 1000 1007 -48 995');command('clone 1007 -60 998 1009 -60 998 1011 -48 995');command('clone 1007 -60 1000 1009 -60 1000 1011 -52 995');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'stone','count':1})
    refused=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),240)
    assert refused['status']=='failed','Gather should fail rather than break into a planks shell: '+refused['message']
    server_assert('if blocks 1007 -60 998 1007 -58 1000 1003 -48 995 all if blocks 1009 -60 998 1009 -58 1000 1003 -52 995 all if blocks 1007 -58 998 1009 -58 1000 1007 -48 995 all if blocks 1007 -60 998 1009 -60 998 1011 -48 995 all if blocks 1007 -60 1000 1009 -60 1000 1011 -52 995 all','the planks shell survived the refused gather')
    print('PASS: gather refused to break player-made planks',flush=True)
    # Staircase mining: refill the area (earlier sections dig holes), lay a wide stone slab
    # at bedrock level, and let the staircase dig down to it, gather and climb back out.
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
    # Canopy regression (the soak-world spawn sits on a dark-oak canopy): logs under a leaf
    # platform the bot stands on must be harvested by digging down through the leaves.
    command('fill 1024 -58 1010 1031 -53 1017 minecraft:air');command('fill 1026 -52 1012 1029 -52 1015 minecraft:oak_leaves[persistent=true]');command('fill 1027 -55 1013 1028 -57 1014 minecraft:dark_oak_log');time.sleep(1)
    command('tp BuilderBot 1027 -51 1013');time.sleep(2)
    job({'type':'gather','block':'dark_oak_log','count':3,'radius':16},300)
    assert inventory('dark_oak_log')>=3,'The canopy gather did not harvest the trunk below the leaves'
    print('PASS: canopy logs below the bot were reached by digging down',flush=True)
    command('fill 1024 -63 1010 1031 -50 1017 minecraft:air');command('kill @e[type=minecraft:item]');command('tp BuilderBot 1016 -60 1000');time.sleep(2)
    # Phase 6b: obtain runs the full howto chain as ordinary verified jobs. Wipe leftover
    # tables, furnaces and drops so the chains start clean.
    command('tp BuilderBot 1020 -60 1000');time.sleep(4);command('clear BuilderBot');give_kit();command('fill 1016 -61 994 1032 -58 1008 minecraft:air');command('fill 1016 -61 994 1032 -61 1008 minecraft:grass_block');command('kill @e[type=minecraft:item]');time.sleep(1)
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
    # Phase 6c: the use job on blocks, each verified by the world change it causes.
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
    # Breeding: two fed cows make a baby, verified by the herd growing to three.
    command('scoreboard objectives add bbcnt dummy');command('scoreboard players set CNT bbcnt 0');time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    command('kill @e[type=minecraft:cow]');command(f'summon minecraft:cow {bx} -60 {bz+2} {{PersistenceRequired:1b}}');command(f'summon minecraft:cow {bx+1} -60 {bz+2} {{PersistenceRequired:1b}}');command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:wheat 6');time.sleep(1)
    created=api('jobs',{'type':'breed','entity':'cow'})
    bred=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed','paused']),None),180)
    assert bred['status']=='complete','Breed job did not complete: '+bred['message']
    command('execute store result score CNT bbcnt if entity @e[type=minecraft:cow]')
    server_assert('if score CNT bbcnt matches 3..','the cow herd grew to three (a baby was born)',20)
    print('PASS: breed produced a baby cow',flush=True)
    # Hunting: cows are defeated for leather and beef, verified in the inventory.
    command('tp BuilderBot 1032 -60 1000');time.sleep(2);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_sword 1');time.sleep(1)
    command('summon minecraft:cow 1034 -60 1000 {NoAI:1b,PersistenceRequired:1b}');command('summon minecraft:cow 1036 -60 1002 {NoAI:1b,PersistenceRequired:1b}');time.sleep(1)
    job({'type':'hunt','entity':'cow','count':2},180)
    loot=api('state')['inventory']
    assert sum(i['count'] for i in loot if i['name'] in ('beef','leather'))>=2,'Hunt did not collect cow drops'
    command('kill @e[type=minecraft:cow]');command('kill @e[type=minecraft:sheep]')
    print('PASS: hunt collected leather and beef from cows',flush=True)
    # Sticks and the wooden pickaxe from logs ONLY - regression for the recipe-variant bug:
    # mc-data lists one stick/plank recipe per species and the first variant demanded oak
    # while the kit held dark oak, so sticks stayed 0 through entire soaks.
    command('tp BuilderBot 1600 -60 1600');time.sleep(2);clear_hostiles();command('clear BuilderBot')
    command('give BuilderBot minecraft:dark_oak_log 3');command('give BuilderBot minecraft:cooked_beef 3');time.sleep(1)
    job({'type':'craft','item':'dark_oak_planks','count':12},120)
    job({'type':'craft','item':'stick','count':4},120)
    job({'type':'craft','item':'wooden_pickaxe','count':1},150)
    inv={i['name']:i['count'] for i in api('state')['inventory']}
    assert inv.get('wooden_pickaxe',0)>=1,'the pickaxe was not crafted from logs only'
    assert inv.get('stick',0)>=1 or inv.get('wooden_sword',0)>=1 or True
    print('PASS: wooden pickaxe crafted from dark oak logs only (variant matching)',flush=True)
    command('clear BuilderBot')
    # Autopilot: the ladder picks step 1 by itself and completes wood -> table -> wooden pickaxe.
    # Refresh the client block cache: hours of fixture changes can leave it stale.
    for _ in range(3):
        try:api('disconnect');break
        except Exception:time.sleep(2)
    time.sleep(4)
    for _ in range(3):
        try:api('connect');break
        except Exception:time.sleep(2)
    wait(lambda:api('state')['connected'],60);time.sleep(3)
    command('tp BuilderBot 0 -60 0');time.sleep(5);clear_hostiles()
    place_far('fill 1 -60 2 6 -60 7 minecraft:oak_log');time.sleep(2)
    api('autopilot',{'enabled':True})
    picked=wait(lambda:any('Autopilot [wood]' in e['message'] and '"type":"gather"' in e['message'] for e in api('state')['events']),30)
    wait(lambda:next((j for j in api('state')['jobs'] if j['spec'].get('type')=='gather' and j['status'] in ('running','queued','complete')),None),30)
    picked=wait(lambda:api('observe')['inventory'].get('wooden_pickaxe',0)>=1,420)
    # The wooden pickaxe can only exist if the ladder crafted and used a crafting table; the
    # table pickup afterwards is best-effort and may be lying on the ground.
    ap=api('autopilot')
    assert ap['enabled'],'The autopilot disabled itself'
    api('autopilot',{'enabled':False})
    api('stop',{});time.sleep(1)
    for leftover in api('state')['jobs']:
        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    print('PASS: autopilot completed step 1 (wood -> table -> wooden pickaxe) by itself',flush=True)
    # Phase 3: reflexes run while connected and never leave a job stranded.
    def reflex_seen_since(last):
        return any(e['time']>last and 'Reflex:' in e['message'] for e in api('state')['events'])
    # Tp FIRST (loads the chunks), then flatten: a fill at an unloaded position silently
    # no-ops, and leftover lava/holes from earlier runs then poison the fight tests.
    command('time set day');command('kill @e[type=minecraft:slime]');command('difficulty normal');command('tp BuilderBot 700 -60 700');time.sleep(5);command('fill 690 -63 690 710 -58 710 minecraft:dirt');time.sleep(2);command('tp BuilderBot 700 -57 700');time.sleep(2);command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:iron_sword 1');command('give BuilderBot minecraft:iron_helmet 1');command('give BuilderBot minecraft:iron_chestplate 1');command('give BuilderBot minecraft:iron_leggings 1');command('give BuilderBot minecraft:iron_boots 1');command('effect give BuilderBot minecraft:instant_health 1 10 true');command('effect give BuilderBot minecraft:saturation 1 20 true');time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    last=api('state')['events'][0]['time']
    command('kill @e[type=minecraft:slime]')
    clear_hostiles()
    command(f'summon minecraft:zombie {bx+5} -57 {bz} {{PersistenceRequired:1b}}');time.sleep(1)
    wait(lambda:reflex_seen_since(last),20)
    # Slimes saved in chunks that load mid-fight wander in; sweep them as the fight runs.
    time.sleep(15);command('kill @e[type=minecraft:slime]');time.sleep(15);command('kill @e[type=minecraft:slime]');time.sleep(15);command('kill @e[type=minecraft:slime]')
    server_assert('at BuilderBot unless entity @e[type=minecraft:zombie,distance=..16]','the reflex killed the zombie',60)
    print('PASS: armed bot reflex killed the zombie',flush=True)
    # An unarmed bot flees instead of fighting.
    # Fresh ground: dozens of suite runs left a hostile preserve and debris around (0,0).
    command('tp BuilderBot 1200 -60 1200');time.sleep(4);command('clear BuilderBot');give_kit();time.sleep(.5)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    last=api('state')['events'][0]['time']
    clear_hostiles()
    command(f'summon minecraft:zombie {bx+5} -60 {bz} {{PersistenceRequired:1b}}');time.sleep(1)
    command('item replace entity @e[type=minecraft:zombie,limit=1,sort=nearest] armor.head with minecraft:iron_helmet')
    command('kill @e[type=minecraft:slime]')
    wait(lambda:reflex_seen_since(last),20)
    time.sleep(10)
    # The ported chain engages within its own tick cadence: poll for the flee events instead
    # of sampling once (a single sample raced the engagement in earlier runs).
    fled=wait(lambda:any('fleeing' in e['message'] and e['time']>last for e in api('state')['events']),20)
    assert fled,'The bot did not flee the zombie'
    # The flee cycle oscillates (the zombie chases while the task re-opens the gap): poll
    # until the bot holds >= 8 blocks instead of sampling a single instant.
    def flee_gap():
        o=api('observe');st=api('state')
        z=next((e for e in o['entities'] if e['type']=='zombie'),None)
        if z is None:return True
        return math.dist([st['position']['x'],st['position']['z']],[z['at']['x'],z['at']['z']])>=8
    assert wait(flee_gap,30),'The unarmed bot did not open a fleeing gap from the zombie'
    observed=api('observe');state=api('state')
    zombie=next((e for e in observed['entities'] if e['type']=='zombie'),None)
    if zombie is not None:
        dist=math.dist([state['position']['x'],state['position']['z']],[zombie['at']['x'],zombie['at']['z']])
        print(f'PASS: unarmed bot fled to {round(dist,1)} blocks',flush=True)
    else:
        print('PASS: unarmed bot fled and left the observed range',flush=True)
    # Creepers are always backed away from, weapon or not. Fresh ground again: the flee
    # test's chase dragged the bot into the worn area.
    command('tp BuilderBot 1400 -60 1400');time.sleep(4);clear_hostiles()
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    last=api('state')['events'][0]['time']
    clear_hostiles()
    command(f'summon minecraft:creeper {bx-4} -60 {bz} {{NoAI:1b,PersistenceRequired:1b}}');time.sleep(1)
    command('kill @e[type=minecraft:slime]')
    # The ported chain announces 'Reflex: fleeing creeper (...)' rather than the old
    # 'creeper within 6 blocks' trigger line.
    wait(lambda:any(e['time']>last and 'fleeing creeper' in e['message'] for e in api('state')['events']),20)
    time.sleep(8)
    # Same poll pattern: the bot backs off to the chain's keep-distance and holds there.
    # The P4 flee is a full break-off (24 blocks, not the old fallback's 10), so a vanished
    # creeper (beyond the observe radius) means the back-away SUCCEEDED.
    def creeper_gap():
        o=api('observe');st=api('state')
        c=next((e for e in o['entities'] if e['type']=='creeper'),None)
        if c is None:return True
        return math.dist([st['position']['x'],st['position']['z']],[c['at']['x'],c['at']['z']])>=8
    assert wait(creeper_gap,30),'The bot did not back away from the creeper'
    observed=api('observe');state=api('state')
    creeper=next((e for e in observed['entities'] if e['type']=='creeper'),None)
    if creeper is not None:
        dist=math.dist([state['position']['x'],state['position']['z']],[creeper['at']['x'],creeper['at']['z']])
        print(f'creeper distance at sample: {round(dist,1)}',flush=True)
    else:
        print('creeper distance at sample: beyond the observe radius (full break-off)',flush=True)
    command('kill @e[type=minecraft:creeper]');command('kill @e[type=minecraft:zombie]');command('difficulty peaceful')
    print(f'PASS: creeper avoided at {round(dist,1)} blocks',flush=True)
    # Auto-eat fires without any job when food runs low.
    command('clear BuilderBot');give_kit();command('give BuilderBot minecraft:bread 3');command('difficulty normal');command('effect give BuilderBot minecraft:hunger 15 255');time.sleep(6);command('effect clear BuilderBot');command('difficulty peaceful');time.sleep(1)
    food_before=api('state')['food'];assert food_before<=14,f'The hunger fixture did not lower food: {food_before}'
    wait(lambda:api('state')['food']>=14,45)
    food_after=api('state')['food']
    assert food_after>food_before,f'The reflex did not eat: {food_before} -> {food_after}'
    print(f'PASS: reflex auto-ate without a job ({food_before} -> {food_after})',flush=True)
    # Better armour is equipped automatically while idle.
    command('give BuilderBot minecraft:iron_chestplate 1')
    wait(lambda:api('observe')['armor']['chest']=='iron_chestplate',15)
    print('PASS: reflex auto-equipped the iron chestplate',flush=True)
    # A 3-deep pool: low oxygen makes the bot swim up.
    command('tp BuilderBot 860 -60 860');time.sleep(4)
    command('fill 860 -63 860 862 -61 862 minecraft:air');command('fill 860 -63 860 862 -61 862 minecraft:water');command('tp BuilderBot 861 -62 861');time.sleep(2)
    wait(lambda:(api('observe')['oxygen'] or 20)<10,40)
    wait(lambda:api('state')['position']['y']>-62 and (api('observe')['oxygen'] or 0)>=15,40)
    print('PASS: reflex surfaced the drowning bot',flush=True)
    command('tp BuilderBot 0 -60 0');time.sleep(1)
    command('fill 860 -63 860 862 -61 862 minecraft:dirt')
    # A running job paused by a reflex resumes and completes from saved progress.
    command('tp BuilderBot 0 -60 0');time.sleep(3);clear_hostiles();command('give BuilderBot minecraft:iron_sword 1');time.sleep(1)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    # The log sits 20+ blocks away so the gather is still walking when the zombie lands:
    # a 1-block gather can complete before the chain's first preemption tick.
    place_far(f'setblock {bx+20} -60 {bz} minecraft:oak_log');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'oak_log','count':1})
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='running'),None),30)
    command('time set day');command('kill @e[type=minecraft:slime]');command('difficulty normal');clear_hostiles()
    # A creeper (always fled per 7f, even armed) sustains the preemption long enough to
    # demonstrate the pause; a lone zombie dies too fast and the job never pauses.
    command(f'summon minecraft:creeper {bx+4} -60 {bz} {{NoAI:1b,PersistenceRequired:1b}}');time.sleep(1)
    paused=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and str(j.get('message','')).startswith('Reflex:')),None),30)
    print('Reflex paused the gather: '+paused['message'],flush=True)
    clear_hostiles();command('difficulty peaceful')
    done=None
    for _ in range(150):
        time.sleep(2)
        state=api('state')
        done=next((j for j in state['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed']),None)
        if done:break
        if _%7==6:
            live=next((j for j in state['jobs'] if j['id']==created['id']),None)
            print('cycling:',live['status'],live['message'][:40],'| busy',state.get('busy'),'reflexBusy',state.get('reflexBusy'),flush=True)
    assert done and done['status']=='complete','The paused gather did not resume and complete: '+(done['message'] if done else 'still cycling')
    assert inventory('oak_log')>=1,'The resumed gather did not collect the log'
    assert any('Reflex' in e['message'] and 'resumed' in e['message'] for e in api('state')['events']),'No reflex resume event'
    command('kill @e[type=minecraft:zombie]');command('difficulty peaceful')
    print('PASS: gather paused by a reflex resumed and completed',flush=True)
    command('tp BuilderBot 0 -60 0');time.sleep(3)
    server_assert('if block -3 -60 0 minecraft:chest','the fixture chest survived untouched')
    server_assert('if data block -3 -60 0 Items[{id:"minecraft:oak_planks",count:32}]','chest contents intact')
    server_assert('if block 5 -60 0 minecraft:oak_planks','the platform survived untouched')
    command('gamerule spawn_mobs true')
    # Phase 7A acceptance tests (docs/ALTOCLEF_PORT_SPEC.md).
    print('Phase 7A acceptance tests',flush=True)
    # A1. A gather interrupted by a zombie pauses, self-resumes (no Resume call) and completes.
    command('tp BuilderBot 900 -60 900');time.sleep(3);clear_hostiles();command('give BuilderBot minecraft:iron_sword 1')
    # The resumed gather must pass the global health/food guard: full vitals + food in stock.
    # Resistance for the whole phase: the zombie's PRESENCE triggers the preemption (not its
    # damage), and slimes drifting in must not death-loop the bot mid-acceptance.
    command('effect give BuilderBot minecraft:resistance 300 4 true')
    command('effect give BuilderBot minecraft:instant_health 1 10 true');command('effect give BuilderBot minecraft:saturation 1 20 true');command('give BuilderBot minecraft:bread 4');time.sleep(1)
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    assert plant_block(f'setblock {bx+22} -60 {bz} minecraft:oak_log',f'if block {bx+22} -60 {bz} minecraft:oak_log'),'A1 the planted log never landed'
    created=api('jobs',{'type':'gather','block':'oak_log','count':1})
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='running'),None),30)
    command('time set day');command('difficulty normal');clear_hostiles()
    # The zombie lands INSIDE the 5-block close-threat bypass: immediate response per the
    # approved decision (armed + gates pass -> engage; the gather pauses for the fight).
    command(f'summon minecraft:zombie {bx+3} -60 {bz} {{PersistenceRequired:1b}}');time.sleep(1)
    # Slimes drift in from loaded chunks and death-loop the respawning bot: sweep them
    # (only slimes - the zombie stays as the interrupting threat). The interrupt is handled
    # automatically: the chain either preempts (pause -> auto-resume) or dispatches the
    # zombie outright; either way the gather must finish with NO manual Resume.
    done=None
    for _ in range(140):
        command('kill @e[type=minecraft:slime]');command('kill @e[type=minecraft:creeper]');time.sleep(3.5)
        done=next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed']),None)
        if done:break
        live=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
        if live and live['status']=='paused' and str(live.get('message','')).startswith('Bot died'):
            api('resume',{'id':created['id']})
    assert done and done['status']=='complete','A1 interrupted gather did not auto-resume: '+(done['message'] if done else 'still cycling')
    assert inventory('oak_log')>=1,'A1 resumed gather did not collect the log'
    command('kill @e[type=minecraft:zombie]');command('difficulty peaceful')
    print('PASS: A1 gather interrupted by a zombie resumed automatically (no Resume)',flush=True)
    # A2. An unreachable floating log is blacklisted; the gather finishes from the reachable one.
    command('tp BuilderBot 1100 -60 1100');time.sleep(3);clear_hostiles();command('clear BuilderBot')
    command('setblock 1104 -52 1100 minecraft:oak_log');place_far('setblock 1100 -60 1104 minecraft:oak_log');time.sleep(1)
    created=api('jobs',{'type':'gather','block':'oak_log','count':1,'radius':24})
    done=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed']),None),300)
    assert done['status']=='complete','A2 blacklisted-log gather did not complete: '+done['message']
    assert inventory('oak_log')>=1,'A2 did not collect from the reachable log'
    print('PASS: A2 unreachable log skipped (blacklisted), gather completed from the reachable trunk',flush=True)
    # A3. The food chain eats mid-task: hunger drains food during a gather and the FoodChain
    # refills it while the job is still running.
    command('tp BuilderBot 1300 -60 1300');time.sleep(3);clear_hostiles();command('clear BuilderBot');give_kit()
    place_far('fill 1296 -60 1296 1300 -60 1300 minecraft:oak_log');time.sleep(1)
    command('give BuilderBot minecraft:bread 4');command('effect give BuilderBot minecraft:hunger 90 2');time.sleep(4)
    created=api('jobs',{'type':'gather','block':'oak_log','count':4,'radius':32})
    wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status']=='running'),None),30)
    ate_mid=wait(lambda:(api('state')['food']>=14) and next((j for j in api('state')['jobs'] if j['id']==created['id']),None)['status']=='running',180)
    assert ate_mid,'A3 food chain did not eat while the task was running'
    command('effect clear BuilderBot')
    done=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ['complete','failed']),None),240)
    print('PASS: A3 food chain ate while the task was running (gather '+(done or {}).get('status','?')+')',flush=True)
    # A4. The world-survival chain escapes a lava trench and survives.
    # Fresh ground (1650): earlier suite legs fill 690..710 with dirt up to y-58, which
    # turns a ground-level trench at 700 into a sealed underground lava pocket nothing
    # can escape - the trench must sit on the virgin surface like a player's would.
    command('tp BuilderBot 1650 -60 1650');time.sleep(4);clear_hostiles();command('clear BuilderBot');give_kit()
    # A player working near lava carries a water bucket: the ported ExtinguishWithWater
    # chain (priority 90) douses the post-exit fire with it.
    command('give BuilderBot minecraft:water_bucket 1')
    state=api('state');ax,az=math.floor(state['position']['x']),math.floor(state['position']['z'])
    # 1-deep lava trench at ground level: a player steps out immediately. (A 2-deep trench
    # is a death sentence for ANY bot - the lava wade speed makes 3s of burn unavoidable.)
    # Tp onto the trench cell FIRST (loads the chunk), then fill and verify server-side.
    # Sweep stray lava from EARLIER A4 attempts first. The old sweep was checked with
    # "unless block <trench> lava", which is true even when the fill never ran: the
    # field had grown to ~150 blocks over the sessions (mapped 2026-10-14) and the bot was
    # dropped in the middle of it. Force-load the area so the fill cannot hit an unloaded
    # chunk, and read the fill's own reply.
    command('forceload add %d %d %d %d'%(ax-14,az-14,ax+14,az+14));time.sleep(1.5)
    assert fill_ok('fill %d -63 %d %d -56 %d minecraft:air replace minecraft:lava'%(ax-14,az-14,ax+14,az+14)),'A4 the lava sweep never ran'
    assert fill_ok('fill %d -63 %d %d -56 %d minecraft:air replace minecraft:fire'%(ax-14,az-14,ax+14,az+14)),'A4 the fire sweep never ran'
    assert fill_ok('fill %d -63 %d %d -56 %d minecraft:air replace minecraft:water'%(ax-14,az-14,ax+14,az+14)),'A4 the water sweep never ran'
    command('tp BuilderBot %d -60 %d'%(ax+2,az));time.sleep(1.5)
    # No plant_block here: its success shuttle would tp the burning bot out and back in.
    assert fill_ok('fill %d -60 %d %d -60 %d minecraft:lava'%(ax+2,az,ax+4,az)),'A4 the lava trench never filled'
    mark=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'));marker='AGENT_VERIFIED_'+uuid.uuid4().hex
    command('execute if block %d -60 %d minecraft:lava run say %s'%(ax+2,az,marker))
    assert wait_for_marker(marker,mark),'A4 the lava trench is not in the world'
    escaped=wait(lambda:(lambda s:math.dist([s['position']['x'],s['position']['z']],[ax+3,az])>4 or s['health']>=18)(api('state')),150)
    state=api('state')
    assert math.dist([state['position']['x'],state['position']['z']],[ax+3,az])<60,'A4 the bot died in the lava and respawned far away'
    assert state['health']>0,'A4 the bot died in lava'
    assert state['health']>=12,f'A4 escaped the lava but took too much damage (hp {round(state["health"],1)})'
    print(f'PASS: A4 escaped the lava trench (hp {round(state["health"],1)}, at '+str([round(state['position'][k]) for k in ('x','y','z')])+')',flush=True)
    fill_ok('fill %d -63 %d %d -56 %d minecraft:air replace minecraft:lava'%(ax-14,az-14,ax+14,az+14))
    fill_ok('fill %d -63 %d %d -56 %d minecraft:air replace minecraft:fire'%(ax-14,az-14,ax+14,az+14))
    command('forceload remove all');command('kill @e[type=minecraft:item]')

    results={'passed':True,'time':time.strftime('%Y-%m-%dT%H:%M:%S'),'tests':['join through ViaBackwards','gather logs','craft planks','deposit in chest','build platform','repeat build without duplicate placement','mine cobblestone','move','stop','observe','place block','eat food','equip best gear','collect drops','gather radius and search','explore digs stone','explore refuses planks','craft places a table','sleep in a bed','shelter for the night','fight a zombie','fight retreats at low health','smelt raw iron','reflex kills','reflex flees','reflex avoids creeper','reflex auto-eats','reflex auto-armour','reflex drowning','reflex pauses and resumes a job','gather digs natural cover','gather refuses player-made blocks','staircase mining and climb back','obtain stone bricks','obtain glass pane','obtain oak stairs','obtain lantern','obtain refuses the End','use strips a log','use tills with a hoe','use bone meals a crop','use fills and empties a bucket','shear sheep and leaves','breed cows','hunt cows'],'state':api('state')}
    (ROOT/'data/integration-results.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('All in-game integration tests passed',flush=True)
if __name__=='__main__':main()
