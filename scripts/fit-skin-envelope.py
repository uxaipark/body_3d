"""Regularize registration displacement on the original smooth tissue topology.
The surface is not shrink-wrapped onto disjoint muscles or projected radially.
An implicit membrane smooths landmark changes across UV and regional boundaries,
while preserving original anatomical relief and rigid hands, soles and face.
"""
import json
from pathlib import Path
import numpy as np
s=json.loads(Path('/tmp/soma-skin-envelope-input.json').read_text())
output=[]
for mesh in s['meshes']:
 if mesh['name']!='Male skin':output.append(mesh);continue
 source=np.asarray(mesh['sourcePositions']);target=np.asarray(mesh['positions'])
 # Weld in the source pose: registration may already have separated seam copies.
 _,unique,mapping=np.unique(np.round(source,6),axis=0,return_index=True,return_inverse=True)
 base=source[unique];requested=target[unique]-base;count=len(base)
 faces=mapping[np.asarray(mesh['indices']).reshape(-1,3)]
 edges=np.unique(np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1),axis=0)
 edges=edges[edges[:,0]!=edges[:,1]];a,b=edges.T
 length=np.linalg.norm(base[a]-base[b],axis=1)
 # Short edges must not cause density-dependent creases. Clamp tiny UV triangles.
 conductance=1/np.maximum(length,.0008)
 degree=np.bincount(a,conductance,count)+np.bincount(b,conductance,count)
 rms=np.sqrt((np.bincount(a,length*length,count)+np.bincount(b,length*length,count))/np.maximum(1,np.bincount(a,minlength=count)+np.bincount(b,minlength=count)))
 def smooth(lo,hi,x):
  t=np.clip((x-lo)/(hi-lo),0,1);return t*t*(3-2*t)
 y=base[:,1];arms=np.abs(np.asarray(mesh['arms'])[unique])>.5
 # Fade smoothing before the neck/face and rigid hand/foot boundaries.
 mask=smooth(.10,.17,y)*(1-smooth(1.46,1.51,y))
 mask*=np.where(arms,smooth(.84,.95,y),1)
 strength=(.025/np.maximum(rms,.001))**2*mask
 alpha=strength/(1+strength)
 current=requested.copy()
 for iteration in range(240):
  average=np.zeros_like(current)
  for axis in range(3):
   average[:,axis]=(np.bincount(a,conductance*current[b,axis],count)+np.bincount(b,conductance*current[a,axis],count))/np.maximum(degree,1e-12)
  current=(1-alpha[:,None])*requested+alpha[:,None]*average
 fitted=base+current
 def roughness(displacement):
  gradient=np.linalg.norm(displacement[a]-displacement[b],axis=1)/np.maximum(length,.0008)
  return np.quantile(gradient,[.95,.99,1]).tolist()
 print('Registration edge strain p95 / p99 / max:',roughness(requested),'->',roughness(current))
 assert np.isfinite(fitted).all()
 assert np.max(np.linalg.norm(current-requested,axis=1))<.04
 # Regression guard for the four reported crumpling regions. A source edge
 # must not become a long spike or collapse when landmarks are registered.
 zones={
  'buttocks':(y>.8)&(y<1.03)&(base[:,2]<0),
  'elbows':(y>1.02)&(y<1.18)&(np.abs(base[:,0])>.17),
  'armpits':(y>1.20)&(y<1.43)&(np.abs(base[:,0])>.09),
  'back neck':(y>1.40)&(y<1.53)&(base[:,2]<0),
 }
 ratio=np.linalg.norm(fitted[a]-fitted[b],axis=1)/np.maximum(length,1e-12)
 for name,zone in zones.items():
  measured=ratio[zone[a]&zone[b]&(length>.001)]
  print(name,'edge length ratio range:',float(measured.min()),float(measured.max()))
  assert measured.min()>.65 and measured.max()<1.35,(name,measured.min(),measured.max())
 mesh['positions']=fitted[mapping].tolist()
 # Smooth normals across UV seams, without flattening the facial texture chart.
 normals=np.zeros_like(fitted);face_norm=np.cross(fitted[faces[:,1]]-fitted[faces[:,0]],fitted[faces[:,2]]-fitted[faces[:,0]])
 for corner in range(3):np.add.at(normals,faces[:,corner],face_norm)
 normals/=np.maximum(np.linalg.norm(normals,axis=1)[:,None],1e-20)
 mesh['normals']=normals[mapping].tolist()
 output.append(mesh)
Path('/tmp/soma-skin-envelope-fitted.json').write_text(json.dumps(output))
