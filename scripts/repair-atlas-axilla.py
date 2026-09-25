"""Open the fused arm/chest contact below each axillary crease, offline.
Preserve the rest of the atlas surface and interpolate existing vertex groups.
"""
import bpy, json, sys
from pathlib import Path
source, destination = sys.argv[sys.argv.index('--')+1:]
s = json.loads(Path(source).read_text())
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('Atlas');mesh.from_pydata(s['positions'],[],s['faces']);mesh.update()
obj=bpy.data.objects.new('Atlas',mesh);bpy.context.collection.objects.link(obj)
for name in s['bones']:obj.vertex_groups.new(name=name)
for i,(ids,weights) in enumerate(zip(s['rigIndex'],s['rigWeight'])):
 for bone,w in zip(ids,weights):
  if w>0:obj.vertex_groups[bone].add([i],w,'REPLACE')
for side in [-1,1]:
 # A narrow, closed-ended gap. It joins the existing free arm surface below
 # the contact, and rounds into the axilla rather than cutting the shoulder.
 levels=[(.96,.180,.003),(1.10,.170,.003),(1.18,.163,.003),
         (1.24,.167,.004),(1.285,.164,.004),(1.305,.161,.003),
         (1.315,.160,.0015),(1.32,.160,.0002)]
 vertices=[]
 for y,x,r in levels:
  for xx,z in [(x-r,-.19),(x+r,-.19),(x+r,.20),(x-r,.20)]:vertices.append((xx*side,y,z))
 faces=[(3,2,1,0)]
 for k in range(len(levels)-1):
  for j in range(4):faces.append((k*4+j,k*4+(j+1)%4,(k+1)*4+(j+1)%4,(k+1)*4+j))
 faces.append(tuple(range((len(levels)-1)*4,len(levels)*4)))
 cutter_mesh=bpy.data.meshes.new('Axillary clearance');cutter_mesh.from_pydata(vertices,[],faces);cutter_mesh.update()
 cutter=bpy.data.objects.new('Axillary clearance',cutter_mesh);bpy.context.collection.objects.link(cutter)
 import bmesh
 bm=bmesh.new();bm.from_mesh(cutter_mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(cutter_mesh);bm.free()
 bpy.context.view_layer.objects.active=obj;obj.select_set(True)
 modifier=obj.modifiers.new('Separate chest and upper arm contact','BOOLEAN');modifier.operation='DIFFERENCE';modifier.solver='EXACT';modifier.object=cutter
 bpy.ops.object.modifier_apply(modifier=modifier.name);bpy.data.objects.remove(cutter,do_unlink=True)
bm=bmesh.new();bm.from_mesh(obj.data)
# Boolean caps can span the entire contact as one polygon. They need bending
# resolution before weights are assigned; otherwise a single triangle forms a sail.
bmesh.ops.triangulate(bm,faces=list(bm.faces))
for _ in range(4):
 edges=[e for e in bm.edges if e.calc_length()>.008 and all(.94<v.co.y<1.33 and .14<abs(v.co.x)<.22 for v in e.verts)]
 if not edges:break
 bmesh.ops.subdivide_edges(bm,edges=edges,cuts=1,use_grid_fill=True)
 bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>3])
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
out={'positions':[list(v.co) for v in obj.data.vertices],'faces':[list(p.vertices) for p in obj.data.polygons],'rigIndex':[],'rigWeight':[]}
from mathutils.kdtree import KDTree
tree=KDTree(len(s['positions']))
for i,p in enumerate(s['positions']):tree.insert(p,i)
tree.balance()
for vertex in obj.data.vertices:
 entries=sorted([(g.group,g.weight) for g in vertex.groups if g.weight>1e-8],key=lambda x:-x[1])[:4]
 total=sum(w for _,w in entries)
 if total<=0:
  _,nearest,_=tree.find(vertex.co)
  entries=[(i,w) for i,w in zip(s['rigIndex'][nearest],s['rigWeight'][nearest]) if w>0];total=sum(w for _,w in entries)
 out['rigIndex'].append([i for i,w in entries]+[0]*(4-len(entries)))
 out['rigWeight'].append([w/total for i,w in entries]+[0]*(4-len(entries)))
Path(destination).write_text(json.dumps(out))
