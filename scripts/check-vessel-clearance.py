import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
s=json.loads(Path('/tmp/soma-vessel-poses.json').read_text());points=[];faces=[]
for m in s['ribs']:
 offset=len(points);points+=m['positions'];ix=m['indices'];faces += [[offset+j for j in ix[i:i+3]] for i in range(0,len(ix),3)]
rib=BVHTree.FromPolygons(points,faces,all_triangles=True);gap=1
for m in s['vessels']:
 ix=m['indices'];triangles=[ix[i:i+3] for i in range(0,len(ix),3)]
 for phase,vertices in enumerate(m['phases']):
  tree=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
  overlaps=rib.overlap(tree)
  assert not overlaps,(m['name'],s['cases'][phase],len(overlaps))
  for p in vertices:gap=min(gap,rib.find_nearest(Vector(p))[3])
assert gap>.001,gap
print('No vessel/rib/cartilage intersections;',len(s['cases']),'poses; minimum sampled clearance',gap*1000,'mm')
