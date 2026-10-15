"""Offline check of tests/soak.py's food metric (no server needed): python tests/soak_metrics_check.py"""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('soak',str(pathlib.Path(__file__).resolve().parent/'soak.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
run={'meals_mark':{'eaten':2,'points':10,'cooked':3,'items':{'cooked_beef':2}}}
d=m.meals_delta({'meals':{'eaten':5,'points':22,'cooked':7,'items':{'cooked_beef':3,'cooked_chicken':2}}},run)
assert d=={'eaten':3,'points':12,'cooked':4,'items':{'cooked_beef':1,'cooked_chicken':2},'due':0,'failed':0,'no_food':0,'last_error':None},d
d=m.meals_delta({'meals':{'eaten':1,'points':6,'cooked':0,'items':{'bread':1}}},run) # dashboard restarted
assert d['eaten']==1 and d['points']==6 and d['cooked']==0,d
d=m.meals_delta({},{} )
assert d=={'eaten':0,'points':0,'cooked':0,'items':{},'due':0,'failed':0,'no_food':0,'last_error':None},d
# Round 6: due/failed (FoodChain) say whether 'eaten 0' is a full bar or a broken eat path.
d=m.meals_delta({'meals':{'eaten':0,'due':3,'failed':2,'lastError':'consume timed out'}},{'meals_mark':{'due':1,'failed':0}})
assert d['due']==2 and d['failed']==2 and d['last_error']=='consume timed out',d
assert m.meals_delta({'meals':{'failed':1,'lastError':'old'}},{'meals_mark':{'failed':1}})['last_error'] is None
lv=m.food_level([{'food':20,'sat':5.0},{'food':13,'sat':0.0},{'food':17},{'hp':20}])
assert lv=={'food_min':13,'food_max':20,'sat_min':0.0,'food_min_held':None},lv
assert m.food_level([])=={'food_min':None,'food_max':None,'sat_min':None,'food_min_held':None}
lv={'food_min':13,'food_max':20,'sat_min':0.0}
assert m.food_verdict({'meals':{'eaten':1},'food_level':lv})=='ate'
assert m.food_verdict({'meals':{'eaten':0,'due':0},'food_level':lv,'edible_peak':8})=='never hungry (food min 13)'
v=m.food_verdict({'meals':{'eaten':0,'due':2,'failed':2,'last_error':'no cooked_beef stack in the inventory'},'food_level':{'food_min':9},'edible_peak':8})
assert v.startswith('EAT FAILED (due 2, failed 2, no cooked_beef stack'),v
assert m.food_verdict({'meals':{'eaten':0},'food_level':{'food_min':6},'edible_peak':0})=='no food held (food min 6)'
assert m.food_verdict({'meals':{'eaten':0},'food_level':{'food_min':8},'edible_peak':7}).startswith('EAT FAILED'),'hungry, food held, never due: the chain never asked'
# Round 7: normal2 fell to 5 with `due 1, failed 0` and no food held at the low (cooked 0).
lv7=m.food_level([{'food':16,'food_items':2},{'food':9,'food_items':0},{'food':5,'food_items':0}])
assert lv7['food_min']==5 and lv7['food_min_held']==16,lv7
assert m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0},'food_level':lv7,'edible_peak':2})=='no food held (food min 5)'
assert m.food_verdict({'meals':{'eaten':0,'due':1,'failed':0,'no_food':1},'food_level':{'food_min':5},'edible_peak':2})=='no food held (food min 5)'
assert m.meals_delta({'meals':{'noFood':3}},{'meals_mark':{'noFood':1}})['no_food']==2
# food held at the low and the meal failed: still EAT FAILED with the reason
lv8=m.food_level([{'food':8,'food_items':4}])
v=m.food_verdict({'meals':{'eaten':0,'due':3,'failed':4,'last_error':'Promise timed out. (2 tries)'},'food_level':lv8,'edible_peak':4})
assert v.startswith('EAT FAILED (due 3, failed 4, Promise timed out.'),v
v=m.food_verdict({'meals':{'eaten':0,'due':3,'failed':4,'last_error':'x'},'food_level':{'food_min':15},'edible_peak':4})
assert v.startswith('EAT FAILED'),'a failed meal is never "never hungry"'
assert m.food_verdict({'meals':{'eaten':2,'failed':1,'last_error':'x'},'food_level':lv8})=='ate (1 failed: x)'
runs=[{'food':True,'meals':{'eaten':2,'points':12,'cooked':3},'edible_peak':4,'achieved':{'edible_food':1},'interventions':[]},{'interventions':[]}]
runs[0]['meals'].update(due=2,failed=0);runs[0]['food_level']={'food_min':10,'food_max':20};runs[0]['food_verdict']='ate'
sm=m.summarise(runs)
assert sm['food_runs']==1 and sm['eaten']==[2,0] and sm['cooked']==[3,0] and sm['food_points']==[12,0],sm
assert sm['food_due']==[2,0] and sm['food_failed']==[0,0] and sm['food_min']==[10,None] and sm['food_max']==[20,None] and sm['food_verdict']==['ate',None],sm
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
# Deaths (round 5): the server log, the bot counter and the event window; max of the three.
LOG='''[02:06:11] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:20:00] [Server thread/INFO]: <BuilderBot> I was shot earlier
[02:41:02] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:44:40] [Server thread/INFO]: BuilderBot was shot by Skeleton
[02:46:13] [Server thread/INFO]: BuilderBot drowned
[02:46:50] [Server thread/INFO]: BuilderBot lost connection: Timed out
[02:47:00] [Server thread/INFO]: BuilderBot left the game
[02:48:00] [Server thread/INFO]: BuilderBot joined the game
[02:49:00] [Server thread/INFO]: BuilderBot froze to death
[02:50:00] [Server thread/INFO]: BuilderBot suffocated in a wall
[02:51:00] [Server thread/INFO]: BuilderBot hit the ground too hard
[02:52:00] [Server thread/INFO]: BuilderBot tried to swim in lava to escape Zombie
'''
causes=m.log_deaths(LOG)
assert causes==['BuilderBot was shot by Skeleton']*3+['BuilderBot drowned','BuilderBot froze to death','BuilderBot suffocated in a wall','BuilderBot hit the ground too hard','BuilderBot tried to swim in lava to escape Zombie'],causes
# Round 4 hard3: the dashboard read failed; the log alone still counts both shots.
run={'deaths_mark':0,'bot_deaths_mark':5}
t=m.death_tally(run,None,'',LOG.splitlines()[0]+'\n'+LOG.splitlines()[2]+'\n')
assert t['deaths']==2 and t['log']==2,t
# The bot counter rises past a scrolled-out event window (window 1, counter 4, log 3).
run={'deaths_mark':1,'bot_deaths_mark':5,'deaths':0}
t=m.death_tally(run,{'deaths':9},'Bot died at 1, 2, 3 | Bot died at 4, 5, 6','\n'.join(LOG.splitlines()[:4]))
assert t['deaths']==4 and t['counter']==4 and t['window']==1 and t['log']==3,t
# A dashboard restart resets the counter: count from zero, never negative.
assert m.bot_deaths({'deaths':2},{'bot_deaths_mark':7})==2
assert m.bot_deaths({},{'bot_deaths_mark':7})==0
# Monotonic: an earlier higher count is never lowered by a later read.
assert m.death_tally({'deaths':3},None,'','')['deaths']==3
print('soak death metric ok')
