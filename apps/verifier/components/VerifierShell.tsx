'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {Fingerprint,ShieldCheck,Info,Sun,Moon,ExternalLink,LockKeyhole} from 'lucide-react';
import {Button} from './button';
import {Tag} from './institution-ui';

export function VerifierShell({children}:{children:ReactNode}){
  const [dark,setDark]=useState(false);
  useEffect(()=>{
    const query=window.matchMedia('(prefers-color-scheme: dark)');
    const apply=()=>{
      let saved:{theme?:string;density?:string}={};try{saved=JSON.parse(localStorage.getItem('scaffold.appearance')||'{}');}catch{}
      const value=saved?.theme==='dark'||(saved?.theme==='auto'&&query.matches);
      document.documentElement.dataset.theme=value?'dark':'light';
      document.documentElement.dataset.density=['regular','compact','comfy'].includes(saved?.density||'')?saved.density:'regular';setDark(value);
    };
    apply();query.addEventListener('change',apply);window.addEventListener('storage',apply);
    return()=>{query.removeEventListener('change',apply);window.removeEventListener('storage',apply);};
  },[]);
  function toggle(){
    const value=!dark;let saved:Record<string,unknown>={};try{const raw=JSON.parse(localStorage.getItem('scaffold.appearance')||'{}');if(raw&&typeof raw==='object'&&!Array.isArray(raw))saved=raw;}catch{}
    try{localStorage.setItem('scaffold.appearance',JSON.stringify({...saved,theme:value?'dark':'light',density:saved.density||'regular'}));}catch{}
    document.documentElement.dataset.theme=value?'dark':'light';setDark(value);
  }
  return <div className="wp-stage"><div className="wp-frame">
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
