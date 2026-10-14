"""A4 lava-escape probe: where does the escape's damage actually accrue?
Samples health/position at 250 ms through the same api the suite uses and prints the
timeline, so a slow scramble and a slow douse are distinguishable. PASS = final hp >= 12.
"""
import pathlib,json,urllib.request,time,sys,socket,uuid,math,re
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
def api(route,data=None,supervisor=False):
    port=8766 if supervisor else 8765
    key=(ROOT/'data'/('supervisor-token' if supervisor else 'dashboard-token')).read_text()
    req=urllib.request.Request(f'http://127.0.0.1:{port}/'+(route if supervisor else 'api/'+route),data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    try:return json.load(urllib.request.urlopen(req,timeout=30))
    except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode())
def command(c):return api('test-command',{'command':c},True)
def port_ready():
    try:
        with socket.create_connection(('127.0.0.1',25569),timeout=.5):return True
    except OSError:return False
def wait(pred,seconds=60):
    deadline=time.time()+seconds
    while time.time()<deadline:
        v=pred()
        if v:return v
        time.sleep(.5)
    raise TimeoutError('condition never became true')
def marker_ok(condition,seconds=6):
    mark='PROBE_'+uuid.uuid4().hex
    off=len((ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace'))
    command('execute '+condition+' run say '+mark)
    deadline=time.time()+seconds
    while time.time()<deadline:
        raw=(ROOT/'logs/test-server.log').read_text(encoding='utf-8',errors='replace')[off:]
        if '[Server] '+mark in re.sub(r'\x1b\[[0-9;]*[A-Za-z]','',raw):return True
        time.sleep(.4)
    return False
AX,AZ=(int(sys.argv[1]),int(sys.argv[2])) if len(sys.argv)>2 else (1700,1700)
def main():
    wait(port_ready,120)
    command('difficulty peaceful')
    st=api('state')
    if not st['connected']:
        api('connect',{});wait(lambda:api('state')['connected'],90);time.sleep(3)
    for leftover in api('state')['jobs']:
        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    command('tp BuilderBot 0 -60 0');time.sleep(2)
    command('gamemode survival BuilderBot');command('clear BuilderBot')
    for item in ['leather_helmet','leather_chestplate','leather_leggings','leather_boots']:command('give BuilderBot minecraft:'+item+' 1')
    command('give BuilderBot minecraft:water_bucket 1')
    command('kill @e[type=minecraft:slime]');command('kill @e[type=minecraft:zombie]');command('kill @e[type=minecraft:creeper]')
    command('gamerule spawn_mobs false')
    command('effect give BuilderBot minecraft:instant_health 1 4');command('effect give BuilderBot minecraft:saturation 1 20');time.sleep(1)
    # Fresh ground: load the chunk first, then verify the surface the trench sits in.
    command('tp BuilderBot %d -60 %d'%(AX,AZ));time.sleep(4)
    assert marker_ok('if block %d -61 %d minecraft:grass_block'%(AX,AZ)),'no grass surface at the probe site'
    command('fill %d -60 %d %d -60 %d minecraft:air'%(AX+2,AZ,AX+4,AZ));time.sleep(1)
    assert marker_ok('if block %d -60 %d minecraft:air'%(AX+2,AZ)),'trench cells did not clear'
    command('fill %d -60 %d %d -60 %d minecraft:lava'%(AX+2,AZ,AX+4,AZ));time.sleep(1)
    assert marker_ok('if block %d -60 %d minecraft:lava'%(AX+2,AZ)),'the lava trench never filled'
    hp0=api('state')['health']
    print(f'fixture ok, health {hp0}; dropping into the trench now',flush=True)
    t0=time.time()
    command('tp BuilderBot %d -60 %d'%(AX+2,AZ))
    samples=[]
    while time.time()-t0<30:
        s=api('state');t=time.time()-t0
        p=s['position']
        inLava=(AX+2)<=math.floor(p['x'])<=(AX+4) and math.floor(p['z'])==AZ and abs(p['y']+60)<2.5
        samples.append((round(t,2),round(s['health'],1),inLava,[round(p[k],1) for k in ('x','y','z')]))
        if not inLava and s['health']>=19.5 and t>8:break
        time.sleep(.25)
    for row in samples:print(row,flush=True)
    final=samples[-1][1];dropped=next((r for r in samples if r[1]<19.9),None)
    minhp=min(r[1] for r in samples)
    print(f'PROBE RESULT: first damage at t={dropped[0] if dropped else None}, min hp {minhp}, final hp {final}',flush=True)
    print('PASS: A4 probe hp >= 12' if final>=12 else 'FAIL: A4 probe hp < 12',flush=True)
    command('fill %d -60 %d %d -60 %d minecraft:air'%(AX+2,AZ,AX+4,AZ))
    command('fill %d -60 %d %d -60 %d minecraft:dirt'%(AX+2,AZ,AX+4,AZ))
if __name__=='__main__':main()
