"""Derive closed dermal and subcutaneous shells from the original CC0 exterior.
Illustrative thicknesses, not subject-specific tissue measurements. Run in Blender.
The original skin GLB is read-only.
"""
import bpy,math
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
 bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.remove_doubles(threshold=.000005);bpy.ops.object.mode_set(mode='OBJECT')
 for v in obj.data.vertices:v.co-=v.normal*inset
 vg=obj.vertex_groups.new(name='Regional thickness')
 for v in obj.data.vertices:
  p=obj.matrix_world@v.co;h=p.z;ax=abs(p.x)
  weight=1
  if layer=='adipose':
   weight=.08 if h>1.43 else .10 if (ax>.19 and h<.93) or h<.12 else .45 if ax>.19 else .32 if h<.48 else .7 if h<.85 else 1
  vg.add([v.index],weight,'REPLACE')
 mat=bpy.data.materials.new(layer);mat.use_nodes=True;bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=.65;obj.data.materials.append(mat)
 mod=obj.modifiers.new('Closed tissue volume','SOLIDIFY');mod.thickness=thickness;mod.offset=-1;mod.use_even_offset=True;mod.vertex_group=vg.name;mod.thickness_vertex_group=.05;bpy.ops.object.modifier_apply(modifier=mod.name)
 for p in obj.data.polygons:p.use_smooth=True
 bpy.ops.export_scene.gltf(filepath=str(ROOT/f'public/models/{layer}-web.glb'),export_format='GLB',use_selection=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6)
 print('TISSUE_EXPORTED',layer,len(obj.data.vertices),len(obj.data.polygons))
 bpy.data.objects.remove(obj,do_unlink=True)
