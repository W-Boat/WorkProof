import {icon} from './icons.js';
import {groupActions} from './action-flow.mjs';

const node=(tag,className,text)=>{const element=document.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
const clock=ms=>{const seconds=Math.floor(Math.max(0,ms)/1000);return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
function command(label,glyph,run){const button=node('fluent-button','replay-command');button.setAttribute('appearance','subtle');button.setAttribute('aria-label',label);button.title=label;button.append(icon(glyph));button.addEventListener('click',run);return button;}
function stepText(value){if(!value||typeof value!=='object')return '';if(typeof value.text==='string')return value.text;return Array.isArray(value.content)?value.content.map(stepText).join(''):'';}

export function openProcessReplay({document:doc,invoke,renderContent}){
  const previousFocus=document.activeElement,dialog=node('dialog','process-replay');dialog.id='process-replay';dialog.setAttribute('aria-labelledby','replay-title');
  let alive=true,playing=false,animation=0,request=0,index=-1,position=0,duration=1,speed=1,frames=[],mode='activity',current=null;
  const cache=new Map();
  const header=node('header','replay-header'),heading=node('div'),title=node('h2','',doc.title);title.id='replay-title';heading.append(node('p','replay-eyebrow','过程回放'),title);
  const headerActions=node('div','replay-header-actions');
  const toggleInspector=command('收起分析侧栏','panel_right',()=>{
    const collapsed=dialog.classList.toggle('inspector-collapsed');right.inert=collapsed;right.setAttribute('aria-hidden',String(collapsed));toggleInspector.setAttribute('aria-expanded',String(!collapsed));toggleInspector.setAttribute('aria-label',collapsed?'展开分析侧栏':'收起分析侧栏');toggleInspector.title=collapsed?'展开分析侧栏':'收起分析侧栏';
  });toggleInspector.setAttribute('aria-expanded','true');
  headerActions.append(toggleInspector,command('关闭过程回放','dismiss',()=>dialog.close()));header.append(heading,headerActions);
  const layout=node('div','replay-layout'),left=node('section','replay-main'),right=node('aside','replay-inspector');right.setAttribute('aria-label','回放分析');
  const preview=node('div','replay-preview');preview.dataset.selectable='true';preview.setAttribute('aria-label','保存版本只读预览');
  const paper=node('article','replay-paper history-paper');preview.append(paper);
  const transport=node('section','replay-transport'),caption=node('div','replay-caption'),version=node('span','','正在读取版本…'),elapsed=node('span','','0:00');caption.append(version,elapsed);
  const tracks=node('div','replay-tracks'),wave=node('div','replay-wave'),pastes=node('div','replay-pastes');wave.setAttribute('aria-hidden','true');pastes.setAttribute('aria-label','粘贴发生的版本');tracks.append(wave,pastes);
  const seek=node('input','replay-seek');seek.type='range';seek.min='0';seek.max='1';seek.value='0';seek.step='1';seek.setAttribute('aria-label','回放进度');seek.disabled=true;
  const controls=node('div','replay-controls-row'),controlsLeft=node('div'),controlsCenter=node('div'),controlsRight=node('div');
  const play=command('播放保存过程','play',()=>{if(playing)pause();else start();});play.setAttribute('appearance','primary');play.disabled=true;
  const back=command('上一个保存版本','arrow_left',()=>step(-1)),next=command('下一个保存版本','arrow_redo',()=>step(1));back.disabled=next.disabled=true;
  const rate=node('select');rate.setAttribute('aria-label','回放速度');for(const n of [1,2,4,8]){const option=node('option','',`${n}×`);option.value=String(n);rate.append(option);}rate.addEventListener('change',()=>{speed=Number(rate.value);});
  controlsLeft.append(node('span','replay-local','本机记录 · 只读'));controlsCenter.append(back,play,next);controlsRight.append(rate);controls.append(controlsLeft,controlsCenter,controlsRight);
  const notice=node('p','replay-notice','按保存版本回放，版本之间的逐字输入没有重建。');
  transport.append(caption,tracks,seek,controls,notice);left.append(preview,transport);
  const analysis=node('div','replay-analysis'),summary=node('h3','','记录概览'),totals=node('div','replay-totals'),explanation=node('p','replay-explanation','正在整理保存版本。文件和正文留在本机。');
  const progress=node('fluent-progress-bar');progress.setAttribute('aria-label','正在整理保存版本');analysis.append(summary,totals,explanation,progress);
  const tabs=node('div','replay-tabs');tabs.setAttribute('aria-label','动作查看方式');
  const activity=command('查看本版本动作','text_bullet_list_ltr',()=>switchMode('activity')),inspect=command('查看粘贴与修改线索','search',()=>switchMode('inspect'));
  activity.append(node('span','','动作'));inspect.append(node('span','','检查'));tabs.append(activity,inspect);
  const activityTitle=node('h3','replay-activity-title','本版本动作'),cards=node('div','replay-activity');cards.setAttribute('aria-label','所选版本的动作');
  right.append(analysis,tabs,activityTitle,cards);layout.append(left,right);dialog.append(header,layout);document.body.append(dialog);dialog.showModal();header.querySelector('fluent-button').focus();

  function pause(){playing=false;cancelAnimationFrame(animation);play.replaceChildren(icon('play'));play.setAttribute('aria-label','播放保存过程');play.title='播放保存过程';play.setAttribute('aria-pressed','false');}
  function start(){
    if(!frames.length)return;if(position>=duration)void move(0);
    playing=true;play.replaceChildren(icon('pause'));play.setAttribute('aria-label','暂停回放');play.title='暂停回放';play.setAttribute('aria-pressed','true');
    let last=performance.now();
    function tick(now){if(!alive||!playing)return;const delta=(now-last)*speed;last=now;void move(Math.min(duration,position+delta));if(position>=duration)pause();else animation=requestAnimationFrame(tick);}
    animation=requestAnimationFrame(tick);
  }
  function step(direction){pause();const target=Math.max(0,Math.min(frames.length-1,index+direction));if(frames[target])void move(frames[target].at,target);}
  function switchMode(value){mode=value;paintActions();}
  function paintActions(){
    activity.setAttribute('aria-pressed',String(mode==='activity'));inspect.setAttribute('aria-pressed',String(mode==='inspect'));
    activityTitle.textContent=mode==='activity'?'本版本动作':'粘贴与修改线索';cards.replaceChildren();
    if(!current){cards.append(node('p','replay-explanation','选择一个保存版本，查看对应动作。'));return;}
    const groups=groupActions(current.actions.map(action=>({revision:current.revision,action})).reverse());
    const selected=mode==='inspect'?groups.filter(group=>['paste','import','erase','undo','redo'].includes(group.type)):groups;
    if(!selected.length){cards.append(node('p','replay-explanation',mode==='inspect'?'这个版本没有记录到粘贴、导入、删除或撤销。':'这是文档的起始版本，还没有编辑动作。'));return;}
    for(const group of selected){
      const card=node('section','replay-action');card.dataset.type=group.type;
      const h=node('h4'),glyph=group.type==='paste'?'copy':group.type==='undo'?'arrow_undo':group.type==='erase'?'delete':'document_text';h.append(icon(glyph),node('span','',`${group.label}${group.count>1?` · ${group.count} 次`:''}`));
      const amount=node('p','replay-action-amount',`新增 ${group.inserted.toLocaleString()} 字符 · 删除 ${group.deleted.toLocaleString()} 字符`);
      card.append(h,amount,node('p','replay-action-time',`${clock(group.start)} – ${clock(group.end)} · 版本 ${current.revision+1}`));
      const excerpt=group.items.flatMap(item=>item.action.steps||[]).map(step=>stepText(step.slice)).join('').slice(0,240);
      if(excerpt){const quote=node('blockquote','',excerpt);quote.dataset.selectable='true';card.append(quote);}
      if(group.type==='paste'&&group.inserted>=200)card.append(node('p','replay-caution','大段粘贴：可结合前后版本查看内容从哪里加入。'));
      if(group.type==='import')card.append(node('p','replay-caution','导入前的编辑过程未在当前文档中记录。'));
      cards.append(card);
    }
  }
  async function move(value,forcedIndex=null){
    if(!alive||!frames.length)return;position=Math.max(0,Math.min(duration,value));seek.value=String(Math.round(position));elapsed.textContent=`${clock(position)} / ${clock(duration)}`;
    tracks.style.setProperty('--replay-progress',`${position/duration*100}%`);
    let low=0,high=frames.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(frames[mid].at<=position)low=mid;else high=mid-1;}
    const nextIndex=forcedIndex===null?low:forcedIndex;
    if(index===nextIndex)return;index=nextIndex;const frame=frames[index],token=++request;
    back.disabled=index===0;next.disabled=index===frames.length-1;version.textContent=`版本 ${frame.revision+1} · ${index+1} / ${frames.length}`;seek.setAttribute('aria-valuetext',`${clock(position)}，版本 ${frame.revision+1}`);
    paper.replaceChildren(node('p','replay-explanation','正在读取这个版本…'));preview.setAttribute('aria-busy','true');current=null;paintActions();
    try{
      const content=cache.get(frame.revision)||await invoke('editor_replay_frame',{id:doc.id,revision:frame.revision});
      if(!alive||token!==request)return;
      if(content.revision!==frame.revision||!Array.isArray(content.actions)||!content.content)throw new Error('这个版本的记录不完整，请重新打开回放。');
      cache.set(frame.revision,content);while(cache.size>3)cache.delete(cache.keys().next().value);
      current=content;paper.innerHTML=renderContent(content.content);preview.scrollTop=0;paintActions();
    }catch(error){if(alive&&token===request){pause();paper.replaceChildren(node('p','replay-error',String(error.message||error)));index=-1;}}
    finally{if(alive&&token===request)preview.setAttribute('aria-busy','false');}
  }
  seek.addEventListener('input',()=>{pause();void move(Number(seek.value));});
  function key(event){if(event.code!=='Space'||event.defaultPrevented||event.target.closest('input,select,fluent-dropdown,fluent-button,button'))return;event.preventDefault();if(playing)pause();else start();}
  dialog.addEventListener('keydown',key);
  const visibility=()=>{if(document.hidden)pause();};document.addEventListener('visibilitychange',visibility);
  dialog.addEventListener('close',()=>{alive=false;request++;pause();cache.clear();document.removeEventListener('visibilitychange',visibility);dialog.remove();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});},{once:true});
  void (async()=>{
    try{
      let after=null;
      do{
        const page=await invoke('editor_history',{id:doc.id,after,through:doc.revision});if(!alive)return;
        if(!Array.isArray(page.frames)||page.frames.length>128||page.frames.some(frame=>!Number.isSafeInteger(frame.revision)||!Number.isFinite(frame.saved)||frame.revision>doc.revision||frame.revision<=(after??-1)))throw new Error('保存版本的时间轴无法读取。');
        frames.push(...page.frames);if(frames.length>20000)throw new Error('保存版本过多，本次无法打开回放。原始记录仍保存在本机。');
        if(!page.has_more)break;if(!page.frames.length||page.next_after!==page.frames.at(-1).revision)throw new Error('保存版本的分页无法读取。');after=page.next_after;
      }while(alive);
      if(!frames.length)throw new Error('这份文档还没有可回放的保存版本。');
      let last=0;const first=frames[0].saved;for(const frame of frames){frame.at=Math.max(last,frame.saved-first);last=frame.at;}
      duration=Math.max(1,last);seek.max=String(duration);seek.disabled=play.disabled=false;
      const sums=frames.reduce((all,frame)=>({pastes:all.pastes+frame.pastes,inserted:all.inserted+frame.inserted,deleted:all.deleted+frame.deleted,count:all.count+frame.count}),{pastes:0,inserted:0,deleted:0,count:0});
      for(const [value,label] of [[frames.length,'保存版本'],[sums.pastes,'粘贴命令'],[sums.count,'原始动作']]){const stat=node('div');stat.append(node('strong','',Number(value).toLocaleString()),node('span','',label));totals.append(stat);}
      explanation.textContent=`累计新增 ${sums.inserted.toLocaleString()}、删除 ${sums.deleted.toLocaleString()} 字符。粘贴标记只表示发生过粘贴，不判断内容作者。`;
      const buckets=Array.from({length:64},()=>({count:0,pastes:0}));for(const frame of frames){const bucket=buckets[Math.min(63,Math.floor(frame.at/duration*63))];bucket.count+=frame.count;bucket.pastes+=frame.pastes;}
      const max=Math.max(1,...buckets.map(bucket=>bucket.count));for(const bucket of buckets){const bar=node('span');bar.style.height=`${Math.max(3,bucket.count/max*100)}%`;wave.append(bar);}
      const marked=frames.map((frame,frameIndex)=>({frame,frameIndex})).filter(item=>item.frame.pastes>0);
      const shown=marked.slice(-96);
      if(marked.length>shown.length)notice.textContent+=' 时间轴标出最近 96 个粘贴版本，其余版本仍可拖动查看。';
      for(const {frame,frameIndex} of shown){const marker=node('button','replay-paste-marker');marker.title=`版本 ${frame.revision+1} · ${frame.pastes} 次粘贴`;marker.setAttribute('aria-label',marker.title);marker.style.left=`${frame.at/duration*100}%`;marker.addEventListener('click',()=>{pause();void move(frame.at,frameIndex);});pastes.append(marker);}
      progress.remove();await move(duration);
    }catch(error){if(alive){progress.remove();explanation.textContent=String(error.message||error);explanation.classList.add('replay-error');paper.replaceChildren(node('p','replay-error','回放未能打开。关闭后可重新尝试，原文档不受影响。'));}}
  })();
  return ()=>dialog.close();
}
