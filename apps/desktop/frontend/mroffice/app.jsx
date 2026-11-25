import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {configureEditors, EditorHostProvider} from 'mroffice-core';
import 'mroffice-docs/style.self-hosted.css';
import {editors, fullEngineFormats} from './catalog.js';
import {eventCount, fileSummary, listFiles, persist, readFile, recentEvents} from './storage.js';

configureEditors({assetsBaseUrl: new URL('./mroffice/assets/', document.baseURI).href});
const MAX_FILE = 32 * 1024 * 1024;
const interactions = {
  copy: '复制', cut: '剪切', paste: '粘贴', drop: '拖放',
  compositionstart: '开始输入法合成', compositionend: '完成输入法合成',
  dragstart: '开始拖动', dragend: '结束拖动',
};
const inputs = {
  insertText: '输入文字', insertParagraph: '换段', insertLineBreak: '换行',
  deleteContentBackward: '退格', deleteContentForward: '删除',
  historyUndo: '撤销', historyRedo: '重做', formatBold: '加粗',
  formatItalic: '斜体', formatUnderline: '下划线',
};

class EditorErrorBoundary extends React.Component {
  state = {failed: false};

  static getDerivedStateFromError() { return {failed: true}; }

  render() {
    if (this.state.failed) return <p className="office-empty" role="alert">文件未能打开。请选择其他文件或重新打开当前文档。</p>;
    return this.props.children;
  }
}

