'use client';
import {useLayoutEffect,useRef,type SelectHTMLAttributes} from 'react';
import {enhanceSelect} from '../public/ui/select.js';
type Props=Omit<SelectHTMLAttributes<HTMLSelectElement>,'children'|'multiple'|'size'> & {options:{value:string|number;label:string;disabled?:boolean}[]};
/** React owns values/options; the shared renderer owns only the custom popup. */
export function SomaSelect({options,className,...props}:Props){
 const select=useRef<HTMLSelectElement>(null),button=useRef<HTMLButtonElement>(null),api=useRef<ReturnType<typeof enhanceSelect>|null>(null);
 useLayoutEffect(()=>{if(select.current&&button.current)api.current=enhanceSelect(select.current,{trigger:button.current});return()=>{api.current?.destroy();api.current=null;};},[]);
 useLayoutEffect(()=>{api.current?.refresh();});
 const selected=options.find(o=>String(o.value)===String(props.value??props.defaultValue))??options[0];
 return <span className={`soma-select ${className||''}`}><select {...props} ref={select} hidden tabIndex={-1} aria-hidden="true">{options.map(o=><option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select><button ref={button} type="button" className="dd-btn soma-select-trigger" disabled={props.disabled} aria-label={props['aria-label']} aria-haspopup="listbox" aria-expanded={false}><span className="dd-label">{selected?.label}</span><span className="dd-caret" aria-hidden="true">⌄</span></button></span>;
}
