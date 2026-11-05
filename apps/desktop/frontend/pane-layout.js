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
    const automatic = {ribbon: !markdown && width >= 580, outline: width >= 1150, inspector: width >= 960};
    const visible = {};
    for (const name of Object.keys(panes)) {
      visible[name] = !focused && (preferences[name] === 'open' || (preferences[name] === 'auto' && automatic[name]));
    }
    if (compact) {
      if (overlayDismissed) visible.outline = visible.inspector = false;
      else if (visible.outline && visible.inspector) visible[lastOpened === 'outline' ? 'inspector' : 'outline'] = false;
    }
    workspace.classList.toggle('panes-overlay', compact);
    workspace.classList.toggle('pane-overlay-open', compact && (visible.outline || visible.inspector));
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
      if (focused) focused = false;
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
    focused = false;
    overlayDismissed = false;
    if (select.value === 'open') lastOpened = name;
    render();
  });
  focusButton?.addEventListener('click', () => { focused = !focused; render(); });
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
    else if (focused) { focused = false; render(); }
  });
  document.addEventListener('workproof:editor-mode', render);
  new MutationObserver(render).observe(workspace, {attributes: true, attributeFilter: ['data-edit-mode']});
  new ResizeObserver(render).observe(workspace);
  render();
  requestAnimationFrame(() => workspace.classList.add('panes-ready'));
}
