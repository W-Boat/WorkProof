// SPDX-License-Identifier: MIT
// Only native APIs; no production catch-all listener and no descriptor persistence.
function createHost(ps,storage){
  const fs=storage.localFileSystem;
  const id=()=>ps.app.activeDocument?.id;
  const stamp=m=>JSON.stringify({size:m.size,modified:String(m.dateModified||'')});
  function list(collection){
    if(!collection||!Number.isSafeInteger(collection.length)||collection.length<0||collection.length>50_000)throw new Error('当前宿主无法完整读取图层结构，已停止统计。');
    return Array.from(collection);
  }
  function marker(){
    const doc=ps.app.activeDocument;if(!doc)throw new Error('请先打开 Photoshop 文档。');
    const history=doc.activeHistoryState?.id;
    if(!Number.isSafeInteger(doc.id)||!Number.isSafeInteger(history))throw new Error('当前宿主未提供文档/历史状态标识，无法安全检测并发编辑。');
    return {id:doc.id,history};
  }
  function snapshot(){
    const doc=ps.app.activeDocument;if(!doc)throw new Error('请先打开 Photoshop 文档。');
    let layers=0,groups=0,visible_layers=0;
    const stack=list(doc.layers).map(layer=>({layer,visible:true}));
    while(stack.length){
      const {layer,visible}=stack.pop();
      if(++layers>50_000)throw new Error('当前适配器最多统计 50000 个图层节点。');
      if(typeof layer.visible!=='boolean'||layer.kind===undefined)throw new Error('当前宿主无法读取图层种类或可见性，不能将未知值当成零。');
      const shown=visible&&layer.visible;
      if(shown)visible_layers++;
      if(layer.kind===ps.constants.LayerKind.GROUP){
        groups++;const children=list(layer.layers);
        if(stack.length+layers+children.length>50_000)throw new Error('当前适配器最多统计 50000 个图层节点。');
        for(const child of children)stack.push({layer:child,visible:shown});
      }
    }
    const position=marker();
    if(position.id!==doc.id)throw new Error('统计期间活动文档已改变。');
    return {...position,metrics:{layers,groups,visible_layers}};
  }
  return {
    snapshot,marker,activeId:id,
    async listen(events,callback){await ps.action.addNotificationListener(events,callback);},
    async unlisten(events,callback){await ps.action.removeNotificationListener(events,callback);},
    async chooseArtifact(){
      const doc=ps.app.activeDocument;if(!doc)throw new Error('请先打开 Photoshop 文档。');
      const name=String(doc.title||doc.name||'design').replace(/\.[^.]*$/,'')+'-workproof.psd';
      const entry=await fs.getFileForSaving(name,{types:['psd']});
      if(entry&&!entry.name.toLowerCase().endsWith('.psd'))throw new Error('交付副本须使用 .psd 扩展名。');
      return entry;
    },
    async chooseProof(name){
      const entry=await fs.getFileForSaving(name,{types:['wproof']});
      if(entry&&!entry.name.toLowerCase().endsWith('.wproof'))throw new Error('证书须使用 .wproof 扩展名。');
      return entry;
    },
    async saveCopy(entry,documentId){
      await ps.core.executeAsModal(async context=>{
        const doc=ps.app.activeDocument;
        if(!doc||doc.id!==documentId||context.isCancelled)throw new Error('当前文档已改变或保存已取消。');
        const normalize=value=>String(value||'').replace(/\\/g,'/').toLowerCase();
        if(!doc.cloudDocument&&doc.path&&normalize(doc.path)===normalize(entry.nativePath))throw new Error('请选择不同于原文档的位置，避免覆盖正在创作的原文件。');
        await doc.saveAs.psd(entry,{},true);
      },{commandName:'WorkProof：保存交付副本'});
    },
    async readArtifact(entry){
      const before=await entry.getMetadata();
      if(!Number.isSafeInteger(before.size)||before.size<=0||before.size>128*1024*1024)throw new Error('当前适配器支持 0–128 MB（不含空文件）的 PSD 副本。');
      const data=await entry.read({format:storage.formats.binary});
      if(!(data instanceof ArrayBuffer))throw new Error('宿主没有返回二进制交付文件。');
      const bytes=new Uint8Array(data),after=await entry.getMetadata();
      if(bytes.length!==before.size||stamp(before)!==stamp(after))throw new Error('读取期间交付文件发生变化。');
      return {bytes,stamp:stamp(after)};
    },
    async assertArtifactUnchanged(entry,expected){if(stamp(await entry.getMetadata())!==expected)throw new Error('交付文件已改变，请重新导出证书。');},
    async writeProof(entry,proof){await entry.write(JSON.stringify(proof,null,2),{format:storage.formats.utf8});},
  };
}
module.exports={createHost};
