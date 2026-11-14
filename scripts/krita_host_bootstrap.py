"""Actions-only driver loaded by Krita's normal Python Plugin Manager."""
import json
import os
import sys
import traceback
from PyQt5.QtCore import QTimer
from PyQt5.QtWidgets import QApplication

assert os.environ.get('GITHUB_ACTIONS') == 'true'
print('WORKPROOF_HOST bootstrap loaded', flush=True)

def run():
    print('WORKPROOF_HOST driver started', flush=True)
    try:
        assert 'workproof' in sys.modules, 'Krita did not load the enabled packaged plugin'
        from krita_host_acceptance import __main__
        __main__(json.loads(os.environ['WORKPROOF_HOST_ARGS']))
    except BaseException:
        traceback.print_exc()
        QTimer.singleShot(0, lambda: QApplication.exit(1))
    else:
        # Let the driver frame and its libkis document, node and window wrappers
        # unwind before Krita tears down the owning windows and image resources.
        QTimer.singleShot(0, QApplication.quit)

QTimer.singleShot(1500, run)
