import type {ChangeEvent,HTMLAttributes,InputHTMLAttributes,ReactNode} from 'react';
import {FluentElement,useEmbeddedFluent} from './fluent-embedded';
// Thin React adapters for the institution's Vue primitives. Classes and styling have one source.
// Vue SFCs are not imported into React; their shared CSS is imported unchanged in globals.css.
export function Panel({title,meta,tools,children,className='',...props}:Omit<HTMLAttributes<HTMLElement>,'title'>&{title?:string;meta?:string;tools?:ReactNode}){
  const embedded=useEmbeddedFluent();
  return <section {...props} aria-label={props['aria-label']||title} className={`panel ${embedded?'fluent-panel':'m-surface'} ${className}`}>
    {(title||tools)&&<header className="panel-head"><div><h2 className="section-label">{title}</h2>{meta&&<span className="panel-meta">{meta}</span>}</div>{tools&&<div className="panel-tools">{tools}</div>}</header>}
    <div className="panel-body">{children}</div>
  </section>;
}
export function PageHeader({title,desc,children}:{title:string;desc:string;children?:ReactNode}){
  return <header className="page-head"><div className="page-head-main"><h1 className="page-title">{title}</h1><p className="page-desc">{desc}</p></div>{children&&<div className="page-head-side"><div className="page-actions">{children}</div></div>}</header>;
}
export function Tag({tone='neutral',children}:{tone?:'ok'|'info'|'danger'|'neutral';children:ReactNode}){
  const embedded=useEmbeddedFluent();
  if(embedded)return <FluentElement tag="fluent-badge" appearance="tint" color={tone==='ok'?'success':tone==='danger'?'danger':tone==='info'?'brand':'neutral'}>{children}</FluentElement>;
  return <span className={`tag tone-${tone}`}>{children}</span>;
}
export function TextInput({onChange,...props}:InputHTMLAttributes<HTMLInputElement>){
  const embedded=useEmbeddedFluent();
  if(embedded)return <FluentElement tag="fluent-text-input" {...props} onInput={(event:ChangeEvent<HTMLInputElement>)=>onChange?.(event)}/>;
  return <span className={`input-shell ${props.disabled?'is-disabled':''}`}><input {...props} onChange={onChange}/></span>;
}
export function Checkbox({checked,disabled,onChange,children}:{checked:boolean;disabled?:boolean;onChange:(checked:boolean)=>void;children:ReactNode}){
  const embedded=useEmbeddedFluent();
  if(embedded)return <FluentElement tag="fluent-checkbox" checked={checked} disabled={disabled} onChange={(event:ChangeEvent<HTMLInputElement>)=>onChange(event.target.checked)}>{children}</FluentElement>;
  return <label className="quiet-label"><input type="checkbox" checked={checked} disabled={disabled} onChange={event=>onChange(event.target.checked)}/>{children}</label>;
}
export function VerificationProgress({phase,progress}:{phase:string;progress:number}){
  const embedded=useEmbeddedFluent();
  if(embedded)return <div className="fluent-verification-progress" role="status"><span>{phase} · {progress}%</span><FluentElement tag="fluent-progress-bar" value={progress} max={100} aria-label="核验进度"/></div>;
  return <div className="progress" role="status"><span>{phase}</span><span>{progress}%</span><div><i style={{width:`${progress}%`}}/></div></div>;
}
export function EmptyState({title,desc,icon}:{title:string;desc:string;icon:ReactNode}){
  return <div className="empty"><span className="empty-ico m-groove">{icon}</span><h2 className="empty-title">{title}</h2><p>{desc}</p></div>;
}
