"""Offline elastic surface relaxation against regional muscle/bone envelopes.
Preserves the original skin topology/UVs; never unions hands with the trunk.
"""
import json, math
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
s=json.loads(Path('/tmp/soma-skin-envelope-input.json').read_text())
trees={k:BVHTree.FromPolygons(g['points'],g['faces'],all_triangles=True) for k,g in s['tissue'].items()}
targets={k:Vector(v) for k,v in s['targets'].items()}
def mix(a,b,t):return a.lerp(b,max(0,min(1,t)))
def centre(p,region):
 side=-1 if region.startswith('r') else 1
 if region.endswith('arm'):
  a,b=(targets['shoulder'],targets['elbow']) if p.y>targets['elbow'].y else (targets['elbow'],targets['wrist'])
  c=mix(a,b,(a.y-p.y)/(a.y-b.y));c.x*=side
 elif region.endswith('leg'):
  a,b=(targets['hip'],targets['knee']) if p.y>targets['knee'].y else (targets['knee'],targets['ankle'])
  c=mix(a,b,(a.y-p.y)/(a.y-b.y));c.x*=side
  if p.y<.11:c.z=-.043+.10*max(0,min(1,(.11-p.y)/.085))
 else:c=Vector((0,p.y,-.025))
 c.y=p.y;return c
output=[]
for mesh in s['meshes']:
 if mesh['name']!='Male skin':output.append(mesh);continue
 # Weld only identical UV-split positions. Keep all source indices for export.
 mapping=[];lookup={};points=[];regions=[];fixed=[]
 for i,v in enumerate(mesh['positions']):
  key=tuple(round(x,6) for x in v)
  if key not in lookup:
   lookup[key]=len(points);points.append(Vector(v));regions.append(mesh['regions'][i]);fixed.append(v[1]>1.50 or v[1]<.045 or mesh['pelvic'][i] or mesh['arms'][i] and v[1]<.85)
  mapping.append(lookup[key])
 neighbors=[set() for _ in points];ix=mesh['indices']
 for i in range(0,len(ix),3):
  a,b,c=(mapping[j] for j in ix[i:i+3])
  for u,v in [(a,b),(b,c),(c,a)]:
   if u!=v:neighbors[u].add(v);neighbors[v].add(u)
 original=[p.copy() for p in points];centres=[];minimum=[];constrained=0
 for i,p in enumerate(points):
  c=centre(p,regions[i]);centres.append(c);direction=p-c;radius=direction.length;minimum.append(0)
  if fixed[i] or radius<.002:continue
  direction.normalize();limit=.12 if regions[i].endswith('arm') else .22 if regions[i].endswith('leg') else .28
  origin=c.copy();furthest=0
  for hit_index in range(64):
   hit=trees[regions[i]].ray_cast(origin,direction,limit)
   if hit[0] is None:break
   distance=(hit[0]-c).dot(direction)
   if distance>limit:break
   furthest=max(furthest,distance);origin=hit[0]+direction*.000025
  if furthest:
   minimum[i]=furthest+.0035
   # Expand to cover tissue; do not erase natural fat/soft-tissue volume where
   # a regional ray sees only a narrower inner bone (pelvis and shoulder seams).
   desired=max(minimum[i]+.003,radius)
   points[i]=c+direction*desired;constrained+=1
 # A constrained membrane relaxation removes shoulder/neck/ankle creases.
 # Face, fingers and pelvic midline remain anchors; constraint radii prevent
 # smoothing from collapsing the exterior back through underlying tissues.
 for iteration in range(28):
  previous=[p.copy() for p in points]
  strength=.38 if iteration%2==0 else -.39
  for i,p in enumerate(previous):
   if fixed[i] or not neighbors[i]:continue
   average=sum((previous[j] for j in neighbors[i]),Vector())/len(neighbors[i])
   q=p+(average-p)*strength
   # Restrict vertical smoothing to preserve landmark height and floor contact.
   q.y=max(.001,max(original[i].y-.004,min(original[i].y+.004,q.y)))
   c=centres[i].copy();c.y=q.y;radial=q-c
   if minimum[i] and radial.length<minimum[i]:q=c+radial.normalized()*minimum[i]
   points[i]=q
 mesh['positions']=[list(points[i]) for i in mapping]
 assert all(math.isfinite(c) for p in points for c in p)
 max_shift=max((a-b).length for a,b in zip(original,points))
 print('Skin envelope:',len(points),'welded vertices,',constrained,'tissue constraints, max shift (mm)',max_shift*1000)
 worst=max(range(len(points)),key=lambda i:(points[i]-original[i]).length)
 print("Largest correction",regions[worst],list(original[worst]),list(points[worst]),minimum[worst])
 assert max_shift<.12,max_shift
 output.append(mesh)
Path('/tmp/soma-skin-envelope-fitted.json').write_text(json.dumps(output))
