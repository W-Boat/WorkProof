#include "addin.h"
#include <cstdio>
#include <ocidl.h>
#include <initializer_list>
#include <string>

namespace {

#ifdef WORKPROOF_POWERPOINT
const CLSID kClass = {0x6EC055C4,0x2EB0,0x49EB,{0x80,0xC9,0x30,0xC6,0xDA,0x38,0xEB,0x86}};
const CLSID kPaneClass = {0x6EC055C4,0x2EB0,0x49EB,{0x80,0xC9,0x30,0xC6,0xDA,0x38,0xEB,0x87}};
const wchar_t* kRibbonId = L"Microsoft.PowerPoint.Presentation";
#else
const CLSID kClass = {0x5F628C20, 0x62BB, 0x4DA6, {0x94, 0xDF, 0x36, 0xBD, 0x59, 0x9A, 0x93, 0x01}};
const CLSID kPaneClass = {0x41D77603,0x57A1,0x43C8,{0x83,0x9E,0xBB,0x53,0x75,0xA9,0xD8,0x43}};
const wchar_t* kRibbonId = L"Microsoft.Word.Document";
#endif
const IID kExtensibility = {0xB65AD801, 0xABAF, 0x11D0, {0xBB, 0x8B, 0x00, 0xA0, 0xC9, 0x0F, 0x27, 0x44}};
const IID kRibbon = {0x000C0396, 0x0000, 0x0000, {0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}};

class HostSite final : public IOleClientSite, public IOleInPlaceSite {
    LONG refs_=1;
public:
    HWND window=nullptr; int activations=0,deactivations=0;
    STDMETHODIMP QueryInterface(REFIID iid,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(iid==IID_IUnknown||iid==IID_IOleClientSite)*out=static_cast<IOleClientSite*>(this);
        else if(iid==IID_IOleWindow||iid==IID_IOleInPlaceSite)*out=static_cast<IOleInPlaceSite*>(this);
        else return E_NOINTERFACE;
        AddRef();return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override{return InterlockedIncrement(&refs_);}
    STDMETHODIMP_(ULONG) Release() override{LONG n=InterlockedDecrement(&refs_);if(!n)delete this;return n;}
    STDMETHODIMP SaveObject() override{return E_NOTIMPL;}
    STDMETHODIMP GetMoniker(DWORD,DWORD,IMoniker** out) override{if(out)*out=nullptr;return E_NOTIMPL;}
    STDMETHODIMP GetContainer(IOleContainer** out) override{if(out)*out=nullptr;return E_NOINTERFACE;}
    STDMETHODIMP ShowObject() override{return S_OK;}
    STDMETHODIMP OnShowWindow(BOOL) override{return S_OK;}
    STDMETHODIMP RequestNewObjectLayout() override{return E_NOTIMPL;}
    STDMETHODIMP GetWindow(HWND* out) override{if(!out)return E_POINTER;*out=window;return S_OK;}
    STDMETHODIMP ContextSensitiveHelp(BOOL) override{return E_NOTIMPL;}
    STDMETHODIMP CanInPlaceActivate() override{return S_OK;}
    STDMETHODIMP OnInPlaceActivate() override{++activations;return S_OK;}
    STDMETHODIMP OnUIActivate() override{return S_OK;}
    STDMETHODIMP GetWindowContext(IOleInPlaceFrame** frame,IOleInPlaceUIWindow** document,LPRECT pos,LPRECT clip,LPOLEINPLACEFRAMEINFO info) override{
        if(frame)*frame=nullptr;if(document)*document=nullptr;
        GetClientRect(window,pos);*clip=*pos;info->hwndFrame=window;return S_OK;
    }
    STDMETHODIMP Scroll(SIZE) override{return E_NOTIMPL;}
    STDMETHODIMP OnUIDeactivate(BOOL) override{return S_OK;}
    STDMETHODIMP OnInPlaceDeactivate() override{++deactivations;return S_OK;}
    STDMETHODIMP DiscardUndoState() override{return S_OK;}
    STDMETHODIMP DeactivateAndUndo() override{return E_NOTIMPL;}
    STDMETHODIMP OnPosRectChange(LPCRECT) override{return S_OK;}
};

int Fail(const char* message) {
    std::printf("FAIL: %s\n", message);
    return 1;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) return Fail("usage: test_addin <native Word or PowerPoint DLL>");
    if(FAILED(OleInitialize(nullptr))) return Fail("OLE initialization failed");
    HMODULE module = LoadLibraryW(argv[1]);
    if (!module) return Fail("LoadLibrary failed; the DLL cannot be loaded into a plain process");

