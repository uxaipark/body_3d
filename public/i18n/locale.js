import {english} from './messages.js';
export const languageCookie='soma_language';
/** @param {unknown} value @returns {'ko'|'en'} */
export function normalizeLanguage(value){return value==='en'?'en':'ko';}
/** @returns {'ko'|'en'} */
export function getLanguage(){
 if(typeof document==='undefined')return 'ko';
 const query=new URLSearchParams(globalThis.location?.search||'').get('lang');
 if(query==='en'||query==='ko')return query;
 return normalizeLanguage(document.cookie.match(/(?:^|;\s*)soma_language=(ko|en)(?:;|$)/)?.[1]);
}
const dictionary=/** @type {Record<string,string>} */(english);
/** @param {string} text @param {'ko'|'en'} [language] */
export function t(text,language=getLanguage()){
 if(typeof text!=='string'||language==='ko'||!/[가-힣]/.test(text))return text;
 const key=text.replace(/\s+/g,' ').trim();
 if(dictionary[key])return text.replace(text.trim(),dictionary[key]);
 // Dynamic readouts combine stable labels with numeric values. Translate the
 // labels without touching acquisition values, IDs, units, or file formats.
 return text.replace(/[가-힣][가-힣· →↔/()\s-]*[가-힣]|[가-힣]+/g,part=>dictionary[part.trim()]?part.replace(part.trim(),dictionary[part.trim()]):part);
}
/** Translate an explicitly supplied vanilla-engine UI fragment, never the React tree. */
export function localizeDOM(root,language=getLanguage()){
 if(language==='ko')return;
 const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){
  if(node.parentElement?.closest('script,style,textarea,[data-no-translate]'))continue;
  node.textContent=t(node.textContent||'',language);
 }
 const elements=root.querySelectorAll?.('*')||[];
 for(const el of elements)for(const attr of ['title','aria-label','placeholder','alt'])if(el.hasAttribute(attr))el.setAttribute(attr,t(el.getAttribute(attr),language));
}
/** @param {string} markup */
export function html(markup){
 if(getLanguage()==='ko'||typeof document==='undefined')return markup;
 const template=document.createElement('template');template.innerHTML=markup;localizeDOM(template.content);return template.innerHTML;
}
