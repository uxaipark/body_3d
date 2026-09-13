import {build} from 'vite';
await build({configFile:false,publicDir:false,build:{outDir:'public/simulators/radial/bridge',emptyOutDir:true,lib:{entry:'lib/wrist/soma-bridge.ts',formats:['es'],fileName:'soma-bridge'},minify:true,rollupOptions:{output:{entryFileNames:'soma-bridge.js'}}}});
