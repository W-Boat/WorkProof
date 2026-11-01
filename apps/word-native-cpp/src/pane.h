#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>

namespace workproof {

// The pane owns the whole recording flow; the ribbon only forwards commands.
void PaneAttachWord(IDispatch* application);
void PaneShow();
void PaneSetFactory(IDispatch* factory);
HWND PaneCreateChild(HWND parent, const RECT& rect);
void PaneResizeChild(const RECT& rect);
void PaneDestroyChild();
void PaneLaunchRecording();
void PaneStart();
void PaneTogglePause();
void PaneExport();
void PaneClose();
bool PaneCreated();

} // namespace workproof
