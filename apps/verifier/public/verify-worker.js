let ready;
self.onmessage = async ({data}) => {
  try {
    self.postMessage({type:'progress',phase:'加载核验引擎',progress:0});
    ready ||= import('/wasm/workproof_protocol.js').then(async mod=>{await mod.default();return mod;});
    const {FileHasher,create_disclosure_json}=await ready;
    const {artifact,proof}=data;
    if(proof.size>32*1024*1024)throw new Error('证据文件超过 32 MB 限制');
    const json=await proof.text();
    const parsed=JSON.parse(json);
    if(!['workproof/1','workproof/2','workproof/3'].includes(parsed.manifest?.protocol))throw new Error('不支持的证据协议版本');
    if(data.action==='disclose'){
      const output=create_disclosure_json(json,JSON.stringify(data.indices));
      self.postMessage({type:'disclosure',json:output});return;
    }
    const hasher=new FileHasher();
    try {
      for(let pos=0;pos<artifact.size;pos+=1024*1024){
        const chunk=new Uint8Array(await artifact.slice(pos,pos+1024*1024).arrayBuffer());
        hasher.update(chunk);
        self.postMessage({type:'progress',phase:'计算作品指纹',progress:Math.min(90,Math.round((pos+chunk.length)/artifact.size*90))});
      }
      self.postMessage({type:'progress',phase:'核验记录链与签名',progress:95});
      const report=JSON.parse(hasher.verify(json));
      const display=parsed.format?{...parsed,records:(parsed.disclosed||[]).map(entry=>entry.record)}:parsed;
      self.postMessage({type:'result',report,proof:display,fingerprint:hasher.finish()});
    } finally {hasher.free();}
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
};
