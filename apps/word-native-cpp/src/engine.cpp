#include "engine.h"
#include "addin.h"
#include "controlled_process.h"
#include <winhttp.h>
#include <bcrypt.h>
#include <cmath>
#pragma comment(lib, "bcrypt.lib")
#include <cstdlib>
#include <vector>
#include <initializer_list>

#pragma comment(lib, "winhttp.lib")

namespace workproof {

namespace {

#ifdef WORKPROOF_POWERPOINT
const wchar_t kActiveDocument[]=L"ActivePresentation";
const wchar_t kHostName[]=L"PowerPoint";
#else
const wchar_t kActiveDocument[]=L"ActiveDocument";
const wchar_t kHostName[]=L"Word";
#endif

std::wstring EnginePort() {
    wchar_t buffer[16] = {0};
    DWORD length = GetEnvironmentVariableW(L"WORKPROOF_ENGINE_PORT", buffer, 16);
    if (length > 0 && length < 16) {
        int port = _wtoi(buffer);
        if (port > 0 && port < 65536) return buffer;
    }
    return L"43127";
}

struct Variant {
    VARIANT value;
    Variant() { VariantInit(&value); }
    ~Variant() { VariantClear(&value); }
    VARIANT* operator&() { return &value; }
    VARIANT* get() { return &value; }
};

struct Internet {
    HINTERNET handle;
    explicit Internet(HINTERNET h) : handle(h) {}
    ~Internet() { if (handle) WinHttpCloseHandle(handle); }
    operator HINTERNET() const { return handle; }
};

HRESULT GetProperty(IDispatch* object, const wchar_t* name, VARIANT* result) {
    if (!result) return E_POINTER;
    VariantInit(result);
    if (!object) return E_POINTER;
    DISPID id = 0;
    OLECHAR* names[1] = { const_cast<OLECHAR*>(name) };
    HRESULT hr = object->GetIDsOfNames(IID_NULL, names, 1, LOCALE_USER_DEFAULT, &id);
    if (FAILED(hr)) return hr;
    DISPPARAMS params = { nullptr, nullptr, 0, 0 };
    VariantInit(result);
    return object->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_PROPERTYGET, &params, result, nullptr, nullptr);
}

#ifdef WORKPROOF_POWERPOINT
// Optional bounded structure sampling. Never read text, names, pixels or notes.
std::wstring PresentationStructure(IDispatch* slides,long slideCount,long long shapeCount){
    if(shapeCount>4096)return {};
    const ULONGLONG started=GetTickCount64();
    std::wstring data=L"workproof-ppt-structure-v1;";
    auto fields=[&](IDispatch* object,std::initializer_list<const wchar_t*> names){
        for(auto name:names){
            Variant value,number;
            if(FAILED(GetProperty(object,name,value.get()))||
               FAILED(VariantChangeType(number.get(),value.get(),0,VT_R8))||
               !std::isfinite(number.value.dblVal)||std::abs(number.value.dblVal)>1e12)return false;
            data+=std::to_wstring(number.value.dblVal)+L";";
        }
        return true;
    };
    auto item=[](IDispatch* collection,long index,Variant& output){
        LPOLESTR name=const_cast<LPOLESTR>(L"Item");DISPID id=0;
        if(FAILED(collection->GetIDsOfNames(IID_NULL,&name,1,LOCALE_USER_DEFAULT,&id)))return false;
        VARIANT arg={};arg.vt=VT_I4;arg.lVal=index;
        DISPPARAMS parameters={&arg,nullptr,1,0};
        return SUCCEEDED(collection->Invoke(id,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD|DISPATCH_PROPERTYGET,&parameters,output.get(),nullptr,nullptr))&&
            output.value.vt==VT_DISPATCH&&output.value.pdispVal;
    };
    long observed=0;
    for(long i=1;i<=slideCount;++i){
        if(GetTickCount64()-started>=75)return {};
        Variant slide,shapes,count;
        if(!item(slides,i,slide)||!fields(slide.value.pdispVal,{L"SlideID"})||
           FAILED(GetProperty(slide.value.pdispVal,L"Shapes",shapes.get()))||shapes.value.vt!=VT_DISPATCH||!shapes.value.pdispVal||
           FAILED(GetProperty(shapes.value.pdispVal,L"Count",count.get()))||count.value.vt!=VT_I4||count.value.lVal<0||count.value.lVal>4096-observed)return {};
        data+=L"count="+std::to_wstring(count.value.lVal)+L";";
        for(long j=1;j<=count.value.lVal;++j){
            // Discard incomplete scans and retain count-based recording. This
            // budget is checked between COM calls, which the host controls.
            if(GetTickCount64()-started>=75)return {};
            Variant shape;
            if(!item(shapes.value.pdispVal,j,shape)||
               !fields(shape.value.pdispVal,{L"Id",L"Type",L"Left",L"Top",L"Width",L"Height",L"Rotation",L"ZOrderPosition"}))return {};
            ++observed;
        }
    }
    if(observed!=shapeCount)return {}; // Changed while enumerating; establish no baseline.
    unsigned char digest[32]{};
    const auto size=static_cast<ULONG>(data.size()*sizeof(wchar_t));
    if(BCryptHash(BCRYPT_SHA256_ALG_HANDLE,nullptr,0,reinterpret_cast<PUCHAR>(data.data()),size,digest,sizeof(digest))<0)return {};
    const wchar_t* hex=L"0123456789abcdef";std::wstring output;
    for(auto byte:digest){output+=hex[byte>>4];output+=hex[byte&15];}
    return output;
}
#endif

bool WideToUtf8(const std::wstring& text, std::string& output) {
    if (text.empty()) { output.clear(); return true; }
    int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return false;
    output.resize((size_t)size);
    return WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), &output[0], size, nullptr, nullptr) == size;
}

