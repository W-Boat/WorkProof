import * as path from 'node:path';
export function dataDirectory(env:NodeJS.ProcessEnv=process.env,platform:NodeJS.Platform=process.platform):string{
  const paths=platform==='win32'?path.win32:path.posix;
  const absolute=(value:string|undefined)=>value&&paths.isAbsolute(value)?value:undefined;
  if(env.WORKPROOF_DATA_DIR){if(!absolute(env.WORKPROOF_DATA_DIR))throw new Error('记录目录必须使用完整路径。');return env.WORKPROOF_DATA_DIR;}
  const home=absolute(env.HOME)||absolute(env.USERPROFILE);
  if(platform==='win32'&&absolute(env.LOCALAPPDATA))return paths.join(env.LOCALAPPDATA!,'WorkProof');
  if(platform!=='win32'&&platform!=='darwin'&&absolute(env.XDG_DATA_HOME))return paths.join(env.XDG_DATA_HOME!,'WorkProof');
  if(!home)throw new Error('找不到用户目录，请设置 WORKPROOF_DATA_DIR 后重试。');
  return paths.join(home,...(platform==='win32'?['AppData','Local','WorkProof']:platform==='darwin'?['Library','Application Support','WorkProof']:['.local','share','WorkProof']));
}
