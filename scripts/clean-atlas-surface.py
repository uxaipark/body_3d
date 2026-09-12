"""Remove nested source tissue surfaces via exterior flood-fill, offline only.
Rasterize at 1.5 mm, fill enclosed interiors, and extract a single outer surface.
This preserves the imported body's silhouette without regional fitting fields.
"""
import sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'.asset-cache/python'))
import numpy as np
from scipy import ndimage
from skimage.measure import marching_cubes
s=json.loads(Path('/tmp/soma-atlas-skin-raw.json').read_text());v=np.asarray(s['positions']);f=np.asarray(s['indices'])
pitch=.0015;origin=v.min(axis=0)-pitch*5;shape=np.ceil((v.max(axis=0)-origin)/pitch).astype(int)+6
surface=np.zeros(shape,dtype=bool)
# Dense samples close diagonal cracks; batch by triangle edge subdivision count.
a=v[f[:,0]];b=v[f[:,1]];c=v[f[:,2]]
counts=np.ceil(np.maximum.reduce([np.linalg.norm(b-a,axis=1),np.linalg.norm(c-a,axis=1),np.linalg.norm(c-b,axis=1)])/pitch*2).astype(int)
for n in np.unique(counts):
 ids=np.flatnonzero(counts==n);n=max(1,int(n));uv=np.asarray([(i/n,j/n) for i in range(n+1) for j in range(n+1-i)])
 for start in range(0,len(ids),300):
  k=ids[start:start+300];points=a[k,None,:]+uv[None,:,0,None]*(b[k]-a[k])[:,None,:]+uv[None,:,1,None]*(c[k]-a[k])[:,None,:]
  grid=np.rint((points.reshape(-1,3)-origin)/pitch).astype(int);surface[grid[:,0],grid[:,1],grid[:,2]]=True
surface=ndimage.binary_closing(surface,iterations=1)
solid=ndimage.binary_fill_holes(surface)
# A half-voxel Gaussian removes grid stair steps, with sub-millimetre effect.
field=ndimage.gaussian_filter(solid.astype(np.float32),.65)
points,faces,_,_=marching_cubes(field,.5,spacing=(pitch,)*3,allow_degenerate=False)
points+=origin
Path('/tmp/soma-atlas-outer.json').write_text(json.dumps({'positions':points.tolist(),'indices':faces.tolist(),'transform':s['transform'],'scale':s['scale']}))
print('Exterior extraction',len(points),'vertices',len(faces),'faces',flush=True)
