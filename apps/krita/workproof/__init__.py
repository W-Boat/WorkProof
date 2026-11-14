# SPDX-License-Identifier: GPL-3.0-or-later
from krita import Krita, DockWidgetFactory, DockWidgetFactoryBase
from .docker import WorkProofDocker

Krita.instance().addDockWidgetFactory(DockWidgetFactory(
    "workproof", DockWidgetFactoryBase.DockRight, WorkProofDocker))
