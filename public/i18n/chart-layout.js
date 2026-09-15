import {getLanguage,t} from './locale.js';

/** Wrap measured glyphs, including an unbroken identifier, without losing text. */
export function wrapCanvasText(ctx,text,maxWidth){
 const limit=Math.max(1,maxWidth),lines=[];let line='';
 for(const word of String(text).split(/\s+/).filter(Boolean)){
  if(line && ctx.measureText(line+' '+word).width<=limit){line+=' '+word;continue;}
  if(line){lines.push(line);line='';}
  for(const glyph of word){if(line && ctx.measureText(line+glyph).width>limit){lines.push(line);line='';}line+=glyph;}
 }
 if(line)lines.push(line);
 return lines;
}

// English descriptions occupy normal document flow, not fixed canvas pixels.
// Reuse nodes and update only changed strings, even when called on every frame.
export function chartCaption(canvas,key,text,{legend=false,color}={}){
 if(getLanguage()!=='en'||!canvas.ownerDocument||!canvas.parentElement)return false;
 const cache=canvas._localizedCaptions||(canvas._localizedCaptions=new Map());
 let node=cache.get(key);
 if(!node){
  node=canvas.ownerDocument.createElement('div');node.className=legend?'chart-legend-item':'chart-caption';
  const anchor=canvas.parentElement.classList.contains('viz-stack')?canvas.parentElement:canvas;
  anchor.insertAdjacentElement('afterend',node);cache.set(key,node);
 }
 const value=t(text);if(node.textContent!==value)node.textContent=value;
 if(color)node.style.setProperty('--trace-color',color);
 return true;
}

export function chartLegend(canvas,traces){
 if(getLanguage()!=='en'||!canvas.ownerDocument||!canvas.parentElement)return false;
 const signature=JSON.stringify(traces.map(({name,color})=>[t(name),color]));
 if(canvas._legendSignature===signature)return true;
 let node=canvas._localizedLegend;
 if(!node){node=canvas.ownerDocument.createElement('div');node.className='chart-legend';canvas.insertAdjacentElement('beforebegin',node);canvas._localizedLegend=node;}
 node.replaceChildren(...traces.map(({name,color})=>{const item=canvas.ownerDocument.createElement('span');item.className='chart-legend-item';item.style.setProperty('--trace-color',color);item.textContent=t(name);return item;}));
 canvas._legendSignature=signature;return true;
}
