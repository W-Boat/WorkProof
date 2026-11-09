let ready;
self.onmessage = async ({data}) => {
  try {
    self.postMessage({type:'progress',phase:'加载核验引擎',progress:0});
    ready ||= import('/wasm/workproof_protocol.js').then(async mod=>{await mod.default();return mod;});
    const {FileHasher,create_disclosure_json,verify_evolution_json,behavior_json}=await ready;
    const {artifact,proof}=data;
    if(proof.size>32*1024*1024)throw new Error('证据文件超过 32 MB 限制');
    if(data.action==='receipt'){
      if(!data.receipt||data.receipt.size>16*1024||typeof data.issuerId!=='string'||data.issuerId.length>128||typeof data.publicKey!=='string'||!/^[a-fA-F0-9]{64}$/.test(data.publicKey))throw new Error('回执或信任配置不符合限制');
      if(typeof (await ready).verify_server_receipt!=='function')throw new Error('请重新加载包含回执核验引擎的完整站点');
      const report=JSON.parse((await ready).verify_server_receipt(new Uint8Array(await proof.arrayBuffer()),new Uint8Array(await data.receipt.arrayBuffer()),data.issuerId,data.publicKey,data.nowMs,2678400));
      self.postMessage({type:'receipt',report});return;
    }
    const json=await proof.text();
    const parsed=JSON.parse(json);
    if(!['workproof/1','workproof/2','workproof/3'].includes(parsed.manifest?.protocol))throw new Error('不支持的证据协议版本');
    if(data.action==='disclose'){
      const output=create_disclosure_json(json,JSON.stringify(data.indices));
      self.postMessage({type:'disclosure',json:output});return;
    }
    if(data.action==='evolution'){
      if(!data.supplement||data.supplement.size>8*1024*1024)throw new Error('结构文件超过 8 MB 限制，或尚未选择结构文件');
      const graph=await data.supplement.text();
      const report=JSON.parse(verify_evolution_json(json,graph));
      self.postMessage({type:'evolution',report});return;
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
      // A stable identifier for the signed certificate, also across selective exports.
      // Compare only after Rust has verified the signature; this is not an identity claim.
      let certificateId='';
      if(report.signature_valid){
        const signature=Uint8Array.from(parsed.signature.match(/.{2}/g)||[],byte=>parseInt(byte,16));
        const digest=await crypto.subtle.digest('SHA-256',signature);
        certificateId=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
      }
      const expected=(data.expectedCertificateId||'').trim().toLowerCase();
      const certificateMatch=expected?(/^[a-f0-9]{64}$/.test(expected)&&certificateId===expected):null;
      if(certificateMatch===false){report.valid=false;report.errors.push('证书指纹不一致：这不是发送者指定的证书。');}
      const display=parsed.format?{...parsed,records:(parsed.disclosed||[]).map(entry=>entry.record)}:parsed;
      let behavior=null;
      if(report.valid&&typeof behavior_json==='function'){
        try{behavior=JSON.parse(behavior_json(json));}catch{behavior=null;}
      }
      self.postMessage({type:'result',report,proof:display,fingerprint:hasher.finish(),certificateId,certificateMatch,behavior});
    } finally {hasher.free();}
  }catch(error){self.postMessage({type:'error',message:String(error?.message||error)});}
};
