// Shared controls for explicitly selected SAI2 and Illustrator documents.
export function savedRecordingUI({ready,onSaved}){
  const panel=document.getElementById('sai2-recording'),select=document.getElementById('creation-tool');
  const start=document.getElementById('sai2-start'),pause=document.getElementById('sai2-pause'),finish=document.getElementById('sai2-finish');
  const coverage=document.getElementById('drawing-recording-coverage');
  const status=document.getElementById('sai2-recording-status');
  let current={active:false},busy=false,refreshing=false,revision=0,feedback='';
  const invoke=(name,args)=>window.__TAURI__.core.invoke(name,args);
  function render(){
    const active=current.active===true;
    const illustrator=select.value==='illustrator';
    coverage.textContent=illustrator?'记录当前 .ai 作品的几何变化摘要和保存版本。完成后请在 Illustrator 保存。':'仅观察所选文件的保存版本，不采集图层或笔触。完成绘画后请先在 SAI2 保存。';
    start.disabled=busy||active||!ready();pause.disabled=finish.disabled=busy||!active;
    const pauseLabel=current.paused?'继续记录':'暂停记录';
    if(pause.textContent.trim()!==pauseLabel){pause.setAttribute('aria-label',pauseLabel);pause.title=pauseLabel;pause.dataset.icon=current.paused?'play':'pause';pause.textContent=pauseLabel;}
    status.textContent=feedback||current.error||(active?`${current.file_name} · ${current.paused?'已暂停':(current.source==='illustrator'?'正在采集几何和保存版本':'正在观察保存版本')} · 已保存 ${current.events} 条记录`:(illustrator?'打开 Illustrator 中的本地作品，再选择对应 .ai 文件。':'选择一份已保存的 .sai2 文件后开始。'));
  }
  async function refresh(){
    panel.hidden=!['sai2-file','illustrator'].includes(select.value);
    if(panel.hidden||busy||refreshing)return;
    const requestedAt=revision;
    refreshing=true;
    try{
      const result=await invoke('saved_recording_status');
      if(requestedAt===revision&&!busy){current=result;render();}
    }catch{
      if(requestedAt===revision&&!busy&&!feedback)status.textContent='暂时无法读取保存版本记录状态，请稍后重试。';
    }finally{refreshing=false;}
  }
  for(const [button,command,args] of [[start,'saved_recording_start',()=>({startedAt:new Date().toISOString(),source:select.value})],[pause,'saved_recording_pause',()=>({resume:!!current.paused})],[finish,'saved_recording_finish',()=>({})]]){
    button.addEventListener('click',async()=>{
      if(busy)return;busy=true;++revision;feedback='正在处理，请稍候…';render();
      try{
        const result=await invoke(command,args());
        if(!result.cancelled){
          current=result;feedback='';
          if(command==='saved_recording_finish'){
            feedback='证书已保存，记录已结束。请将原作品和证书一起交付。';
            await onSaved();
          }
        }
        else{if(command==='saved_recording_finish')current.paused=true;feedback=command==='saved_recording_finish'?'已取消导出，记录保持暂停。':'已取消选择，尚未开始记录。';}
      }catch(error){try{current=await invoke('saved_recording_status');}catch{}feedback=error instanceof Error?error.message:String(error);}
      finally{busy=false;render();}
    });
  }
  select.addEventListener('change',refresh);
  setInterval(()=>{if(document.body.dataset.view==='connections')refresh();},2000);
  refresh();
}
