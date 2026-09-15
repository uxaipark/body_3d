'use client';
import {createContext, useContext, createElement, Fragment, isValidElement, cloneElement, type ReactNode, type ElementType, type ReactElement} from 'react';
import {t, languageCookie} from '../public/i18n/locale.js';

export type Language = 'ko'|'en';
const LanguageContext = createContext<Language>('ko');
export function LanguageProvider({language, children}:{language:Language;children:ReactNode}) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}
export const useLanguage = () => useContext(LanguageContext);
function childrenInLanguage(children:ReactNode, language:Language):ReactNode {
  if(typeof children==='string')return t(children,language);
  if(Array.isArray(children))return children.map(child=>childrenInLanguage(child,language));
  if(isValidElement(children)&&children.type===Fragment){const child=children as ReactElement<{children:ReactNode}>;return cloneElement(child,{},childrenInLanguage(child.props.children,language));}
  return children;
}
// Translate presentation props only. Model values, IDs, URLs, classes, and
// event handlers pass through unchanged; React remains the owner of its DOM.
export function L({as,children,...props}:{as:ElementType;children?:ReactNode;[key:string]:any}) {
  const language=useLanguage();
  const localized={...props};
  for(const key of ['title','aria-label','placeholder','alt','label'])if(typeof localized[key]==='string')localized[key]=t(localized[key],language);
  return createElement(as,localized,childrenInLanguage(children,language));
}
export function LanguageSwitch(){
  const language=useLanguage();
  return <div className="language-switch" role="group" aria-label={language==='ko'?'언어 선택':'Choose language'}>{(['ko','en'] as const).map(code=><button key={code} type="button" lang={code} title={language==='ko'?'언어를 바꾸면 페이지를 다시 불러옵니다':'Changing language reloads this page'} aria-pressed={language===code} onClick={()=>{
    if(code===language)return;
    document.cookie=`${languageCookie}=${code}; Path=/; Max-Age=31536000; SameSite=Lax`;
    try{localStorage.setItem('soma.language',code);}catch{}
    const url=new URL(window.location.href);url.searchParams.delete('lang');
    window.location.assign(url.href);
  }}>{code==='ko'?'한국어':'EN'}</button>)}</div>;
}