    auto getClassObject = (HRESULT(__stdcall*)(REFCLSID, REFIID, void**))GetProcAddress(module, "DllGetClassObject");
    auto canUnload = (HRESULT(__stdcall*)())GetProcAddress(module, "DllCanUnloadNow");
    if (!getClassObject) return Fail("DllGetClassObject is not exported");
    if (!canUnload) return Fail("DllCanUnloadNow is not exported");

    IClassFactory* factory = nullptr;
    if (FAILED(getClassObject(kClass, IID_IClassFactory, (void**)&factory)) || !factory) {
        return Fail("DllGetClassObject did not return a class factory");
    }
    IDispatch* connect = nullptr;
    HRESULT hr = factory->CreateInstance(nullptr, IID_IDispatch, (void**)&connect);
    factory->Release();
    if (FAILED(hr) || !connect) return Fail("CreateInstance(IID_IDispatch) failed");

    workproof::IDTExtensibility2* extensibility = nullptr;
    workproof::IRibbonExtensibility* ribbon = nullptr;
    if (FAILED(connect->QueryInterface(kExtensibility, (void**)&extensibility)) || !extensibility) {
        return Fail("IDTExtensibility2 is not exposed");
    }
    if (FAILED(connect->QueryInterface(kRibbon, (void**)&ribbon)) || !ribbon) {
        return Fail("IRibbonExtensibility is not exposed");
    }

    const IID consumerIid={0x000C033E,0,0,{0xC0,0,0,0,0,0,0,0x46}};
    workproof::ITaskPaneConsumer* consumer=nullptr;
    if(FAILED(connect->QueryInterface(consumerIid,(void**)&consumer))||!consumer)
        return Fail("task pane consumer missing");
    if(FAILED(consumer->CTPFactoryAvailable(nullptr)))return Fail("consumer dual vtable invalid");
    IUnknown *consumerIdentity=nullptr,*connectIdentity=nullptr;
    consumer->QueryInterface(IID_IUnknown,(void**)&consumerIdentity);
    connect->QueryInterface(IID_IUnknown,(void**)&connectIdentity);
    if(consumerIdentity!=connectIdentity)return Fail("consumer COM identity mismatch");
    consumerIdentity->Release();connectIdentity->Release();
    OLECHAR* factoryName=const_cast<OLECHAR*>(L"CTPFactoryAvailable");DISPID factoryId=DISPID_UNKNOWN;
    if(FAILED(consumer->GetIDsOfNames(IID_NULL,&factoryName,1,LOCALE_USER_DEFAULT,&factoryId)))
        return Fail("consumer factory dispatch name missing");
    VARIANT emptyFactory;VariantInit(&emptyFactory);emptyFactory.vt=VT_DISPATCH;emptyFactory.pdispVal=nullptr;
    DISPPARAMS factoryParameters={&emptyFactory,nullptr,1,0};
    if(FAILED(consumer->Invoke(factoryId,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD,&factoryParameters,nullptr,nullptr,nullptr)))
        return Fail("consumer factory dispatch failed");
    consumer->Release();

