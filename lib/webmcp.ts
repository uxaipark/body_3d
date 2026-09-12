import type {Parameters} from './physiology';
import {sites,metrics} from './physiology';
type Registry={registerTool:(tool:{name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown},options:{signal:AbortSignal})=>void|Promise<void>};
export function registerLabTools(read:()=>Parameters,write:(p:Parameters)=>void){
 const context=(document as unknown as {modelContext?:Registry}).modelContext;if(!context?.registerTool)return()=>{};
 const life=new AbortController();
 const definitions=[{name:'read_biosensing_experiment',description:'Read current virtual sensor parameters and synthetic propagation timings.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({parameters:read(),timing:metrics(read()),model:'synthetic-unvalidated'})},
 {name:'configure_biosensing_experiment',description:'Configure the visible synthetic experiment with heart rate, respiratory rate and PPG sensor site.',inputSchema:{type:'object',properties:{hr:{type:'number',minimum:40,maximum:180},rr:{type:'number',minimum:6,maximum:40},site:{type:'string',enum:Object.keys(sites)}},additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:async(input:unknown)=>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected an object');
 const patch=input as Record<string,unknown>;for(const [key,value]of Object.entries(patch)){if(!['hr','rr','site'].includes(key))throw new Error('Unsupported parameter');if(key==='site'&&(typeof value!=='string'||!Object.hasOwn(sites,value)))throw new Error('Invalid sensor site');if(key==='hr'&&(typeof value!=='number'||!Number.isFinite(value)||value<40||value>180))throw new Error('Heart rate must be 40–180');if(key==='rr'&&(typeof value!=='number'||!Number.isFinite(value)||value<6||value>40))throw new Error('Respiratory rate must be 6–40');}
 const next={...read(),...patch}as Parameters;write(next);await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));return{parameters:next,timing:metrics(next)};
 }}];
 for(const tool of definitions){try{Promise.resolve(context.registerTool(tool,{signal:life.signal})).catch(()=>{});}catch{/* Optional browser API; the lab remains usable. */}}
 return()=>life.abort();
}
