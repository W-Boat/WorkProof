// CI-only: exercise the real PowerPoint snapshot reader without Office.
#ifndef WORKPROOF_POWERPOINT
#error This probe requires WORKPROOF_POWERPOINT
#endif
#include "engine.cpp"
#include <cstdio>
#include <cwchar>
namespace workproof { std::wstring EnginePath(){return L"unused.exe";} }
namespace {
enum Property {ActivePresentation=1,Path,Name,FullName,Slides,Count,Item,Shapes,ReadOnly,Saved,Save};
enum Role {Application,Presentation,SlideList,Slide,ShapeList};
struct Fixture;
class Object final:public IDispatch {
public:
    Fixture* fixture;Role role;LONG refs=1;
    Object(Fixture* f,Role r):fixture(f),role(r){}
    STDMETHODIMP QueryInterface(REFIID iid,void** out) override{if(!out)return E_POINTER;*out=nullptr;if(iid!=IID_IUnknown&&iid!=IID_IDispatch)return E_NOINTERFACE;*out=static_cast<IDispatch*>(this);AddRef();return S_OK;}
    STDMETHODIMP_(ULONG) AddRef() override{return InterlockedIncrement(&refs);}
    STDMETHODIMP_(ULONG) Release() override{return InterlockedDecrement(&refs);}
    STDMETHODIMP GetTypeInfoCount(UINT* out) override{if(!out)return E_POINTER;*out=0;return S_OK;}
    STDMETHODIMP GetTypeInfo(UINT,LCID,ITypeInfo**) override{return E_NOTIMPL;}
    STDMETHODIMP GetIDsOfNames(REFIID,LPOLESTR*,UINT,LCID,DISPID*) override;
    STDMETHODIMP Invoke(DISPID,REFIID,LCID,WORD,DISPPARAMS*,VARIANT*,EXCEPINFO*,UINT*) override;
};
struct Fixture {
    Object application{this,Application},presentation{this,Presentation},slides{this,SlideList},slide{this,Slide},shapes{this,ShapeList};
    LONG slideCount=3,shapeCount=4;
    Role failRole=Application;DISPID failProperty=0;bool wrongType=false;
    int forbiddenAccess=0,itemCalls=0,saveCalls=0;
    bool balanced(){return application.refs==1&&presentation.refs==1&&slides.refs==1&&slide.refs==1&&shapes.refs==1;}
};
STDMETHODIMP Object::GetIDsOfNames(REFIID,LPOLESTR* names,UINT n,LCID,DISPID* ids){
    const wchar_t* keys[]={L"",L"ActivePresentation",L"Path",L"Name",L"FullName",L"Slides",L"Count",L"Item",L"Shapes",L"ReadOnly",L"Saved",L"Save"};
    if(!names||!ids)return E_POINTER;
    for(UINT i=0;i<n;++i){ids[i]=DISPID_UNKNOWN;for(int k=1;k<=Save;++k)if(!wcscmp(names[i],keys[k])){ids[i]=k;break;}if(ids[i]==DISPID_UNKNOWN){++fixture->forbiddenAccess;return DISP_E_UNKNOWNNAME;}}
    return S_OK;
}
STDMETHODIMP Object::Invoke(DISPID id,REFIID,LCID,WORD flags,DISPPARAMS* params,VARIANT* out,EXCEPINFO*,UINT*){
    if(out)VariantInit(out);
    if(role==Presentation&&id==Save){if(!(flags&DISPATCH_METHOD))return DISP_E_MEMBERNOTFOUND;++fixture->saveCalls;return S_OK;}
    if(!out)return E_POINTER;
    if(role==fixture->failRole&&id==fixture->failProperty){if(!fixture->wrongType)return DISP_E_EXCEPTION;out->vt=VT_BOOL;return S_OK;}
    Object* object=nullptr;
    if(role==Application&&id==ActivePresentation)object=&fixture->presentation;
    if(role==Presentation&&id==Slides)object=&fixture->slides;
    if(role==SlideList&&id==Item){
        if(!(flags&(DISPATCH_METHOD|DISPATCH_PROPERTYGET))||!params||params->cArgs!=1||params->rgvarg[0].vt!=VT_I4||params->rgvarg[0].lVal<1||params->rgvarg[0].lVal>fixture->slideCount)return DISP_E_BADINDEX;
        ++fixture->itemCalls;object=&fixture->slide;
    }
    if(role==Slide&&id==Shapes)object=&fixture->shapes;
    if(object){out->vt=VT_DISPATCH;out->pdispVal=object;object->AddRef();return S_OK;}
    if(role==Presentation&&(id==Path||id==Name||id==FullName)){out->vt=VT_BSTR;out->bstrVal=SysAllocString(id==Path?L"C:\\fixture":id==Name?L"slides.pptx":L"C:\\fixture\\slides.pptx");return out->bstrVal?S_OK:E_OUTOFMEMORY;}
    if((role==SlideList||role==ShapeList)&&id==Count){out->vt=VT_I4;out->lVal=role==SlideList?fixture->slideCount:fixture->shapeCount;return S_OK;}
    if(role==Presentation&&(id==ReadOnly||id==Saved)){out->vt=VT_I4;out->lVal=id==Saved?-1:0;return S_OK;}
    ++fixture->forbiddenAccess;return DISP_E_MEMBERNOTFOUND;
}
bool Check(Fixture& f,bool expected,const char* label){
    workproof::DocSnapshot snapshot={};std::wstring error;int previous=f.itemCalls;
    bool actual=workproof::ReadDocument(&f.application,snapshot,error);
    bool valid=actual==expected&&f.balanced()&&f.forbiddenAccess==0&&(actual||!error.empty());
    if(actual)valid=valid&&snapshot.slides==f.slideCount&&snapshot.shapes==static_cast<long long>(f.slideCount)*f.shapeCount&&snapshot.characters==0&&snapshot.paragraphs==0&&!snapshot.readOnly&&snapshot.saved&&(f.itemCalls-previous)==f.slideCount;
    if(!valid)std::printf("FAIL: %s result=%d balanced=%d forbidden=%d\n",label,actual,f.balanced(),f.forbiddenAccess);
    return valid;
}
}
int main(){
    Fixture f;if(!Check(f,true,"three slides twelve shapes"))return 1;
    f.slideCount=0;if(!Check(f,true,"empty presentation"))return 1;
    f.slideCount=2;f.shapeCount=0;if(!Check(f,true,"zero shapes"))return 1;
    f.slideCount=2000;if(!Check(f,true,"exact slide limit"))return 1;
    f.slideCount=2001;if(!Check(f,false,"slide limit exceeded"))return 1;
    f.slideCount=-1;if(!Check(f,false,"negative slide count"))return 1;
    f.slideCount=1;f.shapeCount=-1;if(!Check(f,false,"negative shape count"))return 1;
    f.shapeCount=4;
    const Role roles[]={Application,Presentation,SlideList,SlideList,Slide,ShapeList};
    const DISPID ids[]={ActivePresentation,Slides,Count,Item,Shapes,Count};
    for(int i=0;i<6;++i){f.failRole=roles[i];f.failProperty=ids[i];f.wrongType=false;if(!Check(f,false,"property failure"))return 1;f.wrongType=true;if(!Check(f,false,"property wrong type"))return 1;}
    f.failProperty=0;std::wstring error;
    if(!workproof::SaveDocument(&f.application,error)||f.saveCalls!=1||!f.balanced()){std::puts("FAIL: ActivePresentation.Save");return 1;}
    std::puts("PASS: PowerPoint structure snapshots, zero/limits/failures, no text access, COM ownership and presentation Save");return 0;
}
