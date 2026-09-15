import test from 'node:test';
import assert from 'node:assert/strict';
import {wrapCanvasText,chartCaption,chartLegend} from '../public/i18n/chart-layout.js';
const ctx={measureText:text=>({width:[...text].reduce((n,c)=>n+(/[가-힣]/.test(c)?12:c===' '?4:7),0)})};
test('canvas labels wrap translated English and long tokens inside their measured bounds',()=>{
 for(const width of [120,172,280,420])for(const text of ['Radial artery · Below the skin','TOP · 2 mm grid / 0.25 mm contours / 1 mm major contours','Epidermis · Basal layer','광학 시뮬레이션 피부 단면','veryLongUnbrokenLabelWithoutAnySpaces']){
  const lines=wrapCanvasText(ctx,text,width);assert.equal(lines.join('').replaceAll(' ',''),text.replaceAll(' ',''));
  lines.forEach(line=>assert.ok(ctx.measureText(line).width<=width));
 }
});
function element(){return {textContent:'',className:'',style:{setProperty(){}},nodes:[],classList:{contains(){return false;}},insertAdjacentElement(where,node){this.nodes.push({where,node});},replaceChildren(...nodes){this.nodes=nodes;}};}
test('English legends use complete translated labels in reusable flow nodes, Korean keeps its canvas',()=>{
 const prior=globalThis.document;try{
  globalThis.document={cookie:'soma_language=en',createElement:element};
  const canvas=element();canvas.ownerDocument=document;canvas.parentElement=element();
  const traces=[{name:'요골동맥',color:'#f00'},{name:'시뮬레이터 진값 요골동맥 맥파',color:'#fff'}];
  assert.equal(chartLegend(canvas,traces),true);assert.equal(canvas._localizedLegend.nodes[0].textContent,'Radial artery');
  const node=canvas._localizedLegend,children=node.nodes;chartLegend(canvas,traces);assert.equal(node.nodes,children);
  assert.equal(chartCaption(canvas,'detail','행 간격 3.5 mm · 샘플 주기 1.00 ms'),true);
  const caption=canvas._localizedCaptions.get('detail');assert.match(caption.textContent,/3\.5 mm/);assert.match(caption.textContent,/1\.00 ms/);assert.ok(!/[가-힣]/.test(caption.textContent));
  chartCaption(canvas,'detail','행 간격 6.0 mm · 샘플 주기 0.50 ms');assert.equal(canvas._localizedCaptions.get('detail'),caption);assert.match(caption.textContent,/0\.50 ms/);
  document.cookie='soma_language=ko';assert.equal(chartLegend(canvas,traces),false);assert.equal(chartCaption(canvas,'detail','문구'),false);
 }finally{if(prior===undefined)delete globalThis.document;else globalThis.document=prior;}
});
