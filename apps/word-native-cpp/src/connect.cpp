#include "addin.h"
#include "pane.h"
#include <new>

namespace workproof {

const CLSID CLSID_Connect = {0x5F628C20, 0x62BB, 0x4DA6, {0x94, 0xDF, 0x36, 0xBD, 0x59, 0x9A, 0x93, 0x01}};
const IID IID_IExtensibility2 = {0xB65AD801, 0xABAF, 0x11D0, {0xBB, 0x8B, 0x00, 0xA0, 0xC9, 0x0F, 0x27, 0x44}};
const IID IID_IRibbon = {0x000C0396, 0x0000, 0x0000, {0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}};

extern HINSTANCE g_module;
extern LONG g_objectCount;

namespace {

// Ribbon commands live above the IDTExtensibility2 DISPIDs (1..5) so both can share one dispatcher.
enum Command : int {
    CommandOpen = 101,
    CommandStart = 102,
    CommandPause = 103,
    CommandExport = 104,
    CommandRibbonLoad = 105,
    CommandImage = 106
};

// IDTExtensibility2 is a dual interface in Office: Word may use the vtable or IDispatch with
// DISPIDs 1..5. The dispatch route is the one Word actually uses for COM add-ins.
enum ExtensibilityDispId : int {
    DispOnConnection = 1,
    DispOnDisconnection = 2,
    DispOnAddInsUpdate = 3,
    DispOnStartupComplete = 4,
    DispOnBeginShutdown = 5
};

struct NameEntry {
    const wchar_t* name;
    DISPID id;
};

const NameEntry kCommandNames[] = {
    {L"OpenRecorder", CommandOpen},
    {L"StartRecording", CommandStart},
    {L"TogglePause", CommandPause},
    {L"ExportRecord", CommandExport},
    {L"RibbonLoad", CommandRibbonLoad},
    {L"GetRibbonImage", CommandImage},
};

const NameEntry kExtensibilityNames[] = {
    {L"OnConnection", DispOnConnection},
    {L"OnDisconnection", DispOnDisconnection},
    {L"OnAddInsUpdate", DispOnAddInsUpdate},
    {L"OnStartupComplete", DispOnStartupComplete},
    {L"OnBeginShutdown", DispOnBeginShutdown},
};

class CConnect;

class CExtensibility : public IDispatch {
public:
    explicit CExtensibility(CConnect* owner) : m_owner(owner) {}
    ~CExtensibility() { m_owner = nullptr; }
    void Detach() { m_owner = nullptr; }

    STDMETHODIMP QueryInterface(REFIID iid, void** object) override;
    STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    STDMETHODIMP_(ULONG) Release() override {
        LONG remaining = InterlockedDecrement(&m_ref);
        if (remaining == 0) delete this;
        return (ULONG)remaining;
    }
    STDMETHODIMP GetTypeInfoCount(UINT* count) override { if (count) *count = 0; return S_OK; }
    STDMETHODIMP GetTypeInfo(UINT, LCID, ITypeInfo** info) override { if (info) *info = nullptr; return E_NOTIMPL; }
    STDMETHODIMP GetIDsOfNames(REFIID, LPOLESTR* names, UINT count, LCID, DISPID* ids) override;
    STDMETHODIMP Invoke(DISPID id, REFIID, LCID, WORD flags, DISPPARAMS* parameters, VARIANT* result,
                        EXCEPINFO* exception, UINT* argumentError) override;

    // Dual vtable entries, so a host that calls through the vtable also works.
    virtual HRESULT __stdcall OnConnection(IDispatch* application, int connectMode, IDispatch* addInInstance, SAFEARRAY** custom);
    virtual HRESULT __stdcall OnDisconnection(int removeMode, SAFEARRAY** custom);
    virtual HRESULT __stdcall OnAddInsUpdate(SAFEARRAY** custom);
    virtual HRESULT __stdcall OnStartupComplete(SAFEARRAY** custom);
    virtual HRESULT __stdcall OnBeginShutdown(SAFEARRAY** custom);

private:
    LONG m_ref = 1;
    CConnect* m_owner = nullptr;
};

class CRibbon : public IRibbonExtensibility {
public:
    explicit CRibbon(CConnect* owner) : m_owner(owner) {}
    void Detach() { m_owner = nullptr; }

