"""Constrain inspiration to the actual thoracic mesh, with a 3 mm pleural gap.
The convex cage bridges intercostal gaps; actual rib BVH hits further limit it.
Exhalation contracts inward and raises the diaphragm-facing bases.
"""
import json, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from pathlib import Path
source=json.loads(Path('/tmp/soma-lung-input.json').read_text())
bvh=BVHTree.FromPolygons(source['verts'],source['faces'],all_triangles=True)
planes=[(Vector(p[:3]),p[3]) for p in source['planes']]
maximum_error=-1;result=[]
for mesh in source['lungs']:
 points=[Vector(v) for v in mesh['positions']];side=1 if sum(v.x for v in points)>=0 else -1
 center=Vector((side*.055,1.285,-.005));inhale=[];exhale=[]
 for point in points:
  direction=point-center;length=direction.length;direction.normalize();limit=length
  for n,d in planes:
   den=n.dot(direction)
   if den>1e-8:limit=min(limit,(d-.008-n.dot(center))/den)
  hit=bvh.ray_cast(center,direction,.5)
  if hit[0] is not None:limit=min(limit,max(.002,hit[3]-.003))
  inside=center+direction*max(.001,limit)
  # Extra rest clearance at the chest wall; modest cranial motion at the base.
  rest=center+Vector(((inside.x-center.x)*.935,(inside.y-center.y)*.955,(inside.z-center.z)*.91))
  rest.y+=.004*max(0,min(1,(1.30-inside.y)/.15))
  inhale.append(list(inside));exhale.append(list(rest))
  for n,d in planes:maximum_error=max(maximum_error,n.dot(inside)-d+.008)
 result.append({'name':mesh['name'],'primitive':mesh['primitive'],'inhale':inhale,'exhale':exhale})
assert maximum_error<1e-6,maximum_error
Path('/tmp/soma-lung-fitted.json').write_text(json.dumps(result))
print('Constrained',sum(len(m['inhale'])for m in result),'lung vertices; max cage violation',maximum_error)
