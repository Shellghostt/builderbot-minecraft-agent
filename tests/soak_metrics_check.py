"""Offline check of tests/soak.py's food metric (no server needed): python tests/soak_metrics_check.py"""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('soak',str(pathlib.Path(__file__).resolve().parent/'soak.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
run={'meals_mark':{'eaten':2,'points':10,'cooked':3,'items':{'cooked_beef':2}}}
d=m.meals_delta({'meals':{'eaten':5,'points':22,'cooked':7,'items':{'cooked_beef':3,'cooked_chicken':2}}},run)
assert d=={'eaten':3,'points':12,'cooked':4,'items':{'cooked_beef':1,'cooked_chicken':2}},d
d=m.meals_delta({'meals':{'eaten':1,'points':6,'cooked':0,'items':{'bread':1}}},run) # dashboard restarted
assert d['eaten']==1 and d['points']==6 and d['cooked']==0,d
d=m.meals_delta({},{} )
assert d=={'eaten':0,'points':0,'cooked':0,'items':{}},d
runs=[{'food':True,'meals':{'eaten':2,'points':12,'cooked':3},'edible_peak':4,'achieved':{'edible_food':1},'interventions':[]},{'interventions':[]}]
sm=m.summarise(runs)
assert sm['food_runs']==1 and sm['eaten']==[2,0] and sm['cooked']==[3,0] and sm['food_points']==[12,0],sm
# Iron columns (round 3): normal runs are long enough to reach the iron step now.
assert m.NORMAL_SECONDS==1200 and m.HARD_SECONDS==1250
assert m.iron_sample({'raw_iron':4,'iron_ingot':2,'iron_pickaxe':1})=={'iron_ore':4,'ingots':2,'iron_pick':1}
assert m.iron_sample({})=={'iron_ore':0,'ingots':0,'iron_pick':0}
samples=[{'t':30,'iron_ore':0,'ingots':0,'iron_pick':0},{'t':900,'iron_ore':6,'ingots':0,'iron_pick':0},
         {'t':960,'iron_ore':0,'ingots':6,'iron_pick':0},{'t':990,'iron_ore':0,'ingots':3,'iron_pick':1}]
im=m.iron_metrics(samples)
assert im=={'iron_ore_peak':6,'ingots_peak':6,'iron_pick_at':990,'iron':True},im
assert m.iron_metrics([])=={'iron_ore_peak':0,'ingots_peak':0,'iron_pick_at':None,'iron':False}
sm=m.summarise([{**im,'interventions':[]},{'interventions':[]}])
assert sm['iron_runs']==1 and sm['iron_ore_peak']==[6,0] and sm['ingots_peak']==[6,0] and sm['iron_pick_at']==[990,None],sm
assert sm['peak_median']['iron_pick']==0,sm['peak_median']
print('soak food metric ok')
print('soak iron metric ok')
