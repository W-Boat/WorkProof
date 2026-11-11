'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Fingerprint,ShieldCheck,Info,Sun,Moon,ExternalLink,LockKeyhole} from 'lucide-react';
import {useReducedMotion} from 'motion/react';
import {webLightTheme,webDarkTheme} from '@fluentui/tokens';
import type {CSSProperties} from 'react';
import {desktopAppearance} from '../lib/desktop-appearance';
import {Button} from './button';
import {Tag} from './institution-ui';
import {EmbeddedFluent,loadEmbeddedFluent} from './fluent-embedded';

export function useVerifierReducedMotion(){
  const system=useReducedMotion();
  const [desktop,setDesktop]=useState(false);
  useEffect(()=>{
    const update=()=>setDesktop(document.documentElement.dataset.workproofMotion==='reduced');
    update();window.addEventListener('workproof:appearance-changed',update);
    return()=>window.removeEventListener('workproof:appearance-changed',update);
  },[]);
  return Boolean(system||desktop);
}

export function VerifierShell({children}:{children:ReactNode}){
  const [dark,setDark]=useState(false),[embedded,setEmbedded]=useState(false);
  const [fluentReady,setFluentReady]=useState(false),[fluentError,setFluentError]=useState(false);
  useEffect(()=>{
    if(!embedded)return;
    let active=true;
    loadEmbeddedFluent(dark).then(()=>{if(active){setFluentReady(true);setFluentError(false);}},()=>{if(active)setFluentError(true);});
    return()=>{active=false;};
  },[embedded,dark]);
  const controlled=useRef(false);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{
      if(controlled.current)return;
      let saved:{theme?:string;density?:string}={};try{saved=JSON.parse(localStorage.getItem('scaffold.appearance')||'{}');}catch{}
      const value=saved?.theme==='dark'||(saved?.theme==='auto'&&query.matches);
      document.documentElement.dataset.theme=value?'dark':'light';
      document.documentElement.dataset.density=['regular','compact','comfy'].includes(saved?.density||'')?saved.density:'regular';setDark(value);
    };
    const receive=(event:MessageEvent)=>{
      if(window.parent===window)return;
      const appearance=desktopAppearance(event,window.parent,window.location.search);
      if(!appearance)return;
      controlled.current=true;setEmbedded(true);setDark(appearance.theme==='dark');
      document.documentElement.dataset.theme=appearance.theme;
      document.documentElement.dataset.workproofEmbedded='true';
      document.documentElement.dataset.workproofMotion=appearance.reduceMotion?'reduced':'full';
      window.dispatchEvent(new Event('workproof:appearance-changed'));
    };
    window.addEventListener('message',receive);
    if(window.parent!==window&&new URLSearchParams(window.location.search).get('embedded')==='1')window.parent.postMessage({type:'workproof:verifier-ready'},'*');
    apply();query.addEventListener('change',apply);window.addEventListener('storage',apply);
    return()=>{query.removeEventListener('change',apply);window.removeEventListener('storage',apply);window.removeEventListener('message',receive);delete document.documentElement.dataset.workproofEmbedded;delete document.documentElement.dataset.workproofMotion;};
  },[]);
  function toggle(){
    const value=!dark;let saved:Record<string,unknown>={};try{const raw=JSON.parse(localStorage.getItem('scaffold.appearance')||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))saved=raw;}catch{}
    try{localStorage.setItem('scaffold.appearance',JSON.stringify({...saved,theme:value?'dark':'light',density:saved.density||'regular'}));}catch{}
    document.documentElement.dataset.theme=value?'dark':'light';setDark(value);
  }
  const fluent=dark?webDarkTheme:webLightTheme;
  const fluentStyle={'--canvas':fluent.colorNeutralBackground2,'--surface-solid':fluent.colorNeutralBackground1,'--input-bg':fluent.colorNeutralBackground1,'--ink':fluent.colorNeutralForeground1,'--ink-muted':fluent.colorNeutralForeground2,'--line':fluent.colorNeutralStroke2,'--line-strong':fluent.colorNeutralStroke1,'--blue':fluent.colorBrandForeground1,'--fluent-primary':fluent.colorBrandBackground,'--fluent-primary-hover':fluent.colorBrandBackgroundHover,'--fluent-primary-pressed':fluent.colorBrandBackgroundPressed} as CSSProperties;
  if(embedded)return <EmbeddedFluent.Provider value={fluentReady}>
    <div className="wp-stage wp-fluent wp-embedded fluent-verifier" style={fluentStyle}>
      <main className="wp-content" id="verify">
        {fluentError?<p role="alert">核验界面组件加载失败。请重新打开核验页。</p>:fluentReady?children:<p role="status">正在载入核验工具…</p>}
      </main>
    </div>
  </EmbeddedFluent.Provider>;
  return <div className={`wp-stage${embedded?' wp-fluent wp-embedded':''}`} style={embedded?fluentStyle:undefined}><div className="wp-frame">
    <aside className="rail m-rail wp-rail" aria-label="主导航">
      <a className="rail-brand" href="/" aria-label="WorkProof 首页"><span className="brand-mark"><img src="/icon.png" alt="" width="34" height="34"/></span><span className="brand-text"><span className="brand-name">WorkProof</span><span className="brand-sub">开源证人</span></span></a>
      <nav className="rail-nav"><div className="nav-group-title">创作证据</div><div className="nav-list"><a className="nav-item is-active m-pill" aria-current="page" href="#verify"><ShieldCheck className="nav-ico" size={18}/><span className="nav-label">证据核验</span></a><a className="nav-item" href="#principles"><Info className="nav-ico" size={18}/><span className="nav-label">核验说明</span></a></div></nav>
      <div className="rail-foot"><p>作品留在本机</p><small>签名有效与身份可信分别判断。</small><a href="https://github.com/W-Boat/WorkProof" target="_blank" rel="noreferrer">查看项目源码<ExternalLink size={13}/></a></div>
    </aside>
    <div className="wp-workspace"><header className="wp-topbar"><span className="wp-breadcrumb">创作证据 <span>/</span> 证据核验</span><div><Tag tone="ok"><LockKeyhole size={12}/>文件不上传</Tag><Button variant="ghost" onClick={toggle} aria-label={dark?'切换为浅色主题':'切换为深色主题'}>{dark?<Sun size={16}/>:<Moon size={16}/>}</Button></div></header>
      <main className="wp-content" id="verify">{children}<footer className="wp-footer"><span>WorkProof · 开源证人</span><span>证据可复核，结论有边界。</span></footer></main>
    </div>
  </div></div>;
}
