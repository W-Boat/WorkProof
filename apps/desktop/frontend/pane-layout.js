// Pane visibility belongs to the workspace, so changing documents preserves it.
export function initializePaneLayout() {
  const workspace = document.getElementById('write-panel');
  if (!workspace || workspace.dataset.panesInitialized) return;
  workspace.dataset.panesInitialized = 'true';
  const panes = {
    outline: {element: document.getElementById('writing-outline'), button: document.getElementById('toggle-outline')},
    inspector: {element: document.getElementById('action-inspector'), button: document.getElementById('toggle-inspector')},
    ribbon: {element: document.getElementById('writing-ribbon'), button: document.getElementById('toggle-ribbon')},
  };
  const preferences = {};
  const controls = [...document.querySelectorAll('[data-pane-preference]')];
  let focused = false;
  let lastOpened = 'inspector';
  let overlayDismissed = false;
  const focusButton = document.getElementById('focus-writing');
  const exitButton = document.getElementById('exit-simple-writing');
  function setFocused(value){
    focused=value;
    document.body.classList.toggle('simple-writing',value);
    document.dispatchEvent(new CustomEvent('workproof:simple-writing',{detail:value}));
    exitButton.hidden=!value;
    for(const element of document.querySelectorAll('.workspace-nav,.doc-head,.document-tabs,.writing-chrome'))element.inert=value;
    render();
    (value?exitButton:focusButton)?.focus({preventScroll:true});
  }
  for (const name of Object.keys(panes)) {
    let saved;
    try { saved = localStorage.getItem(`workproof.pane.${name}`); } catch {}
    preferences[name] = ['open', 'closed', 'auto'].includes(saved) ? saved : 'auto';
    const select = controls.find(control => control.dataset.panePreference === name);
    if (select) select.value = preferences[name];
    panes[name].button?.setAttribute('aria-controls', panes[name].element.id);
  }

  function persist(name, value) {
    preferences[name] = value;
    try { localStorage.setItem(`workproof.pane.${name}`, value); } catch {}
    const select = controls.find(control => control.dataset.panePreference === name);
    if (select) select.value = value;
  }

  function render() {
    const width = workspace.clientWidth;
    if (!width) return;
    const compact = width < 820;
    const markdown = workspace.dataset.editMode === 'markdown';
    // Keep seven tenths of the workspace for writing. Explicitly opened panes
    // become overlays when side-by-side layout would consume that space.
    const totalWidth=document.getElementById('document-workspace').clientWidth;
    const totalHeight=document.getElementById('document-workspace').clientHeight;
    const styles=getComputedStyle(workspace);
    const outlineWidth=parseFloat(styles.getPropertyValue('--outline-width'))||210;
    const inspectorWidth=parseFloat(styles.getPropertyValue('--inspector-width'))||270;
    const chromeHeight=document.querySelector('.doc-head').offsetHeight+document.querySelector('.document-tabs').offsetHeight+document.querySelector('.mode-strip').offsetHeight+document.querySelector('.ribbon-tabs').offsetHeight;
    const ribbonHeight=document.querySelector('.ribbon-inner').scrollHeight;
    const automatic = {ribbon: !markdown && totalHeight-chromeHeight-ribbonHeight>=totalHeight*.7, outline:false, inspector:false};
    const usableHeight=Math.max(0,totalHeight-chromeHeight-(automatic.ribbon?ribbonHeight:0));
    const minimumWidth=usableHeight?totalWidth*totalHeight*.7/usableHeight:totalWidth;
    if(width-inspectorWidth>=minimumWidth)automatic.inspector=true;
    const visible = {};
    for (const name of Object.keys(panes)) {
      visible[name] = !focused && (preferences[name] === 'open' || (preferences[name] === 'auto' && automatic[name]));
    }
    const sidebarWidth=(visible.outline?outlineWidth:0)+(visible.inspector?inspectorWidth:0);
    const overlay=compact||width-sidebarWidth<width*.7;
    if (overlay) {
      if (overlayDismissed) visible.outline = visible.inspector = false;
      else if (visible.outline && visible.inspector) visible[lastOpened === 'outline' ? 'inspector' : 'outline'] = false;
    }
    workspace.classList.toggle('panes-overlay', overlay);
    workspace.classList.toggle('pane-overlay-open', overlay && (visible.outline || visible.inspector));
    workspace.classList.toggle('focus-writing', focused);
    focusButton?.setAttribute('aria-pressed', String(focused));
    for (const [name, {element, button}] of Object.entries(panes)) {
      if (!visible[name] && element.contains(document.activeElement)) button?.focus();
      element.inert = !visible[name];
      element.setAttribute('aria-hidden', String(!visible[name]));
      element.dataset.open = String(visible[name]);
      workspace.dataset[`${name}Open`] = String(visible[name]);
      button?.setAttribute('aria-expanded', String(visible[name]));
      if (name !== 'ribbon') button?.setAttribute('aria-pressed', String(visible[name]));
      else {
        const label = visible[name] ? '折叠工具栏' : '展开工具栏';
        button?.setAttribute('aria-label', label);
        button?.setAttribute('title', label);
      }
    }
  }

  for (const [name, {button}] of Object.entries(panes)) {
    button?.addEventListener('click', () => {
      const open = workspace.dataset[`${name}Open`] !== 'true';
      if (focused) setFocused(false);
      overlayDismissed = false;
      if (open && name !== 'ribbon') lastOpened = name;
      persist(name, open ? 'open' : 'closed');
      render();
    });
  }
  for (const select of controls) select.addEventListener('change', () => {
    const name = select.dataset.panePreference;
    if (!panes[name]) return;
    persist(name, select.value);
    if(focused)setFocused(false);
    overlayDismissed = false;
    if (select.value === 'open') lastOpened = name;
    render();
  });
  focusButton?.addEventListener('click', () => setFocused(!focused));
  exitButton?.addEventListener('click',()=>setFocused(false));
  window.addEventListener('workproof-view',event=>{if(focused&&event.detail!=='document')setFocused(false);});
  document.addEventListener('workproof-editor-tab',event=>{if(focused&&event.detail!=='write')setFocused(false);});
  function dismissOverlay() {
    if (!workspace.classList.contains('pane-overlay-open')) return;
    overlayDismissed = true;
    render();
  }
  workspace.addEventListener('pointerdown', event => {
    if (event.target === workspace) dismissOverlay();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (workspace.classList.contains('pane-overlay-open')) dismissOverlay();
    else if (focused) setFocused(false);
  });
  document.addEventListener('workproof:editor-mode', render);
  new MutationObserver(render).observe(workspace, {attributes: true, attributeFilter: ['data-edit-mode']});
  new ResizeObserver(render).observe(workspace);
  render();
  requestAnimationFrame(() => workspace.classList.add('panes-ready'));
}
