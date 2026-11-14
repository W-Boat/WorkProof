// SAI2 is a saved-file observation mode, never presented as an installed SAI plugin.
export function savedRecordingUI({ready,onSaved}){
  const panel=document.getElementById('sai2-recording'),select=document.getElementById('creation-tool');
  const start=document.getElementById('sai2-start'),pause=document.getElementById('sai2-pause'),finish=document.getElementById('sai2-finish');
  const status=document.getElementById('sai2-recording-status');
  let current={active:false},busy=false;
  const invoke=(name,args)=>window.__TAURI__.core.invoke(name,args);
  function render(){
    const active=current.active===true;
    start.disabled=busy||active||!ready();pause.disabled=finish.disabled=busy||!active;
    pause.textContent=current.paused?'继续记录':'暂停记录';
    status.textContent=current.error||(active?`${current.file_name} · ${current.paused?'已暂停':'正在观察保存版本'} · 已保存 ${current.events} 条记录`:'选择一份已保存的 .sai2 文件后开始。');
  }
  async function refresh(){
    panel.hidden=select.value!=='sai2-file';
    if(panel.hidden||busy)return;
    try{current=await invoke('saved_recording_status');render();}
    catch{status.textContent='暂时无法读取保存版本记录状态，请稍后重试。';}
  }
  for(const [button,command,args] of [[start,'saved_recording_start',()=>({startedAt:new Date().toISOString()})],[pause,'saved_recording_pause',()=>({resume:!!current.paused})],[finish,'saved_recording_finish',()=>({})]]){
    button.addEventListener('click',async()=>{
      if(busy)return;busy=true;render();status.textContent='正在处理，请稍候…';
      try{
        const result=await invoke(command,args());
        if(!result.cancelled){current=result;render();if(command==='saved_recording_finish'){status.textContent='证书已保存，记录已结束。请将原作品和证书一起交付。';await onSaved();}}
        else{if(command==='saved_recording_finish')current.paused=true;status.textContent=command==='saved_recording_finish'?'已取消导出，记录保持暂停。':'已取消选择，尚未开始记录。';}
      }catch(error){status.textContent=error instanceof Error?error.message:String(error);}
      finally{busy=false;const message=status.textContent;render();status.textContent=message;}
    });
  }
  select.addEventListener('change',refresh);
  setInterval(()=>{if(document.body.dataset.view==='connections')refresh();},2000);
  refresh();
}
