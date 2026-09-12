"""Derive closed dermal and subcutaneous shells from the original CC0 exterior.
Illustrative thicknesses, not subject-specific tissue measurements. Run in Blender.
The original skin GLB is read-only.
"""
import bpy,math
from mathutils.bvhtree import BVHTree
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models/skin-web.glb'))
source=max((o for o in bpy.context.scene.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices))
for layer,color,inset,thickness in [('dermis',(.60,.27,.22),.00025,.00135),('adipose',(.79,.48,.12),.0016,.014)]:
 bpy.ops.object.select_all(action='DESELECT')
 obj=source.copy();obj.data=source.data.copy();obj.name='Dermal layer' if layer=='dermis' else 'Subcutaneous adipose';bpy.context.collection.objects.link(obj);obj.select_set(True);bpy.context.view_layer.objects.active=obj
 obj.data.materials.clear()
 for uv in list(obj.data.uv_layers):obj.data.uv_layers.remove(uv)
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.000005);bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')
 # Capture the unmodified surface. Never use even-offset miters: at nearly
 # opposing normals they turn millimetres of thickness into metre-long spikes.
 obj.data.update()
 positions=[v.co.copy() for v in obj.data.vertices]
 normals=[v.normal.copy().normalized() for v in obj.data.vertices]
 bvh=BVHTree.FromPolygons(positions,[list(p.vertices) for p in obj.data.polygons])
 def smooth(a,b,x):
  t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
 def mix(a,b,t):return a+(b-a)*t

 vg=obj.vertex_groups.new(name='Regional thickness')
 for v in obj.data.vertices:
  p=obj.matrix_world@v.co;h=p.z;ax=abs(p.x)
  weight=1
  if layer=='adipose':
   # Continuous transitions avoid internal ledges at wrists, knees and neck.
   weight=mix(.32,.70,smooth(.42,.54,h))
   weight=mix(weight,1,smooth(.79,.91,h))
   weight=mix(weight,.45,smooth(.17,.23,ax))
   weight=mix(weight,.10,smooth(.18,.23,ax)*(1-smooth(.86,.96,h)))
   weight=mix(weight,.10,1-smooth(.09,.16,h))
   weight=mix(weight,.08,smooth(1.40,1.49,h))
  # Ray to the opposite wall limits thickness in fingers, lips and skin folds.
  normal=normals[v.index];origin=positions[v.index]
  hit=bvh.ray_cast(origin-normal*.00001,-normal,.1)
  clearance=(hit[3]+.00001) if hit[0] is not None else .1
  local_inset=min(inset,clearance*.12)
  local_thickness=min(thickness*weight,clearance*.30)
  v.co=origin-normal*local_inset
  vg.add([v.index],local_thickness/thickness,'REPLACE')
 mat=bpy.data.materials.new(layer);mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.65;obj.data.materials.append(mat)
 mod=obj.modifiers.new('Closed tissue volume','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;mod.use_even_offset=False;mod.vertex_group=vg.name;mod.thickness_vertex_group=0;bpy.ops.object.modifier_apply(modifier=mod.name)
 # Validate actual vertices before compression/export, including the inner wall.
 for v in obj.data.vertices:
  distance=bvh.find_nearest(v.co)[3]
  assert math.isfinite(distance) and distance<=inset+thickness+.00001, (layer,v.index,distance)
 for p in obj.data.polygons:p.use_smooth=True
 bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{layer}-web.glb'),export_format='GLB',use_selection=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)
 print('TISSUE_EXPORTED',layer,len(obj.data.vertices),len(obj.data.polygons))
 bpy.data.objects.remove(obj,do_unlink=True)
