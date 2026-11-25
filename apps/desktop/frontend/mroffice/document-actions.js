// The document component exposes its ProseMirror editor on the content element.
// Record transaction structure and intent without copying inserted text.
export function observeDocumentActions(root, record) {
  const subscribed = new Map();
  function observe() {
    const found = new Set(Array.from(root.querySelectorAll('.ProseMirror.note-editor-content'))
      .map(element => element.editor).filter(editor => editor?.on && !editor.isDestroyed));
    for (const [editor, listener] of subscribed) {
      if (found.has(editor)) continue;
      editor.off('transaction', listener);
      subscribed.delete(editor);
    }
    for (const editor of found) {
      if (subscribed.has(editor)) continue;
      const listener = ({transaction}) => {
        if (!transaction.docChanged || transaction.getMeta('addToHistory') === false) return;
        let inserted = 0;
        let deleted = 0;
        for (const map of transaction.mapping.maps) {
          map.forEach((from, to, newFrom, newTo) => {
            inserted += newTo - newFrom;
            deleted += to - from;
          });
        }
        const label = inserted && deleted ? '替换正文内容'
          : inserted ? '新增正文内容' : deleted ? '删除正文内容' : '修改正文格式或属性';
        record(label, true);
      };
      editor.on('transaction', listener);
      subscribed.set(editor, listener);
    }
  }
  const observer = new MutationObserver(observe);
  observer.observe(root, {childList: true, subtree: true});
  observe();
  return () => {
    observer.disconnect();
    for (const [editor, listener] of subscribed) editor.off('transaction', listener);
  };
}
