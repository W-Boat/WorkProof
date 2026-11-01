#include "engine.h"
#include "addin.h"
#include "controlled_process.h"
#include <winhttp.h>
#include <cstdlib>
#include <vector>

#pragma comment(lib, "winhttp.lib")

namespace workproof {

namespace {

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
    if (!application) { error = L"Word 还没有完成加载。请保存文档后重新打开 Word 再试。"; return false; }
    Variant documentOwner;
    VARIANT& document=documentOwner.value;
    if (FAILED(GetProperty(application, L"ActiveDocument", &document)) || document.vt != VT_DISPATCH || !document.pdispVal) {
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

    VariantInit(&readOnlyValue);
    VariantInit(&savedValue);
    snapshot.readOnly = SUCCEEDED(GetProperty(doc, L"ReadOnly", &readOnlyValue)) &&
                        (readOnlyValue.vt == VT_BOOL) && readOnlyValue.boolVal == VARIANT_TRUE;
    snapshot.saved = !(SUCCEEDED(GetProperty(doc, L"Saved", &savedValue)) &&
                       (savedValue.vt == VT_BOOL) && savedValue.boolVal == VARIANT_FALSE);
    VariantClear(&readOnlyValue);
    VariantClear(&savedValue);

    if (snapshot.characters > 8000000) { error = L"文档超过 800 万字符，超出本版记录范围。请拆分文档后重试。"; return false; }
    return true;

}

bool SaveDocument(IDispatch* application, std::wstring& error) {
    if (!application) { error = L"Word 还没有完成加载。"; return false; }
    Variant documentOwner;
    VARIANT& document=documentOwner.value;
    if (FAILED(GetProperty(application, L"ActiveDocument", &document)) || document.vt != VT_DISPATCH || !document.pdispVal) {
        error = L"请先打开一份文档。";
        return false;
    }
    IDispatch* doc = document.pdispVal;
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
