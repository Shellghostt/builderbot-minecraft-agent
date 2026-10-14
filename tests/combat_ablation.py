"""Primitive ablation for the combat controller (review directive B.1).

For each duel mob (zombie, skeleton, creeper) and each primitive configuration, run the
fight job N times in the arena and record time-to-kill, damage taken and swings. A
primitive EARNS its default back only by measurably lowering damage or time-to-kill vs
the all-off baseline (the review's bar: 'keep only what measurably lowers damage or time
to kill on this 26.3 server; default to the simplest behaviour that wins').

Configurations: all-off (the shipped default), then one primitive on at a time
(+backpedal, +shield, +sprintKnockback, +kite), then all-on. The kite configuration is
skipped for the zombie (there is nothing to kite - it walks into the blade) and the
creeper kite is the shipped hybrid (bow while far, melee inside 5).

REQUIRES the dashboard and test server up (run only when the memory guard is clear -
see the memory order: code-only work while aces.exe holds ~8 GB). Results go to
data/combat-ablation.json; nothing is auto-promoted into the controller defaults - the
numbers go in the report and the defaults change only on the evidence.
"""
import pathlib,json,urllib.request,urllib.error,time,sys,math
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
CENTER=(1500,-60,1500)
KEYS={'zombie':('zombie',), 'skeleton':('skeleton',), 'creeper':('creeper',)}
CONFIGS=[
    ('all-off',{}),
    ('+backpedal',{'backpedal':True}),
    ('+shield',{'shield':True}),
    ('+sprintKnockback',{'sprintKnockback':True}),
    ('+kite',{'kite':True}),
    ('all-on',{'backpedal':True,'shield':True,'sprintKnockback':True,'kite':True,'crit':True}),
]
RUNS_PER_CELL=2
def api(route,data=None):
    key=(ROOT/'data'/'dashboard-token').read_text()
    req=urllib.request.Request('http://127.0.0.1:8765/api/'+route,data=None if data is None else json.dumps(data).encode(),
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=100))
def command(c):
    sk=(ROOT/'data'/'supervisor-token').read_text()
    req=urllib.request.Request('http://127.0.0.1:8766/test-command',data=json.dumps({'command':c}).encode(),
        headers={'Authorization':'Bearer '+sk,'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(req,timeout=60))
def sweep(skip=()):
    for mob in ('zombie','skeleton','creeper','slime','spider','witch','husk'):
        if mob not in skip:command('kill @e[type=minecraft:'+mob+']')
def reset(gear):
    for leftover in api('state')['jobs']:
        if leftover['status'] in ('paused','queued','running'):api('cancel',{'id':leftover['id']})
    command('clear BuilderBot')
    for item,count in gear:command('give BuilderBot minecraft:'+item+' '+str(count))
    command('effect clear BuilderBot')
    command('effect give BuilderBot minecraft:instant_health 1 4')
    command('effect give BuilderBot minecraft:saturation 1 20')
    command('tp BuilderBot %d %d %d'%CENTER);time.sleep(2)
    sweep();time.sleep(1)
    wait(lambda:(api('state')['health'] or 0)>=19,15)
def wait(predicate,seconds):
    deadline=time.time()+seconds
    while time.time()<deadline:
        v=predicate()
        if v:return v
        time.sleep(.5)
    raise TimeoutError('condition did not become true')
def duel(mob,gear,primitives,max_seconds=60):
    """One fight. Returns {outcome,ttk,damage_taken,hits,crits} or raises."""
    reset(gear)
    command('difficulty normal')
    command('summon minecraft:%s 1504 -60 1500 {PersistenceRequired:1b}'%mob);time.sleep(1)
    created=api('jobs',{'type':'fight','maxSeconds':max_seconds,'primitives':primitives})
    t0=time.time()
    while time.time()-t0<max_seconds+20:
        time.sleep(1)
        j=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
        if j and j['status'] in ('complete','failed','paused'):break
    j=next((j for j in api('state')['jobs'] if j['id']==created['id']),None)
    command('kill @e[type=minecraft:%s]'%mob)
    return {'outcome':j['status'],'message':j['message'][:80],'ttk':round(time.time()-t0,1),
            'damage_taken':round(max(0,20-(api('state')['health'] or 0)),1),
            'inventory':{i['name']:i['count'] for i in api('state')['inventory']},'primitives':primitives}
def median(values):
    v=sorted(values);return v[len(v)//2] if v else None
def main():
    wait(lambda:api('state')['connected'],120)
    api('reflexes',{'enabled':False})
    command('difficulty peaceful');command('time set day')
    results={}
    for mob,gear in (('zombie',[('stone_sword',1)]),
                     ('skeleton',[('stone_sword',1),('shield',1)]),
                     ('creeper',[('stone_sword',1),('bow',1),('arrow',32),('shield',1),('cooked_beef',3)])):
        cells={}
        for name,prims in CONFIGS:
            if name=='+kite' and mob=='zombie':continue  # nothing to kite: it walks into the blade
            runs=[]
            for _ in range(RUNS_PER_CELL):
                try:runs.append(duel(mob,gear,prims))
                except Exception as e:runs.append({'outcome':'error','message':repr(e)[:100]})
                time.sleep(1)
            ok=[r for r in runs if r.get('outcome')=='complete']
            cells[name]={'runs':runs,
                         'kills':len(ok),
                         'median_ttk':median([r['ttk'] for r in ok]) if ok else None,
                         'median_damage':median([r['damage_taken'] for r in ok]) if ok else None}
            print(f'{mob:9s} {name:16s} kills={len(ok)}/{len(runs)} ttk={cells[name]["median_ttk"]} dmg={cells[name]["median_damage"]}',flush=True)
        results[mob]=cells
    command('difficulty peaceful');sweep()
    api('reflexes',{'enabled':True})
    verdicts={}
    for mob,cells in results.items():
        base=cells['all-off']
        verdicts[mob]={}
        for name,cell in cells.items():
            if name=='all-off':continue
            better_dmg=cell['median_damage'] is not None and base['median_damage'] is not None and cell['median_damage']<base['median_damage']
            better_ttk=cell['median_ttk'] is not None and base['median_ttk'] is not None and cell['median_ttk']<base['median_ttk']
            more_kills=cell['kills']>base['kills']
            verdicts[mob][name]={'keep':bool(better_dmg or better_ttk or more_kills),
                                 'evidence':{'dmg':[base['median_damage'],cell['median_damage']],'ttk':[base['median_ttk'],cell['median_ttk']],'kills':[base['kills'],cell['kills']]}}
    payload={'meta':{'date':time.strftime('%Y-%m-%dT%H:%M:%S'),'runs_per_cell':RUNS_PER_CELL,
                     'note':'keep=true requires strictly lower damage, lower ttk, or more kills than the all-off baseline'},
             'results':results,'verdicts':verdicts}
    (ROOT/'data'/'combat-ablation.json').write_text(json.dumps(payload,indent=2),encoding='utf-8')
    print(json.dumps(verdicts,indent=1),flush=True)
    print('Ablation written to data/combat-ablation.json',flush=True)
if __name__=='__main__':main()
