"""Krita core simulations plus real collector acceptance; not a real Krita host test."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('krita_core', ROOT / 'apps/krita/workproof/core.py')
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


def snapshot(path, digest='a' * 64):
    return {'identity': (str(path), 'private-document-id'), 'path': str(path),
            'checkpoint': digest, 'tree': 'b' * 64,
            'metrics': {'layers': 2, 'groups': 1, 'visible_layers': 1}}


class CaptureTests(unittest.TestCase):
    def test_tree_and_pixels_change_without_exposing_content(self):
        class Node:
            opacity_value = 255
            def __init__(self, uid, children=()):
                self.uid, self.children = uid, children
            def uniqueId(self): return self
            def toString(self): return self.uid
            def type(self): return 'grouplayer' if self.children else 'paintlayer'
            def visible(self): return True
            def opacity(self): return self.opacity_value
            def blendingMode(self): return 'normal'
            def childNodes(self): return self.children
        class Image:
            pixels = b'private preview bytes'
            def isNull(self): return False
            def width(self): return 64
            def height(self): return 64
            def sizeInBytes(self): return len(self.pixels)
            def constBits(self): return self
            def asstring(self, size): return self.pixels[:size]
        class Document:
            idle = True
            def fileName(self): return str(artifact)
            def tryBarrierLock(self): return self.idle
            def unlock(self): self.unlocks = getattr(self, 'unlocks', 0) + 1
            def rootNode(self): return root_node
            def thumbnail(self, width, height): return image
            def width(self): return 1024
            def height(self): return 768
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'art.kra'
            artifact.write_bytes(b'fixture')
            leaf = Node('private-node-id')
            root_node = Node('private-root-id', [leaf])
            image = Image()
            document = Document()
            first = core.capture(document, now=lambda: 1)
            self.assertEqual(first['metrics'], {'layers': 1, 'groups': 0, 'visible_layers': 1})
            self.assertNotIn('private preview bytes', json.dumps(first))
            self.assertNotIn('private-node-id', json.dumps(first))
            self.assertEqual(document.unlocks, 1)
            image.pixels = b'changed preview bytes'
            second = core.capture(document, now=lambda: 1)
            self.assertEqual(first['tree'], second['tree'])
            self.assertNotEqual(first['checkpoint'], second['checkpoint'])
            leaf.opacity_value = 100
            third = core.capture(document, now=lambda: 1)
            self.assertNotEqual(second['tree'], third['tree'])
            document.idle = False
            with self.assertRaises(core.SnapshotBusy):
                core.capture(document, now=lambda: 1)
            document.idle = True
            root_node.children = [leaf] * 4097
            with self.assertRaises(RuntimeError):
                core.capture(document, now=lambda: 1)
            self.assertEqual(document.unlocks, 4)


class RecorderTests(unittest.TestCase):
    def test_changed_document_cannot_submit_or_export(self):
        calls = []
        recorder = core.Recorder(lambda *args: calls.append(args))
        recorder.identity = ('original', 'id')
        recorder.session = 'd' * 32
        with self.assertRaises(RuntimeError):
            recorder.sample(snapshot('/other.kra'))
        with self.assertRaises(RuntimeError):
            recorder.export(snapshot('/other.kra'), '/engine', None)
        self.assertEqual(calls, [])

    def test_lost_response_retains_exact_events(self):
        calls = []
        def request(route, body, token):
            calls.append(json.dumps(body))
            if len(calls) == 1:
                raise OSError('lost response')
            return {'next_seq': 1}
        recorder = core.Recorder(request, lambda: 10)
        frame = snapshot('/work.kra')
        recorder.identity = frame['identity']
        recorder.session = 'd' * 32
        recorder.event('edit', frame)
        with self.assertRaises(OSError):
            recorder.flush()
        self.assertEqual(recorder.committed, 0)
        recorder.flush()
        self.assertEqual(calls[0], calls[1])
        self.assertEqual(recorder.committed, 1)
        self.assertEqual(recorder.pending, [])

    def test_queue_bound_keeps_existing_records(self):
        recorder = core.Recorder(clock=lambda: 10)
        frame = snapshot('/work.kra')
        recorder.identity = frame['identity']
        for _ in range(128):
            recorder.event('edit', frame)
        before = json.dumps(recorder.pending)
        with self.assertRaises(RuntimeError):
            recorder.event('edit', frame)
        self.assertEqual(json.dumps(recorder.pending), before)

    def test_busy_gap_is_explicit_without_text_counts(self):
        sent = []
        recorder = core.Recorder(lambda route, body, token: sent.extend(body['events']) or {'next_seq': 1}, lambda: 20)
        frame = snapshot('/work.kra')
        recorder.identity = frame['identity']
        recorder.previous = frame
        recorder.session = 'd' * 32
        recorder.sample(frame)
        self.assertEqual(sent[0]['kind'], 'gap')
        self.assertEqual(sent[0]['inserted'], 0)

    def test_export_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / 'existing.wproof'
            file.write_bytes(b'keep')
            recorder = core.Recorder()
            frame = snapshot('/work.kra')
            recorder.identity = frame['identity']
            with self.assertRaises(RuntimeError):
                recorder.export(frame, '/engine', file)
            self.assertEqual(file.read_bytes(), b'keep')

    def test_cancel_does_not_poll_or_read_master_token(self):
        calls = []
        recorder = core.Recorder(lambda *args: calls.append(args) or {'ticket': 'e' * 32})
        with self.assertRaises(RuntimeError):
            recorder.connect(lambda: True)
        self.assertEqual(len(calls), 1)
        self.assertFalse(recorder.token)


def real_collector(harness, engine):
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise RuntimeError('Actions isolation required')
    with tempfile.TemporaryDirectory(prefix='workproof-krita-') as directory:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen([str(Path(harness).resolve())], stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True,
            env=dict(os.environ, WORKPROOF_DATA_DIR=directory, WORKPROOF_HARNESS_PORT=str(port)))
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError('Collector exited')
                if (Path(directory) / 'connection.json').is_file():
                    break
                time.sleep(.05)
            info = json.loads((Path(directory) / 'connection.json').read_text())
            http = core.Transport(port)
            calls = []
            ticket = None
            def request(route, body=None, token=''):
                nonlocal ticket
                calls.append((route, body))
                result = http(route, body, token)
                if route == '/v1/native-pairing':
                    ticket = result['ticket']
                    process.stdin.write(json.dumps({'ticket': ticket, 'approve': True}) + '\n')
                    process.stdin.flush()
                return result
            recorder = core.Recorder(request)
            recorder.connect(sleep=lambda _: time.sleep(.02))
            artifact = Path(directory) / 'fixture.kra'
            artifact.write_bytes(b'synthetic artifact bytes, not an actual Krita document')
            frame = snapshot(artifact)
            recorder.start(frame)
            recorder.sample(dict(frame, checkpoint='c' * 64), 'layer')
            output = Path(directory) / 'fixture.kra.wproof'
            recorder.export(frame, str(Path(engine).resolve()), output)
            proof = json.loads(output.read_text())
            assert proof['manifest']['source'] == 'krita'
            assert proof['records'][-1]['event']['kind'] == 'save'
            assert all(r['event']['chars'] == 0 for r in proof['records'])
            # No pixels, names or persistent node identities in event payloads.
            assert 'private-document-id' not in json.dumps(proof)
            check = subprocess.run([engine, 'verify', str(artifact), str(output)], capture_output=True)
            assert check.returncode == 0, 'Actual engine rejected certificate'
            def denied(route, body=None, expected=403):
                try:
                    http(route, body, recorder.token)
                except HTTPError as error:
                    assert error.code == expected
                else:
                    raise AssertionError('Scope escape')
            denied('/v1/status')
            denied('/v1/sessions', {'file_name': 'wrong.docx', 'started_at': '2026-11-14', 'source': 'word'})
            foreign = http('/v1/sessions', {'file_name': 'foreign.kra', 'started_at': '2026-11-14', 'source': 'krita'}, info['token'])['session_id']
            denied('/v1/sessions/' + foreign + '/export', {'artifact_hash': 'a' * 64, 'artifact_bytes': 1})
            artifact.write_bytes(b'tampered artifact')
            assert subprocess.run([engine, 'verify', str(artifact), str(output)], capture_output=True).returncode != 0
            process.stdin.write(json.dumps({'revoke': ticket}) + '\n')
            process.stdin.flush()
            time.sleep(.1)
            denied('/v1/sessions/' + recorder.session + '/export', {'artifact_hash': 'a' * 64, 'artifact_bytes': 1}, expected=401)
            print('Real collector: approval, Krita source, signed export, file tamper and scope isolation passed; Krita host not exercised')
        finally:
            process.terminate()
            process.wait(timeout=10)


if __name__ == '__main__':
    if len(sys.argv) == 3:
        real_collector(*sys.argv[1:])
    else:
        unittest.main()
