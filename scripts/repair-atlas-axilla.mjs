import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {draco,prune} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import * as T from 'three';
import {BONE_NAMES} from '../lib/rig.ts';
import {bindAxillarySkin} from '../lib/axillary-binding.ts';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco3d.createDecoderModule(),'draco3d.encoder':await draco3d.createEncoderModule()});
const file='public/models/skin-atlas-web.glb',doc=await io.read(process.env.SKIN_SOURCE||file),root=doc.getRoot();
if(root.getExtras().axillaryRepair===1){console.log('Axillary contact already repaired');process.exit(0)}
const primitive=root.listMeshes()[0].listPrimitives()[0],chunks=(a,n)=>Array.from({length:a.length/n},(_,i)=>Array.from(a.slice(i*n,(i+1)*n))),temp=await mkdtemp(join(tmpdir(),'soma-axilla-'));
try{
 const source=join(temp,'input.json'),destination=join(temp,'output.json');
 await writeFile(source,JSON.stringify({positions:chunks(primitive.getAttribute('POSITION').getArray(),3),faces:chunks(primitive.getIndices().getArray(),3),rigIndex:chunks(primitive.getAttribute('_RIG_INDEX').getArray(),4),rigWeight:chunks(primitive.getAttribute('_RIG_WEIGHT').getArray(),4),bones:BONE_NAMES}));
 execFileSync(process.env.BLENDER_PATH||'/Applications/Blender.app/Contents/MacOS/Blender',['--background','--python','scripts/repair-atlas-axilla.py','--',source,destination],{stdio:'inherit'});
 const result=JSON.parse(await readFile(destination,'utf8')),g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute(result.positions.flat(),3)).setIndex(result.faces.flat()).setAttribute('rigIndex',new T.Uint16BufferAttribute(result.rigIndex.flat(),4)).setAttribute('rigWeight',new T.Float32BufferAttribute(result.rigWeight.flat(),4));
 bindAxillarySkin(g);g.computeVertexNormals();const buffer=root.listBuffers()[0];
 for(const [name,key,type] of [['POSITION','position','VEC3'],['NORMAL','normal','VEC3'],['_RIG_INDEX','rigIndex','VEC4'],['_RIG_WEIGHT','rigWeight','VEC4']])primitive.setAttribute(name,doc.createAccessor().setType(type).setBuffer(buffer).setArray(g.getAttribute(key).array));
 primitive.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(g.index.array));root.setExtras({...root.getExtras(),axillaryRepair:1});
 await doc.transform(prune(),draco());await io.write(file,doc);console.log({vertices:g.attributes.position.count,triangles:g.index.count/3});
}finally{await rm(temp,{recursive:true,force:true})}
