# SPDX-License-Identifier: MIT OR GPL-3.0-or-later
"""Host-independent Krita recorder. No Qt calls or master-token access."""
import datetime
import hashlib
import json
import pathlib
import subprocess
import time
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


class SnapshotBusy(RuntimeError):
    pass


class Transport:
    def __init__(self, port=43127):
        if not isinstance(port, int) or not 1 <= port <= 65535:
            raise ValueError('Invalid local port')
        self.base = 'http://127.0.0.1:' + str(port)
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, route, body=None, token=''):
        if not route.startswith('/v1/') or '?' in route or '#' in route:
            raise ValueError('Invalid collector route')
        raw = None if body is None else json.dumps(body).encode('utf-8')
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = urllib.request.Request(self.base + route, data=raw, headers=headers)
        with self.opener.open(request, timeout=5) as response:
            data = response.read(32 * 1024 * 1024 + 1)
        if len(data) > 32 * 1024 * 1024:
            raise RuntimeError('Collector response exceeds 32 MB')
        return json.loads(data)


def capture(document, now=time.monotonic):
    """Call on Krita's main thread. Names and pixel bytes are never returned."""
    started = now()
    if document is None or not document.fileName():
        raise RuntimeError('请先保存当前 Krita 文档。')
    path = pathlib.Path(document.fileName())
    if not path.is_absolute() or not path.is_file():
        raise RuntimeError('请使用已保存的本地文件。')
    if not document.isIdle():
        raise SnapshotBusy('画布正在处理操作，稍后继续采样。')
    root_node = document.rootNode()
    rows = []
    layers = groups = visible = 0
    stack = [(node, None, order, 1) for order, node in enumerate(root_node.childNodes())]
    while stack:
        node, parent, order, depth = stack.pop()
        if depth > 64 or len(rows) >= 4096 or now() - started > .1:
            raise RuntimeError('图层采样未完成，已暂停记录；请减少复杂度后重试。')
        uid = node.uniqueId().toString()
        kind = node.type()
        shown = bool(node.visible())
        rows.append([uid, parent, order, kind, shown, node.opacity(), node.blendingMode()])
        groups += kind == 'grouplayer'
        is_layer = kind != 'grouplayer' and not kind.endswith('mask')
        layers += is_layer
        visible += shown and is_layer
        stack.extend((child, uid, i, depth + 1) for i, child in enumerate(node.childNodes()))
    rows.sort(key=lambda row: row[0])
    # Fixed-size thumbnail is a change hint, not a full-resolution image commitment.
    image = document.thumbnail(64, 64)
    if image.isNull() or image.width() > 64 or image.height() > 64:
        raise RuntimeError('无法读取画面变化摘要，记录已暂停。')
    size = image.sizeInBytes()
    if size > 65536:
        raise RuntimeError('画面摘要超过采样范围。')
    pixels = image.constBits().asstring(size)
    payload = json.dumps([document.width(), document.height(), rows], separators=(',', ':')).encode()
    tree = hashlib.sha256(b'workproof-krita-tree-v1\0' + payload).hexdigest()
    digest = hashlib.sha256(b'workproof-krita-preview-v1\0' + payload + pixels).hexdigest()
    if now() - started > .2:
        raise RuntimeError('采样耗时过长，已暂停；请稍后继续。')
    return {'identity': (str(path), root_node.uniqueId().toString()), 'path': str(path),
            'tree': tree, 'checkpoint': digest,
            'metrics': {'layers': layers, 'groups': groups, 'visible_layers': visible}}


