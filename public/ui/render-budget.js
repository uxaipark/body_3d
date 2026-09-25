// Shared render-only budget. Acquisition and physiological clocks stay outside.
export const renderPresets={low:{dpr:.85,fps:30},balanced:{dpr:1.15,fps:60},high:{dpr:1.5,fps:60}};
export class RenderBudget {
 constructor(){this.reset();}
 reset(){this.last=0;this.window=0;this.frames=0;this.samples=0;this.slow=0;}
 frame(now,tier,choice,active=true,hidden=false){
  if(hidden||!active){this.window=now;this.frames=0;this.slow=0;if(hidden){this.last=0;return {draw:false,lower:false}}}
  if(now-this.last<1000/renderPresets[tier].fps-1)return {draw:false,lower:false};
  this.last=now;if(!this.window)this.window=now;this.frames++;
  let lower=false;
  if(active&&now-this.window>=1000){const fps=this.frames*1000/(now-this.window);this.samples++;this.slow=fps<42?this.slow+1:0;lower=choice==='auto'&&tier!=='low'&&this.samples>3&&this.slow>=3;this.window=now;this.frames=0;}
  return {draw:true,lower};
 }
}
