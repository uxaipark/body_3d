"""Rig the cleaned native atlas exterior using Blender bone heat weights."""
import bpy,json,numpy as np,bmesh
import sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'scripts'))
from smooth_atlas_surface import smooth_surface
ref=json.loads(Path('/tmp/soma-atlas-skin-reference.json').read_text())
s=json.loads(Path('/tmp/soma-atlas-outer.json').read_text());scale=s['scale'];translation=np.asarray(s['transform'])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
mesh=bpy.data.meshes.new('Native atlas exterior');mesh.from_pydata(s['positions'],[],s['indices']);mesh.update()
obj=bpy.data.objects.new('Atlas Skin',mesh);bpy.context.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
mod=obj.modifiers.new('Web exterior budget','DECIMATE');mod.ratio=min(1,110000/len(mesh.polygons));mod.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=mod.name);mesh=obj.data
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.update()
positions=np.asarray([list(v.co) for v in mesh.vertices]);triangles=[list(p.vertices) for p in mesh.polygons]
positions,smoothing=smooth_surface(positions,triangles)
for vertex,position in zip(mesh.vertices,positions):vertex.co=position
mesh.update()
print('Clean native exterior:',len(positions),'vertices,',len(triangles),'triangles',flush=True)
# Native bone-heat weights, solved on the connected exterior rather than X/Y
# partitioning. Geometry is never changed by the rigging operation.
armature=bpy.data.armatures.new('Atlas skeleton');rig=bpy.data.objects.new('Atlas skeleton',armature);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;rig.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
heads={b['name']:Vector(b['head']) for b in ref['bones']}
ends={'pelvis':'spine','spine':'chest','chest':'neck','neck':'head'}
for b in ref['bones']:
 name=b['name'];bone=armature.edit_bones.new(name);bone.head=heads[name]
 if name in ends:bone.tail=heads[ends[name]]
 elif name=='head':bone.tail=Vector((0,1.70,-.02))
 else:
  stem,side=name.split('.');sign=1 if side=='l' else -1
  end={'thigh':'shin','shin':'foot','foot':'toe','upperArm':'forearm','forearm':'hand'}.get(stem)
  bone.tail=heads[end+'.'+side] if end else Vector((sign*.078,.023,.155)) if stem=='toe' else Vector((sign*.315,.72,.012)) if stem=='hand' else bone.head+Vector((0,.025,0))
 if name.startswith('patella'):bone.use_deform=False
 if b['parent']:bone.parent=armature.edit_bones[b['parent']]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
indices=[];weights=[];unbound=0
names=[b['name'] for b in ref['bones']]
for vertex in mesh.vertices:
 active=[(names.index(obj.vertex_groups[g.group].name),g.weight) for g in vertex.groups if obj.vertex_groups[g.group].name in names and g.weight>1e-7]
 # Genital/perineal midline remains one structure during either leg swing.
 p=vertex.co
 def smooth(a,b,x):
  t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
 anchor=(1-smooth(.025,.06,abs(p.x)))*smooth(.70,.76,p.y)*(1-smooth(.94,1.00,p.y))
 if anchor>0:
  combined={i:w*(1-anchor) for i,w in active};combined[0]=combined.get(0,0)+anchor;active=list(combined.items())
 active=sorted(active,key=lambda x:-x[1])[:4];total=sum(w for _,w in active)
 if total<1e-6:unbound+=1;active=[(0,1.)];total=1.
 indices.append([i for i,w in active]+[0]*(4-len(active)))
 weights.append([w/total for i,w in active]+[0.]*(4-len(active)))
print('Bone heat result',len(mesh.vertices),'vertices; unbound',unbound)
assert unbound==0,unbound
for p in mesh.polygons:p.use_smooth=True
Path('/tmp/soma-atlas-skin-rigged.json').write_text(json.dumps({'positions':positions.tolist(),'indices':triangles,'rigIndex':indices,'rigWeight':weights,'transform':translation.tolist(),'scale':float(scale),'smoothing':smoothing}))
bpy.ops.wm.save_as_mainfile(filepath='/tmp/soma-atlas-skin.blend')
