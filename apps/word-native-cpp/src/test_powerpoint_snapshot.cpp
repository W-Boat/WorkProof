// CI-only: exercise the real PowerPoint snapshot reader without Office.
#ifndef WORKPROOF_POWERPOINT
#error This probe requires WORKPROOF_POWERPOINT
#endif
#include "engine.cpp"
#include <cstdio>
#include <cwchar>
namespace workproof { std::wstring EnginePath(){return L"unused.exe";} }
namespace {
enum Property {ActivePresentation=1,Path,Name,FullName,Slides,Count,Item,Shapes,ReadOnly,Saved,Save,FileDialog,Show,Execute,ActiveWindow,Hwnd,PageSetup,SlideWidth,SlideHeight,SlideId,ShapeId,ShapeType,Left,Top,Width,Height,Rotation,ZOrder,HasTextFrame,TextFrame,TextRange,Text,TableProperty,Rows,Columns,Cell,CellShape,SmartArt,AllNodes,TextFrame2,Font,ParagraphFormat,Size,Bold,Italic,Alignment,SpaceBefore,SpaceAfter,SpaceWithin};
enum Role {Application,Presentation,SlideList,Slide,ShapeList,Dialog,DocumentWindow,Page,Shape,Frame,Range,TableObject,RowList,ColumnList,CellObject,CellShapeObject,ArtObject,NodeList,ArtNode,FontObject,ParagraphObject};
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
    Object dialog{this,Dialog},window{this,DocumentWindow},page{this,Page},shape{this,Shape},frame{this,Frame},range{this,Range};
    Object table{this,TableObject},rows{this,RowList},columns{this,ColumnList},cell{this,CellObject},cellShape{this,CellShapeObject};
    Object smartArt{this,ArtObject},nodes{this,NodeList},node{this,ArtNode};
    Object font{this,FontObject},paragraph{this,ParagraphObject};
    long shapeType=1,cellColumn=0;double fontSize=20;long alignment=1;
    bool textEnabled=false;std::wstring text=L"hello";
    long activeSlide=0,activeShape=0;double shapeLeft=12;bool reverseShapes=false;int shapeCalls=0;
    bool unsaved=false,executeFailure=false,executeNoPath=false,showFailure=false,saveFailure=false;
    long choice=-1;int showCalls=0,executeCalls=0;
    LONG slideCount=3,shapeCount=4;
    Role failRole=Application;DISPID failProperty=0;bool wrongType=false;
    int forbiddenAccess=0,itemCalls=0,saveCalls=0;
    bool balanced(){return application.refs==1&&presentation.refs==1&&slides.refs==1&&slide.refs==1&&shapes.refs==1&&dialog.refs==1&&window.refs==1&&page.refs==1&&shape.refs==1&&frame.refs==1&&range.refs==1&&table.refs==1&&rows.refs==1&&columns.refs==1&&cell.refs==1&&cellShape.refs==1&&smartArt.refs==1&&nodes.refs==1&&node.refs==1&&font.refs==1&&paragraph.refs==1;}
};
STDMETHODIMP Object::GetIDsOfNames(REFIID,LPOLESTR* names,UINT n,LCID,DISPID* ids){
    const wchar_t* keys[]={L"",L"ActivePresentation",L"Path",L"Name",L"FullName",L"Slides",L"Count",L"Item",L"Shapes",L"ReadOnly",L"Saved",L"Save",L"FileDialog",L"Show",L"Execute",L"ActiveWindow",L"HWND",L"PageSetup",L"SlideWidth",L"SlideHeight",L"SlideID",L"Id",L"Type",L"Left",L"Top",L"Width",L"Height",L"Rotation",L"ZOrderPosition",L"HasTextFrame",L"TextFrame",L"TextRange",L"Text",L"Table",L"Rows",L"Columns",L"Cell",L"Shape",L"SmartArt",L"AllNodes",L"TextFrame2",L"Font",L"ParagraphFormat",L"Size",L"Bold",L"Italic",L"Alignment",L"SpaceBefore",L"SpaceAfter",L"SpaceWithin"};
    if(!names||!ids)return E_POINTER;
    for(UINT i=0;i<n;++i){ids[i]=DISPID_UNKNOWN;for(int k=1;k<=SpaceWithin;++k)if(!wcscmp(names[i],keys[k])){ids[i]=k;break;}if(ids[i]==DISPID_UNKNOWN){++fixture->forbiddenAccess;return DISP_E_UNKNOWNNAME;}}
    return S_OK;
}
STDMETHODIMP Object::Invoke(DISPID id,REFIID,LCID,WORD flags,DISPPARAMS* params,VARIANT* out,EXCEPINFO*,UINT*){
    if(out)VariantInit(out);
    if(role==Presentation&&id==Save){if(!(flags&DISPATCH_METHOD))return DISP_E_MEMBERNOTFOUND;++fixture->saveCalls;return fixture->saveFailure?E_FAIL:S_OK;}
    if(role==Dialog&&id==Execute){++fixture->executeCalls;if(fixture->executeFailure)return E_FAIL;if(!fixture->executeNoPath)fixture->unsaved=false;return S_OK;}
    if(role==Dialog&&id==Show){++fixture->showCalls;if(fixture->showFailure)return E_FAIL;if(!out)return E_POINTER;out->vt=VT_I4;out->lVal=fixture->choice;return S_OK;}
    if(!out)return E_POINTER;
    if(role==fixture->failRole&&id==fixture->failProperty){if(!fixture->wrongType)return DISP_E_EXCEPTION;out->vt=VT_BOOL;return S_OK;}
    Object* object=nullptr;
    if(role==Application&&id==ActiveWindow)object=&fixture->window;
    if(role==Presentation&&id==PageSetup)object=&fixture->page;
    if(role==DocumentWindow&&id==Hwnd){out->vt=VT_I4;out->lVal=1234;return S_OK;}
    if(role==Page&&(id==SlideWidth||id==SlideHeight)){out->vt=VT_R8;out->dblVal=id==SlideWidth?960.0:540.0;return S_OK;}
    if(role==Application&&id==ActivePresentation)object=&fixture->presentation;
    if(role==Application&&id==FileDialog){if(!params||params->cArgs!=1||params->rgvarg[0].vt!=VT_I4||params->rgvarg[0].lVal!=2)return DISP_E_TYPEMISMATCH;object=&fixture->dialog;}
    if(role==Presentation&&id==Slides)object=&fixture->slides;
    if(role==SlideList&&id==Item){
        if(!(flags&(DISPATCH_METHOD|DISPATCH_PROPERTYGET))||!params||params->cArgs!=1||params->rgvarg[0].vt!=VT_I4||params->rgvarg[0].lVal<1||params->rgvarg[0].lVal>fixture->slideCount)return DISP_E_BADINDEX;
        ++fixture->itemCalls;fixture->activeSlide=params->rgvarg[0].lVal;object=&fixture->slide;
    }
    if(role==Slide&&id==SlideId){out->vt=VT_I4;out->lVal=fixture->activeSlide+100;return S_OK;}
    if(role==ShapeList&&id==Item){
        if(!params||params->cArgs!=1||params->rgvarg[0].vt!=VT_I4||params->rgvarg[0].lVal<1||params->rgvarg[0].lVal>fixture->shapeCount)return DISP_E_BADINDEX;
        fixture->activeShape=params->rgvarg[0].lVal;++fixture->shapeCalls;object=&fixture->shape;
    }
    if(role==Shape&&id==HasTextFrame){out->vt=VT_I4;out->lVal=fixture->textEnabled?-1:0;return S_OK;}
    if((role==Shape||role==CellShapeObject)&&id==TextFrame)object=&fixture->frame;
    if(role==Shape&&id==TableProperty)object=&fixture->table;
    if(role==TableObject&&id==Rows)object=&fixture->rows;
    if(role==TableObject&&id==Columns)object=&fixture->columns;
    if((role==RowList||role==ColumnList||role==NodeList)&&id==Count){out->vt=VT_I4;out->lVal=role==ColumnList?2:1;return S_OK;}
    if(role==TableObject&&id==Cell){
        if(!params||params->cArgs!=2||params->rgvarg[0].vt!=VT_I4||params->rgvarg[1].vt!=VT_I4||params->rgvarg[1].lVal!=1||params->rgvarg[0].lVal<1||params->rgvarg[0].lVal>2)return DISP_E_BADINDEX;
        fixture->cellColumn=params->rgvarg[0].lVal;object=&fixture->cell;
    }
    if(role==CellObject&&id==CellShape)object=&fixture->cellShape;
    if(role==CellShapeObject&&id==ShapeId){out->vt=VT_I4;out->lVal=fixture->cellColumn;return S_OK;}
    if(role==Shape&&id==SmartArt)object=&fixture->smartArt;
    if(role==ArtObject&&id==AllNodes)object=&fixture->nodes;
    if(role==NodeList&&id==Item)object=&fixture->node;
    if(role==ArtNode&&id==TextFrame2)object=&fixture->frame;
    if(role==Frame&&id==TextRange)object=&fixture->range;
    if(role==Range&&id==Font)object=&fixture->font;
    if(role==Range&&id==ParagraphFormat)object=&fixture->paragraph;
    if(role==FontObject&&id==Name){out->vt=VT_BSTR;out->bstrVal=SysAllocString(L"Fixture Font");return S_OK;}
    if(role==FontObject&&(id==Size||id==Bold||id==Italic)){out->vt=VT_R8;out->dblVal=id==Size?fixture->fontSize:0;return S_OK;}
    if(role==ParagraphObject&&(id==Alignment||id==SpaceBefore||id==SpaceAfter||id==SpaceWithin)){out->vt=VT_R8;out->dblVal=id==Alignment?fixture->alignment:1;return S_OK;}
    if(role==Range&&id==Text){out->vt=VT_BSTR;out->bstrVal=SysAllocString(fixture->text.c_str());return S_OK;}
    if(role==Shape){
        out->vt=VT_R8;
        switch(id){
            case ShapeId:out->dblVal=fixture->activeSlide*10000+(fixture->reverseShapes?fixture->shapeCount+1-fixture->activeShape:fixture->activeShape);return S_OK;
            case ShapeType:out->dblVal=fixture->shapeType;return S_OK;
            case Left:out->dblVal=fixture->shapeLeft;return S_OK;
            case Top:case Width:case Height:out->dblVal=30;return S_OK;
            case Rotation:out->dblVal=0;return S_OK;
            case ZOrder:out->dblVal=fixture->activeShape;return S_OK;
        }
    }
    if(role==Slide&&id==Shapes)object=&fixture->shapes;
    if(object){out->vt=VT_DISPATCH;out->pdispVal=object;object->AddRef();return S_OK;}
    if(role==Presentation&&(id==Path||id==Name||id==FullName)){out->vt=VT_BSTR;out->bstrVal=SysAllocString(id==Path?(fixture->unsaved?L"":L"C:\\fixture"):id==Name?L"slides.pptx":L"C:\\fixture\\slides.pptx");return out->bstrVal?S_OK:E_OUTOFMEMORY;}
    if((role==SlideList||role==ShapeList)&&id==Count){out->vt=VT_I4;out->lVal=role==SlideList?fixture->slideCount:fixture->shapeCount;return S_OK;}
    if(role==Presentation&&(id==ReadOnly||id==Saved)){out->vt=VT_I4;out->lVal=id==Saved?-1:0;return S_OK;}
    ++fixture->forbiddenAccess;return DISP_E_MEMBERNOTFOUND;
}
bool Check(Fixture& f,bool expected,const char* label){
    workproof::DocSnapshot snapshot={};std::wstring error;int previous=f.itemCalls;
    bool actual=workproof::ReadDocument(&f.application,snapshot,error);
    bool valid=actual==expected&&f.balanced()&&f.forbiddenAccess==0&&(actual||!error.empty());
    if(actual)valid=valid&&snapshot.slides==f.slideCount&&snapshot.shapes==static_cast<long long>(f.slideCount)*f.shapeCount&&snapshot.characters==0&&snapshot.paragraphs==0&&!snapshot.readOnly&&snapshot.saved&&(f.itemCalls-previous)>=f.slideCount;
    if(!valid)std::printf("FAIL: %s result=%d balanced=%d forbidden=%d\n",label,actual,f.balanced(),f.forbiddenAccess);
    return valid;
}
}
int main(){
    Fixture f;if(!Check(f,true,"three slides twelve shapes"))return 1;
    workproof::DocSnapshot baseline,moved,reordered;std::wstring structureError;
    if(!workproof::ReadDocument(&f.application,baseline,structureError)||baseline.structureSignature.size()!=64)return 1;
    f.textEnabled=true;
    workproof::DocSnapshot firstText,secondText;
    if(!workproof::ReadDocument(&f.application,firstText,structureError)||!firstText.textSampled||firstText.characters!=60||firstText.paragraphs!=12||firstText.textSignature.size()!=64||!f.balanced()){std::puts("FAIL: complete PowerPoint text count");return 1;}
    f.fontSize=28;f.alignment=2;
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||!secondText.textSampled||secondText.textSignature!=firstText.textSignature||secondText.formatSignature.empty()||secondText.formatSignature==firstText.formatSignature||!f.balanced()){std::puts("FAIL: pure formatting change missed");return 1;}
    f.failRole=FontObject;f.failProperty=Size;
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||!secondText.textSampled||!secondText.formatSignature.empty()||!f.balanced()){std::puts("FAIL: unavailable formatting prevented text sampling");return 1;}
    f.failProperty=0;
    f.text=L"world";
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||!secondText.textSampled||secondText.characters!=firstText.characters||secondText.textSignature==firstText.textSignature){std::puts("FAIL: equal-length replacement missed");return 1;}
    f.failRole=Range;f.failProperty=Text;
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||secondText.textSampled||!secondText.textSignature.empty()||!f.balanced()){std::puts("FAIL: incomplete text became an empty-document baseline");return 1;}
    f.failProperty=0;f.textEnabled=false;
    f.shapeType=19;
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||!secondText.textSampled||secondText.characters!=120||!f.balanced()){std::puts("FAIL: PowerPoint table cells were not counted");return 1;}
    f.shapeType=24;
    if(!workproof::ReadDocument(&f.application,secondText,structureError)||!secondText.textSampled||secondText.characters!=60||!f.balanced()){std::puts("FAIL: PowerPoint SmartArt nodes were not counted");return 1;}
    f.shapeType=1;
    f.shapeLeft+=20;
    if(!workproof::ReadDocument(&f.application,moved,structureError)||moved.structureSignature==baseline.structureSignature||moved.shapes!=baseline.shapes){std::puts("FAIL: same-count geometry change missed");return 1;}
    f.reverseShapes=true;
    if(!workproof::ReadDocument(&f.application,reordered,structureError)||reordered.structureSignature==moved.structureSignature||reordered.shapes!=moved.shapes){std::puts("FAIL: same-count shape reorder missed");return 1;}
    f.failRole=Shape;f.failProperty=Left;
    if(!workproof::ReadDocument(&f.application,reordered,structureError)||!reordered.structureSignature.empty()||!f.balanced()){std::puts("FAIL: unavailable geometry produced a partial signature");return 1;}
    f.failProperty=0;
    f.shapeCount=4097;const int calls=f.shapeCalls;
    if(!workproof::ReadDocument(&f.application,reordered,structureError)||!reordered.structureSignature.empty()||f.shapeCalls!=calls){std::puts("FAIL: bounded optional geometry collection");return 1;}
    f.shapeCount=4;
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
    f.failProperty=0;
    workproof::DocSnapshot optional;std::wstring error;
    if(!workproof::ReadDocument(&f.application,optional,error)||optional.layoutSignature.empty()||optional.editorWindow!=reinterpret_cast<HWND>(1234)||!f.balanced())return 1;
    for(auto property:{ActiveWindow,PageSetup}){f.failRole=property==ActiveWindow?Application:Presentation;f.failProperty=property;f.wrongType=false;if(!Check(f,true,"optional metadata unavailable"))return 1;}
    f.failProperty=0;
    if(!workproof::SaveDocument(&f.application,error)||f.saveCalls!=1||!f.balanced()){std::puts("FAIL: ActivePresentation.Save");return 1;}
    f.saveFailure=true;
    if(workproof::SaveDocument(&f.application,error)||!f.balanced()){std::puts("FAIL: save command failure");return 1;}
    f.saveFailure=false;
    Fixture blank;blank.unsaved=true;blank.choice=0;
    if(workproof::SaveDocument(&blank.application,error)||blank.executeCalls||blank.saveCalls||!blank.balanced()){std::puts("FAIL: save dialog cancellation");return 1;}
    blank.choice=-1;blank.executeFailure=true;
    if(workproof::SaveDocument(&blank.application,error)||!blank.unsaved||!blank.balanced()){std::puts("FAIL: save dialog execute failure");return 1;}
    blank.executeFailure=false;blank.executeNoPath=true;
    if(workproof::SaveDocument(&blank.application,error)||!blank.balanced()){std::puts("FAIL: save dialog no saved path");return 1;}
    blank.executeNoPath=false;blank.showFailure=true;
    if(workproof::SaveDocument(&blank.application,error)||!blank.balanced()){std::puts("FAIL: save dialog show failure");return 1;}
    blank.showFailure=false;
    if(!workproof::SaveDocument(&blank.application,error)||blank.unsaved||blank.saveCalls||!blank.balanced()){std::puts("FAIL: save dialog success");return 1;}
    std::puts("PASS: PowerPoint structure snapshots, zero/limits/failures, no text access, COM ownership and presentation Save");return 0;
}
