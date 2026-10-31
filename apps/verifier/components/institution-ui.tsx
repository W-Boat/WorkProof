import type {HTMLAttributes,InputHTMLAttributes,ReactNode} from 'react';
// Thin React adapters for the institution's Vue primitives. Classes and styling have one source.
// Vue SFCs are not imported into React; their shared CSS is imported unchanged in globals.css.
export function Panel({title,meta,tools,children,className='',...props}:Omit<HTMLAttributes<HTMLElement>,'title'>&{title?:string;meta?:string;tools?:ReactNode}){
  return <section {...props} aria-label={props['aria-label']||title} className={`panel m-surface ${className}`}>
    {(title||tools)&&<header className="panel-head"><div><h2 className="section-label">{title}</h2>{meta&&<span className="panel-meta">{meta}</span>}</div>{tools&&<div className="panel-tools">{tools}</div>}</header>}
    <div className="panel-body">{children}</div>
  </section>;
}
export function PageHeader({title,desc,children}:{title:string;desc:string;children?:ReactNode}){
  return <header className="page-head"><div className="page-head-main"><h1 className="page-title">{title}</h1><p className="page-desc">{desc}</p></div>{children&&<div className="page-head-side"><div className="page-actions">{children}</div></div>}</header>;
}
export function Tag({tone='neutral',children}:{tone?:'ok'|'info'|'danger'|'neutral';children:ReactNode}){
  return <span className={`tag tone-${tone}`}>{children}</span>;
}
export function TextInput(props:InputHTMLAttributes<HTMLInputElement>){return <span className={`input-shell ${props.disabled?'is-disabled':''}`}><input {...props}/></span>;}
export function EmptyState({title,desc,icon}:{title:string;desc:string;icon:ReactNode}){
  return <div className="empty"><span className="empty-ico m-groove">{icon}</span><h2 className="empty-title">{title}</h2><p>{desc}</p></div>;
}
