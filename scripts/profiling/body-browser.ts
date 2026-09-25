// Standalone measurement of the production AnatomyScene, without React panels.
import {AnatomyScene,initialLayers} from '../../lib/anatomy';
import {defaults} from '../../lib/physiology';
import {NerveSkinGuard} from '../../lib/skin-boundary';
import * as T from 'three';
import {surfaceTissueWeight} from '../../lib/rig';
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
if(scene.nerveCache){
 const skin=scene.meshes.find(m=>m.userData.layer==='skin')!.geometry,p=skin.getAttribute('position'),ix=skin.getAttribute('rigIndex'),w=skin.getAttribute('rigWeight'),pixel=new Float32Array(4);let maxError=0;
 for(const pose of ['rest','wave','dance']){if(pose==='rest')scene.rig.reset();else scene.rig.poseExpression(pose as 'wave'|'dance',3.2);scene.softBody.update(.02,1,800);scene.nerveCache.update(scene.renderer);
 for(let i=0;i<p.count;i+=997){const point=new T.Vector3().fromBufferAttribute(p,i),weights={indices:[0,1,2,3].map(j=>ix.getComponent(i,j)),weights:[0,1,2,3].map(j=>w.getComponent(i,j))};point.addScaledVector(scene.softBody.sample(point),surfaceTissueWeight(weights));const expected=scene.rig.transform(point,weights);scene.renderer.readRenderTargetPixels(scene.nerveCache.target,i%512,Math.floor(i/512),1,1,pixel);maxError=Math.max(maxError,expected.distanceTo(new T.Vector3().fromArray(pixel)))}
 }scene.rig.reset();
 results.cachePositionError=maxError;if(maxError>.00002)throw Error('GPU nerve pose cache differs from CPU pose: '+maxError);
}
results.geometry=Object.fromEntries([...scene.groups].map(([layer,group])=>{let vertices=0,triangles=0,bytes=0;group.traverse((o:any)=>{if(!o.geometry)return;const g=o.geometry;vertices+=g.attributes.position.count;triangles+=(g.index?.count||g.attributes.position.count)/3;bytes+=Object.values(g.attributes).reduce((s:number,a:any)=>s+a.array.byteLength,0)+(g.index?.array.byteLength||0)});return [layer,{vertices,triangles,bytes,meshes:group.children.length}]}));
const timings:any={};let recording=false;
const timer=gl.getExtension('EXT_disjoint_timer_query_webgl2');results.gpuTimerAvailable=Boolean(timer);
const pendingQueries:any[]=[];
for(const [label,obj,key] of [['physics',scene.softBody,'update'],['rig',scene.rig,'update'],['copyPose',scene.skinRig,'copyPose'],['renderSubmit',scene.renderer,'render']] as const){const target:any=obj;const original=target[key].bind(obj);target[key]=(...args:any[])=>{const t=performance.now();const out=original(...args);if(recording)(timings[label]??=[]).push(performance.now()-t);return out}}
if(timer){const render=scene.renderer.render.bind(scene.renderer);let active:WebGLQuery|null=null;scene.renderer.render=(...args)=>{
 while(pendingQueries.length&&gl.getQueryParameter(pendingQueries[0].q,gl.QUERY_RESULT_AVAILABLE)){const {q,bucket}=pendingQueries.shift();if(!gl.getParameter(timer.GPU_DISJOINT_EXT))bucket.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q)}
 if(recording&&!active){active=gl.createQuery();gl.beginQuery(timer.TIME_ELAPSED_EXT,active)}render(...args);if(active&&args[0]===scene.scene){gl.endQuery(timer.TIME_ELAPSED_EXT);pendingQueries.push({q:active,bucket:timings.gpuMs??=[]});active=null}
}}
const summary=(a:number[])=>{a.sort((x,y)=>x-y);return {n:a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)]}};
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
(window as any).profileBody=async(label:string,options:any={})=>{
 scene.setQuality(options.quality||'balanced');scene.setNerveCacheEnabled(options.cache!==false);scene.setLayers({...initialLayers,...options.layers});scene.params.motion=options.motion||'walk';scene.running=!options.paused;scene.renderer.setPixelRatio(options.dpr||1.5);scene.resize();scene.updateLod();
 await delay(1800);for(const key of Object.keys(timings))timings[key]=[];
 const intervals:number[]=[];let prev=0,stop=false;const initialFrame=scene.renderer.info.render.frame;const tick=(t:number)=>{if(prev)intervals.push(t-prev);prev=t;if(!stop)requestAnimationFrame(tick)};recording=true;requestAnimationFrame(tick);await delay(3500);stop=true;recording=false;
 const row={label,dpr:scene.renderer.getPixelRatio(),frame:summary(intervals),renderCallsDuringSample:scene.renderer.info.render.frame-initialFrame,cpu:Object.fromEntries(Object.entries(timings).map(([k,a])=>[k,summary(a as number[])])),render:{...scene.renderer.info.render}};results.cases.push(row);return row;
};
(window as any).profileResults=results;
(window as any).anatomyScene=scene;
