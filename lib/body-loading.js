/** Keep skin first: nerve and patch binding depend on its attributes. */
export function bodyLoadParts(parts, profile='full') {
 return parts.filter(p=>profile!=='sleep'||p.layer!=='nervous');
}
/** Bound compressed-buffer memory as well as concurrent requests. Decode at the
 * consumer, in manifest order, instead of allocating all GPU meshes at once. */
export async function* orderedBatches(items, load, signal, concurrency=4) {
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('Invalid concurrency');
 const controller=new AbortController();
 const abort=()=>controller.abort(signal.reason);
 signal.addEventListener('abort',abort,{once:true});
 if(signal.aborted)abort();
 try {
  for(let i=0;i<items.length;i+=concurrency){
   controller.signal.throwIfAborted();
   const batch=items.slice(i,i+concurrency);
   const values=await Promise.all(batch.map(item=>load(item,controller.signal)));
   for(let j=0;j<batch.length;j++){
    controller.signal.throwIfAborted();
    const value=values[j];values[j]=null;
    yield {item:batch[j],value};
   }
  }
 }finally{controller.abort();signal.removeEventListener('abort',abort);}
}