    STDMETHODIMP QueryInterface(REFIID iid, void** object) override;
    STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    STDMETHODIMP_(ULONG) Release() override {
        LONG remaining = InterlockedDecrement(&m_ref);
        if (remaining == 0) delete this;
        return (ULONG)remaining;
    }
    STDMETHODIMP GetCustomUI(BSTR ribbonId, BSTR* ribbonXml) override;

private:
    LONG m_ref = 1;
    CConnect* m_owner = nullptr;
};

class CConnect : public IDispatch {
public:
    CConnect() : m_ref(1) { InterlockedIncrement(&g_objectCount); }
    ~CConnect() {
        if (m_extensibility) { m_extensibility->Detach(); m_extensibility->Release(); }
        if (m_ribbon) { m_ribbon->Detach(); m_ribbon->Release(); }
        if (m_word) m_word->Release();
        InterlockedDecrement(&g_objectCount);
    }

    STDMETHODIMP QueryInterface(REFIID iid, void** object) override;
    STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    STDMETHODIMP_(ULONG) Release() override {
        LONG remaining = InterlockedDecrement(&m_ref);
        if (remaining == 0) delete this;
        return (ULONG)remaining;
    }
    STDMETHODIMP GetTypeInfoCount(UINT* count) override { if (count) *count = 0; return S_OK; }
    STDMETHODIMP GetTypeInfo(UINT, LCID, ITypeInfo** info) override { if (info) *info = nullptr; return E_NOTIMPL; }
    STDMETHODIMP GetIDsOfNames(REFIID, LPOLESTR* names, UINT count, LCID, DISPID* ids) override;
    STDMETHODIMP Invoke(DISPID id, REFIID, LCID, WORD flags, DISPPARAMS* parameters, VARIANT* result,
                        EXCEPINFO* exception, UINT* argumentError) override;

