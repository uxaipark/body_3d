import {build} from 'vite';
import {writeFile} from 'node:fs/promises';
import {mocapData} from '../../lib/mocap-data.js';
import {NodeIO} from '@gltf-transform/core';
import {buildSkinWrap} from '../../public/simulators/radial/js/patchGeometry.js';
const atlas=await new NodeIO().read('public/models/wrist/atlas.glb');
const skin=atlas.getRoot().listMeshes().find(m=>m.getName()==='Atlas Skin').listPrimitives()[0];
const wrap=buildSkinWrap(skin.getAttribute('POSITION').getArray(),skin.getIndices()?.getArray());
await writeFile('public/simulators/radial/js/wristSurfaceData.js',`// Generated from the native wrist skin; shared by rendering and acquisition.\nexport const skinRings=${JSON.stringify(wrap.rings)};\n`);
// Publish only the capture timing to the signal worker; the full joint data
// stays in the existing SOMA renderer bundle.
await writeFile('public/simulators/radial/js/gaitTiming.js',
 `// Generated from SOMA mocap-data.js by build-bridge.mjs.\nexport const WALK_STRIDE_SECONDS = ${mocapData.walk.duration};\n`);
await build({configFile:false,publicDir:false,build:{outDir:'public/simulators/radial/bridge',emptyOutDir:true,lib:{entry:'lib/wrist/soma-bridge.ts',formats:['es'],fileName:'soma-bridge'},minify:true,rollupOptions:{output:{entryFileNames:'soma-bridge.js'}}}});
