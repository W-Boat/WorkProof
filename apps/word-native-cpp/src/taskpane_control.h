#pragma once
#include <windows.h>
#include <objbase.h>

namespace workproof {
extern const CLSID CLSID_TaskPane;
HRESULT CreateTaskPaneControl(REFIID iid, void** object);
}
