import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {t,normalizeLanguage,getLanguage} from '../public/i18n/locale.js';
import {english} from '../public/i18n/messages.js';

test('locale defaults safely and isolates explicit server language from browser state',()=>{
 assert.equal(normalizeLanguage('en'),'en');
 for(const v of ['ko','fr','EN','',null,undefined])assert.equal(normalizeLanguage(v),'ko');
 assert.equal(getLanguage(),'ko');
 assert.equal(t('손목 센싱','en'),'Wrist Sensing');
 assert.equal(t('손목 센싱','ko'),'손목 센싱');
 assert.equal(t('  손목 센싱\n','en'),'  Wrist Sensing\n');
});
test('dynamic scientific readouts translate labels while preserving numeric data and units',()=>{
 for(const input of ['120 mmHg (유도)','중앙 변위 0.123 mm · 주변 변위 -0.012 mm · 내강 반경 1.102 mm','해부학 레이어 불러오는 중 · 35%','체형 유도(모델 가정): BMI 23 · 피하지방 2 mm · 동맥 깊이 4 mm']){
  const output=t(input,'en');
  assert.ok(!/[가-힣]/.test(output),output);
  assert.deepEqual(output.match(/-?\d+(?:\.\d+)?/g),input.match(/-?\d+(?:\.\d+)?/g));
  assert.equal(t(input,'ko'),input);
 }
 for(const input of ['radial_artery','CAP_01','ECG R → PPG foot','Δr = 0.018 mm; PWV 6 m/s','https://example.test/path'])assert.equal(t(input,'en'),input);
});
test('all public reader documents have UTF-8 English counterparts with matching scientific formulas',async()=>{
 const docs=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(new URL('../app/documents/content.json',import.meta.url))));
 assert.equal(docs.length,15);
 for(const d of docs){
  assert.ok(d.en.title && d.en.markdown.includes(d.en.title),d.slug);
  assert.ok(!/[가-힣]/.test(d.en.markdown.replaceAll('한국어','')),d.slug);
  assert.ok(!/\uFFFD|\/Users\/|\/home\/|appg(?:prj|ver|dep)_|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(d.en.markdown),d.slug);
 }
 const forward=docs.find(d=>d.slug==='04-forward-model');
 for(const formula of ['r0 × 133.322 × ΔP / (2 ρ PWV²)','1−exp(−Δt/τ)','11.15 pF/mm','1060 kg/m³'])assert.ok(forward.en.markdown.includes(formula),formula);
});
test('English catalog contains no replacement characters or unintended Korean translations',()=>{
 for(const [key,value] of Object.entries(english)){
  assert.equal(typeof value,'string',key);
  assert.ok(!/\uFFFD/.test(key+value),key);
  assert.ok(!/[가-힣]/.test(value.replaceAll('한국어','')),key);
 }
});
