export type DesktopAppearance={type:'workproof:appearance';theme:'light'|'dark';reduceMotion:boolean};

// This bridge changes presentation only. It never accepts files, commands or
// trust decisions, and an embedding query alone cannot enable the desktop shell.
export function desktopAppearance(event:MessageEvent,parent:Window,search:string):DesktopAppearance|null{
  const query=new URLSearchParams(search),expected=query.get('parentOrigin');
  if(query.get('embedded')!=='1'||!expected||event.source!==parent||event.origin!==expected)return null;
  let permitted=expected==='null'||expected==='tauri://localhost';
  try{
    const url=new URL(expected);
    permitted=permitted||(['http:','https:'].includes(url.protocol)&&['tauri.localhost','127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.origin===expected&&!url.username&&!url.password);
  }catch{}
  if(!permitted)return null;
  const data=event.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||data.type!=='workproof:appearance'||!['light','dark'].includes(data.theme)||typeof data.reduceMotion!=='boolean')return null;
  return {type:'workproof:appearance',theme:data.theme,reduceMotion:data.reduceMotion};
}
