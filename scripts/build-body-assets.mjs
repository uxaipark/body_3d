import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['scripts/profiling/body-profile.mjs'],{stdio:'inherit',env:{...process.env,BAKE_ASSETS:'1'}});process.exit(result.status??1);
