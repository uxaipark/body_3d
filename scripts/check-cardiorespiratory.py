import json
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
s=json.loads(Path('/tmp/soma-cardiorespiratory-check.json').read_text())
s['lungs']=[m for m in s['lungs'] if 'pleura' not in m['name'].lower()]
# Pulmonary fragments inside the swept cardiac display envelope are clipped.
planes=json.loads((Path(__file__).resolve().parent.parent/'lib/cardiac-space-data.js').read_text().split('=')[1].rstrip(';\n'))
def combine(meshes,field='positions'):
 points=[];faces=[]
 for m in meshes:
  base=len(points);points.extend(m[field]);ix=m['indices'];faces.extend([[j+base for j in ix[i:i+3]] for i in range(0,len(ix),3)])
 return points,faces
p,f=combine([m for m in s['bones'] if any(v in m['name'].lower() for v in ['rib','sternum','vertebra t'])]);ribs=BVHTree.FromPolygons(p,f,all_triangles=True)
rest,lf=combine(s['lungs']);full,_=combine(s['lungs'],'inhale');minimum=1;overlap=0
for breath in range(5):
 amount=breath/4;lp=[Vector(a).lerp(Vector(b),amount) for a,b in zip(rest,full)];lungs=BVHTree.FromPolygons(lp,lf,all_triangles=True)
 for phase in range(20):
  hp=[];hf=[]
  for m in s['hearts']:
   base=len(hp);hp.extend([Vector(v)+Vector((0,-.002*amount,0)) for v in m['phases'][phase]]);ix=m['indices'];hf.extend([[j+base for j in ix[i:i+3]] for i in range(0,len(ix),3)])
  heart=BVHTree.FromPolygons(hp,hf,all_triangles=True)
  assert not ribs.overlap(heart),('heart intersects ribs',breath,phase)
  overlap=max(overlap,len(lungs.overlap(heart)))
  for v in hp:minimum=min(minimum,ribs.find_nearest(v)[3])
# All cardiac triangles lie wholly inside this convex exclusion volume;
# any pulmonary intersection fragment is consequently discarded before depth write.
margin=1
for m in s['hearts']:
 for phase in m['phases']:
  for p in phase:
   for breath in [0,1]:
    v=Vector(p)+Vector((0,-.002*breath,0))
    margin=min(margin,-max(Vector(n[:3]).dot(v)-n[3] for n in planes))
assert margin>.0028,margin
print('Heart/rib minimum clearance mm',minimum*1000)
print('Reserved heart space margin mm',margin*1000,'all pulmonary intersection fragments excluded')