function Workspace() {
  const [kind, setKind] = useState('docs');
  const [active, setActive] = useState(null);
  const [files, setFiles] = useState([]);
  const [events, setEvents] = useState([]);
  const [showEvents, setShowEvents] = useState(false);
  const [earlierEvents, setEarlierEvents] = useState([]);
  const [status, setStatus] = useState('选择编辑器，新建或打开本机文件。');
  const [busy, setBusy] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const [supportedFormats, setSupportedFormats] = useState(null);
  const fileInput = useRef(null);
  const surface = useRef(null);
  const current = useRef(null);
  const saver = useRef(null);
  const pending = useRef([]);
  const saving = useRef(null);
  const opening = useRef(false);
  const openWord = useRef(null);
  const timer = useRef(null);
  const earliest = earlierEvents.at(-1) || events.at(-1);
  const selected = editors[kind];

  function error(cause) {
    setStatus(cause instanceof Error ? cause.message : '操作失败，请重试。');
  }

  function queue(action, change = false) {
    const file = current.current;
    if (!file) return;
    const now = Date.now();
    const last = pending.current.at(-1);
    if (last && last.action === action && last.change === change && now - last.endedAt <= 750) {
      last.count++;
      last.endedAt = now;
    } else {
      pending.current.push({fileId: file.id, action, change, at: now, endedAt: now, count: 1});
    }
    if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        flush().catch(error);
      }, 850);
    }
  }

  async function snapshot(file, getFile) {
    if (!getFile || !editors[file.kind].save) return file;
    const out = await getFile();
    const bytes = out.bytes instanceof Blob ? new Uint8Array(await out.bytes.arrayBuffer()) : out.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE) {
      throw new Error('无法保存此版本，文件超过 32 MiB 或没有返回有效数据。');
    }
    return {...file, name: out.name, bytes, mime: out.type, savedAt: Date.now()};
  }

  async function flush(forced = false) {
    clearTimeout(timer.current);
    timer.current = null;
    if (saving.current) {
      await saving.current;
      return flush(forced);
    }
    const file = current.current;
    if (!file || (!forced && !pending.current.length)) return;
    const batch = pending.current;
    pending.current = [];
    saving.current = (async () => {
      let next = file;
      let recorded;
      try {
        if (forced || batch.some(event => event.change)) next = await snapshot(file, saver.current);
        recorded = await persist(next === file ? null : next, batch);
      } catch (cause) {
        pending.current = [...batch, ...pending.current];
        throw cause;
      }
      current.current = next;
      if (next !== file) setFiles(items => [fileSummary(next), ...items.filter(item => item.id !== file.id)]);
      if (recorded.length) setEvents(items => [...recorded.reverse(), ...items].slice(0, 100));
      if (forced || next !== file) setStatus('已保存到本机。');
    })();
    try { await saving.current; }
    finally { saving.current = null; }
  }

  useEffect(() => {
    listFiles().then(setFiles).catch(error);
    const bridge = {flush: async () => {
      if (opening.current) throw new Error('正在打开文件，请稍候。');
      await flush();
    }, openWord: document => openWord.current(document)};
    window.workproofMROffice = bridge;
    window.dispatchEvent(new Event('workproof-mroffice-ready'));
    return () => {
      clearTimeout(timer.current);
      delete window.workproofMROffice;
    };
  }, []);

  useEffect(() => {
    if (kind !== 'code') return;
    let disposed = false;
    editors.code.load().then(module => {
      if (!disposed) setSupportedFormats(module.CODE_EXTENSIONS.join(','));
    }).catch(error);
    return () => { disposed = true; };
  }, [kind]);

  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    function observe(event) {
      if (!event.isTrusted) return;
      if (event.type === 'input') {
        queue(inputs[event.inputType] || '输入或调整内容', true);
      } else if (event.type === 'change') {
        queue('调整编辑器选项', true);
      } else if (event.type === 'click') {
        const button = event.target.closest?.('button,[role="button"],[role="menuitem"],[role="tab"]');
        if (!button) return;
        const label = button.getAttribute('aria-label') || button.getAttribute('title');
        // Command names are metadata. Avoid capturing document or menu item text.
        queue(label ? '命令 · ' + label.slice(0, 80) : '执行编辑器命令');
      } else if (event.type === 'keydown') {
        const command = (event.ctrlKey || event.metaKey) && !event.altKey;
        if (command && ['z', 'y'].includes(event.key.toLowerCase())) {
          queue(event.key.toLowerCase() === 'y' || event.shiftKey ? '重做快捷键' : '撤销快捷键', true);
        } else if (['Backspace', 'Delete', 'Enter', ' ', 'Tab'].includes(event.key) && !event.isComposing) {
          queue({Backspace:'退格键',Delete:'删除键',Enter:'回车键',' ':'空格键',Tab:'制表键'}[event.key]);
        }
      } else if (event.type === 'pointerup' && event.target.closest?.('canvas,.ProseMirror,svg')) {
        const kind = current.current?.kind;
        if (kind === 'ink') queue('手写画布操作', true);
        if (kind === 'pdf' && !event.target.closest('button,[role="button"]')) queue('PDF 页面操作');
      } else if (interactions[event.type]) queue(interactions[event.type], ['cut','paste','drop'].includes(event.type));
    }
    const types = ['input','change','click','keydown','pointerup',...Object.keys(interactions)];
    for (const type of types) root.addEventListener(type, observe, true);
    return () => { for (const type of types) root.removeEventListener(type, observe, true); };
  }, [active]);

  const registerSave = useRef(save => {
    saver.current = save;
    setCanSave(true);
    return () => {
      if (saver.current === save) {
        saver.current = null;
        setCanSave(false);
      }
    };
  }).current;

  async function open(targetKind, loadFile, propagateError = false) {
    if (opening.current) {
      if (propagateError) throw new Error('正在打开文件，请稍候。');
      return;
    }
    opening.current = true;
    setBusy(true);
    try {
      const {default: editor} = await editors[targetKind].load();
      await flush();
      const file = await loadFile(editor);
      const records = await recentEvents(file.id);
      await persist(file, []);
      saver.current = null;
      setCanSave(false);
      current.current = file;
      setFiles(items => [fileSummary(file), ...items.filter(item => item.id !== file.id)]);
      setActive({file, Component: editor.Component, mount: crypto.randomUUID()});
      setKind(targetKind);
      setEvents(records);
      setEarlierEvents([]);
      setStatus(file.kind === 'pdf' ? '已打开。批注记录保存在本机。' : '已打开，自动保存到本机。');
      queue(records.length ? '重新打开文件' : '打开文件');
    } catch (cause) {
      error(cause);
      if (propagateError) throw cause;
    }
    finally { opening.current = false; setBusy(false); }
  }

  const openFormats = kind === 'code' && supportedFormats ? supportedFormats : selected.open;

  openWord.current = async ({id, revision, title, content}) => {
    const {mrdocBytes} = await editors.docs.load();
    const existing = files.find(file => file.workproof?.id === id && file.workproof.revision === revision);
    await open('docs', () => existing ? readFile(existing.id) : ({
      id: crypto.randomUUID(), kind: 'docs', name: title + '.mrdoc',
      bytes: mrdocBytes(title, content), workproof: {id, revision}, savedAt: Date.now(),
    }), true);
  };

  async function returnToWorkProof() {
    try {
      await flush(true);
      const file = current.current;
      const editor = surface.current.querySelector('.ProseMirror.note-editor-content')?.editor;
      if (!file?.workproof || !editor) throw new Error('请等待 Word 文档加载完成。');
      await window.parent.workproofReturnFromMROffice(file.workproof, editor.getJSON(), editor.schema,
        await eventCount(file.id));
    } catch (cause) { error(cause); }
  }

  function selectFile(event) {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    if (picked.size > MAX_FILE || !openFormats.split(',').some(ext => picked.name.toLowerCase().endsWith(ext))) {
      setStatus('请选择不超过 32 MiB 的受支持文件。');
      return;
    }
    void open(kind, async () => ({
      id: crypto.randomUUID(), kind, name: picked.name, bytes: new Uint8Array(await picked.arrayBuffer()), savedAt: Date.now(),
    }));
  }

  function create() {
    void open(kind, async editor => {
      const fresh = editor.newFile?.();
      if (!fresh) throw new Error('请使用“打开文件”。');
      return {...fresh, id: crypto.randomUUID(), kind, savedAt: Date.now()};
    });
  }

  async function save(download = false) {
    try {
      queue(download ? '导出文件' : '保存版本');
      await flush(true);
      const file = current.current;
      if (!download || !file || !editors[file.kind].save) return;
      downloadFile({name: file.name, data: new Blob([file.bytes], {type: file.mime})});
    } catch (cause) { error(cause); }
  }

  async function loadEarlier() {
    try {
      const file = current.current;
      if (!file || !earliest) return;
      const records = await recentEvents(file.id, 100, earliest.recordId);
      if (current.current?.id !== file.id) return;
      if (!records.length) setStatus('已到最早的操作。');
      setEarlierEvents(items => {
        const existing = new Set(items.map(item => item.recordId));
        return [...items, ...records.filter(item => !existing.has(item.recordId))];
      });
    } catch (cause) { error(cause); }
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  const host = {
    saveFile: file => {
      if (current.current?.workproof) {
        setStatus('请保存并切回 WorkProof，再导出 Word 文件和证书。');
        return;
      }
      queue('编辑器导出');
      downloadFile(file);
    },
    notify: message => setStatus(message.description || message.title || ''),
  };

  return <main className="office-shell">
    <header className="office-toolbar">
      <a href="https://mroffice.ai" target="_blank" rel="noreferrer">MR Office</a>
      <label>编辑器<select value={kind} disabled={busy} onChange={event => setKind(event.target.value)}>
        {Object.entries(editors).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}
      </select></label>
      <button disabled={busy || kind === 'pdf'} onClick={create}>新建</button>
      <button disabled={busy} onClick={() => fileInput.current.click()}>打开文件</button>
      <input ref={fileInput} type="file" accept={openFormats} hidden onChange={selectFile}/>
      <label>本机文档<select disabled={busy} value={active?.file.id || ''} onChange={event => {
        const file = files.find(item => item.id === event.target.value);
        if (file) void open(file.kind, () => current.current?.id === file.id ? current.current : readFile(file.id));
      }}>
        <option value="">选择文档</option>
        {files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}
      </select></label>
      {!active?.file.workproof && <button disabled={!canSave || busy || !editors[active?.file.kind]?.save} onClick={() => void save(true)}>导出文件</button>}
      {active?.file.workproof && <button disabled={busy} onClick={() => void returnToWorkProof()}>保存并切回 WorkProof</button>}
      <button type="button" aria-pressed={showEvents} onClick={() => setShowEvents(!showEvents)}>操作记录</button>
      {active && <details><summary>支持的格式</summary><span>{openFormats.split(',').join('、')}</span></details>}
    </header>
    <p className="office-status" role="status">{busy ? '正在打开编辑器…' : status}</p>
    <div className="office-layout">
      <div ref={surface} className="office-surface" inert={busy}>
        {active ? <EditorErrorBoundary key={active.file.id + ':' + active.mount}>
          <EditorHostProvider locale="zh" host={host}>
            <active.Component file={active.file} registerSave={registerSave}
              onSaveRequest={() => void save()} onDirty={() => queue('内容已更改', true)}/>
          </EditorHostProvider>
        </EditorErrorBoundary> : <div className="office-empty">
          <h1>{selected.label}编辑器</h1>
          <p>可打开 {openFormats.split(',').join('、')}</p>
          <p>{selected.save ? '可保存 ' + selected.save : '批注仅在当前编辑器中查看。'}</p>
          <details className="office-format-details">
            <summary>MR Office 完整引擎的格式</summary>
            <p>以下为上游格式清单。当前离线组件可打开的格式以本页上方为准。</p>
            <table>
              <thead><tr><th scope="col">类型</th><th scope="col">可编辑并原格式保存</th><th scope="col">可预览</th></tr></thead>
              <tbody>{fullEngineFormats.map(([label, editable, preview]) => <tr key={label}>
                <th scope="row">{label}</th><td>{editable}</td><td>{preview}</td>
              </tr>)}</tbody>
            </table>
            <p>部分预览格式取决于上游部署的转换组件。<a href="https://mroffice.ai/en/developers/embed/formats" target="_blank" rel="noreferrer">官方格式说明</a></p>
          </details>
          <p><a href="https://github.com/XinaTian/MROffice/tree/2e69eb18f2676ef689dc994f84af1c429dea2d2f" target="_blank" rel="noreferrer">编辑器源码</a>
            {' · '}<a href="https://github.com/XinaTian/MROffice/tree/f0a2168e1a0a3f877e96158bf1e0f347cf6d6c28" target="_blank" rel="noreferrer">手写组件源码</a>
            {' · '}<a href="mroffice/notices/docs/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a></p>
        </div>}
      </div>
      {showEvents && <aside className="office-log" aria-label="操作记录">
        <h2>操作记录</h2>
        <ol>{[...events, ...earlierEvents].map(event => <li key={event.recordId}>
          {event.action}{event.count > 1 && ' × ' + event.count}
          <time>{new Date(event.at).toLocaleTimeString('zh-CN')}</time>
        </li>)}</ol>
        {events.length === 100 && <button onClick={() => void loadEarlier()}>查看更早记录</button>}
      </aside>}
    </div>
  </main>;
}

createRoot(document.getElementById('office-root')).render(<Workspace/>);
