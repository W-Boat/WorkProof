#include "taskpane_control.h"
#include "addin.h"
#include "pane.h"
#include <ocidl.h>
#include <new>

namespace workproof {
const CLSID CLSID_TaskPane = {0x41D77603,0x57A1,0x43C8,{0x83,0x9E,0xBB,0x53,0x75,0xA9,0xD8,0x43}};
namespace {
// A windowed OLE control hosted by Office's CustomTaskPane. Office owns the
// surrounding dock frame; this object creates only its in-place child window.
class TaskPaneControl final : public IOleObject, public IOleInPlaceObject,
    public IOleInPlaceActiveObject, public IOleControl, public IPersistStreamInit,
    public IDispatch, public IViewObject2 {
    LONG refs_ = 1;
    IOleClientSite* site_ = nullptr;
    IOleInPlaceSite* inplace_ = nullptr;
    HWND window_ = nullptr;
    RECT rect_ = {0,0,360,600};
    SIZEL extent_ = {9525,15875};
    bool active_ = false;
    bool uiActive_ = false;
    IAdviseSink* viewSink_ = nullptr;
    DWORD viewFlags_ = 0;
    void Deactivate() {
        if (window_) { PaneDestroyChild(); window_ = nullptr; }
        if (inplace_) {
            if (uiActive_) inplace_->OnUIDeactivate(FALSE);
            if (active_) inplace_->OnInPlaceDeactivate();
            inplace_->Release(); inplace_ = nullptr;
        }
        active_ = uiActive_ = false;
    }
    HRESULT Activate(LONG verb, HWND parent, LPCRECT bounds) {
        if (!site_) return E_UNEXPECTED;
        if (!inplace_) {
            HRESULT hr=site_->QueryInterface(IID_IOleInPlaceSite,reinterpret_cast<void**>(&inplace_));
            if (FAILED(hr)) return hr;
        }
        if (!active_) {
            HRESULT hr=inplace_->CanInPlaceActivate();
            if (hr!=S_OK) return FAILED(hr)?hr:E_FAIL;
            hr=inplace_->OnInPlaceActivate();
            if (FAILED(hr)) return hr;
            active_=true;
        }
        HWND host=nullptr;
        inplace_->GetWindow(&host);
        if (!host) host=parent;
        if (!host) return E_UNEXPECTED;
        IOleInPlaceFrame* frame=nullptr;
        IOleInPlaceUIWindow* document=nullptr;
        RECT position=rect_,clip=rect_;
        OLEINPLACEFRAMEINFO info={}; info.cb=sizeof(info);
        HRESULT context=inplace_->GetWindowContext(&frame,&document,&position,&clip,&info);
        if (frame) frame->Release();
        if (document) document->Release();
        if (bounds) position=*bounds;
        else if (FAILED(context)) GetClientRect(host,&position);
        rect_=position;
        if (!window_) window_=PaneCreateChild(host,rect_);
        if (!window_) return E_FAIL;
        PaneResizeChild(rect_);
        ShowWindow(window_,SW_SHOW);
        if (verb==OLEIVERB_UIACTIVATE && !uiActive_) {
            HRESULT hr=inplace_->OnUIActivate();
            if (FAILED(hr)) return hr;
            uiActive_=true;
            SetFocus(window_);
        }
        return S_OK;
    }
public:
    TaskPaneControl() { InterlockedIncrement(&g_objectCount); }
    ~TaskPaneControl() { Deactivate(); if(site_) site_->Release(); if(viewSink_) viewSink_->Release(); InterlockedDecrement(&g_objectCount); }
    STDMETHODIMP QueryInterface(REFIID iid,void** object) override {
        if(!object) return E_POINTER;
        *object=nullptr;
        if(iid==IID_IUnknown || iid==IID_IOleObject) *object=static_cast<IOleObject*>(this);
        else if(iid==IID_IOleWindow || iid==IID_IOleInPlaceObject) *object=static_cast<IOleInPlaceObject*>(this);
        else if(iid==IID_IOleInPlaceActiveObject) *object=static_cast<IOleInPlaceActiveObject*>(this);
        else if(iid==IID_IOleControl) *object=static_cast<IOleControl*>(this);
        else if(iid==IID_IPersist || iid==IID_IPersistStream || iid==IID_IPersistStreamInit) *object=static_cast<IPersistStreamInit*>(this);
        else if(iid==IID_IDispatch) *object=static_cast<IDispatch*>(this);
        else if(iid==IID_IViewObject || iid==IID_IViewObject2) *object=static_cast<IViewObject2*>(this);
        else return E_NOINTERFACE;
        AddRef(); return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&refs_); }
    STDMETHODIMP_(ULONG) Release() override { LONG count=InterlockedDecrement(&refs_); if(!count) delete this; return count; }
    STDMETHODIMP SetClientSite(IOleClientSite* site) override {
        if(site==site_) return S_OK;
        Deactivate(); if(site) site->AddRef(); if(site_) site_->Release(); site_=site; return S_OK;
    }
    STDMETHODIMP GetClientSite(IOleClientSite** site) override { if(!site) return E_POINTER; *site=site_; if(*site) (*site)->AddRef(); return S_OK; }
    STDMETHODIMP SetHostNames(LPCOLESTR,LPCOLESTR) override { return S_OK; }
    STDMETHODIMP Close(DWORD) override { Deactivate(); return S_OK; }
    STDMETHODIMP SetMoniker(DWORD,IMoniker*) override { return E_NOTIMPL; }
    STDMETHODIMP GetMoniker(DWORD,DWORD,IMoniker** value) override { if(value) *value=nullptr; return E_NOTIMPL; }
    STDMETHODIMP InitFromData(IDataObject*,BOOL,DWORD) override { return E_NOTIMPL; }
    STDMETHODIMP GetClipboardData(DWORD,IDataObject** value) override { if(value) *value=nullptr; return E_NOTIMPL; }
    STDMETHODIMP DoVerb(LONG verb,LPMSG,IOleClientSite*,LONG,HWND parent,LPCRECT rect) override {
        if(verb==OLEIVERB_HIDE) { if(window_) ShowWindow(window_,SW_HIDE); return S_OK; }
        if(verb==OLEIVERB_PRIMARY || verb==OLEIVERB_SHOW || verb==OLEIVERB_INPLACEACTIVATE || verb==OLEIVERB_UIACTIVATE) return Activate(verb,parent,rect);
        return OLEOBJ_S_INVALIDVERB;
    }
    STDMETHODIMP EnumVerbs(IEnumOLEVERB** value) override { if(value) *value=nullptr; return OLE_S_USEREG; }
    STDMETHODIMP Update() override { return S_OK; }
    STDMETHODIMP IsUpToDate() override { return S_OK; }
    STDMETHODIMP GetUserClassID(CLSID* value) override { return GetClassID(value); }
    STDMETHODIMP GetUserType(DWORD,LPOLESTR* value) override {
        if(!value) return E_POINTER;
        const wchar_t label[]=L"WorkProof Word recording";
        *value=static_cast<LPOLESTR>(CoTaskMemAlloc(sizeof(label)));
        if(!*value) return E_OUTOFMEMORY;
        CopyMemory(*value,label,sizeof(label)); return S_OK;
    }
    STDMETHODIMP SetExtent(DWORD aspect,SIZEL* value) override { if(aspect!=DVASPECT_CONTENT) return DV_E_DVASPECT; if(!value) return E_POINTER; extent_=*value; return S_OK; }
    STDMETHODIMP GetExtent(DWORD aspect,SIZEL* value) override { if(aspect!=DVASPECT_CONTENT) return DV_E_DVASPECT; if(!value) return E_POINTER; *value=extent_; return S_OK; }
    STDMETHODIMP Advise(IAdviseSink*,DWORD* connection) override { if(connection) *connection=0; return OLE_E_ADVISENOTSUPPORTED; }
    STDMETHODIMP Unadvise(DWORD) override { return OLE_E_NOCONNECTION; }
    STDMETHODIMP EnumAdvise(IEnumSTATDATA** value) override { if(value) *value=nullptr; return OLE_E_ADVISENOTSUPPORTED; }
    STDMETHODIMP GetMiscStatus(DWORD aspect,DWORD* value) override {
        if(!value) return E_POINTER;
        if(aspect!=DVASPECT_CONTENT) return DV_E_DVASPECT;
        *value=OLEMISC_SETCLIENTSITEFIRST|OLEMISC_INSIDEOUT|OLEMISC_ACTIVATEWHENVISIBLE|OLEMISC_RECOMPOSEONRESIZE; return S_OK;
    }
    STDMETHODIMP SetColorScheme(LOGPALETTE*) override { return S_OK; }
    STDMETHODIMP GetWindow(HWND* value) override { if(!value) return E_POINTER; *value=window_; return window_?S_OK:E_FAIL; }
    STDMETHODIMP ContextSensitiveHelp(BOOL) override { return S_OK; }
    STDMETHODIMP InPlaceDeactivate() override { Deactivate(); return S_OK; }
    STDMETHODIMP UIDeactivate() override { if(uiActive_ && inplace_) inplace_->OnUIDeactivate(FALSE); uiActive_=false; return S_OK; }
    STDMETHODIMP SetObjectRects(LPCRECT position,LPCRECT) override { if(!position) return E_POINTER; rect_=*position; if(window_) PaneResizeChild(rect_); return S_OK; }
    STDMETHODIMP ReactivateAndUndo() override { return E_NOTIMPL; }
    STDMETHODIMP TranslateAccelerator(LPMSG) override { return S_FALSE; }
    STDMETHODIMP OnFrameWindowActivate(BOOL) override { return S_OK; }
    STDMETHODIMP OnDocWindowActivate(BOOL) override { return S_OK; }
    STDMETHODIMP ResizeBorder(LPCRECT,IOleInPlaceUIWindow*,BOOL) override { return S_OK; }
    STDMETHODIMP EnableModeless(BOOL) override { return S_OK; }
    STDMETHODIMP GetControlInfo(CONTROLINFO* info) override { if(!info) return E_POINTER; *info={}; info->cb=sizeof(*info); return S_OK; }
    STDMETHODIMP OnMnemonic(LPMSG) override { return S_FALSE; }
    STDMETHODIMP OnAmbientPropertyChange(DISPID) override { return S_OK; }
    STDMETHODIMP FreezeEvents(BOOL) override { return S_OK; }
    STDMETHODIMP GetClassID(CLSID* value) override { if(!value) return E_POINTER; *value=CLSID_TaskPane; return S_OK; }
    STDMETHODIMP IsDirty() override { return S_FALSE; }
    STDMETHODIMP Load(IStream*) override { return S_OK; }
    STDMETHODIMP Save(IStream*,BOOL) override { return S_OK; }
    STDMETHODIMP GetSizeMax(ULARGE_INTEGER* value) override { if(!value) return E_POINTER; value->QuadPart=0; return S_OK; }
    STDMETHODIMP InitNew() override { return S_OK; }
    STDMETHODIMP GetTypeInfoCount(UINT* value) override { if(!value) return E_POINTER; *value=0; return S_OK; }
    STDMETHODIMP GetTypeInfo(UINT,LCID,ITypeInfo** value) override { if(value) *value=nullptr; return DISP_E_BADINDEX; }
    STDMETHODIMP GetIDsOfNames(REFIID,LPOLESTR*,UINT,LCID,DISPID*) override { return DISP_E_UNKNOWNNAME; }
    STDMETHODIMP Invoke(DISPID,REFIID,LCID,WORD,DISPPARAMS*,VARIANT*,EXCEPINFO*,UINT*) override { return DISP_E_MEMBERNOTFOUND; }
    STDMETHODIMP Draw(DWORD aspect,LONG,void*,DVTARGETDEVICE*,HDC,HDC target,LPCRECTL bounds,LPCRECTL,BOOL(CALLBACK*)(ULONG_PTR),ULONG_PTR) override {
        if(aspect!=DVASPECT_CONTENT) return DV_E_DVASPECT;
        if(!target || !bounds) return E_INVALIDARG;
        RECT rect={bounds->left,bounds->top,bounds->right,bounds->bottom};
        FillRect(target,&rect,GetSysColorBrush(COLOR_WINDOW)); return S_OK;
    }
    STDMETHODIMP GetColorSet(DWORD,LONG,void*,DVTARGETDEVICE*,HDC,LOGPALETTE** value) override { if(value) *value=nullptr; return E_NOTIMPL; }
    STDMETHODIMP Freeze(DWORD,LONG,void*,DWORD* value) override { if(value) *value=0; return E_NOTIMPL; }
    STDMETHODIMP Unfreeze(DWORD) override { return E_NOTIMPL; }
    STDMETHODIMP SetAdvise(DWORD aspect,DWORD flags,IAdviseSink* sink) override {
        if(aspect!=DVASPECT_CONTENT) return DV_E_DVASPECT;
        if(sink) sink->AddRef();
        if(viewSink_) viewSink_->Release();
        viewSink_=sink; viewFlags_=flags;
        if(viewSink_ && (flags&ADVF_PRIMEFIRST)) {
            IAdviseSink* notify=viewSink_; notify->AddRef();
            if(flags&ADVF_ONLYONCE) { viewSink_->Release(); viewSink_=nullptr; }
            notify->OnViewChange(DVASPECT_CONTENT,-1); notify->Release();
        }
        return S_OK;
    }
    STDMETHODIMP GetAdvise(DWORD* aspect,DWORD* flags,IAdviseSink** sink) override {
        if(aspect) *aspect=DVASPECT_CONTENT;
        if(flags) *flags=viewFlags_;
        if(sink) { *sink=viewSink_; if(*sink) (*sink)->AddRef(); }
        return S_OK;
    }
    STDMETHODIMP GetExtent(DWORD aspect,LONG,DVTARGETDEVICE*,LPSIZEL value) override { return GetExtent(aspect,value); }
};
}
HRESULT CreateTaskPaneControl(REFIID iid,void** object) {
    if(!object) return E_POINTER;
    *object=nullptr;
    auto* control=new(std::nothrow) TaskPaneControl();
    if(!control) return E_OUTOFMEMORY;
    HRESULT hr=control->QueryInterface(iid,object);
    control->Release(); return hr;
}
}
