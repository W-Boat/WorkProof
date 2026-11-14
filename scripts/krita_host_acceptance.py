"""Executed inside official kritarunner, never an ordinary Python interpreter."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time
from unittest.mock import patch


def __main__(args):
    from krita import Krita
    from PyQt5.QtCore import QT_VERSION_STR, PYQT_VERSION_STR
    from PyQt5.QtWidgets import QApplication
    from workproof.core import Recorder, Transport, capture
    from workproof.docker import WorkProofDocker, QFileDialog

    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Actions-only host fixture'
    harness, engine, directory, report, digest = args
    directory = Path(directory).resolve()
    assert directory.is_relative_to(Path(os.environ['RUNNER_TEMP']).resolve())
    process = subprocess.Popen([harness], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, text=True, env=dict(os.environ, WORKPROOF_DATA_DIR=str(directory)))
    document = second = None
    try:
        for _ in range(150):
            assert process.poll() is None, 'Collector exited'
            if (directory/'connection.json').is_file():
                break
            time.sleep(.05)
        assert (directory/'connection.json').is_file(), 'Collector did not initialize'
        transport = Transport()
        def request(route, body=None, token=''):
            result = transport(route, body, token)
            if route == '/v1/native-pairing':
                process.stdin.write(json.dumps({'ticket':result['ticket'],'approve':True})+'\n')
                process.stdin.flush()
            return result
        app = Krita.instance()
        app.setBatchmode(True)
        window = app.openWindow()
        window.qwindow().show()
        document = app.createDocument(128,128,'WorkProof native fixture','RGBA','U8','',72.)
        assert document, 'Could not create native document'
        document.setBatchmode(True)
        window.addView(document)
        artifact = directory/'native-fixture.kra'
        assert document.saveAs(str(artifact)), 'Native KRA save failed'
        document.waitForDone()
        QApplication.processEvents()
        dock = next((item for item in app.dockers() if isinstance(item,WorkProofDocker)),None)
        assert dock is not None, 'Packaged plugin factory did not create docker'
        dock.show()
        dock.timer.stop()  # Explicit samples below make host timing deterministic.
        dock.recorder = Recorder(request)
        dock.settings.setValue('engine',engine)
        document.thumbnail(64,64)  # Warm the host's first thumbnail setup.
        first = capture(document)
        def wait_for(predicate, label, seconds=20):
            until=time.monotonic()+seconds
            while time.monotonic()<until:
                QApplication.processEvents()
                if predicate():
                    return
                time.sleep(.01)
            raise AssertionError(label+': '+dock.status.text())
        dock.buttons[0].click()
        wait_for(lambda:bool(dock.recorder.session) and not dock.busy and not dock.paused,'Real start button')
        baseline = dock.recorder.committed
        added = document.createNode('PRIVATE LAYER NAME DO NOT PUBLISH','paintlayer')
        assert document.rootNode().addChildNode(added,None), 'Could not add native layer'
        document.refreshProjection()
        document.waitForDone()
        current = capture(document)
        assert current['metrics']['layers']==first['metrics']['layers']+1, 'Native layer count'
        dock.sample()
        wait_for(lambda:not dock.busy,'Native layer sample')
        assert dock.recorder.committed>baseline, 'Native layer edit missing'
        assert dock.recorder.previous['checkpoint']==current['checkpoint']
        # Change actual pixels; a same-count paint edit must change the preview digest.
        before_paint = capture(document)
        assert added.setPixelData(bytes([0,0,255,255])*128*128,0,0,128,128), 'Native pixel write'
        document.refreshProjection()
        document.waitForDone()
        painted = capture(document)
        assert painted['tree']==before_paint['tree'], 'Painting changed structure unexpectedly'
        assert painted['checkpoint']!=before_paint['checkpoint'], 'Native pixels not detected'
        dock.sample()
        wait_for(lambda:not dock.busy,'Native paint sample')
        # Trigger the actual host QAction. This tests command observation, not undoability of API writes.
        action = app.action('edit_undo')
        assert action is not None, 'Native undo QAction unavailable'
        action.trigger()
        QApplication.processEvents()
        assert dock.pending_commands.get('undo_commands',0)>=1, 'Native command hook missing'
        document.waitForDone()
        dock.sample()
        wait_for(lambda:not dock.busy,'Undo command sample')
        output = directory/'native-fixture.kra.wproof'
        with patch.object(QFileDialog,'getSaveFileName',return_value=(str(output),'WorkProof (*.wproof)')):
            dock.buttons[2].click()
            wait_for(lambda:not dock.busy and output.is_file(),'Real export button',seconds=60)
        proof = json.loads(output.read_text())
        kinds=[row['event']['kind'] for row in proof['records']]
        assert 'layer' in kinds and 'edit' in kinds and kinds[-1]=='save', 'Native event kinds missing'
        assert any(row['event'].get('metrics',{}).get('undo_commands',0)>0 for row in proof['records'])
        assert 'PRIVATE LAYER NAME DO NOT PUBLISH' not in json.dumps(proof)
        assert str(directory) not in json.dumps(proof), 'Path leaked into public certificate'
        verified = subprocess.run([engine,'verify',str(artifact),str(output)],capture_output=True)
        assert verified.returncode==0, 'Native KRA certificate rejected'
        tampered=directory/'changed.kra'
        tampered.write_bytes(artifact.read_bytes()+b'tampered')
        assert subprocess.run([engine,'verify',str(tampered),str(output)],capture_output=True).returncode!=0
        before_switch=dock.recorder.committed
        second=app.createDocument(64,64,'Other document','RGBA','U8','',72.)
        second.setBatchmode(True)
        window.addView(second)
        assert second.saveAs(str(directory/'other.kra'))
        second.waitForDone()
        app.setActiveDocument(second)
        QApplication.processEvents()
        dock.paused=False
        dock.sample()
        wait_for(lambda:not dock.busy,'Switched document sample')
        assert dock.paused and dock.recorder.committed==before_switch, 'Switched document entered old session'
        dock.grab().save(str(Path(report).with_suffix('.png')))
        result={'passed':True,'host':app.version(),'qt':QT_VERSION_STR,'pyqt':PYQT_VERSION_STR,
            'plugin_sha256':digest,'events':len(proof['records']),
            'checks':['packaged plugin import and docker factory','real start button and collector approval',
                'native KRA save','native layer creation','native pixel change with same layer count',
                'native undo QAction observation','real export button with mocked destination chooser',
                'actual KRA BLAKE3/signature verification','tamper rejection','document switch isolation'],
            'limitations':['Linux distribution host only','not physical mouse/tablet stroke replay',
                'destination chooser mocked','Python-plugin-manager import UI not exercised','Windows and Qt6 not exercised']}
        Path(report).write_text(json.dumps(result,indent=2),encoding='utf-8')
    finally:
        process.terminate()
        process.wait(timeout=10)
        if second:
            second.setModified(False)
            second.close()
        if document:
            document.setModified(False)
            document.close()
