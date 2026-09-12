"""Fit a smaller lung envelope inside the actual thoracic mesh.
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
  # The single pleural mesh spans both lungs. Use the corresponding side's
  # lobe centre, with a continuous midline transition (never split the mesh).
  if 'pleura' in mesh['name'].lower():
   t=max(-1,min(1,point.x/.012))
   center.x=.055*t*(1.5-.5*t*t)
  direction=point-center;length=direction.length;direction.normalize();limit=length
  for n,d in planes:
   den=n.dot(direction)
   if den>1e-8:limit=min(limit,(d-.008-n.dot(center))/den)
  hit=bvh.ray_cast(center,direction,.5)
  if hit[0] is not None:limit=min(limit,max(.002,hit[3]-.003))
  inside=center+direction*max(.001,limit)
  # The convex envelope alone overestimates the space behind curved ribs.
  # Reduce full inspiration by 14% transversely/AP and 6% vertically;
  # this retains lobe shape while reducing volume by 30.5% from the old fit.
  inside=center+Vector(((inside.x-center.x)*.86,(inside.y-center.y)*.94,(inside.z-center.z)*.86))
  # Extra rest clearance at the chest wall; modest cranial motion at the base.
  rest=center+Vector(((inside.x-center.x)*.935,(inside.y-center.y)*.955,(inside.z-center.z)*.91))
  rest.y+=.004*max(0,min(1,(1.30-inside.y)/.15))
  inhale.append(list(inside));exhale.append(list(rest))
  for n,d in planes:maximum_error=max(maximum_error,n.dot(inside)-d+.008)
 result.append({'name':mesh['name'],'primitive':mesh['primitive'],'inhale':inhale,'exhale':exhale})
assert maximum_error<1e-6,maximum_error
# The convex cage bridges gaps but cannot detect inward-curving rib surfaces.
# Check actual triangle overlap and surface clearance throughout respiration.
minimum_gap=1
for original,fit in zip(source['lungs'],result):
 indices=original['indices'];triangles=[indices[i:i+3] for i in range(0,len(indices),3)]
 rest=[Vector(p) for p in fit['exhale']];full=[Vector(p) for p in fit['inhale']]
 for step in range(11):
  points=[a.lerp(b,step/10) for a,b in zip(rest,full)]
  lung_bvh=BVHTree.FromPolygons(points,triangles,all_triangles=True)
  assert not bvh.overlap(lung_bvh),(fit['name'],step,'intersects a rib')
  samples=points+[(points[a]+points[b]+points[c])/3 for a,b,c in triangles]
  for point in samples:minimum_gap=min(minimum_gap,bvh.find_nearest(point)[3])
assert minimum_gap>.002,minimum_gap
Path('/tmp/soma-lung-fitted.json').write_text(json.dumps(result))
print('Constrained',sum(len(m['inhale'])for m in result),'lung vertices; max cage violation',maximum_error)
print('No rib intersections at 11 breathing phases; minimum sampled gap (mm)',minimum_gap*1000)
