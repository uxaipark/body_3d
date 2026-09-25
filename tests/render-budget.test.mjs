import test from 'node:test';import assert from 'node:assert/strict';
import {RenderBudget,renderPresets} from '../public/ui/render-budget.js';
test('all simulators share the same render caps without changing signal sampling',()=>{
 for(const tier of ['low','balanced','high']){const b=new RenderBudget();let frames=0;for(let i=1;i<=600;i++)frames+=b.frame(i*1000/60,tier,tier).draw?1:0;assert.equal(frames,tier==='low'?300:600);}
 assert.deepEqual(renderPresets.low,{dpr:.85,fps:30});
});
test('only automatic mode downgrades after sustained slow rendering',()=>{
 for(const choice of ['auto','balanced','high']){const b=new RenderBudget();let lower=false;for(let i=1;i<=120;i++)lower||=b.frame(i*50,'balanced',choice).lower;assert.equal(lower,choice==='auto');}
});
test('paused and hidden time do not trigger automatic downgrade',()=>{
 const b=new RenderBudget();for(let i=1;i<=200;i++){assert.equal(b.frame(i*100,'balanced','auto',false).lower,false);assert.deepEqual(b.frame(i*100,'balanced','auto',true,true),{draw:false,lower:false});}
 b.reset();for(let i=1;i<=180;i++)assert.equal(b.frame(i*1000/60,'balanced','auto').lower,false);
});
