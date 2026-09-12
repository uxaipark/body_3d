"""Import a BodyParts3D skin surface, preserving its actual body proportions.
Only one global similarity registration is allowed; never warp individual limbs.
"""
import bpy,json,numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
ref=json.loads(Path('/tmp/soma-atlas-skin-reference.json').read_text())
def convert(v):return v[:,[0,2,1]]*np.array([.001,.001,-.001])
def read_stl(path,weld=True):
 data=path.read_bytes();count=int.from_bytes(data[80:84],'little')
 triangles=np.frombuffer(data,dtype=np.dtype([('n','<f4',(3,)),('v','<f4',(3,3)),('attr','<u2')]),count=count,offset=84)['v'].reshape(-1,3)
 if not weld:return triangles
 points,mapping=np.unique(triangles,axis=0,return_inverse=True)
 return points,mapping.reshape(-1,3).tolist()
# Register the matching 20110915 atlas version from four independent bones.
# One uniform scale + translation; no regional stretching, twist or sculpture.
rows=[];rhs=[]
for fma,pair in zip(['24474','23130','52788','24477'],ref['pairs']):
 original=convert(read_stl(ROOT/'.asset-cache'/('FMA'+fma+'.stl'),False));atlas=np.asarray(pair['positions'])
 for point,target in zip([original.min(axis=0),original.max(axis=0)],[atlas.min(axis=0),atlas.max(axis=0)]):
  for k in range(3):row=[point[k],0,0,0];row[k+1]=1;rows.append(row);rhs.append(target[k])
registration=np.linalg.lstsq(rows,rhs,rcond=None)[0];scale=registration[0];translation=registration[1:]
residual=np.abs(np.asarray(rows)@registration-rhs)
assert residual.max()<.002,residual.max()
raw,faces=read_stl(ROOT/'.asset-cache/bodyparts3d-skin-v3.stl')
v=convert(raw)*scale+translation
print('GLOBAL SIMILARITY',registration.tolist(),'maximum reference residual mm',residual.max()*1000,flush=True)
print('Skin bounds',v.min(axis=0),v.max(axis=0),'faces',len(faces))
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('BodyParts3D skin');mesh.from_pydata(v.tolist(),[],faces);mesh.update();obj=bpy.data.objects.new('Atlas Skin',mesh);bpy.context.collection.objects.link(obj)
bpy.context.view_layer.objects.active=obj;obj.select_set(True)
mod=obj.modifiers.new('Web surface budget','DECIMATE');mod.ratio=min(1,110000/len(mesh.polygons));mod.use_collapse_triangulate=True
bpy.ops.object.modifier_apply(modifier=mod.name);mesh=obj.data
v=np.asarray([list(p.co) for p in mesh.vertices])
print('Web surface',len(mesh.vertices),len(mesh.polygons),flush=True)
# Count connected pieces before selecting the exterior of the physical skin layer.
adj=[set() for _ in mesh.vertices]
for e in mesh.edges:a,b=e.vertices;adj[a].add(b);adj[b].add(a)
seen=set();components=[]
for start in range(len(v)):
 if start in seen:continue
 component=[];stack=[start];seen.add(start)
 while stack:
  i=stack.pop();component.append(i)
  for j in adj[i]:
   if j not in seen:seen.add(j);stack.append(j)
 components.append(component)
print('Skin components',sorted([len(c) for c in components],reverse=True)[:20])
# FMA7163 contains both walls of a physical skin layer. Keep its exterior
# connected component only, avoiding doubled transparent surfaces.
outer=max(components,key=len);keep=set(outer)
outer_faces=[list(p.vertices) for p in mesh.polygons if p.vertices[0] in keep]
remap={old:i for i,old in enumerate(outer)}
positions=v[outer];triangles=[[remap[i] for i in f] for f in outer_faces]
bpy.data.objects.remove(obj,do_unlink=True)
mesh=bpy.data.meshes.new('Native atlas exterior');mesh.from_pydata(positions.tolist(),[],triangles);mesh.update()
obj=bpy.data.objects.new('Atlas Skin',mesh);bpy.context.collection.objects.link(obj)
Path('/tmp/soma-atlas-skin-raw.json').write_text(json.dumps({'positions':positions.tolist(),'indices':triangles,'transform':translation.tolist(),'scale':float(scale)}))
