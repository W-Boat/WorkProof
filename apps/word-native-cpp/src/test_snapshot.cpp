// CI-only behavioral regression probe. No Word installation is required.
#include "engine.cpp"
#include <cstdio>
#include <cwchar>
#include <initializer_list>

namespace workproof { std::wstring EnginePath() { return L"unused.exe"; } }

namespace {
enum Property { ActiveDocument=1, Path, Name, FullName, Content, End, Paragraphs, Count, ReadOnly, Saved, TrackRevisions, Revisions, Item, RevisionType };
class Document final : public IDispatch {
public:
    LONG refs=1;
    DISPID failure=0;
    LONG characters=120, paragraphs=4;
    bool wrongType=false,tracking=false,denyTracking=false,revisionCollection=false;
    long revisionCount=4,lastRevision=0,trackingWrites=0;
    STDMETHODIMP QueryInterface(REFIID iid,void** out) override {
        if(!out)return E_POINTER;*out=nullptr;
        if(iid!=IID_IUnknown && iid!=IID_IDispatch)return E_NOINTERFACE;
        *out=static_cast<IDispatch*>(this);AddRef();return S_OK;
    }
    STDMETHODIMP_(ULONG) AddRef() override{return InterlockedIncrement(&refs);}
    STDMETHODIMP_(ULONG) Release() override{return InterlockedDecrement(&refs);}
    STDMETHODIMP GetTypeInfoCount(UINT* count) override{if(!count)return E_POINTER;*count=0;return S_OK;}
    STDMETHODIMP GetTypeInfo(UINT,LCID,ITypeInfo**) override{return E_NOTIMPL;}
    STDMETHODIMP GetIDsOfNames(REFIID,LPOLESTR* names,UINT count,LCID,DISPID* ids) override {
        const wchar_t* properties[]={L"",L"ActiveDocument",L"Path",L"Name",L"FullName",L"Content",L"End",L"Paragraphs",L"Count",L"ReadOnly",L"Saved",L"TrackRevisions",L"Revisions",L"Item",L"Type"};
        if(!names||!ids)return E_POINTER;
        for(UINT n=0;n<count;++n){
            ids[n]=DISPID_UNKNOWN;
            for(int id=1;id<=RevisionType;++id)if(wcscmp(names[n],properties[id])==0){ids[n]=id;break;}
            if(ids[n]==DISPID_UNKNOWN)return DISP_E_UNKNOWNNAME;
        }
        return S_OK;
    }
    STDMETHODIMP Invoke(DISPID id,REFIID,LCID,WORD flags,DISPPARAMS* params,VARIANT* out,EXCEPINFO*,UINT*) override {
        if(id==TrackRevisions&&flags==DISPATCH_PROPERTYPUT){
            if(denyTracking)return E_ACCESSDENIED;
            if(!params||params->cArgs!=1||params->cNamedArgs!=1||params->rgdispidNamedArgs[0]!=DISPID_PROPERTYPUT||
               params->rgvarg[0].vt!=VT_BOOL||params->rgvarg[0].boolVal!=VARIANT_TRUE)return E_INVALIDARG;
            tracking=true;++trackingWrites;return S_OK;
        }
        if(!out)return E_POINTER;VariantInit(out);
        if(id==ActiveDocument)revisionCollection=false;
        if(id==TrackRevisions){out->vt=VT_BOOL;out->boolVal=tracking?VARIANT_TRUE:VARIANT_FALSE;return S_OK;}
        if(id==Revisions){revisionCollection=true;out->vt=VT_DISPATCH;out->pdispVal=this;AddRef();return S_OK;}
        if(id==Item&&params&&params->cArgs==1&&params->rgvarg[0].vt==VT_I4){
            lastRevision=params->rgvarg[0].lVal;out->vt=VT_DISPATCH;out->pdispVal=this;AddRef();return S_OK;
        }
        if(id==RevisionType){out->vt=VT_I4;out->lVal=lastRevision==4?14:lastRevision;return S_OK;}
        if(id==failure){if(!wrongType)return DISP_E_EXCEPTION;out->vt=VT_BOOL;out->boolVal=VARIANT_FALSE;return S_OK;}
        if(id==ActiveDocument||id==Content||id==Paragraphs){out->vt=VT_DISPATCH;out->pdispVal=this;AddRef();return S_OK;}
        if(id==Path||id==Name||id==FullName){
            out->vt=VT_BSTR;out->bstrVal=SysAllocString(id==Path?L"C:\\fixture":id==Name?L"test.docx":L"C:\\fixture\\test.docx");return out->bstrVal?S_OK:E_OUTOFMEMORY;
        }
        if(id==End||id==Count){out->vt=VT_I4;out->lVal=id==End?characters:revisionCollection?revisionCount:paragraphs;return S_OK;}
        if(id==ReadOnly||id==Saved){out->vt=VT_BOOL;out->boolVal=id==Saved?VARIANT_TRUE:VARIANT_FALSE;return S_OK;}
        return DISP_E_MEMBERNOTFOUND;
    }
};
bool Check(Document& doc,bool expected,const char* label){
    workproof::DocSnapshot snapshot={};std::wstring error;
    bool actual=workproof::ReadDocument(&doc,snapshot,error);
    if(actual!=expected||doc.refs!=1||(!actual&&error.empty())){std::printf("FAIL: %s result=%d refs=%ld\n",label,actual,doc.refs);return false;}
    if(actual&&(snapshot.characters!=doc.characters||snapshot.paragraphs!=doc.paragraphs)){std::printf("FAIL: %s counts\n",label);return false;}
    return true;
}
}
int main(){
    Document doc;
    if(!Check(doc,true,"normal snapshot"))return 1;
    for(DISPID failure : {static_cast<DISPID>(Content),static_cast<DISPID>(End),static_cast<DISPID>(Paragraphs),static_cast<DISPID>(Count)}){
        doc.failure=failure;doc.wrongType=false;
        if(!Check(doc,false,"COM property failure"))return 1;
        doc.wrongType=true;
        if(!Check(doc,false,"unexpected property type"))return 1;
    }
    doc.failure=0;doc.wrongType=false;doc.characters=0;doc.paragraphs=0;
    if(!Check(doc,true,"valid zero counts"))return 1;
    doc.characters=-1;
    if(!Check(doc,false,"negative characters"))return 1;
    doc.characters=0;doc.paragraphs=-1;
    if(!Check(doc,false,"negative paragraphs"))return 1;
    const std::wstring identity=LR"(C:\fixture\test.docx)";
    const auto wrong=workproof::ReadWordRevisions(&doc,L"other.docx",true);
    const auto off=workproof::ReadWordRevisions(&doc,identity,false);
    if(wrong.tracking!=-1||off.tracking!=0||doc.trackingWrites!=0||off.total!=4)return 1;
    doc.denyTracking=true;
    if(workproof::ReadWordRevisions(&doc,identity,true).tracking!=0||doc.trackingWrites!=0)return 1;
    doc.denyTracking=false;
    const auto enabled=workproof::ReadWordRevisions(&doc,identity,true);
    if(enabled.tracking!=1||enabled.total!=4||enabled.inserted!=1||enabled.deleted!=1||
       enabled.formatted!=1||enabled.other!=1||doc.trackingWrites!=1||doc.refs!=1)return 1;
    doc.revisionCount=129;
    const auto bounded=workproof::ReadWordRevisions(&doc,identity,true);
    if(bounded.tracking!=1||bounded.total!=129||bounded.inserted!=-1||doc.trackingWrites!=1||doc.refs!=1)return 1;
    std::puts("PASS: snapshot rejects unavailable/invalid metrics, accepts real zero counts, releases COM references");
    return 0;
}
