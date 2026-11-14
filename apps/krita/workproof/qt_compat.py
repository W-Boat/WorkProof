# SPDX-License-Identifier: GPL-3.0-or-later
"""Choose the binding for Krita's actual Qt major, never load both runtimes."""
import pykrita

QT_MAJOR = getattr(pykrita, 'qt_major_version', lambda: 5)()
if QT_MAJOR == 6:
    from PyQt6.QtCore import QObject, QTimer, pyqtSignal, QSettings, QT_VERSION_STR, PYQT_VERSION_STR
    from PyQt6.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton, QFileDialog, QMessageBox
elif QT_MAJOR == 5:
    from PyQt5.QtCore import QObject, QTimer, pyqtSignal, QSettings, QT_VERSION_STR, PYQT_VERSION_STR
    from PyQt5.QtWidgets import QApplication, QWidget, QVBoxLayout, QLabel, QPushButton, QFileDialog, QMessageBox
else:
    raise RuntimeError('WorkProof 暂不支持此 Qt 版本。')

_standard_buttons = getattr(QMessageBox, 'StandardButton', QMessageBox)
YES, NO = _standard_buttons.Yes, _standard_buttons.No
