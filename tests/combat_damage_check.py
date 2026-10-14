"""Offline check of tests/combat_integration.py's damage accounting (no server needed): python tests/combat_damage_check.py"""
import importlib.util,pathlib
spec=importlib.util.spec_from_file_location('combat_integration',str(pathlib.Path(__file__).resolve().parent/'combat_integration.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
d=m.damage_from
# 2026-10-14 lane creeper: the job's polls stayed at 20, the blast landed after it settled
assert d([20,20,20,20,3.86])==16.1,d([20,20,20,20,3.86])
# healing/eating in between: start - end + healed = 20 - 14 + 6
assert d([20,12,18,14])==12,d([20,12,18,14])
# a death and respawn at 20 still counts the hp lost
assert d([20,9,0,20])==20
# missing samples (state not ready) are skipped, never counted as damage
assert d([20,None,15,None])==5 and d([])==0 and d([None])==0
# settle() closes the series with the live health and recomputes damage + end health
m.api=lambda route,data=None,supervisor=False:{'health':3.86}
fight={'health':[20,20,20],'damage_taken':0}
assert m.settle(fight)==3.86 and fight['damage_taken']==16.1 and fight['end_health']==3.86,fight
# record() must come before the post-fight asserts in every fight test: a failed leg is still measured
import inspect
for name in ('test2_zombie_triple','test3_skeleton','test4_creeper','test4b_creeper_roofed','test5_spiders','test6_enderman','test7_witch','test8_low_health'):
    src=inspect.getsource(getattr(m,name))
    src=src[src.rfind('run_fight('):] # setup asserts before the fight measure nothing yet
    first_assert=min(i for i in (src.find('\n    assert '),src.find('assert_at_arena()')) if i>=0)
    assert src.find('record(')<first_assert,name+' asserts before it records'
print('combat damage accounting ok')