    BSTR ribbonId = SysAllocString(kRibbonId);
    BSTR markup = nullptr;
    hr = ribbon->GetCustomUI(ribbonId, &markup);
    SysFreeString(ribbonId);
    if (FAILED(hr) || !markup) return Fail("GetCustomUI returned nothing");
    std::wstring xml(markup, SysStringLen(markup));
    SysFreeString(markup);
    // Exercise the dual-interface layout, not an IUnknown-only imitation of Office's ABI.
    if (FAILED(extensibility->OnAddInsUpdate(nullptr))) return Fail("dual extensibility vtable is invalid");
    IDispatch* ribbonDispatch=nullptr;
    if (FAILED(ribbon->QueryInterface(IID_IDispatch,(void**)&ribbonDispatch))) return Fail("ribbon dispatch missing");
    OLECHAR* uiName=const_cast<OLECHAR*>(L"GetCustomUI");DISPID uiId=DISPID_UNKNOWN;
    if (FAILED(ribbonDispatch->GetIDsOfNames(IID_NULL,&uiName,1,LOCALE_USER_DEFAULT,&uiId))) return Fail("ribbon GetCustomUI dispatch missing");
    VARIANT argument;VariantInit(&argument);argument.vt=VT_BSTR;argument.bstrVal=SysAllocString(kRibbonId);
    DISPPARAMS parameters={&argument,nullptr,1,0};VARIANT output;VariantInit(&output);
    hr=ribbonDispatch->Invoke(uiId,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD,&parameters,&output,nullptr,nullptr);
    VariantClear(&argument);
    if (FAILED(hr)||output.vt!=VT_BSTR||xml!=std::wstring(output.bstrVal,SysStringLen(output.bstrVal))) return Fail("dual ribbon dispatch returned different markup");
    VariantClear(&output);
    IUnknown *identity=nullptr,*ribbonIdentity=nullptr,*extensionIdentity=nullptr;
    connect->QueryInterface(IID_IUnknown,(void**)&identity);
    ribbon->QueryInterface(IID_IUnknown,(void**)&ribbonIdentity);
    extensibility->QueryInterface(IID_IUnknown,(void**)&extensionIdentity);
    if(identity!=ribbonIdentity||identity!=extensionIdentity) return Fail("COM interfaces disagree about object identity");
    identity->Release();ribbonIdentity->Release();extensionIdentity->Release();ribbonDispatch->Release();

    for (const wchar_t* token : {L"customUI", L"id='workproofTab'", L"OpenRecorder", L"StartRecording",
                                 L"TogglePause", L"ExportRecord"}) {
        if (xml.find(token) == std::wstring::npos) return Fail("ribbon markup is missing a required element");
    }

    for (const wchar_t* name : {L"OpenRecorder", L"StartRecording", L"TogglePause", L"ExportRecord", L"RibbonLoad",
                                L"GetRibbonImage", L"LaunchRecording"}) {
        DISPID id = DISPID_UNKNOWN;
        OLECHAR* candidate[1] = {const_cast<OLECHAR*>(name)};
        if (FAILED(connect->GetIDsOfNames(IID_NULL, candidate, 1, LOCALE_USER_DEFAULT, &id)) || id == DISPID_UNKNOWN) {
            return Fail("a ribbon callback name does not resolve through IDispatch");
        }
    }

    DISPID unknown = DISPID_UNKNOWN;
    OLECHAR* missing[1] = {const_cast<OLECHAR*>(L"NotAWorkProofCallback")};
    if (SUCCEEDED(connect->GetIDsOfNames(IID_NULL, missing, 1, LOCALE_USER_DEFAULT, &unknown))) {
        return Fail("an unknown callback name was accepted");
    }

    ribbon->Release();
    extensibility->Release();
    connect->Release();

