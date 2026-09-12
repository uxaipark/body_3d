import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
s=json.loads(Path('/tmp/soma-atlas-skin-rigged.json').read_text());ref=json.loads(Path('/tmp/soma-cardiorespiratory-check.json').read_text());bvh=BVHTree.FromPolygons(s['positions'],s['indices'],all_triangles=True)
def inside(p):
 votes=0
 for d in [Vector((1,.013,.021)).normalized(),Vector((.027,.051,1)).normalized(),Vector((-.031,1,.014)).normalized()]:
  origin=p.copy();count=0
  for i in range(40):
   hit=bvh.ray_cast(origin,d,3)
   if hit[0] is None:break
   count+=1;origin=hit[0]+d*.00005
  votes+=count%2
 return votes>=2
for m in ref['bones']:
 if not any(t in m['name'] for t in ['Femur.','Humerus.','Frontal bone','Tibia.','phalanx']):continue
 out=[]
 for v in m['positions']:
  p=Vector(v);q,n,_,d=bvh.find_nearest(p)
  if d>.002 and not inside(p):out.append(d)
 assert not out,(m['name'],len(out),max(out)*1000)
print('Major limb, cranial and finger/toe bones are inside the cleaned exterior (2 mm tolerance)')
