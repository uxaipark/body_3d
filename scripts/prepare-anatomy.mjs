import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {simplify,prune,draco} from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import {MeshoptSimplifier} from 'meshoptimizer';
import fs from 'node:fs';
await MeshoptSimplifier.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'draco3d.decoder':await draco3d.createDecoderModule(),'draco3d.encoder':await draco3d.createEncoderModule()});
for(const name of ['skeleton','visceral','cardiovascular','nervous','muscular']){
 fs.mkdirSync('.asset-cache',{recursive:true});
 const source=`.asset-cache/${name}.glb`;
 if(!fs.existsSync(source)){const response=await fetch(`https://raw.githubusercontent.com/Liyucheng1997/242_lab-human-anatomy/main/public/models/${name}.glb`);if(!response.ok)throw new Error(`Download failed: ${response.status}`);fs.writeFileSync(source,new Uint8Array(await response.arrayBuffer()));}
 const doc=await io.read(source);
 // Remove atlas labels and helper planes; preserve anatomical structures and names.
 for(const n of [...doc.getRoot().listNodes()])if(/\.g\.\d+$/.test(n.getName()))n.dispose();
 await doc.transform(prune(),simplify({simplifier:MeshoptSimplifier,ratio:.16,error:.002}),draco());
 await io.write(`public/models/${name}-web.glb`,doc);
 let tri=0;for(const m of doc.getRoot().listMeshes())for(const p of m.listPrimitives())tri+=(p.getIndices()?.getCount()||0)/3;
 console.log(name,Math.round(tri),'triangles',fs.statSync(`public/models/${name}-web.glb`).size,'bytes');
}