    // Office creates this separate control through ICTPFactory; probe its real OLE
    // interfaces and lifecycle without pretending a windowless probe is an Office host.
    const CLSID paneClass=kPaneClass;
    IClassFactory* paneFactory=nullptr;
    if(FAILED(getClassObject(paneClass,IID_IClassFactory,(void**)&paneFactory))||!paneFactory)
        return Fail("task pane class factory missing");
    IOleObject* pane=nullptr;
    hr=paneFactory->CreateInstance(nullptr,IID_IOleObject,(void**)&pane);
    paneFactory->Release();
    if(FAILED(hr)||!pane) return Fail("task pane IOleObject creation failed");
    IUnknown* paneIdentity=nullptr;
    pane->QueryInterface(IID_IUnknown,(void**)&paneIdentity);
    for(const IID* iid : {&IID_IDispatch,&IID_IOleInPlaceObject,&IID_IOleInPlaceActiveObject,
                          &IID_IOleControl,&IID_IPersistStreamInit}) {
        IUnknown* queried=nullptr; IUnknown* identityCheck=nullptr;
        if(FAILED(pane->QueryInterface(*iid,(void**)&queried))||!queried)
            return Fail("task pane OLE interface missing");
        queried->QueryInterface(IID_IUnknown,(void**)&identityCheck);
        if(identityCheck!=paneIdentity) return Fail("task pane COM identity mismatch");
        identityCheck->Release(); queried->Release();
    }
    paneIdentity->Release();
    IPersistStreamInit* persistence=nullptr;
    pane->QueryInterface(IID_IPersistStreamInit,(void**)&persistence);
    CLSID actualClass={};
    if(FAILED(persistence->GetClassID(&actualClass))||actualClass!=paneClass||FAILED(persistence->InitNew()))
        return Fail("task pane persistence initialization failed");
    persistence->Release();
    RECT bounds={0,0,360,600};
    if(SUCCEEDED(pane->DoVerb(OLEIVERB_INPLACEACTIVATE,nullptr,nullptr,0,nullptr,&bounds)))
        return Fail("task pane accepted activation without an Office client site");
    HostSite* host=new HostSite();
    host->window=CreateWindowExW(0,L"STATIC",L"OLE fixture",WS_OVERLAPPED,0,0,600,700,nullptr,nullptr,GetModuleHandleW(nullptr),nullptr);
    if(!host->window)return Fail("OLE fixture host window failed");
    if(FAILED(pane->SetClientSite(host))||FAILED(pane->DoVerb(OLEIVERB_INPLACEACTIVATE,nullptr,host,0,host->window,&bounds)))
        return Fail("real OLE in-place child activation failed");
    IOleInPlaceObject* inplace=nullptr;
    pane->QueryInterface(IID_IOleInPlaceObject,(void**)&inplace);
    HWND child=nullptr;
    if(FAILED(inplace->GetWindow(&child))||!child||GetParent(child)!=host->window||!(GetWindowLongPtrW(child,GWL_STYLE)&WS_CHILD))
        return Fail("task pane is not a true child of OLE host");
    RECT resized={8,12,408,512};
    if(FAILED(inplace->SetObjectRects(&resized,&resized)))return Fail("task pane resize failed");
    RECT actual={};GetWindowRect(child,&actual);MapWindowPoints(nullptr,host->window,(POINT*)&actual,2);
    if(!EqualRect(&actual,&resized))return Fail("task pane ignored OLE host bounds");
    inplace->Release();
    if(FAILED(pane->SetClientSite(nullptr))||FAILED(pane->Close(OLECLOSE_NOSAVE)))
        return Fail("task pane cleanup failed");
    if(IsWindow(child)||host->activations!=1||host->deactivations!=1)return Fail("OLE child lifecycle leaked");
    DestroyWindow(host->window);host->Release();
    pane->Release();
    if (canUnload() != S_OK) return Fail("DllCanUnloadNow still reports live objects");
    std::printf("PASS: native add-in exposes the fixed COM class, ribbon markup and every dispatch callback\n");
    OleUninitialize();
    return 0;
}
