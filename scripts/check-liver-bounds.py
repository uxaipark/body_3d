import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
s=json.loads(Path('/tmp/soma-liver-check.json').read_text());rib=BVHTree.FromPolygons(s['ribs']['points'],s['ribs']['faces'],all_triangles=True);gap=1
for m in s['liver']:
 a=[Vector(v) for v in m['rest']];b=[Vector(v) for v in m['inhale']];ix=m['indices'];faces=[ix[i:i+3] for i in range(0,len(ix),3)]
 for step in range(21):
  points=[v.lerp(w,step/20) for v,w in zip(a,b)]
  tree=BVHTree.FromPolygons(points,faces,all_triangles=True)
  overlaps=rib.overlap(tree)
  assert not overlaps,(m['name'],step,len(overlaps))
  for p in points:
   d=rib.find_nearest(p)[3]
   if d<gap:gap=d;worst=(m['name'],step,list(p),list(rib.find_nearest(p)[0]))
print('Closest rib sample',worst)
assert gap>.003,gap
print('Liver + gallbladder: no rib intersections in 21 respiratory phases; minimum vertex clearance (mm)',gap*1000)
