/** Offline, zero-phase smoothing of a cyclic [xyz, ...quaternion] capture.
 * Wrap the kernel across the seam; align quaternion hemispheres before averaging.
 * No runtime lag or extra work is added to the animation/render loop.
 */
export function smoothCapture(frames,duration,sigmaSeconds){
 const sigma=sigmaSeconds*frames.length/duration,radius=Math.ceil(3*sigma);
 const kernel=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)/sigma)**2));
 const total=kernel.reduce((a,b)=>a+b,0),count=frames.length;
 return frames.map((reference,i)=>{
  const out=reference.map(()=>0);
  for(let j=-radius;j<=radius;j++){
   const frame=frames[((i+j)%count+count)%count],weight=kernel[j+radius]/total;
   for(let k=0;k<3;k++)out[k]+=frame[k]*weight;
   for(let k=3;k<frame.length;k+=4){
    let dot=0;for(let c=0;c<4;c++)dot+=reference[k+c]*frame[k+c];
    for(let c=0;c<4;c++)out[k+c]+=frame[k+c]*weight*(dot<0?-1:1);
   }
  }
  for(let k=3;k<out.length;k+=4){const length=Math.hypot(...out.slice(k,k+4));for(let c=0;c<4;c++)out[k+c]/=length;}
  return out;
 });
}
