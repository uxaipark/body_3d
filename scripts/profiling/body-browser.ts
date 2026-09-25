// Standalone measurement of the production AnatomyScene, without React panels.
import {AnatomyScene,initialLayers} from '../../lib/anatomy';
import {defaults} from '../../lib/physiology';
import {NerveSkinGuard} from '../../lib/skin-boundary';
const results:any={load:[],cases:[],nerveBindingMs:0};
const bind=NerveSkinGuard.prototype.bind;
NerveSkinGuard.prototype.bind=function(...args){const t=performance.now();try{return bind.apply(this,args)}finally{results.nerveBindingMs+=performance.now()-t}};
const host=document.createElement('div');host.style.cssText='width:1000px;height:850px';document.body.appendChild(host);
const noop=()=>{};
const scene=new AnatomyScene(host,{...defaults},{...initialLayers},{stats:noop,pick:noop,time:noop,site:noop,skin:noop});
// Disable only the automatic DPR drop so comparisons use a fixed resolution.
scene.onStats=()=>{scene.slowFrames=0};
const gl=scene.renderer.getContext() as WebGL2RenderingContext,debug=gl.getExtension('WEBGL_debug_renderer_info');
results.gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
const start=performance.now();let last=start;
await scene.load(progress=>{const now=performance.now();results.load.push({progress,ms:now-last});last=now});
results.loadMs=performance.now()-start;
results.geometry=Object.fromEntries([...scene.groups].map(([layer,group])=>{let vertices=0,triangles=0,bytes=0;group.traverse((o:any)=>{if(!o.geometry)return;const g=o.geometry;vertices+=g.attributes.position.count;triangles+=(g.index?.count||g.attributes.position.count)/3;bytes+=Object.values(g.attributes).reduce((s:number,a:any)=>s+a.array.byteLength,0)+(g.index?.array.byteLength||0)});return [layer,{vertices,triangles,bytes,meshes:group.children.length}]}));
const timings:any={};let recording=false;
const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');results.gpuTimerAvailable=Boolean(timer);
const pendingQueries:any[]=[];
for(const [label,obj,key] of [['physics',scene.softBody,'update'],['rig',scene.rig,'update'],['copyPose',scene.skinRig,'copyPose'],['renderSubmit',scene.renderer,'render']] as const){const target:any=obj;const original=target[key].bind(obj);target[key]=(...args:any[])=>{const t=performance.now();const out=original(...args);if(recording)(timings[label]??=[]).push(performance.now()-t);return out}}
if(timer){const render=scene.renderer.render.bind(scene.renderer);scene.renderer.render=(...args)=>{
 while(pendingQueries.length&&gl.getQueryParameter(pendingQueries[0].q,gl.QUERY_RESULT_AVAILABLE)){const {q,bucket}=pendingQueries.shift();if(!gl.getParameter(timer.GPU_DISJOINT_EXT))bucket.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}
 const q=recording?gl.createQuery():null;if(q)gl.beginQuery(timer.TIME_ELAPSED_EXT,q);render(...args);if(q){gl.endQuery(timer.TIME_ELAPSED_EXT);pendingQueries.push({q,bucket:timings.gpuMs??=[]})}
}}
const summary=(a:number[])=>{a.sort((x,y)=>x-y);return {n:a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]}};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
(window as any).profileBody=async(label:string,options:any={})=>{
 scene.setLayers({...initialLayers,...options.layers});scene.params.motion=options.motion||'walk';scene.running=!options.paused;scene.renderer.setPixelRatio(options.dpr||1.5);scene.resize();
 await delay(1800);for(const key of Object.keys(timings))timings[key]=[];
 const intervals:number[]=[];let prev=0,stop=false;const tick=(t:number)=>{if(prev)intervals.push(t-prev);prev=t;if(!stop)requestAnimationFrame(tick)};recording=true;requestAnimationFrame(tick);await delay(3500);stop=true;recording=false;
 const row={label,dpr:scene.renderer.getPixelRatio(),frame:summary(intervals),cpu:Object.fromEntries(Object.entries(timings).map(([k,a])=>[k,summary(a as number[])])),render:{...scene.renderer.info.render}};results.cases.push(row);return row;
};
(window as any).profileResults=results;
(window as any).anatomyScene=scene;
