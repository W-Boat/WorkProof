/* Native WPS ribbon entry, kept separate from the shared taskpane bundle. */
var workproofPane;
function OnWorkProofLoad(ribbon){return true;}
function OnOpenWorkProof(){
  var api=window.Application||window.wps;
  if(!api||typeof api.CreateTaskPane!=='function'){
    alert('当前 WPS 版本未提供任务窗接口，请联系机构管理员确认加载项支持。');return;
  }
  try{
    var location=window.location;
    if(location.protocol!=='https:'&&!(location.protocol==='http:'&&/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)))throw new Error('加载项必须使用 HTTPS 或本机回环地址。');
    // The ribbon lives at <institution>/office/wps/; never accept a URL from a query string.
    var url=new URL('../index.html?host=wps',location.href);
    if(url.origin!==location.origin||url.username||url.password)throw new Error('加载项网址无效。');
    if(workproofPane){
      try{workproofPane.Visible=true;return;}catch(stalePane){workproofPane=null;}
    }
    workproofPane=api.CreateTaskPane(url.href,'WorkProof · 开源证人');
    if(!workproofPane)throw new Error('WPS 未允许创建任务窗，请确认机构加载项网址及宿主权限。');
    workproofPane.Visible=true;
  }catch(error){workproofPane=null;alert('无法打开 WorkProof：'+String(error.message||error));}
}
