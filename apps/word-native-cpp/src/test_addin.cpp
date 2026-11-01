#include "addin.h"
#include <cstdio>
#include <ocidl.h>
#include <initializer_list>
#include <string>

namespace {

const CLSID kClass = {0x5F628C20, 0x62BB, 0x4DA6, {0x94, 0xDF, 0x36, 0xBD, 0x59, 0x9A, 0x93, 0x01}};
const IID kExtensibility = {0xB65AD801, 0xABAF, 0x11D0, {0xBB, 0x8B, 0x00, 0xA0, 0xC9, 0x0F, 0x27, 0x44}};
const IID kRibbon = {0x000C0396, 0x0000, 0x0000, {0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46}};

int Fail(const char* message) {
    std::printf("FAIL: %s\n", message);
    return 1;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 2) return Fail("usage: test_addin <WorkProofWord.dll>");
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

    BSTR ribbonId = SysAllocString(L"Microsoft.Word.Document");
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
    VARIANT argument;VariantInit(&argument);argument.vt=VT_BSTR;argument.bstrVal=SysAllocString(L"Microsoft.Word.Document");
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
                                L"GetRibbonImage"}) {
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
    const CLSID paneClass={0x41D77603,0x57A1,0x43C8,{0x83,0x9E,0xBB,0x53,0x75,0xA9,0xD8,0x43}};
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
    if(FAILED(pane->SetClientSite(nullptr))||FAILED(pane->Close(OLECLOSE_NOSAVE)))
        return Fail("task pane cleanup failed");
    pane->Release();
    if (canUnload() != S_OK) return Fail("DllCanUnloadNow still reports live objects");
    std::printf("PASS: native add-in exposes the fixed COM class, ribbon markup and every dispatch callback\n");
    return 0;
}
