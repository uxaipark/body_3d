"""Build local rib contact half-spaces for anterior thoracoabdominal vessels."""
import json
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

s=json.loads(Path('/tmp/soma-vessel-contact.json').read_text())
points=[];faces=[]
for m in s['ribs']:
 offset=len(points);points+=m['positions'];ix=m['indices']
 faces += [[offset+j for j in ix[i:i+3]] for i in range(0,len(ix),3)]
rib=BVHTree.FromPolygons(points,faces,all_triangles=True)
cloud=np.asarray(points)

total=0
for m in s['vessels']:
 original=np.asarray(m['positions']);result=original.copy();guards=[];bindings=[]
 for i,p in enumerate(original):
  point=Vector(p);q,normal,face,distance=rib.find_nearest(point)
  # Broad transition ties the vessel to the rib's chest transform before it
  # reaches the contact zone. Remote abdominal branches keep their old rig.
  t=np.clip((distance-.020)/.025,0,1);bindings.append(float(1-t*t*(3-2*t)))
  if distance>.020:guards.append([0.,0.,0.,0.]);continue
  # Keep a whole vessel on one side of the wall: nearest-face normals can
  # otherwise push opposite sides of a thin tube in opposite directions.
  n=Vector((p[0],0,p[2]+.03)).normalized()
  exterior='lateral thoracic' in m['name'].lower() or 'superficial' in m['name'].lower()
  if not exterior:n.negate()
  local=cloud[np.linalg.norm(cloud-np.asarray(q),axis=1)<.025]
  limit=float(np.max(local@np.asarray(n)))+.003 if len(local) else float(q.dot(n))+.003
  guard=[*n,limit];guards.append(guard)
  result[i]+=np.asarray(n)*max(0,limit-float(point.dot(n)))
  total+=1
 # Translate local tube neighbourhoods together instead of flattening every
 # wall vertex independently onto the contact plane.
 required=np.linalg.norm(result-original,axis=1)
 # A 0.35-Lipschitz displacement envelope spreads corrections without
 # pinching a tube or introducing abrupt steps at the contact-zone edge.
 shared=np.asarray([max(0,float(np.max(required-.35*np.linalg.norm(original-p,axis=1)))) for p in original])
 direction=np.column_stack([original[:,0],np.zeros(len(original)),original[:,2]+.03])
 direction/=np.linalg.norm(direction,axis=1)[:,None]
 if not ('lateral thoracic' in m['name'].lower() or 'superficial' in m['name'].lower()):direction*=-1
 result=original+direction*shared[:,None]
 m['original']=m['positions'];m['positions']=result.tolist();m['guard']=guards;m['chestBinding']=bindings
 delta=np.linalg.norm(result-original,axis=1)
 print(m['name'],'max correction mm',round(float(delta.max()*1000),2),flush=True)
Path('/tmp/soma-vessel-clearance.json').write_text(json.dumps(s))
print('Guarded vertices',total,flush=True)
