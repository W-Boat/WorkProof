import {useEffect,useId,useRef,type ChangeEvent,type HTMLAttributes,type InputHTMLAttributes,type ReactNode} from 'react';
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
  const id=useId();
  if(embedded)return <FluentElement tag="fluent-field" label-position="after" className="fluent-checkbox-field">
    <label slot="label" id={id+'-label'} htmlFor={id}>{children}</label>
    <FluentElement tag="fluent-checkbox" slot="input" id={id} role="checkbox" aria-labelledby={id+'-label'} aria-checked={checked} aria-disabled={disabled} checked={checked} disabled={disabled} onChange={(event:Event)=>onChange((event.currentTarget as HTMLInputElement).checked)}/>
  </FluentElement>;
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

export function Details({label,className,children}:{label:string;className?:string;children:ReactNode}){
  const embedded=useEmbeddedFluent();
  if(!embedded)return <details className={className}><summary>{label}</summary>{children}</details>;
  return <FluentElement tag="fluent-accordion" className={className}>
    <FluentElement tag="fluent-accordion-item" heading-level={3}>
      <span slot="heading">{label}</span>
      <div className="fluent-disclosure-content">{children}</div>
    </FluentElement>
  </FluentElement>;
}

export function Select({label,value,options,onChange}:{label:string;value:string;options:{value:string;label:string;disabled?:boolean}[];onChange:(value:string)=>void}){
  const embedded=useEmbeddedFluent();
  const labelId=useId();
  const field=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const element=field.current;
    if(!element)return;
    // Fluent v3 inserts the button in the light DOM without copying the host label.
    const labelControl=()=>element.querySelector('[slot="control"]')?.setAttribute('aria-labelledby',labelId);
    const observer=new MutationObserver(labelControl);
    observer.observe(element,{childList:true,subtree:true});
    labelControl();
    return()=>observer.disconnect();
  },[embedded,labelId]);
  if(!embedded)return <select aria-label={label} value={value} onChange={event=>onChange(event.target.value)}>
    {options.map(option=><option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
  </select>;
  return <div className="fluent-field" ref={field}>
    <span id={labelId}>{label}</span>
    <FluentElement tag="fluent-dropdown" aria-labelledby={labelId} onChange={(event:Event)=>{
      const next=(event.currentTarget as HTMLElement&{value:string|null}).value;
      if(next!==null)onChange(next);
    }}>
      <FluentElement tag="fluent-listbox" role="listbox">
        {options.map(option=><FluentElement tag="fluent-option" role="option" key={option.value} value={option.value} aria-selected={option.value===value} aria-disabled={option.disabled} defaultSelected={option.value===value} disabled={option.disabled}>{option.label}</FluentElement>)}
      </FluentElement>
    </FluentElement>
  </div>;
}

export function Notice({intent,children}:{intent:'success'|'warning'|'error'|'info';children:ReactNode}){
  const embedded=useEmbeddedFluent();
  return embedded?<FluentElement tag="fluent-message-bar" intent={intent} layout="multiline">{children}</FluentElement>:children;
}

export function ResultNavigation({charts,timeline}:{charts:boolean;timeline:boolean}){
  if(!useEmbeddedFluent())return null;
  return <nav className="verification-result-navigation" aria-label="跳到报告章节">
    <FluentElement tag="fluent-anchor-button" appearance="subtle" href="#verification-checks">核验明细</FluentElement>
    <FluentElement tag="fluent-anchor-button" appearance="subtle" href="#verification-diagnosis">编辑过程检验单</FluentElement>
    {charts&&<FluentElement tag="fluent-anchor-button" appearance="subtle" href="#verification-charts">统计图</FluentElement>}
    {timeline&&<FluentElement tag="fluent-anchor-button" appearance="subtle" href="#verification-timeline">过程轨迹</FluentElement>}
  </nav>;
}
