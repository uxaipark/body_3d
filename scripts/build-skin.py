"""Build the CC0 MakeHuman male skin in the SOMA anatomical coordinate frame.
Run: Blender --background --python scripts/build-skin.py
Source inputs are cached beneath .asset-cache/{makehuman,mh-assets}; see SKIN-SOURCE.md.
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
MH=ROOT/'.asset-cache/makehuman'; ASSETS=ROOT/'.asset-cache/mh-assets'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def read_obj(path):
    vertices=[];uv=[];faces=[];uvfaces=[];groups=[];group=''
    for line in path.read_text().splitlines():
        t=line.split()
        if not t:continue
        if t[0]=='v':vertices.append(Vector(map(float,t[1:4])))
        elif t[0]=='vt':uv.append(tuple(map(float,t[1:3])))
        elif t[0]=='g':group=' '.join(t[1:])
        elif t[0]=='f':
            faces.append([int(v.split('/')[0])-1 for v in t[1:]])
            uvfaces.append([int(v.split('/')[1])-1 if '/'in v else 0 for v in t[1:]])
            groups.append(group)
    return vertices,uv,faces,uvfaces,groups
base,uv,faces,uvfaces,groups=read_obj(MH/'3dobjs/base.obj')
for target,weight in [('macrodetails/caucasian-male-young.target',1),('eyes/l-eye-height2-incr.target',.18),('eyes/r-eye-height2-incr.target',.18),('macrodetails/universal-male-young-maxmuscle-averageweight.target',.38),('macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target',.32)]:
    for line in (MH/'targets'/target).read_text().splitlines():
        t=line.split()
        if len(t)==4 and not t[0].startswith('#'):base[int(t[0])]+=Vector(map(float,t[1:]))*weight
body_indices={v for f,g in zip(faces,groups) if g=='body' for v in f}
low=min(base[v].y for v in body_indices);high=max(base[v].y for v in body_indices);scale=1.72/(high-low)
# Adult flower-boy portrait: local facial changes only. Keep the original body
# normalization and all vertices below the neck untouched.
def face_weight(y):
    t=max(0,min(1,(y-5.95)/.65));return t*t*(3-2*t)
face_mask=[face_weight(v.y) for v in base]
portrait_reference=[v.copy() for v in base]
portrait_targets=[
    ('macrodetails/caucasian-male-young.target',-.72),
    ('macrodetails/asian-male-young.target',.72),
    ('head/head-oval.target',.10),
    ('head/head-invertedtriangular.target',.34),
    ('head/head-scale-horiz-decr.target',.10),
    ('cheek/l-cheek-bones-incr.target',.16),
    ('cheek/r-cheek-bones-incr.target',.16),
    ('eyes/l-eye-corner2-up.target',.18),
    ('eyes/r-eye-corner2-up.target',.18),
    ('eyebrows/eyebrows-angle-down.target',.16),
    ('chin/chin-bones-decr.target',.30),
    ('chin/chin-width-decr.target',.34),
    ('chin/chin-height-decr.target',.12),
    ('eyes/l-eye-scale-incr.target',.10),
    ('eyes/r-eye-scale-incr.target',.10),
    ('mouth/mouth-angles-up.target',.18),
    ('mouth/mouth-upperlip-volume-incr.target',.16),
    ('mouth/mouth-lowerlip-volume-incr.target',.12),
    ('nose/nose-point-width-decr.target',.12),
    ('nose/nose-hump-decr.target',.28),
]
for target,weight in portrait_targets:
    for line in (MH/'targets'/target).read_text().splitlines():
        t=line.split()
        if len(t)==4 and not t[0].startswith('#'):
            i=int(t[0]);base[i]+=Vector(map(float,t[1:]))*(weight*face_mask[i])

# Macro ethnicity targets also carry a global stature offset. Remove the rigid
# head displacement so facial styling cannot shorten the neck or shift sensors.
head_ids={i for f,g in zip(faces,groups) if g=='joint-head' for i in f}
head_delta=sum((portrait_reference[i]-base[i] for i in head_ids),Vector())/len(head_ids)
for i,v in enumerate(base):v+=head_delta*face_mask[i]
def joint(name):
    ids={v for f,g in zip(faces,groups) if g==name for v in f}
    return sum((base[i] for i in ids),Vector())/len(ids)
print('Morphed height',high-low,'scale',scale)
for name in ['joint-l-shoulder','joint-l-elbow','joint-l-hand','joint-l-knee','joint-l-ankle','joint-head']:
    print(name,list(joint(name)))
# The atlas is an arms-down posture. Repose the MakeHuman A-pose around shoulders.
shoulder=joint('joint-l-shoulder');shoulder.x=abs(shoulder.x)
def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
def normalized(v):return Vector((v.x*scale,(v.y-low)*scale,v.z*scale-.025))
def bone_map(v,source_a,source_b,target_a,target_b):
    delta=source_b-source_a;target=target_b-target_a
    q=delta.rotation_difference(target)
    return target_a+q@(v-source_a)*(target.length/delta.length)
arm_a=normalized(joint('joint-l-shoulder'));arm_b=normalized(joint('joint-l-elbow'));arm_c=normalized(joint('joint-l-hand'))
arm_a.x=abs(arm_a.x);arm_b.x=abs(arm_b.x);arm_c.x=abs(arm_c.x)
leg_a=normalized(joint('joint-l-upper-leg'));leg_b=normalized(joint('joint-l-knee'));leg_c=normalized(joint('joint-l-ankle'))
leg_a.x=abs(leg_a.x);leg_b.x=abs(leg_b.x);leg_c.x=abs(leg_c.x)
def conform(v):
    v=normalized(v);sign=1 if v.x>=0 else -1;v.x=abs(v.x)
    # Register limb axes to the same shoulder, elbow, wrist, hip, knee and ankle landmarks.
    if v.y>.65:
        edge=arm_a.x-.035+max(0,arm_a.y-v.y)*.48
        amount=smooth(edge-.025,edge+.025,v.x)*(1-smooth(arm_a.y,arm_a.y+.045,v.y))
        upper=bone_map(v,arm_a,arm_b,Vector((.167,1.375,-.019)),Vector((.222,1.098,-.035)))
        lower=bone_map(v,arm_b,arm_c,Vector((.222,1.098,-.035)),Vector((.283,.863,.012)))
        blend=1-smooth(arm_b.y-.045,arm_b.y+.045,v.y)
        mapped=upper.lerp(lower,blend);v=v.lerp(mapped,amount)
    # Smoothly narrow the A-stance, without the discontinuity of separate leg transforms.
    if v.y < .98:
        knots=[0,.10,.53,.85,.98];offsets=[.105,.105,.062,.020,0]
        y=max(0,v.y);shift=0
        for i in range(len(knots)-1):
            if knots[i]<=y<=knots[i+1]:
                t=smooth(knots[i],knots[i+1],y);shift=offsets[i]*(1-t)+offsets[i+1]*t;break
        v.x-=shift*smooth(.015,.085,v.x)*(1-smooth(.60,.68,v.y)*smooth(.17,.225,v.x))
    v.x*=sign
    return Vector((v.x,-v.z,v.y)) # Blender Z-up; glTF exports Y-up, facing +Z.

# Register exterior knee/hip landmarks to the atlas before skeletal binding.
# This is a one-time rest-pose fit, never an animated bend of a bone.
conform_unregistered=conform
source_leg=[conform_unregistered(joint(n)) for n in ['joint-l-upper-leg','joint-l-knee','joint-l-ankle']]
target_leg=[Vector((.072,.006,.867)),Vector((.083,.027,.438)),Vector((.078,.035,.073))]
def conform(v):
    p=conform_unregistered(v);side=1 if p.x>=0 else -1;p.x=abs(p.x)
    if p.z<.98:
        upper=bone_map(p,source_leg[0],source_leg[1],target_leg[0],target_leg[1])
        lower=bone_map(p,source_leg[1],source_leg[2],target_leg[1],target_leg[2])
        knee=1-smooth(source_leg[1].z-.035,source_leg[1].z+.035,p.z)
        mapped=upper.lerp(lower,knee)
        foot=p+(target_leg[2]-source_leg[2])
        mapped=mapped.lerp(foot,1-smooth(.05,.10,p.z))
        groin=1-smooth(.67,.79,p.z)*(1-smooth(.038,.085,p.x))
        p=p.lerp(mapped,(1-smooth(.84,.98,p.z))*groin*(1-smooth(.60,.68,p.z)*smooth(.17,.225,p.x)))
    p.x*=side
    return p

def material(name,texture,rough=.55,alpha=False):
    m=bpy.data.materials.new(name);m.use_nodes=True
    nodes=m.node_tree.nodes;p=nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=rough
    p.inputs['Metallic'].default_value=0;p.inputs['Specular IOR Level'].default_value=.045 if name=='Hair' else .3
    tex=nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(texture));m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color'])
    if alpha:m.node_tree.links.new(tex.outputs['Alpha'],p.inputs['Alpha']);m.surface_render_method='DITHERED'
    if name=='Hair':
        mult=nodes.new('ShaderNodeMixRGB');mult.blend_type='MULTIPLY';mult.inputs[0].default_value=1;mult.inputs[2].default_value=(.11,.075,.052,1);m.node_tree.links.new(tex.outputs['Color'],mult.inputs[1]);m.node_tree.links.new(mult.outputs[0],p.inputs['Base Color'])
    if name=='Skin':p.inputs['Subsurface Weight'].default_value=.07;p.inputs['Subsurface Radius'].default_value=(1,.4,.2)
    return m
skinmat=material('Skin',ASSETS/'skins/young_caucasian_male/young_lightskinned_male_diffuse.png')
# A smooth, warm cinematic skin finish instead of photographic pore detail.
principled=skinmat.node_tree.nodes.get('Principled BSDF')
for link in list(skinmat.node_tree.links):
    if link.to_socket==principled.inputs['Base Color']:skinmat.node_tree.links.remove(link)
principled.inputs['Base Color'].default_value=(.57,.305,.215,1)
principled.inputs['Roughness'].default_value=.8
principled.inputs['Specular IOR Level'].default_value=.22
hairmat=material('Hair',ASSETS/'hair/short02/short02_diffuse.png',.82,True)
eyemat=material('Eyes',MH/'eyes/materials/brown_eye.png',.25)
browmat=material('Eyebrows',ASSETS/'eyebrows/eyebrow005/eyebrow005.png',.7,True)
def mesh_obj(name,verts,uvs,fs,ufs,mat,subdiv=0):
    used=sorted({i for f in fs for i in f});remap={v:i for i,v in enumerate(used)}
    mesh=bpy.data.meshes.new(name);mesh.from_pydata([conform(verts[i]) for i in used],[],[[remap[i]for i in f]for f in fs]);mesh.update()
    layer=mesh.uv_layers.new(name='UVMap')
    for poly,tf in zip(mesh.polygons,ufs):
        poly.use_smooth=True
        for li,ui in zip(poly.loop_indices,tf):layer.data[li].uv=uvs[ui]
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    if subdiv:
        bpy.context.view_layer.objects.active=ob;ob.select_set(True);mod=ob.modifiers.new('Smooth silhouette','SUBSURF');mod.levels=subdiv;bpy.ops.object.modifier_apply(modifier=mod.name);ob.select_set(False)
    return ob
body=mesh_obj('Male skin',base,uv,[f for f,g in zip(faces,groups)if g=='body'],[f for f,g in zip(uvfaces,groups)if g=='body'],skinmat,1)
def fitted_asset(folder,name,mat,subdiv=0):
    verts,uvs,fs,ufs,_=read_obj(folder/(name+'.obj'));lines=(folder/(name+'.mhclo')).read_text().splitlines();fitting=False;out=[];scales=[1,1,1]
    for line in lines:
        t=line.split()
        if not t or t[0].startswith('#'):continue
        if t[0]in ['x_scale','y_scale','z_scale']:
            axis={'x_scale':0,'y_scale':1,'z_scale':2}[t[0]];scales[axis]=abs(base[int(t[1])][axis]-base[int(t[2])][axis])/float(t[3])
        if t[0]=='verts':fitting=True;continue
        if fitting:
            if not t[0].lstrip('-').isdigit():
                if t[0] in ['material','name','tag']:continue
                break
            if len(t)==1:out.append(base[int(t[0])].copy())
            elif len(t)==9:
                v=sum((base[int(t[i])]*float(t[i+3]) for i in range(3)),Vector());v+=Vector(float(t[6+i])*scales[i] for i in range(3));out.append(v)
    if name=='high-poly':
        # The source has an outer cornea patch mapped to the atlas's transparent swatch.
        # Omit that shell for the portable PBR eye instead of rendering it opaque.
        keep=[i for i,face in enumerate(ufs) if not all(uvs[u][0]>.85 and uvs[u][1]<.16 for u in face)]
        fs=[fs[i] for i in keep];ufs=[ufs[i] for i in keep]
    assert len(out)==len(verts),(name,len(out),len(verts))
    return mesh_obj(name,out,uvs,fs,ufs,mat,subdiv)
fitted_asset(MH/'eyes/high-poly','high-poly',eyemat,1)
# Volumetric, sculpted locks replace the photographic hair cards.
exec((ROOT/'scripts/cinematic-hair.py').read_text(),globals())
fitted_asset(ASSETS/'eyebrows/eyebrow005','eyebrow005',browmat)
# Batch the sculpted hair by material to keep the skin layer inexpensive to draw.
for mat in [hair_base,hair_light,brow_solid]:
    obs=[o for o in bpy.context.scene.objects if o.type=='MESH' and len(o.data.materials)==1 and o.data.materials[0]==mat]
    if len(obs)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in obs:o.select_set(True)
        bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join()
        obs[0].name=mat.name
for landmark in ['joint-l-upper-leg','joint-l-knee','joint-l-ankle','joint-mouth']:
    print('FITTED_LANDMARK',landmark,list(conform(joint(landmark))))
# Export in the common anatomical coordinate frame.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/skin-web.glb'),export_format='GLB',use_selection=True,export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=6,export_image_format='AUTO')
print('SKIN_EXPORT_COMPLETE',sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type=='MESH'))
# An offline asset render is for checking the fitted geometry, not a browser screenshot.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.world.color=(.055,.065,.085);scene.render.resolution_x=800;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
def aim(obj,point):obj.rotation_euler=(Vector(point)-obj.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(.8,-3.7,1.25));camera=bpy.context.object;aim(camera,(0,0,.9));camera.data.type='ORTHO';camera.data.ortho_scale=1.95;scene.camera=camera
for loc,power,size in [((2,-3,3),180,3),((-2,-1,2),90,2),((0,2,2),170,2)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;aim(light,(0,0,1))
scene.render.filepath='/tmp/soma-skin-full.png';bpy.ops.render.render(write_still=True)
camera.location=(.13,-1.1,1.64);aim(camera,(0,0,1.61));camera.data.ortho_scale=.40;scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.filepath='/tmp/soma-skin-face.png';bpy.ops.render.render(write_still=True)
