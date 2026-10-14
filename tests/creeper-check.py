"""Focused creeper-flee repro: clear area, summon a NoAI creeper 4 blocks away, and print
the bot-creeper distance every second for 15s plus every reflex event. One iteration ~1 min.
"""
import pathlib,json,urllib.request,urllib.error,time,sys,math
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding='utf-8')
def read_token(name):return (ROOT/'data'/name).read_text().strip()
def api(route,data=None):
    r=urllib.request.Request('http://127.0.0.1:8765/api/'+route,data=None if data is None else json.dumps(data).encode(),headers={'Authorization':'Bearer '+read_token('dashboard-token'),'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r,timeout=100))
def command(text):
    r=urllib.request.Request('http://127.0.0.1:8766/test-command',data=json.dumps({'command':text}).encode(),headers={'Authorization':'Bearer '+read_token('supervisor-token'),'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r,timeout=30))
def main():
    api('connect',{});time.sleep(2)
    for _ in range(20):
        if api('state').get('connected'):break
        time.sleep(2)
    command('difficulty normal');time.sleep(1)
    command('kill @e[type=minecraft:creeper]');command('kill @e[type=minecraft:zombie]')
    # Replicate the suite context: Stop was pressed earlier (userStopped), the bot was
    # teleported to a fresh area for the fight tests, and paused jobs litter the queue.
    api('stop',{});time.sleep(1)
    command('tp BuilderBot 700 -60 700');time.sleep(4)
    for j in api('state').get('jobs',[]):
        if j['status'] in ('paused','queued','running'):api('cancel',{'id':j['id']})
    state=api('state');bx,bz=math.floor(state['position']['x']),math.floor(state['position']['z'])
    print(f'bot at {bx},-60,{bz}; summoning creeper 4 blocks west',flush=True)
    last=api('state')['events'][0]['time']
    command(f'summon minecraft:creeper {bx-4} -60 {bz} {{NoAI:1b,PersistenceRequired:1b}}')
    trail=[]
    for i in range(16):
        time.sleep(1)
        state=api('state')
        try:
            obs=api('observe')
            cr=next((e for e in obs['entities'] if e['type']=='creeper'),None)
            gap=round(math.dist([state['position']['x'],state['position']['z']],[cr['at']['x'],cr['at']['z']]),1) if cr else None
        except Exception as e:gap='err'
        events=[e['message'] for e in state['events'] if e['time']>last and 'creeper' in e['message'].lower()]
        pos=[round(state['position']['x'],1),round(state['position']['z'],1)]
        trail.append((i,gap,pos,events))
        print(f't={i}s gap={gap} pos={pos} events={events}',flush=True)
    command('kill @e[type=minecraft:creeper]')
    gaps=[g for _,g,_,_ in trail if isinstance(g,float)]
    print('MIN gap:',min(gaps) if gaps else None,' FINAL gap:',trail[-1][1],flush=True)
if __name__=='__main__':main()
