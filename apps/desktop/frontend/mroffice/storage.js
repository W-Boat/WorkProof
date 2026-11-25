const DATABASE = 'workproof-mroffice';
let opened;

function database() {
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files', {keyPath: 'id'});
        const entries = request.result.createObjectStore('events', {autoIncrement: true});
        entries.createIndex('file', 'fileId');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('请先关闭其他 MR Office 编辑窗口。'));
    }).catch(error => { opened = undefined; throw error; });
  }
  return opened;
}

export function fileSummary({id, kind, name, savedAt, workproof, archived}) {
  return {id, kind, name, savedAt, workproof, archived};
}

export async function manageFile(id, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['files', 'events'], 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('本机文件未能更新。'));
    const files = tx.objectStore('files');
    if (action === 'delete') {
      files.delete(id);
      const request = tx.objectStore('events').index('file').openCursor(IDBKeyRange.only(id));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
    } else {
      const request = files.get(id);
      request.onsuccess = () => {
        if (request.result) files.put({...request.result, archived:action === 'archived'});
      };
    }
  });
}

export async function listFiles() {
  const db = await database();
  return new Promise((resolve, reject) => {
    const files = [];
    const request = db.transaction('files').objectStore('files').openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(files.sort((a, b) => b.savedAt - a.savedAt)); return; }
      files.push(fileSummary(cursor.value));
      cursor.continue();
    };
  });
}

export async function readFile(id) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('files').objectStore('files').get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (request.result) resolve(request.result);
      else reject(new Error('本机找不到这份文件。'));
    };
  });
}

export async function recentEvents(fileId, maximum = 100, before = Infinity) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const found = [];
    const request = db.transaction('events').objectStore('events').index('file')
      .openCursor(IDBKeyRange.only(fileId), 'prev');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || found.length === maximum) { resolve(found); return; }
      if (cursor.primaryKey < before) found.push({...cursor.value, recordId: cursor.primaryKey});
      cursor.continue();
    };
  });
}

export async function eventCount(fileId) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const request = db.transaction('events').objectStore('events').index('file').count(fileId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function persist(file, events) {
  const db = await database();
  return new Promise((resolve, reject) => {
    // Keep the saved state and the events reflected by it in the same commit.
    const tx = db.transaction(['files', 'events'], 'readwrite');
    const recorded = [];
    tx.oncomplete = () => resolve(recorded);
    tx.onabort = () => reject(tx.error || new Error('本机存储写入失败。'));
    if (file) tx.objectStore('files').put(file);
    const entries = tx.objectStore('events');
    for (const event of events) {
      const request = entries.add(event);
      request.onsuccess = () => recorded.push({...event, recordId: request.result});
    }
  });
}
