import io
p='tests/soak.py'
s=io.open(p,encoding='utf-8').read()

# 1. Replace the old scout_normal_anchor with probe_spot + scout_anchors (fail-closed)
start=s.find('def scout_normal_anchor(base):')
end=s.find('def wait_job(created,seconds):')
assert start>0 and end>start,(start,end)
new_block='''def probe_spot():
    # Live read at the bot's current position: reachable logs within 24 and the light.
    o=api('observe')
    logs=(o.get('blocks') or {}).get('logs') or {}
    return {'logs':logs.get('count',0),'log_at':logs.get('at'),'light':o.get('light'),
            'tod':o.get('timeOfDay'),'pos':[round(o['position'][k]) for k in ('x','y','z')]}

def scout_anchors(base):
    # (review) Fail-closed anchor scout on the regenerated seed:
    #   normal = open sky (daylight light >= 14) with >= 10 reachable logs within 24 blocks;
    #   hard   = dark oak canopy (light <= 7) with >= 10 reachable logs within 24 blocks.
    # Probes by teleporting a spiral from the base (tp is fine for scouting; the runs
    # themselves always reset to the confirmed anchor coordinates). Raises when either
    # anchor cannot be confirmed - the soak then refuses to run on unmeasurable anchors.
    api('connect',{});wait(lambda:api('state').get('connected'),90)
    time.sleep(3)
    found={}
    probes=[(0,0)]+[(d*dx,d*dz) for d in (48,80,112,144) for (dx,dz) in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,-1),(1,-1),(-1,1))]
    for dx,dz in probes:
        x=base[0]+dx;z=base[2]+dz
        command('tp BuilderBot %d 130 %d'%(x,z));time.sleep(3.5) # chunks load; the server drops the bot on the surface
        spot=probe_spot()
        print('scout probe '+json.dumps(spot),flush=True)
        if 'normal' not in found and spot['logs']>=10 and (spot['light'] or 0)>=14:
            found['normal']=[spot['pos'][0],130,spot['pos'][2]]
            print('scout: NORMAL anchor confirmed '+json.dumps(found['normal']),flush=True)
        if 'hard' not in found and spot['logs']>=10 and (spot['light'] or 99)<=7:
            found['hard']=[spot['pos'][0],130,spot['pos'][2]]
            print('scout: HARD anchor confirmed '+json.dumps(found['hard']),flush=True)
        if 'normal' in found and 'hard' in found:break
    if 'normal' not in found or 'hard' not in found:
        raise RuntimeError('anchor scout failed: confirmed '+json.dumps(found)+' - refusing to soak unmeasurable anchors')
    return found['normal'],found['hard']

'''
s=s[:start]+new_block+s[end:]

# 2. main(): the fail-closed dual-anchor flow (invalid setups never count; retries bounded)
start=s.find("    normal_anchor=scout_normal_anchor(ANCHOR)")
end=s.find("    print('stopping services and restoring agent-test-world',flush=True)")
assert start>0 and end>start,(start,end)
new_main='''    api('connect',{});wait(lambda:api('state').get('connected'),90)
    command('time set 0');command('weather clear 1200');time.sleep(3)
    normal_anchor,hard_anchor=scout_anchors(ANCHOR)
    runs=[]
    attempts={'normal':0,'hard':0}
    done={'normal':0,'hard':0}
    for label,anchor in (('normal',normal_anchor),('hard',hard_anchor)):
        while done[label]<3 and attempts[label]<5:
            attempts[label]+=1
            r=run_one(label+str(done[label]+1)+'a'+str(attempts[label]),anchor)
            runs.append(r)
            if r.get('invalid'):
                print('--- '+label+' attempt '+str(attempts[label])+' was INVALID (setup unconfirmed); not counted',flush=True)
                continue
            done[label]+=1
    if done['normal']<3 or done['hard']<3:
        print('WARNING: fewer than 3 valid runs per anchor: '+json.dumps({'normal':done['normal'],'hard':done['hard']}),flush=True)
'''
s=s[:start]+new_main+s[end:]

# 3. payload: anchors recorded; summary over valid runs only
a3="    payload={'runs':runs,'summary':summarise(runs),'errors':[e for r in runs for e in r['errors']],"
assert a3 in s
s=s.replace(a3,"""    valid=[r for r in runs if not r.get('invalid')]
    payload={'runs':runs,'summary':summarise(valid),'errors':[e for r in valid for e in r['errors']],
             'invalid_attempts':[{'index':r.get('index'),'reason':r.get('invalid')} for r in runs if r.get('invalid')],
             'anchors':{'hard':hard_anchor,'normal':normal_anchor},""",1)

io.open(p,'w',encoding='utf-8',newline='\n').write(s)
print('soak.py reworked')
