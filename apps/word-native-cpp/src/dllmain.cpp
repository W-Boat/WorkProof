#include "addin.h"

namespace workproof {
HINSTANCE g_module = nullptr;
LONG g_objectCount = 0;
HRESULT CreateClassFactory(REFCLSID clsid, REFIID iid, void** object);
} // namespace workproof

BOOL APIENTRY DllMain(HMODULE module, DWORD reason, LPVOID reserved) {
    switch (reason) {
        case DLL_PROCESS_ATTACH:
            workproof::g_module = module;
            DisableThreadLibraryCalls(module);
            workproof::Trace(L"DllMain attach");
            break;
        case DLL_THREAD_ATTACH:
        case DLL_THREAD_DETACH:
        case DLL_PROCESS_DETACH:
            break;
    }
    return TRUE;
}

extern "C" HRESULT __stdcall DllGetClassObject(REFCLSID clsid, REFIID iid, void** object) {
    return workproof::CreateClassFactory(clsid, iid, object);
}

extern "C" HRESULT __stdcall DllCanUnloadNow() {
    return workproof::g_objectCount == 0 ? S_OK : S_FALSE;
}
