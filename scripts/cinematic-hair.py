"""Sculpted side-part hairstyle; executed in build-skin.py's Blender context.
The volumetric tapered locks are original geometry, in the anatomical frame.
"""
from mathutils.bvhtree import BVHTree

def solid_material(name,color,roughness):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness;p.inputs['Specular IOR Level'].default_value=.32
    return m
hair_base=solid_material('Cinematic midnight hair',(.012,.009,.025),.54)
hair_light=solid_material('Cinematic hair sheen',(.026,.018,.049),.55)
brow_solid=solid_material('Cinematic eye contours',(.024,.012,.020),.8)
lip_solid=solid_material('Cinematic lips',(.40,.105,.10),.6)
# Keep only the crown of the hair helper: its full mesh extends to the chest.
cap_faces=[i for i,(f,g) in enumerate(zip(faces,groups)) if g=='helper-hair' and all(conform(base[v]).z>1.676 for v in f)]
scalp=mesh_obj('Cinematic hair cap',base,uv,[faces[i] for i in cap_faces],[uvfaces[i] for i in cap_faces],hair_base,1)
for v in scalp.data.vertices:
    center=Vector((0,.005,1.655));d=v.co-center
    v.co=center+Vector((d.x*1.035,d.y*1.035,d.z*1.02))

# Four Bézier points per lock. Coordinates use the app's X / height / forward convention.
def lock(name,pts,width,depth,mat=hair_base):
    pts=[Vector((x,-z,y))for x,y,z in pts];verts=[];faces=[];N=32;R=10
    for i in range(N+1):
        t=i/N;u=1-t
        p=u**3*pts[0]+3*u*u*t*pts[1]+3*u*t*t*pts[2]+t**3*pts[3]
        tangent=(3*u*u*(pts[1]-pts[0])+6*u*t*(pts[2]-pts[1])+3*t*t*(pts[3]-pts[2])).normalized()
        widthdir=tangent.cross(Vector((0,-1,0)))
        if widthdir.length<.001:widthdir=Vector((1,0,0))
        widthdir.normalize();depthdir=tangent.cross(widthdir).normalized()
        taper=(.30+.70*math.sin(math.pi*t)**.45)*(1-t**3)*.98+.018
        for j in range(R):
            a=j*2*math.pi/R;verts.append(p+widthdir*math.cos(a)*width*taper+depthdir*math.sin(a)*depth*taper)
    for i in range(N):
        for j in range(R):a=i*R+j;b=i*R+(j+1)%R;faces.append((a,b,b+R,a+R))
    faces.append(tuple(reversed(range(R))));faces.append(tuple(N*R+j for j in range(R)))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    for p in mesh.polygons:p.use_smooth=True
    return ob

# Raised asymmetrical part and swept, pointed fringe; both eyes remain visible.
paths=[
 ([(.020,1.735,-.015),(-.020,1.790,.025),(-.072,1.737,.105),(-.074,1.641,.080)],.029,.012),
 ([(.027,1.745,-.020),(-.013,1.780,.068),(-.048,1.701,.126),(-.051,1.651,.097)],.026,.012),
 ([(.036,1.749,-.025),(.020,1.776,.075),(-.006,1.698,.128),(-.018,1.665,.113)],.025,.011),
 ([(.040,1.744,-.035),(.076,1.758,.015),(.075,1.700,.106),(.046,1.664,.114)],.026,.012),
 ([(.042,1.742,-.052),(.092,1.740,-.002),(.085,1.668,.069),(.071,1.629,.038)],.024,.010),
 ([(.032,1.730,-.069),(.081,1.733,-.045),(.096,1.658,-.005),(.074,1.604,-.022)],.026,.009),
 ([(-.007,1.739,-.055),(-.067,1.768,-.037),(-.092,1.668,.023),(-.074,1.611,.006)],.027,.010),
 ([(-.015,1.743,-.061),(-.086,1.722,-.068),(-.081,1.656,-.071),(-.063,1.600,-.065)],.025,.010),
]
for i,(points,width,depth)in enumerate(paths):
    lock('Cinematic hair lock %02d'%i,points,width,depth,hair_light if i in [1,4] else hair_base)
    # A narrow surface ridge makes the locks read as hair, not smooth tubes.
    ridge=[(x,y+.001,z+.007)for x,y,z in points]
    lock('Cinematic hair ridge %02d'%i,ridge,width*.07,depth*.14,hair_light)

# Surface-hugging facial definition, cast onto the actual fitted face.
bvh=BVHTree.FromObject(body,bpy.context.evaluated_depsgraph_get())
def surface_curve(name,points,radius,mat):
    fitted=[]
    for x,h in points:
        hit,normal,_,_=bvh.ray_cast(Vector((x,-.6,h)),Vector((0,1,0)))
        if hit is not None:fitted.append(hit+Vector((0,-.0006,0)))
    if len(fitted)<2:return
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.resolution_u=12;curve.bevel_depth=radius;curve.bevel_resolution=2
    spline=curve.splines.new('BEZIER');spline.bezier_points.add(len(fitted)-1)
    for i,(p,v) in enumerate(zip(spline.bezier_points,fitted)):
        p.co=v;p.handle_left_type='AUTO';p.handle_right_type='AUTO';p.radius=.35+.65*math.sin(math.pi*i/(len(fitted)-1))
    ob=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(ob);ob.data.materials.append(mat)
    bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.convert(target='MESH');ob.select_set(False)

# Print landmarks so asset QA can check eye geometry after any future morph change.
for side in ['l','r']:
    c=conform(joint('joint-'+side+'-eye'));print('CINEMATIC_EYE',side,list(c))
    s=1 if c.x>0 else -1
    surface_curve('Cinematic upper lid '+side,[(c.x-s*.018,c.z+.002),(c.x-s*.008,c.z+.006),(c.x+s*.006,c.z+.0065),(c.x+s*.019,c.z+.0035)],.0008,brow_solid)
