import('./mroffice/app.js').catch(error => {
  const status = document.querySelector('#office-root [role="status"]');
  if (status) {
    status.setAttribute('role', 'alert');
    status.textContent = 'MR Office 加载失败，请检查客户端安装包。';
  }
  console.error('MR Office startup:', error);
});
