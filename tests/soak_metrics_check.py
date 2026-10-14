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
print('soak food metric ok')
