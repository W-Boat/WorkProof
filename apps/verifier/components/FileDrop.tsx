'use client';
import {useRef,useState} from 'react';
import {FileText,Plus,Check,FolderOpen} from 'lucide-react';
import {size} from '../lib/evidence';
export function Upload({label,caption,file,onFile,accept,disabled}:{label:string;caption:string;file:File|null;onFile:(f:File)=>void;accept?:string;disabled:boolean}){
  const input=useRef<HTMLInputElement>(null);const [over,setOver]=useState(false);
  return <button type="button" className={`upload m-groove ${over?'over':''} ${file?'filled':''}`} disabled={disabled} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();if(!disabled)setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);if(!disabled&&e.dataTransfer.files[0])onFile(e.dataTransfer.files[0]);}}>
    <span className="upload-icon">{file?<FileText size={21}/>:<Plus size={21}/>}</span><span className="upload-copy"><strong>{file?file.name:label}</strong><span>{file?`${size(file.size)} · 点击更换`:caption}</span></span><span className="upload-end">{file?<Check size={17}/>:<FolderOpen size={17}/>}</span>
    <input ref={input} aria-label={label} type="file" accept={accept} tabIndex={-1} onClick={e=>e.stopPropagation()} onChange={e=>{if(e.target.files?.[0])onFile(e.target.files[0]);e.target.value='';}}/>
  </button>;
}