std::wstring Utf8ToWide(const std::string& text) {
    if (text.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0);
    std::wstring output((size_t)size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), &output[0], size);
    return output;
}

} // namespace

std::string JsonField(const std::string& json, const char* key) {
    std::string pattern = std::string("\"") + key + "\":\"";
    size_t start = json.find(pattern);
    if (start != std::string::npos) {
        start += pattern.size();
        size_t end = json.find('"', start);
        if (end != std::string::npos) return json.substr(start, end - start);
        return std::string();
    }
    // Numeric or boolean value.
    pattern = std::string("\"") + key + "\":";
    start = json.find(pattern);
    if (start == std::string::npos) return std::string();
    start += pattern.size();
    size_t end = start;
    while (end < json.size() && json[end] != ',' && json[end] != '}' && json[end] != '\n') ++end;
    return json.substr(start, end - start);
}

bool HttpJson(const std::wstring& method, const std::wstring& path, const std::string& body,
              const std::wstring& bearer, std::string& response, long& status) {
    response.clear();
    status = 0;
    Internet session(WinHttpOpen(L"WorkProofWord/1.0", WINHTTP_ACCESS_TYPE_NO_PROXY,
                                 WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
    if (!session) return false;
    WinHttpSetTimeouts(session, 5000, 5000, 10000, 20000);
    Internet connection(WinHttpConnect(session, L"127.0.0.1", (INTERNET_PORT)_wtoi(EnginePort().c_str()), 0));
    if (!connection) return false;
    Internet request(WinHttpOpenRequest(connection, method.c_str(), path.c_str(), nullptr,
                                        WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, 0));
    if (!request) return false;

    std::wstring headers = L"Content-Type: application/json\r\nAccept: application/json\r\n";
    if (!bearer.empty()) headers += L"Authorization: Bearer " + bearer + L"\r\n";
    // A native client must not send Origin: the collector rejects browser-shaped native calls.
    BOOL sent = WinHttpSendRequest(request, headers.c_str(), (DWORD)-1L,
                                   body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data(),
                                   (DWORD)body.size(), (DWORD)body.size(), 0);
    if (!sent || !WinHttpReceiveResponse(request, nullptr)) return false;

    DWORD code = 0;
    DWORD size = sizeof(code);
    if (WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                            WINHTTP_HEADER_NAME_BY_INDEX, &code, &size, WINHTTP_NO_HEADER_INDEX)) {
        status = (long)code;
    }
    char buffer[4096];
    DWORD read = 0;
    while (WinHttpReadData(request, buffer, sizeof(buffer), &read) && read > 0) {
        response.append(buffer, read);
        if (response.size() > 4u * 1024u * 1024u) break;
    }
    return true;
}

bool RunEngine(const std::wstring& arguments, std::string& output, std::wstring& error) {
    ProcessStatus status=RunControlledProcess(EnginePath(),arguments,output);
    if(status==ProcessStatus::Success)return true;
    error=status==ProcessStatus::TimedOut?L"记录引擎处理超过 60 秒，已停止本次处理。":
          status==ProcessStatus::OutputLimit?L"记录引擎输出过多，已停止本次处理。":
          L"记录引擎未能完成本次操作，请重试或联系管理员。";
    return false;
}

bool ReadDocument(IDispatch* application, DocSnapshot& snapshot, std::wstring& error) {
    snapshot.editorWindow=nullptr;snapshot.layoutSignature.clear();snapshot.formatSignature.clear();snapshot.structureSignature.clear();
    snapshot.selectionStart=-1;snapshot.selectionEnd=-1;
    if (!application) { error = std::wstring(kHostName)+L" 尚未完成加载，请稍后重试。"; return false; }
    Variant documentOwner;
    VARIANT& document=documentOwner.value;
    if (FAILED(GetProperty(application, kActiveDocument, &document)) || document.vt != VT_DISPATCH || !document.pdispVal) {
        error = L"请先打开一份文档。";
        return false;
    }
    IDispatch* doc = document.pdispVal;
    VARIANT pathValue, nameValue, fullValue, readOnlyValue, savedValue;
    VariantInit(&pathValue); VariantInit(&nameValue); VariantInit(&fullValue);
    VariantInit(&readOnlyValue); VariantInit(&savedValue);
    bool ok = true;
    ok = ok && SUCCEEDED(GetProperty(doc, L"Path", &pathValue)) && pathValue.vt == VT_BSTR;
    ok = ok && SUCCEEDED(GetProperty(doc, L"Name", &nameValue)) && nameValue.vt == VT_BSTR;
    ok = ok && SUCCEEDED(GetProperty(doc, L"FullName", &fullValue)) && fullValue.vt == VT_BSTR;
    if (!ok) {
        VariantClear(&pathValue); VariantClear(&nameValue); VariantClear(&fullValue);
        error = L"暂时读不到文档信息，请稍后重试。";
        return false;
    }
    std::wstring pathText = pathValue.bstrVal ? pathValue.bstrVal : L"";
    if (pathText.empty()) {
        VariantClear(&pathValue); VariantClear(&nameValue); VariantClear(&fullValue);
        error = L"请先保存这份文档。未保存的文档没有可绑定的文件，也无法导出证书。";
        return false;
    }
    snapshot.identity = fullValue.bstrVal ? fullValue.bstrVal : L"";
    snapshot.name = nameValue.bstrVal ? nameValue.bstrVal : L"";
    VariantClear(&pathValue);
    VariantClear(&nameValue);
    VariantClear(&fullValue);

#ifdef WORKPROOF_POWERPOINT
    snapshot.characters=0;snapshot.paragraphs=0;snapshot.slides=0;snapshot.shapes=0;
    Variant slidesOwner,slideCountOwner;
    if(FAILED(GetProperty(doc,L"Slides",slidesOwner.get())) || slidesOwner.value.vt!=VT_DISPATCH || !slidesOwner.value.pdispVal ||
       FAILED(GetProperty(slidesOwner.value.pdispVal,L"Count",slideCountOwner.get())) ||
       (slideCountOwner.value.vt!=VT_I4 && slideCountOwner.value.vt!=VT_I2)) {
        error=L"暂时读不到幻灯片数量，已停止本次采样。请关闭 PowerPoint 中的对话框后重试。";return false;
    }
    snapshot.slides=slideCountOwner.value.vt==VT_I4?slideCountOwner.value.lVal:slideCountOwner.value.iVal;
    if(snapshot.slides<0 || snapshot.slides>2000){error=L"幻灯片数量无效或超过本版 2000 页记录范围。";return false;}
    // No slide text, images, object names or notes are read.
    if(snapshot.slides>0){
        LPOLESTR itemName=const_cast<LPOLESTR>(L"Item");DISPID itemId=0;
        if(FAILED(slidesOwner.value.pdispVal->GetIDsOfNames(IID_NULL,&itemName,1,LOCALE_USER_DEFAULT,&itemId))){error=L"暂时无法读取幻灯片结构，已停止本次采样。";return false;}
        for(long index=1;index<=snapshot.slides;++index){
            Variant slide,shapes,count;
            VARIANT argument={};argument.vt=VT_I4;argument.lVal=index;
            DISPPARAMS parameters={&argument,nullptr,1,0};
            HRESULT hr=slidesOwner.value.pdispVal->Invoke(itemId,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD|DISPATCH_PROPERTYGET,&parameters,slide.get(),nullptr,nullptr);
            if(FAILED(hr)||slide.value.vt!=VT_DISPATCH||!slide.value.pdispVal ||
               FAILED(GetProperty(slide.value.pdispVal,L"Shapes",shapes.get()))||shapes.value.vt!=VT_DISPATCH||!shapes.value.pdispVal ||
               FAILED(GetProperty(shapes.value.pdispVal,L"Count",count.get()))||(count.value.vt!=VT_I4&&count.value.vt!=VT_I2)){
                error=L"暂时无法读取页面对象数量，已停止本次采样。";return false;
            }
            long value=count.value.vt==VT_I4?count.value.lVal:count.value.iVal;
            if(value<0){error=L"页面对象数量无效，已停止本次采样。";return false;}
            snapshot.shapes+=value;
        }
    }
    snapshot.structureSignature=PresentationStructure(slidesOwner.value.pdispVal,snapshot.slides,snapshot.shapes);
#else
    Variant contentOwner, endOwner;
    VARIANT& content=contentOwner.value;
    VARIANT& endValue=endOwner.value;
    if (SUCCEEDED(GetProperty(doc, L"Content", &content)) && content.vt == VT_DISPATCH && content.pdispVal &&
        SUCCEEDED(GetProperty(content.pdispVal, L"End", &endValue)) && (endValue.vt == VT_I4 || endValue.vt == VT_I2)) {
        snapshot.characters = (endValue.vt == VT_I4) ? endValue.lVal : endValue.iVal;
    } else {
        error = L"暂时读不到文档字符数量，已停止本次采样。请关闭 Word 中的对话框后重试。";
        return false;
    }
    VariantClear(&endValue);
    VariantClear(&content);

    Variant paragraphsOwner, countOwner;
    VARIANT& paragraphs=paragraphsOwner.value;
    VARIANT& countValue=countOwner.value;
    if (SUCCEEDED(GetProperty(doc, L"Paragraphs", &paragraphs)) && paragraphs.vt == VT_DISPATCH && paragraphs.pdispVal &&
        SUCCEEDED(GetProperty(paragraphs.pdispVal, L"Count", &countValue)) && (countValue.vt == VT_I4 || countValue.vt == VT_I2)) {
        snapshot.paragraphs = (countValue.vt == VT_I4) ? countValue.lVal : countValue.iVal;
    } else {
        error = L"暂时读不到文档段落数量，已停止本次采样。请关闭 Word 中的对话框后重试。";
        return false;
    }
    VariantClear(&countValue);
    VariantClear(&paragraphs);

    if(snapshot.characters < 0 || snapshot.paragraphs < 0) {
        error = L"Word 返回的文档数量无效，已停止本次采样。请重新打开文档后重试。";
        return false;
    }
#endif

    VariantInit(&readOnlyValue);
    VariantInit(&savedValue);
    snapshot.readOnly = SUCCEEDED(GetProperty(doc, L"ReadOnly", &readOnlyValue)) &&
                        ((readOnlyValue.vt == VT_BOOL && readOnlyValue.boolVal == VARIANT_TRUE) ||
                         (readOnlyValue.vt == VT_I4 && readOnlyValue.lVal == -1));
    snapshot.saved = !(SUCCEEDED(GetProperty(doc, L"Saved", &savedValue)) &&
                       ((savedValue.vt == VT_BOOL && savedValue.boolVal == VARIANT_FALSE) ||
                        (savedValue.vt == VT_I4 && savedValue.lVal == 0)));
    VariantClear(&readOnlyValue);
    VariantClear(&savedValue);

    if (snapshot.characters > 8000000) { error = L"文档超过 800 万字符，超出本版记录范围。请拆分文档后重试。"; return false; }
    // Optional metadata failures must not stop the existing count recorder.
    // No text, clipboard payload or formatting values leave this process.
    auto signature=[](IDispatch* object,std::initializer_list<const wchar_t*> fields){
        std::wstring result;
        for(auto field:fields){
            Variant original,number;
            if(FAILED(GetProperty(object,field,original.get()))||
               FAILED(VariantChangeType(number.get(),original.get(),0,VT_R8)))return std::wstring();
            result+=std::to_wstring(number.value.dblVal)+L";";
        }
        return result;
    };
    Variant window,handle,page;
    if(SUCCEEDED(GetProperty(application,L"ActiveWindow",window.get()))&&window.value.vt==VT_DISPATCH&&window.value.pdispVal&&
       SUCCEEDED(GetProperty(window.value.pdispVal,L"HWND",handle.get()))){
        if(handle.value.vt==VT_I4)snapshot.editorWindow=reinterpret_cast<HWND>(static_cast<ULONG_PTR>(static_cast<unsigned long>(handle.value.lVal)));
        else if(handle.value.vt==VT_I8)snapshot.editorWindow=reinterpret_cast<HWND>(static_cast<ULONG_PTR>(handle.value.llVal));
    }
    if(SUCCEEDED(GetProperty(doc,L"PageSetup",page.get()))&&page.value.vt==VT_DISPATCH&&page.value.pdispVal){
#ifdef WORKPROOF_POWERPOINT
        snapshot.layoutSignature=signature(page.value.pdispVal,{L"SlideWidth",L"SlideHeight"});
#else
        snapshot.layoutSignature=signature(page.value.pdispVal,{L"Orientation",L"TopMargin",L"BottomMargin",L"LeftMargin",L"RightMargin",L"PageWidth",L"PageHeight"});
#endif
    }
#ifndef WORKPROOF_POWERPOINT
    Variant selection,start,end,font,paragraphFormat;
    if(SUCCEEDED(GetProperty(application,L"Selection",selection.get()))&&selection.value.vt==VT_DISPATCH&&selection.value.pdispVal&&
       SUCCEEDED(GetProperty(selection.value.pdispVal,L"Start",start.get()))&&start.value.vt==VT_I4&&
       SUCCEEDED(GetProperty(selection.value.pdispVal,L"End",end.get()))&&end.value.vt==VT_I4){
        snapshot.selectionStart=start.value.lVal;snapshot.selectionEnd=end.value.lVal;
        if(SUCCEEDED(GetProperty(selection.value.pdispVal,L"Font",font.get()))&&font.value.vt==VT_DISPATCH&&font.value.pdispVal&&
           SUCCEEDED(GetProperty(selection.value.pdispVal,L"ParagraphFormat",paragraphFormat.get()))&&paragraphFormat.value.vt==VT_DISPATCH&&paragraphFormat.value.pdispVal){
            auto fontValues=signature(font.value.pdispVal,{L"Bold",L"Italic",L"Underline",L"Size"});
            auto paragraphValues=signature(paragraphFormat.value.pdispVal,{L"Alignment",L"SpaceBefore",L"SpaceAfter",L"LineSpacing"});
            if(!fontValues.empty()&&!paragraphValues.empty()){
                snapshot.formatSignature=fontValues+paragraphValues;
                Variant name;
                if(SUCCEEDED(GetProperty(font.value.pdispVal,L"Name",name.get()))&&name.value.vt==VT_BSTR&&name.value.bstrVal&&SysStringLen(name.value.bstrVal)<=128)
                    snapshot.formatSignature+=L"name="+std::wstring(name.value.bstrVal,SysStringLen(name.value.bstrVal))+L";";
                snapshot.formatSignature+=L"color="+signature(font.value.pdispVal,{L"Color"});
                snapshot.formatSignature+=L"effects="+signature(font.value.pdispVal,{L"StrikeThrough",L"Subscript",L"Superscript"});
                Variant range,list;
                if(SUCCEEDED(GetProperty(selection.value.pdispVal,L"Range",range.get()))&&range.value.vt==VT_DISPATCH&&range.value.pdispVal&&
                   SUCCEEDED(GetProperty(range.value.pdispVal,L"ListFormat",list.get()))&&list.value.vt==VT_DISPATCH&&list.value.pdispVal)
                    snapshot.formatSignature+=L"list="+signature(list.value.pdispVal,{L"ListType",L"ListLevelNumber"});
            }
        }
    }
#endif
    return true;

}

bool SaveDocument(IDispatch* application, std::wstring& error) {
    if (!application) { error = std::wstring(kHostName)+L" 尚未完成加载。"; return false; }
    Variant documentOwner;
    VARIANT& document=documentOwner.value;
    if (FAILED(GetProperty(application, kActiveDocument, &document)) || document.vt != VT_DISPATCH || !document.pdispVal) {
        error = L"请先打开一份文档。";
        return false;
    }
    IDispatch* doc = document.pdispVal;
#ifdef WORKPROOF_POWERPOINT
    Variant path;
    if(FAILED(GetProperty(doc,L"Path",path.get()))||path.value.vt!=VT_BSTR){error=L"无法读取保存位置，请在 PowerPoint 中手动保存后重试。";return false;}
    if(!path.value.bstrVal||!path.value.bstrVal[0]){
        // Let Office own the save UI and overwrite confirmation. Never invent
        // a filename or silently save a new presentation to a default location.
        LPOLESTR name=const_cast<LPOLESTR>(L"FileDialog");DISPID dialogId=0;
        HRESULT hr=application->GetIDsOfNames(IID_NULL,&name,1,LOCALE_USER_DEFAULT,&dialogId);
        Variant dialog;VARIANT type={};type.vt=VT_I4;type.lVal=2; // msoFileDialogSaveAs
        DISPPARAMS parameters={&type,nullptr,1,0};
        if(SUCCEEDED(hr))hr=application->Invoke(dialogId,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_PROPERTYGET,&parameters,dialog.get(),nullptr,nullptr);
        if(FAILED(hr)||dialog.value.vt!=VT_DISPATCH||!dialog.value.pdispVal){error=L"无法打开另存为窗口，请在 PowerPoint 中手动保存后重试。";return false;}
        auto invoke=[&](const wchar_t* key,VARIANT* result){
            LPOLESTR member=const_cast<LPOLESTR>(key);DISPID id=0;
            HRESULT found=dialog.value.pdispVal->GetIDsOfNames(IID_NULL,&member,1,LOCALE_USER_DEFAULT,&id);
            if(FAILED(found))return found;
            DISPPARAMS none={};return dialog.value.pdispVal->Invoke(id,IID_NULL,LOCALE_USER_DEFAULT,DISPATCH_METHOD,&none,result,nullptr,nullptr);
        };
        Variant choice;hr=invoke(L"Show",choice.get());
        if(FAILED(hr)){error=L"另存为窗口未能完成，请手动保存后重试。";return false;}
        if((choice.value.vt!=VT_I4&&choice.value.vt!=VT_I2)||
           (choice.value.vt==VT_I4?choice.value.lVal:choice.value.iVal)!=-1){error=L"已取消保存，尚未开始记录。";return false;}
        hr=invoke(L"Execute",nullptr);
        Variant savedPath;
        if(FAILED(hr)||FAILED(GetProperty(doc,L"Path",savedPath.get()))||savedPath.value.vt!=VT_BSTR||!savedPath.value.bstrVal||!savedPath.value.bstrVal[0]){
            error=L"演示文稿尚未保存到文件，请手动保存后重试。";return false;
        }
        return true;
    }
#endif
    DISPID id = 0;
    OLECHAR* name = const_cast<OLECHAR*>(L"Save");
    HRESULT hr = doc->GetIDsOfNames(IID_NULL, &name, 1, LOCALE_USER_DEFAULT, &id);
    if (SUCCEEDED(hr)) {
        DISPPARAMS params = { nullptr, nullptr, 0, 0 };
        hr = doc->Invoke(id, IID_NULL, LOCALE_USER_DEFAULT, DISPATCH_METHOD, &params, nullptr, nullptr, nullptr);
    }
    VariantClear(&document);
    if (FAILED(hr)) { error = L"保存文档失败，请手动保存后再导出。"; return false; }
    return true;
}

bool Fingerprint(const std::wstring& path, std::string& hash, long long& bytes) {
    std::string output;
    std::wstring error;
    if (!RunEngine(L"fingerprint \"" + path + L"\"", output, error)) return false;
    hash = JsonField(output, "hash");
    std::string size = JsonField(output, "bytes");
    bytes = size.empty() ? 0 : _strtoi64(size.c_str(), nullptr, 10);
    return !hash.empty();
}

} // namespace workproof
