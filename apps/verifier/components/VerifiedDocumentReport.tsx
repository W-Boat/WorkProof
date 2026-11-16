'use client';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Button} from './button';
import {ReportExport} from './ReportExport';
import {ParagraphReport} from './ParagraphReport';
import {HistoricalDocumentPreview} from './HistoricalDocumentPreview';
import {wordPreviewLocations} from '../lib/paragraph-statistics';

type Preview={html:string;excerpts:{ordinal:number;text:string}[]};

export function VerifiedDocumentReport({onLocate,...props}:ComponentProps<typeof ReportExport>&{onLocate?:(seq:number)=>void}){
  const {artifact,result}=props;
  const frame=useRef<HTMLIFrameElement>(null),target=useRef<string|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>{
    target.current=null;setPreview(null);setError('');setBusy(false);
    return()=>{request.current++;};
  },[artifact,result]);

  function focusPreview(){
    if(target.current===null||!frame.current?.contentDocument)return;
    const paragraph=frame.current.contentDocument.getElementById(target.current);
    if(!paragraph){setError('无法在预览中确认该段位置，可查看对应记录。');return;}
    setError('');frame.current.scrollIntoView({block:'nearest'});
    paragraph.tabIndex=-1;paragraph.focus();paragraph.scrollIntoView({block:'center'});
  }

  async function open(ordinal:number|null=null,wordFingerprint?:string){
    if(!artifact||!result.report.valid)return;
    target.current=ordinal===null?null:wordFingerprint?'word-paragraph-'+wordFingerprint:'paragraph-'+ordinal;
    if(preview&&ordinal!==null){focusPreview();return;}
    if(busy)return;
    const generation=++request.current;
    setBusy(true);setError('');
    try{
      const url=new URL('/document-preview.js',window.location.origin).href;
      const runtime=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      const loaded:Preview=await runtime.previewDocument(artifact,result.proof.paragraphs||[],wordPreviewLocations(result.proof));
      if(request.current===generation)setPreview(loaded);
    }catch(cause){
      if(request.current===generation)setError(cause instanceof Error?cause.message:'无法预览作品。');
    }finally{
      if(request.current===generation)setBusy(false);
    }
  }

  return <>
    <ParagraphReport proof={result.proof} report={result.report} onLocate={result.report.chain_valid?onLocate:undefined} onPreview={result.report.valid&&artifact&&/\.(docx|md|markdown|txt)$/i.test(artifact.name)?(ordinal,fingerprint)=>void open(ordinal,fingerprint):undefined}/>
    {result.report.valid&&artifact&&/\.(docx|md|markdown|txt|png|jpe?g|webp)$/i.test(artifact.name)&&
      <section aria-label="作品只读预览">
        <Button disabled={busy} variant="secondary" onClick={()=>void open()}>预览匹配作品</Button>
        {busy&&<p role="status">正在准备文档预览…</p>}
        {error&&<p role="alert">{error}</p>}
        {preview&&<iframe ref={frame} title="作品只读预览" sandbox="allow-same-origin" srcDoc={preview.html} onLoad={focusPreview}
          style={{display:'block',width:'100%',minHeight:400,height:'min(60vh, 720px)',marginBlock:12,borderRadius:8}}/>}
      </section>}
    <HistoricalDocumentPreview result={result} load={async file=>{
      const url=new URL('/document-preview.js',window.location.origin).href;
      const runtime=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      return runtime.previewDocument(file,[]);
    }}/>
    <ReportExport {...props} excerpts={preview?.excerpts}/>
  </>;
}