    void AttachWord(IDispatch* application) {
        if (m_word) m_word->Release();
        m_word = application;
        if (m_word) m_word->AddRef();
        PaneAttachWord(m_word);
    }

private:
    LONG m_ref;
    IDispatch* m_word = nullptr;
    CExtensibility* m_extensibility = nullptr;
    CRibbon* m_ribbon = nullptr;
};

// ------------------------------------------------------------------ extensibility

STDMETHODIMP CExtensibility::QueryInterface(REFIID iid, void** object) {
    TraceIid(L"Extensibility QueryInterface", iid);
    if (!object) return E_POINTER;
    *object = nullptr;
    if (iid == IID_IUnknown || iid == IID_IDispatch || iid == IID_IExtensibility2) {
        // A dual interface shares one vtable, so every accepted IID resolves to the same pointer.
        *object = static_cast<IDispatch*>(this);
        AddRef();
        return S_OK;
    }
    // Word asks this same object for the ribbon interface; the ribbon lives on the add-in object.
    if (iid == IID_IRibbon && m_owner) return m_owner->QueryInterface(iid, object);
    return E_NOINTERFACE;
}

STDMETHODIMP CExtensibility::GetIDsOfNames(REFIID, LPOLESTR* names, UINT count, LCID, DISPID* ids) {
    if (!names || !ids) return E_POINTER;
    for (UINT index = 0; index < count; ++index) {
        ids[index] = DISPID_UNKNOWN;
        for (const NameEntry& entry : kExtensibilityNames) {
            if (names[index] && wcscmp(names[index], entry.name) == 0) { ids[index] = entry.id; break; }
        }
        if (ids[index] == DISPID_UNKNOWN) return DISP_E_UNKNOWNNAME;
    }
    return S_OK;
}

STDMETHODIMP CExtensibility::Invoke(DISPID id, REFIID, LCID, WORD flags, DISPPARAMS* parameters, VARIANT* result,
                                   EXCEPINFO*, UINT*) {
    TraceHresult(L"Extensibility Invoke dispid", (long)id);
    if (result) VariantInit(result);
    if (flags & DISPATCH_PROPERTYGET) return S_OK;

    IDispatch* application = nullptr;
    IDispatch* addInInstance = nullptr;
    int connectMode = 0;
    if (parameters && parameters->cArgs >= 4 && parameters->rgvarg) {
        VARIANT* arguments = parameters->rgvarg;  // DISPPARAMS stores arguments in reverse order.
        if (arguments[3].vt == VT_DISPATCH) application = arguments[3].pdispVal;
        if (arguments[2].vt == VT_I4) connectMode = arguments[2].lVal;
        if (arguments[1].vt == VT_DISPATCH) addInInstance = arguments[1].pdispVal;
    }
    switch (id) {
        case DispOnConnection: return OnConnection(application, connectMode, addInInstance, nullptr);
        case DispOnDisconnection: return OnDisconnection(0, nullptr);
        case DispOnAddInsUpdate: return S_OK;
        case DispOnStartupComplete: return S_OK;
        case DispOnBeginShutdown: return OnBeginShutdown(nullptr);
        default: return DISP_E_MEMBERNOTFOUND;
    }
}

HRESULT __stdcall CExtensibility::OnConnection(IDispatch* application, int connectMode, IDispatch* addInInstance,
                                               SAFEARRAY** custom) {
    Trace(L"OnConnection entered");
    TraceHresult(L"OnConnection application present", application ? 1 : 0);
    if (m_owner) m_owner->AttachWord(application);
    Trace(L"OnConnection completed");
    return S_OK;
}

HRESULT __stdcall CExtensibility::OnDisconnection(int removeMode, SAFEARRAY** custom) {
    Trace(L"OnDisconnection entered");
    PaneClose();
    if (m_owner) m_owner->AttachWord(nullptr);
    return S_OK;
}

HRESULT __stdcall CExtensibility::OnAddInsUpdate(SAFEARRAY** custom) { return S_OK; }
HRESULT __stdcall CExtensibility::OnStartupComplete(SAFEARRAY** custom) { return S_OK; }
HRESULT __stdcall CExtensibility::OnBeginShutdown(SAFEARRAY** custom) {
    Trace(L"OnBeginShutdown entered");
    PaneClose();
    return S_OK;
}

// ------------------------------------------------------------------------ ribbon

STDMETHODIMP CRibbon::QueryInterface(REFIID iid, void** object) {
    TraceIid(L"Ribbon QueryInterface", iid);
    if (!object) return E_POINTER;
    *object = nullptr;
    if (iid == IID_IUnknown || iid == IID_IRibbon) {
        *object = static_cast<IRibbonExtensibility*>(this);
        AddRef();
        return S_OK;
    }
    return E_NOINTERFACE;
}

STDMETHODIMP CRibbon::GetCustomUI(BSTR ribbonId, BSTR* ribbonXml) {
    Trace(L"GetCustomUI entered");
    if (!ribbonXml) return E_POINTER;
    std::wstring markup = RibbonXml();
    *ribbonXml = SysAllocString(markup.c_str());
    TraceHresult(L"GetCustomUI markup length", (long)markup.size());
    return *ribbonXml ? S_OK : E_OUTOFMEMORY;
}

// ------------------------------------------------------------------------- add-in

STDMETHODIMP CConnect::QueryInterface(REFIID iid, void** object) {
    TraceIid(L"QueryInterface", iid);
    if (!object) return E_POINTER;
    *object = nullptr;
    if (iid == IID_IUnknown || iid == IID_IDispatch) {
        *object = static_cast<IDispatch*>(this);
        AddRef();
        return S_OK;
    }
    if (iid == IID_IExtensibility2) {
        if (!m_extensibility) m_extensibility = new (std::nothrow) CExtensibility(this);
        if (!m_extensibility) return E_OUTOFMEMORY;
        m_extensibility->AddRef();
        *object = static_cast<IDispatch*>(m_extensibility);
        return S_OK;
    }
    if (iid == IID_IRibbon) {
        if (!m_ribbon) m_ribbon = new (std::nothrow) CRibbon(this);
        if (!m_ribbon) return E_OUTOFMEMORY;
        m_ribbon->AddRef();
        *object = static_cast<IRibbonExtensibility*>(m_ribbon);
        return S_OK;
    }
    return E_NOINTERFACE;
}

STDMETHODIMP CConnect::GetIDsOfNames(REFIID, LPOLESTR* names, UINT count, LCID, DISPID* ids) {
    if (!names || !ids) return E_POINTER;
    Trace(names[0] ? names[0] : L"GetIDsOfNames(null)");
    for (UINT index = 0; index < count; ++index) {
        ids[index] = DISPID_UNKNOWN;
        for (const NameEntry& entry : kCommandNames) {
            if (names[index] && wcscmp(names[index], entry.name) == 0) { ids[index] = entry.id; break; }
        }
        if (ids[index] == DISPID_UNKNOWN) return DISP_E_UNKNOWNNAME;
    }
    return S_OK;
}

STDMETHODIMP CConnect::Invoke(DISPID id, REFIID, LCID, WORD flags, DISPPARAMS*, VARIANT* result,
                              EXCEPINFO*, UINT*) {
    TraceHresult(L"Add-in Invoke dispid", (long)id);
    if (result) VariantInit(result);
    if (flags & DISPATCH_PROPERTYGET) return S_OK;
    switch (id) {
        case CommandOpen:
            PaneShow();
            return S_OK;
        case CommandStart:
            PaneStart();
            return S_OK;
        case CommandPause:
            PaneTogglePause();
            return S_OK;
        case CommandExport:
            PaneExport();
            return S_OK;
        case CommandRibbonLoad:
        case CommandImage:
            return S_OK;
        default:
            return DISP_E_MEMBERNOTFOUND;
    }
}

class CFactory : public IClassFactory {
public:
    STDMETHODIMP QueryInterface(REFIID iid, void** object) override {
        if (!object) return E_POINTER;
        *object = nullptr;
        if (iid == IID_IUnknown || iid == IID_IClassFactory) {
            *object = static_cast<IClassFactory*>(this);
            AddRef();
            return S_OK;
        }
        return E_NOINTERFACE;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return (ULONG)InterlockedIncrement(&m_ref); }
    STDMETHODIMP_(ULONG) Release() override {
        LONG remaining = InterlockedDecrement(&m_ref);
        if (remaining == 0) delete this;
        return (ULONG)remaining;
    }
    STDMETHODIMP CreateInstance(IUnknown* outer, REFIID iid, void** object) override {
        Trace(L"CreateInstance entered");
        TraceIid(L"CreateInstance iid", iid);
        if (!object) return E_POINTER;
        *object = nullptr;
        if (outer) return CLASS_E_NOAGGREGATION;
        CConnect* connect = new (std::nothrow) CConnect();
        if (!connect) return E_OUTOFMEMORY;
        HRESULT hr = connect->QueryInterface(iid, object);
        connect->Release();
        return hr;
    }
    STDMETHODIMP LockServer(BOOL lock) override {
        if (lock) InterlockedIncrement(&g_objectCount); else InterlockedDecrement(&g_objectCount);
        return S_OK;
    }

private:
    LONG m_ref = 1;
};

} // namespace

HRESULT CreateClassFactory(REFCLSID clsid, REFIID iid, void** object) {
    TraceIid(L"CreateClassFactory clsid", clsid);
    TraceIid(L"CreateClassFactory iid", iid);
    if (!object) return E_POINTER;
    *object = nullptr;
    if (clsid != CLSID_Connect) return CLASS_E_CLASSNOTAVAILABLE;
    CFactory* factory = new (std::nothrow) CFactory();
    if (!factory) return E_OUTOFMEMORY;
    HRESULT hr = factory->QueryInterface(iid, object);
    factory->Release();
    return hr;
}

} // namespace workproof
