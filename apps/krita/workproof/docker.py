# SPDX-License-Identifier: GPL-3.0-or-later
"""Krita/Qt stays on the UI thread; bounded network/file work runs in one worker."""
import os
import pathlib
import threading
from krita import Krita, DockWidget
from PyQt5.QtCore import QObject, QTimer, pyqtSignal, QSettings
from PyQt5.QtWidgets import QWidget, QVBoxLayout, QLabel, QPushButton, QFileDialog
from .core import Recorder, SnapshotBusy, capture


class Completion(QObject):
    ready = pyqtSignal(object)


class WorkProofDocker(DockWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle('WorkProof · 创作记录')
        self.recorder = Recorder()
        self.busy = False
        self.paused = True
        self.cancelled = threading.Event()
        self.settings = QSettings('WorkProof', 'Krita')
        self.completion = Completion(self)
        self.completion.ready.connect(self._completed)
        panel = QWidget(self)
        layout = QVBoxLayout(panel)
        self.status = QLabel('先保存作品，再开始记录。首次连接请在 WorkProof 中允许。')
        self.status.setWordWrap(True)
        layout.addWidget(self.status)
        self.buttons = []
        for title, callback in [('开始记录', self.start), ('暂停 / 继续', self.toggle),
                                ('保存并导出证书', self.export), ('选择本机摘要程序', self.choose_engine)]:
            button = QPushButton(title)
            button.clicked.connect(callback)
            layout.addWidget(button)
            self.buttons.append(button)
        self.cancel_button = QPushButton('取消连接')
        self.cancel_button.clicked.connect(self.cancelled.set)
        layout.addWidget(self.cancel_button)
        note = QLabel('记录图层与画面变化摘要，不保存画面。64×64 采样不等于完整笔触；离线或切换文档会暂停。')
        note.setWordWrap(True)
        layout.addWidget(note)
        layout.addStretch()
        self.setWidget(panel)
        self.timer = QTimer(self)
        self.timer.setInterval(1500)
        self.timer.timeout.connect(self.sample)
        self.timer.start()
        # QAction reports commands being triggered, not proof of their eventual effect.
        for action_id, kind, metric in [('edit_undo', 'undo', 'undo_commands'),
                                        ('edit_redo', 'redo', 'redo_commands'),
                                        ('copy', 'interaction', 'copy'), ('paste', 'interaction', 'paste'),
                                        ('cut', 'interaction', 'cut')]:
            action = Krita.instance().action(action_id)
            if action:
                action.triggered.connect(lambda checked=False, k=kind, m=metric: self.command(k, m))
        self.pending_commands = {}

    def canvasChanged(self, canvas):
        # Actual document identity is rechecked on every sample and completion.
        pass

    def _snapshot(self):
        return capture(Krita.instance().activeDocument())

    def _run(self, operation, success=lambda value: None):
        if self.busy:
            return
        self.busy = True
        for button in self.buttons:
            button.setEnabled(False)
        def work():
            try:
                value = operation()
                self.completion.ready.emit((success, value, None))
            except RuntimeError as error:
                self.completion.ready.emit((success, None, str(error)))
            except Exception:
                # Do not display HTTP bodies, credentials or raw filesystem diagnostics.
                self.completion.ready.emit((success, None, '操作未完成，记录已暂停。请检查 WorkProof 连接、文件与记录上限，再点继续重试。'))
        threading.Thread(target=work, daemon=True, name='WorkProof-Krita-transport').start()

    def _completed(self, result):
        self.busy = False
        for button in self.buttons:
            button.setEnabled(True)
        callback, value, error = result
        if error:
            self.paused = True
            self.status.setText(error)
            return
        try:
            callback(value)
        except Exception as failure:
            self.paused = True
            self.status.setText(str(failure))

    def start(self):
        if self.recorder.session or self.busy:
            return
        try:
            original = self._snapshot()
        except Exception as error:
            self.status.setText(str(error))
            return
        self.cancelled.clear()
        self.status.setText('请在 WorkProof 中允许 Krita 连接；作品保持在本机。')
        def approved(_):
            current = self._snapshot()
            if current['identity'] != original['identity'] or self.cancelled.is_set():
                raise RuntimeError('文档已改变或连接已取消，请重新开始。')
            def started(_):
                self.paused = False
                self.status.setText('正在记录当前作品。')
            self._run(lambda: self.recorder.start(current), started)
        self._run(lambda: self.recorder.connect(self.cancelled.is_set), approved)

    def command(self, kind, metric):
        if self.paused or not self.recorder.session:
            return
        try:
            document = Krita.instance().activeDocument()
            identity = (document.fileName(), document.rootNode().uniqueId().toString())
            if identity != self.recorder.identity:
                return
            self.pending_commands[metric] = min(1000000000, self.pending_commands.get(metric, 0) + 1)
        except Exception:
            self.paused = True

    def sample(self):
        if self.busy or self.paused or not self.recorder.session:
            return
        try:
            snapshot = self._snapshot()
        except SnapshotBusy as error:
            self.status.setText(str(error))
            return
        except Exception as error:
            self.paused = True
            self.status.setText(str(error))
            return
        commands, self.pending_commands = self.pending_commands, {}
        kind = 'interaction' if commands else None
        self._run(lambda: self.recorder.sample(snapshot, kind, commands),
                  lambda _: self.status.setText('记录中 · 已保存 ' + str(self.recorder.committed) + ' 条记录'))

    def toggle(self):
        if self.busy or not self.recorder.session:
            return
        try:
            snapshot = self._snapshot()
            was_paused = self.paused
            self.paused = True
            commands, self.pending_commands = self.pending_commands, {}
            def operation():
                self.recorder.sample(snapshot, metrics=commands, kind='interaction' if commands else None)
                self.recorder.event('gap' if was_paused else 'pause', snapshot)
                if was_paused:
                    self.recorder.event('resume', snapshot)
                self.recorder.flush()
            def complete(_):
                self.paused = not was_paused
                self.status.setText('已暂停。' if self.paused else '已继续记录，暂停期间标记为缺口。')
            self._run(operation, complete)
        except Exception as error:
            self.paused = True
            self.status.setText(str(error))

    def choose_engine(self):
        path, _ = QFileDialog.getOpenFileName(self, '选择安装包中的 workproof-engine')
        if path:
            self.settings.setValue('engine', path)

    def export(self):
        if self.busy or not self.recorder.session:
            return
        try:
            document = Krita.instance().activeDocument()
            snapshot = self._snapshot()
            if snapshot['identity'] != self.recorder.identity:
                raise RuntimeError('请切回正在记录的作品。')
            if document.modified() and not document.save():
                raise RuntimeError('作品保存未完成。')
            snapshot = self._snapshot()
            output, _ = QFileDialog.getSaveFileName(self, '保存证书', snapshot['path'] + '.wproof', 'WorkProof (*.wproof)')
            if not output:
                return
            if pathlib.Path(output).exists():
                raise RuntimeError('请使用新的文件名，已有证书不会被覆盖。')
            engine = self.settings.value('engine', '')
            if not engine and os.name == 'nt':
                engine = str(pathlib.Path(os.environ.get('LOCALAPPDATA', '')) / 'Programs/WorkProof/office/workproof-engine.exe')
            self.paused = True
            commands, self.pending_commands = self.pending_commands, {}
            def operation():
                self.recorder.sample(snapshot, 'interaction' if commands else None, commands)
                return self.recorder.export(snapshot, engine, None)
            def complete(raw):
                final = self._snapshot()
                if final['identity'] != snapshot['identity'] or final['checkpoint'] != snapshot['checkpoint'] or document.modified():
                    raise RuntimeError('导出期间作品改变，请保存后重新导出。')
                with pathlib.Path(output).open('xb') as stream:
                    stream.write(raw)
                self.status.setText('证书已保存。作品另附；记录保持暂停。')
            self._run(operation, complete)
        except Exception as error:
            self.paused = True
            self.status.setText(str(error))
