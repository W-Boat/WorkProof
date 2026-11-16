'use client';
import {useEffect,useRef,useState,type ComponentProps} from 'react';
import {Button} from './button';
import {ReportExport} from './ReportExport';

type Preview={html:string;excerpts:{ordinal:number;text:string}[]};

export function VerifiedDocumentReport(props:ComponentProps<typeof ReportExport>){
  const {artifact,result}=props;
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>{
    setPreview(null);setError('');setBusy(false);
    return()=>{request.current++;};
  },[artifact,result]);

  async function open(){
    if(!artifact||!result.report.valid||busy)return;
    const generation=++request.current;
    setBusy(true);setError('');
    try{
      const url=new URL('/document-preview.js',window.location.origin).href;
      const runtime=await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
      const loaded:Preview=await runtime.previewDocument(artifact,result.proof.paragraphs||[]);
      if(request.current===generation)setPreview(loaded);
    }catch(cause){
      if(request.current===generation)setError(cause instanceof Error?cause.message:'无法预览作品。');
    }finally{
      if(request.current===generation)setBusy(false);
    }
  }

  return <>
    {result.report.valid&&artifact&&/\.(docx|md|markdown|txt|png|jpe?g|webp)$/i.test(artifact.name)&&
      <section aria-label="作品只读预览">
        <Button disabled={busy} variant="secondary" onClick={()=>void open()}>预览匹配作品</Button>
        {busy&&<p role="status">正在准备文档预览…</p>}
        {error&&<p role="alert">{error}</p>}
        {preview&&<iframe title="作品只读预览" sandbox="" srcDoc={preview.html}
          style={{display:'block',width:'100%',minHeight:400,height:'min(60vh, 720px)',marginBlock:12,borderRadius:8}}/>}
      </section>}
    <ReportExport {...props} excerpts={preview?.excerpts}/>
  </>;
}
