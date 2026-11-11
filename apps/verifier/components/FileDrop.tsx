'use client';
import {useId,useRef,useState} from 'react';
import {FileText,Plus,Check,FolderOpen} from 'lucide-react';
import {size} from '../lib/evidence';
import {useEmbeddedFluent} from './fluent-embedded';
import {Button} from './button';
export function Upload({label,caption,file,onFile,accept,disabled}:{label:string;caption:string;file:File|null;onFile:(f:File)=>void;accept?:string;disabled:boolean}){
  const input=useRef<HTMLInputElement>(null);const [over,setOver]=useState(false),[error,setError]=useState('');const id=useId();
  const embedded=useEmbeddedFluent();
  const Control=embedded?Button:'button';
  function choose(files:FileList|null){if(disabled||!files?.length)return;if(files.length!==1){setError('请一次只选择一份文件，当前选择未改变。');return;}setError('');onFile(files[0]);}
  return <div className="upload-field"><Control type="button" className={`upload ${embedded?'fluent-upload':'m-groove'} ${over&&!disabled?'over':''} ${file?'filled':''}`} aria-controls={id} aria-describedby={error?id+'-error':undefined} disabled={disabled} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();if(!disabled)setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);choose(e.dataTransfer.files);}}>
    <span className="upload-icon">{file?<FileText size={21}/>:<Plus size={21}/>}</span><span className="upload-copy"><strong>{file?file.name:label}</strong><span>{file?`${size(file.size)} · 点击更换`:caption}</span></span><span className="upload-end">{file?<Check size={17}/>:<FolderOpen size={17}/>}</span>
  </Control><input id={id} className="upload-input" ref={input} aria-label={label} type="file" accept={accept} disabled={disabled} tabIndex={-1} onChange={e=>{choose(e.target.files);e.target.value='';}}/>{error&&<p id={id+'-error'} role="alert">{error}</p>}</div>;
}
