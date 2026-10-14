"""Placement repro (GLM_NEXT item 2): the Voyager/ADAM table placement on the REAL cluttered
dark-oak floor at the hard anchor of seed 12345. Swaps to a fresh agent-soak-world, drops
the bot on [140,131,32] with planks+sticks only, and runs a craft wooden_pickaxe job - the
table MUST be placed (ensureTable -> placeBlockNear) where the old 12-fixed-cells scan
threw 'No clear spot to place a crafting_table' 8-15 times per run. PASS = a real
crafting_table block, server-verified, within 240 s. Leaves the world for the soak to
delete and regenerate.
"""
import pathlib,json,urllib.request,time,sys,socket,uuid,re,subprocess,shutil
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tests'))
sys.stdout.reconfigure(encoding='utf-8')
from integration import api,command,wait
from soak import edit_props,stop_services,wait_dashboard,wait_server
PROPS=ROOT/'test-server'/'server.properties'
def port_ready():
    try:
        with socket.create_connection(('127.0.0.1',25569),timeout=.5):return True
    except OSError:return False
def marker_ok(condition,seconds=6):
    mark='REPRO_'+uuid.uuid4().hex
    off=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
    command('execute '+condition+' run say '+mark)
    deadline=time.time()+seconds
    while time.time()<deadline:
        raw=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')[off:]
        if '[Server] '+mark in re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',raw):return True
        time.sleep(.4)
    return False
def main():
    print('stopping services',flush=True)
    subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Stop-Agent.ps1')],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=300)
    stop_services()
    print('switching to a fresh agent-soak-world (seed 12345)',flush=True)
    edit_props({'level-name':'agent-soak-world','level-seed':'12345','level-type':'normal','difficulty':'normal'})
    world=(ROOT/'test-server'/'agent-soak-world')
    if world.exists():shutil.rmtree(world)
    subprocess.Popen(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'Start-Agent.ps1'),'-NoBrowser'],cwd=str(ROOT),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    wait_dashboard();wait_server()
    try:
        api('connect',{});wait(lambda:api('state').get('connected'),90);time.sleep(3)
        command('gamerule spawn_mobs false');command('difficulty peaceful')
        command('time set 1000');command('weather clear 1200')
        command('kill @e[type=minecraft:slime]');command('kill @e[type=minecraft:zombie]');command('kill @e[type=minecraft:creeper]');command('kill @e[type=minecraft:spider]')
        # The hard anchor's landing cell: cluttered dark-oak floor (trunks, ferns, mushrooms).
        command('tp BuilderBot 140 131 32');time.sleep(5)
        state=api('state')
        print('bot at '+json.dumps(state['position']),flush=True)
        command('clear BuilderBot');command('gamemode survival BuilderBot')
        for item in ['leather_helmet','leather_chestplate','leather_leggings','leather_boots']:command('give BuilderBot minecraft:'+item+' 1')
        command('give BuilderBot minecraft:dark_oak_planks 12');command('give BuilderBot minecraft:stick 4');command('give BuilderBot minecraft:cooked_beef 4')
        command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20')
        time.sleep(2)
        # keepTable: without it the job places the table, crafts and PICKS IT BACK UP, and
        # there is no block left to verify (measured: complete in 15.9 s, no table nearby).
        created=api('jobs',{'type':'craft','item':'wooden_pickaxe','count':1,'keepTable':True})
        t0=time.time()
        log_mark=len((ROOT/'logs/dashboard.log').read_text(encoding='utf-8',errors='replace'))
        done=wait(lambda:next((j for j in api('state')['jobs'] if j['id']==created['id'] and j['status'] in ('complete','failed','paused')),None),240)
        elapsed=round(time.time()-t0,1)
        print('craft job: '+done['status']+' in '+str(elapsed)+'s - '+done.get('message',''),flush=True)
        observed=api('observe')
        table=observed.get('blocks',{}).get('crafting_table')
        assert done['status']=='complete','the craft job did not complete: '+done.get('message','')
        assert table and table.get('count',0)>=1,'no crafting_table reported nearby: '+json.dumps(observed.get('blocks',{}))
        at=table['at']
        assert marker_ok('if block %d %d %d minecraft:crafting_table'%(at['x'],at['y'],at['z'])),'the table is not really in the world at '+json.dumps(at)
        inv={i['name']:i['count'] for i in api('state')['inventory']}
        assert inv.get('wooden_pickaxe',0)>=1,'the pickaxe was not crafted'
        # Count how loudly placement failed along the way (target: 0 for the next soak).
        log=(ROOT/'logs/dashboard.log').read_text(encoding='utf-8',errors='replace')
        window=log[log_mark:]
        no_clear=window.count('No clear spot to place')
        print(f'REPRO RESULT: table at {json.dumps(at)}, pickaxe crafted in {elapsed}s, "No clear spot" failures: {no_clear}',flush=True)
        print('PASS: placement repro' if no_clear==0 else 'PASS with warnings: placement repro had failures',flush=True)
    finally:
        command('gamerule spawn_mobs true')
if __name__=='__main__':main()
