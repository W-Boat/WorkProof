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
        QApplication.exit(1)
    else:
        QApplication.exit(0)

QTimer.singleShot(1500, run)
