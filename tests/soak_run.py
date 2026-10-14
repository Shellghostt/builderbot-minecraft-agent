"""Second soak pass on an already-running agent-soak-world: the operator resumes the bot
after deaths. Same rules as soak.py: tokens are re-read on every call, the run starts from
a confirmed vitals reset (full health and hunger, 20/20), results go to a timestamped file,
and only a clean run is promoted to data/soak-results.json.
"""
import json,urllib.request,urllib.error,time,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
def read_token(name):
    for _ in range(10):
        try:text=(ROOT/'data'/name).read_text().strip()
        except OSError:text=''
        if text:return text
        time.sleep(.5)
    raise RuntimeError('token file data/'+name+' is empty')
def api(route,data=None):
    last=None
    for attempt in range(2):
        r=urllib.request.Request('http://127.0.0.1:8765/api/'+route,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+read_token('dashboard-token'),'Content-Type':'application/json'})
        try:return json.load(urllib.request.urlopen(r,timeout=60))
        except urllib.error.HTTPError as e:
            last=e
            if e.code==401 and attempt==0:time.sleep(2);continue
            raise RuntimeError(e.read().decode())
        except OSError as e:last=e;time.sleep(1)
    raise last
def command(text):
    # Console fixtures affect ONLY the private test server (supervisor, loopback, token auth).
    r=urllib.request.Request('http://127.0.0.1:8766/test-command',data=json.dumps({'command':text}).encode(),headers={'Authorization':'Bearer '+read_token('supervisor-token'),'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r,timeout=30))
def vitals_reset(errors):
    # Same fairness contract as soak.py: full health and hunger before the clock starts,
    # confirmed via /api/observe. Effects target the bot only (never @a/@p - a human
    # spectator may be on the server).
    def effects():
        for text in ('effect give BuilderBot minecraft:instant_health 1 10 true',
                     'effect give BuilderBot minecraft:saturation 1 20 true',
                     'effect clear BuilderBot'):
            try:command(text)
            except Exception as e:errors.append('vitals '+text.split()[1]+': '+str(e)[:120])
            time.sleep(.5)
    def at20():
        try:o=api('observe');return o.get('health')==20 and o.get('food')==20
        except Exception:return False
    effects()
    ok=False
    for _ in range(6): # ~6s for the instant effects to land
        if at20():ok=True;break
        time.sleep(1)
    if not ok:
        effects() # one retry: a lingering damage/hunger tick can eat the first pair
        for _ in range(4):
            if at20():ok=True;break
            time.sleep(1)
    if not ok:errors.append('vitals: 20/20 not confirmed before run start')
    print('vitals reset: '+('ok (health 20, food 20)' if ok else 'NOT CONFIRMED'),flush=True)
    return ok
SOAK={'achieved':{},'deaths':0,'resumes':0,'stuck_points':[],'samples':[],'errors':[]}
def save_results():
    stamp=time.strftime('%Y%m%d-%H%M%S')
    (ROOT/'data'/f'soak-results-{stamp}.json').write_text(json.dumps(SOAK,indent=2),encoding='utf-8')
    clean=not SOAK['errors'] and len(SOAK['samples'])>=15 and SOAK.get('final_state') is not None
    if clean:
        (ROOT/'data'/'soak-results.json').write_text(json.dumps(SOAK,indent=2),encoding='utf-8')
        print('clean run promoted to data/soak-results.json',flush=True)
    else:
        print(f"run had errors ({len(SOAK['errors'])}); data/soak-results.json left untouched",flush=True)
    return clean
def main():
    api('connect',{})
    for _ in range(30):
        if api('state').get('connected'):break
        time.sleep(2)
    SOAK['vitals_ok']=vitals_reset(SOAK['errors'])
    print('soak: autopilot enabled for 10 minutes (operator resumes after deaths)',flush=True)
    api('autopilot',{'enabled':True})
    start=time.time();deaths=0;resumes=0
    while time.time()-start<600:
        time.sleep(30)
        try:
            state=api('state');o=api('observe')
            inv={i['name']:i['count'] for i in state['inventory']}
            events=' | '.join(e['message'] for e in state['events'][:20])
            deaths=max(deaths,events.count('Bot died at'))
            ap=o['autopilot']
            if ap.get('state','').startswith('paused: died'):
                paused=next((j for j in state['jobs'] if j['status']=='paused'),None)
                if paused:
                    api('resume',{'id':paused['id']});resumes+=1
                    SOAK['resumes']=resumes
            sample={'t':round(time.time()-start),'pos':[round(o['position'][k],1) for k in ('x','y','z')],'hp':round(o['health'],1),'food':o['food'],
                    'step':ap.get('step'),'apstate':ap.get('state'),
                    'logs':sum(v for k,v in inv.items() if k.endswith('_log')),
                    'planks':sum(v for k,v in inv.items() if k.endswith('_planks')),
                    'cobble':inv.get('cobblestone',0),'stick':inv.get('stick',0),
                    'wood_pick':inv.get('wooden_pickaxe',0),'stone_pick':inv.get('stone_pickaxe',0),
                    'stone_sword':inv.get('stone_sword',0),'furnace':inv.get('furnace',0),
                    'edible':sum(v for k,v in inv.items() if 'raw' in k or k in ('beef','porkchop','chicken','mutton','bread','apple')),
                    'deaths':deaths,'resumes':resumes}
            SOAK['samples'].append(sample)
            print('SOAK',json.dumps(sample),flush=True)
            if not state.get('connected'):
                SOAK['errors'].append('bot disconnected at t='+str(sample['t']))
                api('connect',{})
        except Exception as e:
            SOAK['errors'].append('sample error: '+str(e))
    try:
        state=api('state')
        inv={i['name']:i['count'] for i in state['inventory']}
        SOAK['achieved']={k:inv.get(k,0) for k in ('oak_log','oak_planks','stick','crafting_table','wooden_pickaxe','wooden_axe','cobblestone','stone_pickaxe','stone_axe','stone_sword','stone_shovel','furnace','torch')}
        SOAK['achieved']['logs_total']=sum(v for k,v in inv.items() if k.endswith('_log'))
        SOAK['achieved']['planks_total']=sum(v for k,v in inv.items() if k.endswith('_planks'))
        SOAK['achieved']['edible_food']=sum(v for k,v in inv.items() if 'raw' in k or k in ('beef','porkchop','chicken','mutton','bread','apple'))
        SOAK['final_state']=state.get('autopilot')
        events=' | '.join(e['message'] for e in state['events'][:100])
        SOAK['deaths']=events.count('Bot died at')
        SOAK['stuck_points']=[e['message'] for e in state['events'][:100] if 'blocked' in e['message'] or 'stopped early' in e['message']][:6]
    except Exception as e:SOAK['errors'].append('final read: '+str(e))
    try:api('autopilot',{'enabled':False})
    except Exception:pass
    clean=save_results()
    print('SOAK DONE','(clean)' if clean else '(with errors)',flush=True)
    print(json.dumps(SOAK['achieved'],indent=1))
    print('deaths:',SOAK['deaths'],'resumes:',SOAK['resumes'],'errors:',SOAK['errors'])
if __name__=='__main__':main()