def fingerprint(engine, filename):
    binary = pathlib.Path(engine)
    if not binary.is_absolute() or not binary.is_file():
        raise RuntimeError('请选择 WorkProof 安装包中的 workproof-engine 程序。')
    result = subprocess.run([str(binary), 'fingerprint', filename], capture_output=True,
                            timeout=60, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError('文件摘要计算失败，请确认文件已保存且不超过 128 MiB。')
    value = json.loads(result.stdout)
    digest = value.get('hash', '')
    if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
        raise RuntimeError('文件摘要无效。')
    return value


class Recorder:
    def __init__(self, request=None, clock=time.monotonic):
        self.request = request or Transport()
        self.clock = clock
        self.token = self.session = ''
        self.identity = None
        self.pending = []
        self.committed = 0
        self.started = 0
        self.elapsed = 0
        self.previous = None
        self.last_sampled = 0

    def connect(self, cancelled=lambda: False, sleep=time.sleep):
        ticket = self.request('/v1/native-pairing', {'source': 'krita'})['ticket']
        if not isinstance(ticket, str) or not 16 <= len(ticket) <= 128 or any(c not in '0123456789abcdef' for c in ticket):
            raise RuntimeError('连接编号无效。')
        for _ in range(120):
            if cancelled():
                raise RuntimeError('已取消连接。')
            result = self.request('/v1/native-pairing/' + ticket)
            if result.get('approved') is True:
                token = result.get('token', '')
                if len(token) != 64 or any(c not in '0123456789abcdef' for c in token):
                    raise RuntimeError('连接授权无效。')
                self.token = token
                return
            sleep(1)
        raise RuntimeError('连接请求已过期，请重新开始并在 WorkProof 中允许连接。')

    def api(self, suffix, body):
        return self.request('/v1/sessions/' + self.session + suffix, body, self.token)

    def start(self, snapshot):
        if self.session:
            raise RuntimeError('当前记录尚未结束。')
        path = pathlib.Path(snapshot['path'])
        result = self.request('/v1/sessions', {'source': 'krita', 'file_name': path.name,
            'local_path': str(path), 'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}, self.token)
        session = result.get('session_id', '')
        if len(session) != 32 or any(c not in '0123456789abcdef' for c in session):
            raise RuntimeError('记录编号无效。')
        self.session = session
        self.identity = snapshot['identity']
        self.started = self.clock()
        self.last_sampled = self.started
        self.previous = snapshot
        self.event('start', snapshot)
        self.flush()

    def event(self, kind, snapshot, metrics=None):
        if snapshot['identity'] != self.identity:
            raise RuntimeError('当前文档已改变，请切回原文档后继续。')
        sequence = self.committed + len(self.pending)
        terminal = kind in ('save', 'gap', 'pause', 'stop')
        if len(self.pending) >= 128 or sequence >= (100000 if terminal else 99984):
            raise RuntimeError('记录达到容量上限，请导出已有记录。')
        self.elapsed = max(self.elapsed, int((self.clock() - self.started) * 1000))
        values = dict(snapshot['metrics'])
        values.update(metrics or {})
        self.pending.append({'seq': self.committed + len(self.pending), 'elapsed_ms': self.elapsed,
            'kind': kind, 'inserted': 0, 'deleted': 0, 'chars': 0,
            'checkpoint': snapshot['checkpoint'], 'metrics': values})

    def sample(self, snapshot, kind=None, metrics=None):
        if snapshot['identity'] != self.identity:
            raise RuntimeError('当前文档已改变，记录已暂停。')
        sampled_at = self.clock()
        if sampled_at - self.last_sampled > 15:
            self.event('gap', snapshot)
        self.last_sampled = sampled_at
        if kind or snapshot['checkpoint'] != self.previous['checkpoint']:
            kind = kind or ('layer' if snapshot['tree'] != self.previous['tree'] else 'edit')
            self.event(kind, snapshot, metrics)
            self.previous = snapshot
        self.flush()

    def flush(self):
        if not self.pending:
            return
        # A lost response retains identical event fields, sequence and timestamp.
        result = self.api('/events', {'events': self.pending})
        expected = self.committed + len(self.pending)
        if result.get('next_seq') != expected:
            raise RuntimeError('收集器未确认全部记录，待提交动作已保留。')
        self.committed = expected
        self.pending = []

    def export(self, snapshot, engine, output):
        if snapshot['identity'] != self.identity:
            raise RuntimeError('请切回原文档后导出。')
        destination = pathlib.Path(output) if output else None
        if destination and destination.exists():
            raise RuntimeError('证书文件已存在，请另选保存位置。')
        self.sample(snapshot)
        before = pathlib.Path(snapshot['path']).stat()
        value = fingerprint(engine, snapshot['path'])
        final = dict(snapshot, checkpoint=value['hash'])
        self.event('save', final)
        self.flush()
        proof = self.api('/export', {'artifact_hash': value['hash'], 'artifact_bytes': value['bytes']})
        raw = json.dumps(proof, ensure_ascii=False, indent=2).encode('utf-8')
        after = pathlib.Path(snapshot['path']).stat()
        if before.st_mtime_ns != after.st_mtime_ns or before.st_size != after.st_size:
            raise RuntimeError('导出期间文件发生变化，请重新保存后导出。')
        if destination is None:
            return raw
        # Do not silently replace a previous certificate.
        with destination.open('xb') as stream:
            stream.write(raw)
        return str(destination)
