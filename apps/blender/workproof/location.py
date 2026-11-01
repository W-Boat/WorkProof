# SPDX-FileCopyrightText: 2026 WorkProof contributors
# SPDX-License-Identifier: MIT OR GPL-3.0-or-later
"""Shared state directory policy; no Blender API and no filesystem mutations."""
import os,pathlib,sys

def data_directory():
    override=os.environ.get('WORKPROOF_DATA_DIR')
    if override:
        if not pathlib.Path(override).is_absolute():raise RuntimeError('记录目录必须使用完整路径')
        return pathlib.Path(override)
    def absolute(name):
        value=os.environ.get(name)
        return pathlib.Path(value) if value and pathlib.Path(value).is_absolute() else None
    home=absolute('HOME') or absolute('USERPROFILE')
    if sys.platform=='win32' and absolute('LOCALAPPDATA'):return absolute('LOCALAPPDATA')/'WorkProof'
    if sys.platform not in ('win32','darwin') and absolute('XDG_DATA_HOME'):return absolute('XDG_DATA_HOME')/'WorkProof'
    if home is None:raise RuntimeError('找不到用户目录，请设置 WORKPROOF_DATA_DIR')
    if sys.platform=='win32':return home/'AppData'/'Local'/'WorkProof'
    if sys.platform=='darwin':return home/'Library'/'Application Support'/'WorkProof'
    return home/'.local'/'share'/'WorkProof'
