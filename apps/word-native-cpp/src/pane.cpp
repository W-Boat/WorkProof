#include "pane.h"
#include "engine.h"
#include "addin.h"
#include "action_metrics.h"
#include <shlobj.h>
#include <shellapi.h>
#include <string>
#include <chrono>
#include <thread>
#include <atomic>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "comctl32.lib")

namespace workproof {
namespace {
#ifdef WORKPROOF_POWERPOINT
const char* kSource="powerpoint";
const wchar_t* kTaskPaneProgId=L"WorkProof.PowerPointNative.TaskPane";
#else
const char* kSource="word";
const wchar_t* kTaskPaneProgId=L"WorkProof.WordNative.TaskPane";
#endif

const wchar_t kClassName[] = L"WorkProofWordPane";
const UINT kSampleTimer = 1;
const UINT WM_APP_PAIRED = WM_APP + 1;
const UINT WM_APP_LAUNCH = WM_APP + 2;
const int kSampleIntervalMs = 1500;
const int kMaxCharacters = 8000000;

struct PairResult {
    std::wstring token;
    std::wstring error;
};

struct State {
    HHOOK editorHook = nullptr;
    ActionMetrics actions;
    HWND editorWindow=nullptr;
    std::wstring layoutSignature,formatSignature;
    long selectionStart=-1,selectionEnd=-1;
    HWND window = nullptr;
    IDispatch* word = nullptr;
    IDispatch* factory = nullptr;
    IDispatch* taskPane = nullptr;
    bool launchFeedback = false;
    int scroll=0;
    HWND heading=nullptr, intro=nullptr, privacy=nullptr;
    HWND status = nullptr;
    HWND counter = nullptr;
    HWND startButton = nullptr;
    HWND pauseButton = nullptr;
    HWND exportButton = nullptr;
    HWND cancelButton = nullptr;
    HWND newButton = nullptr;
    HWND verifierLink = nullptr;
    HFONT titleFont = nullptr;
    HFONT bodyFont = nullptr;
    HFONT statusFont = nullptr;
    HBRUSH background = nullptr;
    HBRUSH cardBrush = nullptr;
    std::wstring token;
    std::wstring session;
    std::string pendingEvent;
    std::wstring identity;
    std::wstring documentName;
    long long sequence = 0;
    long long lastSampleMs = 0;
    long long lastCharacters = -1;
    long lastParagraphs = -1;
    long lastSlides=-1;long long lastShapes=-1;
    bool paused = true;
    bool pairing = false;
    bool writing = false;
    std::atomic_bool cancelPairing{false};
    std::atomic_ullong pairingGeneration{0};
    std::chrono::steady_clock::time_point started;
} g;

LRESULT CALLBACK EditorMessage(int code,WPARAM removed,LPARAM data){
    if(code>=0&&removed==PM_REMOVE&&!g.paused&&!g.session.empty()&&!g.writing){
        const MSG* message=reinterpret_cast<const MSG*>(data);
        if(message->message==WM_KEYDOWN&&message->hwnd){
            wchar_t editorClass[128]{};
            GetClassNameW(message->hwnd,editorClass,128);
            // Restrict collection to host editing surfaces on this Office thread.
            // Dialogs, our taskpane and other applications are never observed.
            if(g.editorWindow&&(message->hwnd==g.editorWindow||IsChild(g.editorWindow,message->hwnd))&&
               (!_wcsicmp(editorClass,L"_WwG")||!_wcsicmp(editorClass,L"paneClassDC"))){
                unsigned repeat=LOWORD(message->lParam);if(!repeat)repeat=1;
                g.actions.Key(static_cast<unsigned>(message->wParam),(GetKeyState(VK_CONTROL)&0x8000)!=0,
                    (GetKeyState(VK_SHIFT)&0x8000)!=0,(GetKeyState(VK_MENU)&0x8000)!=0,repeat);
            }
        }
    }
    return CallNextHookEx(g.editorHook,code,removed,data);
}

std::wstring Utf8ToWide(const std::string& text) {
    if (text.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0);
    std::wstring output((size_t)size, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.c_str(), (int)text.size(), &output[0], size);
    return output;
}

std::string WideToUtf8(const std::wstring& text) {
    if (text.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), nullptr, 0, nullptr, nullptr);
    std::string output((size_t)size, '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.c_str(), (int)text.size(), &output[0], size, nullptr, nullptr);
    return output;
}

std::string JsonEscape(const std::string& value) {
    std::string output;
    output.reserve(value.size() + 8);
    for (char character : value) {
        switch (character) {
            case '"': output += "\\\""; break;
            case '\\': output += "\\\\"; break;
            case '\n': output += "\\n"; break;
            case '\r': output += "\\r"; break;
            case '\t': output += "\\t"; break;
            default:
                if ((unsigned char)character < 0x20) { output += ' '; } else { output += character; }
        }
    }
    return output;
}

std::wstring IsoUtcNow() {
    SYSTEMTIME now;
    GetSystemTime(&now);
    wchar_t buffer[64];
    swprintf_s(buffer, L"%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
               now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond, now.wMilliseconds);
    return buffer;
}

long long ElapsedMs() {
    std::chrono::steady_clock::duration span = std::chrono::steady_clock::now() - g.started;
    return (long long)std::chrono::duration_cast<std::chrono::milliseconds>(span).count();
}

std::wstring DescribeEngineError(const std::string& code) {
    if (code == "PAIRING_REQUIRED") return L"连接已被撤销或过期。请重新点击开始并在桌面端允许。";
    if (code == "PAIRING_EXPIRED") return L"连接请求已失效。请重新点击开始，并在桌面窗口允许连接。";
    if (code == "PAIRING_LIMIT") return L"待确认的连接太多。请先在桌面窗口处理已有请求，再重试。";
    if (code == "PAIRING_CHANNEL_MISMATCH") return L"连接来源不一致。请关闭面板后重新打开。";
    if (code == "SAVE_CHECKPOINT_REQUIRED") return L"本次保存尚未记录完成，请再次导出。";
    if (code == "SEQUENCE_CONFLICT") return L"记录未能按原顺序保存。请暂停并开始一份新记录。";
    if (code == "ADAPTER_SESSION_DENIED") return L"这份记录不属于当前连接。请重新开始一份新记录。";
    if (code == "UNSUPPORTED_NATIVE_ADAPTER") return L"桌面端版本过旧，不支持 Word 原生连接。请更新 WorkProof 后再试。";
    if (code == "INVALID_ARTIFACT_HASH") return L"作品摘要格式不正确，请重新导出。";
    return L"记录服务没有完成本次操作。请确认桌面端 WorkProof 仍在运行后重试。";
}

void LayoutControls();

void SetStatus(const std::wstring& text) {
    if (g.status) {
        SetWindowTextW(g.status, text.c_str());
        LayoutControls();
    }
}

void PaintState() {
    if (!g.window) return;
    EnableWindow(g.startButton, !g.pairing && !g.writing && g.session.empty());
    EnableWindow(g.pauseButton, !g.pairing && !g.writing && !g.session.empty());
    SetWindowTextW(g.pauseButton, g.paused ? L"继续记录" : L"暂停记录");
    EnableWindow(g.exportButton, !g.pairing && !g.writing && !g.session.empty());
    EnableWindow(g.newButton, !g.session.empty() && g.paused && !g.pairing && !g.writing);
    EnableWindow(g.cancelButton, g.pairing);
    ShowWindow(g.cancelButton, g.pairing ? SW_SHOW : SW_HIDE);
    wchar_t text[192];
    if (g.session.empty()) {
        swprintf_s(text, L"尚未开始");
    } else {
        swprintf_s(text, L"已保存 %lld 条记录", g.sequence);
    }
    SetWindowTextW(g.counter, text);
    LayoutControls();
}

std::string EventJson(const char* kind, const DocSnapshot& snapshot, long long inserted, long long deleted,
                      const std::string& checkpoint,const std::string& actions=std::string()) {
    wchar_t buffer[512];
#ifdef WORKPROOF_POWERPOINT
    swprintf_s(buffer,L"{\"seq\":%lld,\"elapsed_ms\":%lld,\"kind\":\"%S\",\"inserted\":0,\"deleted\":0,\"chars\":0,\"checkpoint\":\"%S\",\"metrics\":{\"slides\":%ld,\"shapes\":%lld}}",g.sequence,ElapsedMs(),kind,checkpoint.c_str(),snapshot.slides,snapshot.shapes);
#else
    swprintf_s(buffer, L"{\"seq\":%lld,\"elapsed_ms\":%lld,\"kind\":\"%S\",\"inserted\":%lld,\"deleted\":%lld,"
                       L"\"chars\":%lld,\"checkpoint\":\"%S\",\"metrics\":{\"characters\":%lld,\"paragraphs\":%ld}}",
               g.sequence, ElapsedMs(), kind, inserted, deleted, snapshot.characters, checkpoint.c_str(),
               snapshot.characters, snapshot.paragraphs);
#endif
    // The buffer above is assembled with wide characters only so numbers stay locale independent.
    std::wstring wide(buffer);
    std::string json=WideToUtf8(wide);
    if(!actions.empty())json.insert(json.size()-2,","+actions);
    return json;
}

bool Call(const std::wstring& method, const std::wstring& path, const std::string& body, bool authorized,
          std::string& response, std::wstring& error) {
    long status = 0;
    if (!HttpJson(method, path, body, authorized ? g.token : std::wstring(), response, status)) {
        error = L"连不上桌面端 WorkProof（127.0.0.1:43127）。请先打开 WorkProof 桌面程序再试。";
        return false;
    }
    if (status != 200) {
        error = DescribeEngineError(JsonField(response, "error"));
        if (status == 401 || status == 403) {
            g.paused = true;
            g.token.clear();
            KillTimer(g.window, kSampleTimer);
        }
        return false;
    }
    return true;
}

bool FlushPending(std::wstring& error){
    if(g.pendingEvent.empty())return true;
    std::string response;
    if(!Call(L"POST",L"/v1/sessions/"+g.session+L"/events",g.pendingEvent,true,response,error))return false;
    // Keep identical bytes until acknowledged: the collector accepts exact retries
    // even if the prior response was lost after committing the event.
    g.pendingEvent.clear();++g.sequence;PaintState();return true;
}
bool SendEvent(const char* kind, const DocSnapshot& snapshot, long long inserted, long long deleted,
               const std::string& checkpoint, std::wstring& error) {
    if(!FlushPending(error))return false;
    g.pendingEvent="{\"events\":["+EventJson(kind,snapshot,inserted,deleted,checkpoint)+"]}";
    return FlushPending(error);
}

bool FlushActions(const DocSnapshot& snapshot,std::wstring& error){
    if(!g.actions.Any())return true;
    if(!FlushPending(error))return false;
    g.pendingEvent="{\"events\":["+EventJson("interaction",snapshot,0,0,std::string(),g.actions.Json())+"]}";
    g.actions.Clear(); // Bytes remain in pendingEvent until acknowledged.
    return FlushPending(error);
}

void PairingThread(HWND target,unsigned long long generation) {
    struct WorkerLifetime {~WorkerLifetime(){InterlockedDecrement(&g_objectCount);}} lifetime;
    auto post=[&](PairResult* result,bool success){
        if(g.pairingGeneration.load()!=generation||!PostMessageW(target,WM_APP_PAIRED,success,(LPARAM)result))delete result;
    };
    std::string response;
    std::wstring error;
    long status = 0;
    if (!HttpJson(L"POST", L"/v1/native-pairing", std::string("{\"source\":\"")+kSource+"\"}", std::wstring(), response, status) || status != 200) {
        PairResult* failure = new PairResult();
        failure->error = L"桌面端拒绝了连接请求。请确认 WorkProof 正在运行并更新到最新版本。";
        post(failure,false);
        return;
    }
    std::wstring ticket = Utf8ToWide(JsonField(response, "ticket"));
    if (ticket.empty()) {
        PairResult* failure = new PairResult();
        failure->error = L"桌面端没有返回连接编号，请稍后重试。";
        post(failure,false);
        return;
    }
    for (int attempt = 0; attempt < 120; ++attempt) {
        if (g.cancelPairing || g.pairingGeneration.load()!=generation) {
            PairResult* cancelled = new PairResult();
            cancelled->error = L"已取消连接。桌面端未批准的请求会自动过期。";
            post(cancelled,false);
            return;
        }
        Sleep(1000);
        std::string poll;
        long pollStatus = 0;
        if (!HttpJson(L"GET", L"/v1/native-pairing/" + ticket, std::string(), std::wstring(), poll, pollStatus)) continue;
        if (pollStatus != 200) continue;
        if (JsonField(poll, "approved") == "true") {
            PairResult* success = new PairResult();
            success->token = Utf8ToWide(JsonField(poll, "token"));
            post(success,true);
            return;
        }
    }
    PairResult* timeout = new PairResult();
    timeout->error = L"连接请求已失效。请重新点击开始，并在桌面窗口允许连接。";
    post(timeout,false);
}

void ClosePane() {
    if (!g.window) return;
    KillTimer(g.window, kSampleTimer);
    DestroyWindow(g.window);
}

void BeginPairing() {
    DocSnapshot snapshot;
    std::wstring error;
    if (!ReadDocument(g.word, snapshot, error)) { SetStatus(error); return; }
    if (!g.session.empty()) return;
    g.pairing = true;
    g.cancelPairing = false;
    g.documentName = snapshot.name;
    g.identity = snapshot.identity;
    SetStatus(L"请在桌面端 WorkProof 核对当前软件来源，再点击允许连接。");
    PaintState();
    InterlockedIncrement(&g_objectCount);
    std::thread(PairingThread,g.window,++g.pairingGeneration).detach();
}

void ShowLaunchFeedback();

void FinishPairing(PairResult* result) {
    g.pairing = false;
    if (!result) { PaintState(); return; }
    if (result->token.empty()) {
        SetStatus(result->error.empty() ? L"连接未完成，请重试。" : result->error);
        delete result;
        PaintState();
        return;
    }
    g.token = result->token;
    delete result;

    DocSnapshot snapshot;
    std::wstring error;
    if (!ReadDocument(g.word, snapshot, error)) { SetStatus(error); PaintState(); return; }
    if(snapshot.identity!=g.identity){
        SetStatus(L"等待连接期间切换了文档，尚未开始记录。请切回原文档后重新开始。");
        g.launchFeedback=false;PaintState();return;
    }
    std::string body = "{\"file_name\":\"" + JsonEscape(WideToUtf8(snapshot.name)) +
                       "\",\"started_at\":\"" + JsonEscape(WideToUtf8(IsoUtcNow())) + "\",\"source\":\""+kSource+"\"}";
    std::string response;
    if (!Call(L"POST", L"/v1/sessions", body, true, response, error)) { SetStatus(error); PaintState(); return; }
    g.session = Utf8ToWide(JsonField(response, "session_id"));
    if (g.session.empty()) { SetStatus(L"桌面端没有返回记录编号，本次开始未完成。"); PaintState(); return; }
    g.identity = snapshot.identity;
    g.documentName = snapshot.name;
    g.lastCharacters = snapshot.characters;
    g.actions.Clear();g.editorWindow=snapshot.editorWindow;
    g.layoutSignature=snapshot.layoutSignature;g.formatSignature=snapshot.formatSignature;
    g.selectionStart=snapshot.selectionStart;g.selectionEnd=snapshot.selectionEnd;
    g.lastParagraphs = snapshot.paragraphs;
    g.lastSlides=snapshot.slides;g.lastShapes=snapshot.shapes;
    g.sequence = 0;
    g.started = std::chrono::steady_clock::now();
    g.lastSampleMs = 0;
    if (!SendEvent("start", snapshot, 0, 0, std::string(), error)) { SetStatus(error); PaintState(); return; }
    g.paused = false;
    SetTimer(g.window, kSampleTimer, kSampleIntervalMs, nullptr);
    SetStatus(L"记录中。只发送数量与摘要，不发送正文。");
    PaintState();
    if(g.launchFeedback){g.launchFeedback=false;ShowLaunchFeedback();}
}

void Sample() {
    if (g.paused || g.session.empty() || g.writing) return;
    DocSnapshot snapshot;
    std::wstring error;
    if (!ReadDocument(g.word, snapshot, error)) {
        g.paused = true;
        KillTimer(g.window, kSampleTimer);
        SetStatus(error);
        PaintState();
        return;
    }
    if (snapshot.identity != g.identity) {
        g.actions.Clear(); // Do not attribute commands in another document.
        g.paused = true;
        KillTimer(g.window, kSampleTimer);
        SetStatus(L"你把编辑对象切换到了另一份文档，记录已暂停。请切回原文档后点“继续记录”。");
        PaintState();
        return;
    }
    long long now = ElapsedMs();
    if (g.lastSampleMs != 0 && now - g.lastSampleMs > 15000) {
        SendEvent("gap", snapshot, 0, 0, std::string(), error);
    }
    g.lastSampleMs = now;
    if(!FlushActions(snapshot,error)){
        g.paused=true;KillTimer(g.window,kSampleTimer);SetStatus(error);PaintState();return;
    }
    const bool layoutChanged=!g.layoutSignature.empty()&&!snapshot.layoutSignature.empty()&&g.layoutSignature!=snapshot.layoutSignature;
    const bool formatChanged=g.selectionStart>=0&&g.selectionStart==snapshot.selectionStart&&g.selectionEnd==snapshot.selectionEnd&&
        !g.formatSignature.empty()&&!snapshot.formatSignature.empty()&&g.formatSignature!=snapshot.formatSignature;
    if((layoutChanged||formatChanged)&&!SendEvent(layoutChanged?"layout":"format",snapshot,0,0,std::string(),error)){
        g.paused=true;KillTimer(g.window,kSampleTimer);SetStatus(error);PaintState();return;
    }
    g.layoutSignature=snapshot.layoutSignature;g.formatSignature=snapshot.formatSignature;
    g.selectionStart=snapshot.selectionStart;g.selectionEnd=snapshot.selectionEnd;
    g.editorWindow=snapshot.editorWindow;
    bool changed = snapshot.characters != g.lastCharacters || snapshot.paragraphs != g.lastParagraphs || snapshot.slides!=g.lastSlides || snapshot.shapes!=g.lastShapes;
    if (changed && g.lastCharacters >= 0) {
        long long inserted = snapshot.characters > g.lastCharacters ? snapshot.characters - g.lastCharacters : 0;
        long long deleted = g.lastCharacters > snapshot.characters ? g.lastCharacters - snapshot.characters : 0;
        if (!SendEvent("edit", snapshot, inserted, deleted, std::string(), error)) {
            g.paused = true;
            KillTimer(g.window, kSampleTimer);
            SetStatus(error);
        }
    }
    g.lastCharacters = snapshot.characters;
    g.lastParagraphs = snapshot.paragraphs;
    g.lastSlides=snapshot.slides;g.lastShapes=snapshot.shapes;
    PaintState();
}

void TogglePause() {
    std::wstring error;
    if (g.session.empty()) return;
    if (!g.paused) {
        g.paused = true;
        KillTimer(g.window, kSampleTimer);
        SetStatus(L"已暂停本机采样，正在保存已有操作。");
        PaintState();
        DocSnapshot snapshot;
        if (!ReadDocument(g.word, snapshot, error)) { SetStatus(error);PaintState();return; }
        if(snapshot.identity!=g.identity){
            SetStatus(L"已暂停。当前是另一份文档，没有把它的内容计入记录。请切回原文档后继续。");
            PaintState();return;
        }
        if(!FlushActions(snapshot,error)||!SendEvent("pause",snapshot,0,0,std::string(),error)){SetStatus(error);PaintState();return;}
        SetStatus(L"已暂停。继续记录时会标明未记录的时间。");
        PaintState();
        return;
    }
    DocSnapshot snapshot;
    if (!ReadDocument(g.word, snapshot, error)) { SetStatus(error); return; }
    if (snapshot.identity != g.identity) { SetStatus(L"当前文档不是开始记录的那一份。请切回原文档后再继续。"); return; }
    if (!SendEvent("gap", snapshot, 0, 0, std::string(), error)) { SetStatus(error); return; }
    if (!SendEvent("resume", snapshot, 0, 0, std::string(), error)) { SetStatus(error); return; }
    g.lastCharacters = snapshot.characters;
    g.lastParagraphs = snapshot.paragraphs;
    g.lastSlides=snapshot.slides;g.lastShapes=snapshot.shapes;
    g.paused = false;
    g.actions.Clear();g.editorWindow=snapshot.editorWindow;
    g.layoutSignature=snapshot.layoutSignature;g.formatSignature=snapshot.formatSignature;
    g.selectionStart=snapshot.selectionStart;g.selectionEnd=snapshot.selectionEnd;
    g.lastSampleMs = ElapsedMs();
    SetTimer(g.window, kSampleTimer, kSampleIntervalMs, nullptr);
    SetStatus(L"继续记录中。");
    PaintState();
}

// Called only after explicit user confirmation. A failed acknowledgement must
// retain the previous session and its exact pending bytes so it remains retryable.
bool ResetPausedRecording(){
    if(g.session.empty()||!g.paused||g.pairing||g.writing)return false;
    std::wstring error;
    if(!FlushPending(error)){SetStatus(L"旧记录还有操作未保存，暂时不能开始另一份。"+error);PaintState();return false;}
    KillTimer(g.window,kSampleTimer);
    g.token.clear();g.session.clear();g.pendingEvent.clear();g.identity.clear();g.documentName.clear();
    g.actions.Clear();g.editorWindow=nullptr;g.layoutSignature.clear();g.formatSignature.clear();
    g.sequence=0;g.lastSampleMs=0;g.lastCharacters=-1;g.lastParagraphs=-1;g.lastSlides=-1;g.lastShapes=-1;
    g.started={};g.launchFeedback=false;g.cancelPairing=false;++g.pairingGeneration;
    SetStatus(L"已结束本地记录。旧记录仍保留在 WorkProof 中。");PaintState();return true;
}
void NewRecording(){
    if(g.session.empty()||!g.paused||g.pairing||g.writing)return;
    if(MessageBoxW(g.window,L"开始另一份记录后，旧记录仍保留在 WorkProof 中，但此侧栏会切换到新记录。\n\n如果还没导出旧作品和证书，请先取消，导出旧作品和证书。\n\n现在开始记录当前文档吗？",L"开始另一份记录",MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2)!=IDYES)return;
    if(ResetPausedRecording())BeginPairing();
}

std::wstring ChooseFolder(HWND owner) {
    IFileOpenDialog* dialog=nullptr;
    if(FAILED(CoCreateInstance(CLSID_FileOpenDialog,nullptr,CLSCTX_INPROC_SERVER,IID_PPV_ARGS(&dialog)))) return {};
    FILEOPENDIALOGOPTIONS options=0;HRESULT hr=dialog->GetOptions(&options);
    if(SUCCEEDED(hr))hr=dialog->SetOptions(options|FOS_PICKFOLDERS|FOS_FORCEFILESYSTEM|FOS_PATHMUSTEXIST|FOS_NOCHANGEDIR);
    if(SUCCEEDED(hr))hr=dialog->SetTitle(L"选择交付目录（不会覆盖原作品）");
    if(SUCCEEDED(hr))hr=dialog->Show(owner);
    IShellItem* item=nullptr;PWSTR path=nullptr;std::wstring selected;
    if(SUCCEEDED(hr))hr=dialog->GetResult(&item);
    if(SUCCEEDED(hr))hr=item->GetDisplayName(SIGDN_FILESYSPATH,&path);
    if(SUCCEEDED(hr)&&path)selected=path;
    if(path)CoTaskMemFree(path);if(item)item->Release();dialog->Release();
    return selected;
}

bool WriteAll(const std::wstring& path, const std::string& body) {
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return false;
    DWORD written = 0;
    bool ok = WriteFile(file, body.data(), (DWORD)body.size(), &written, nullptr) != FALSE && written == body.size();
    CloseHandle(file);
    return ok;
}

void Export() {
    if (g.session.empty() || g.pairing || g.writing) return;
    g.writing = true;
    PaintState();
    std::wstring error;
    DocSnapshot before;
    if (!ReadDocument(g.word, before, error)) { SetStatus(error); g.writing = false; PaintState(); return; }
    if(before.identity!=g.identity){
        g.paused=true;KillTimer(g.window,kSampleTimer);
        SetStatus(L"当前不是开始记录的文档，已暂停。请切回原文档，继续记录后再导出。");
        g.writing=false;PaintState();return;
    }

    std::wstring parent = ChooseFolder(g.window);
    if (parent.empty()) { SetStatus(g.paused ? L"已取消导出。记录保持暂停。" : L"已取消导出。记录仍在继续。"); g.writing = false; PaintState(); return; }

    SYSTEMTIME now;
    GetLocalTime(&now);
    wchar_t suffix[64];
    swprintf_s(suffix, L"WorkProof-%04d%02d%02d-%02d%02d%02d", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);
    std::wstring folder = parent + L"\\" + suffix;
    if(!CreateDirectoryW(folder.c_str(), nullptr)){SetStatus(L"交付目录未能新建，请稍后重试或选择其他目录；没有覆盖文件。");g.writing=false;PaintState();return;}

    DocSnapshot selected;
    if(!ReadDocument(g.word,selected,error)||selected.identity!=g.identity){
        SetStatus(L"选择目录期间切换了文档，已停止导出。请切回开始记录的文档后重试。");
        g.writing=false;PaintState();return;
    }
    if (!SaveDocument(g.word, error)) { SetStatus(error); g.writing = false; PaintState(); return; }
    DocSnapshot saved;
    if (!ReadDocument(g.word, saved, error)) { SetStatus(error); g.writing = false; PaintState(); return; }
    if (saved.identity != before.identity || saved.characters != before.characters || saved.paragraphs != before.paragraphs || saved.slides!=before.slides || saved.shapes!=before.shapes) {
        SetStatus(L"保存后内容仍在变化，已停止导出。请再次保存并重试。");
        g.writing = false;
        PaintState();
        return;
    }

    std::wstring artifact = folder + L"\\" + g.documentName;
    if (!CopyFileW(saved.identity.c_str(), artifact.c_str(), TRUE)) {
        SetStatus(L"无法复制作品，请换一个交付目录后重试。");
        g.writing = false;
        PaintState();
        return;
    }

    std::string hash;
    long long bytes = 0;
    if (!Fingerprint(artifact, hash, bytes)) {
        SetStatus(L"记录引擎没有返回文件摘要，本次导出已中止。");
        g.writing = false;
        PaintState();
        return;
    }
    DocSnapshot check;
    if (!ReadDocument(g.word, check, error) || check.identity != g.identity || check.characters != saved.characters || check.paragraphs != saved.paragraphs || check.slides!=saved.slides || check.shapes!=saved.shapes) {
        SetStatus(L"生成摘要期间文档发生变化，已停止导出。请重新导出。");
        g.writing = false;
        PaintState();
        return;
    }
    if (!FlushActions(check,error)||!SendEvent("save", check, 0, 0, hash, error)) { SetStatus(error); g.writing = false; PaintState(); return; }

    std::string body = "{\"artifact_hash\":\"" + hash + "\",\"artifact_bytes\":" + std::to_string(bytes) + "}";
    std::string response;
    if (!Call(L"POST", L"/v1/sessions/" + g.session + L"/export", body, true, response, error)) {
        SetStatus(error);
        g.writing = false;
        PaintState();
        return;
    }
    if (JsonField(response, "artifact_hash") != hash || JsonField(response, "session_id") != WideToUtf8(g.session)) {
        SetStatus(L"证书绑定的文件摘要与作品不一致，本次导出已中止。");
        g.writing = false;
        PaintState();
        return;
    }
    std::wstring certificate = artifact + L".wproof";
    if (!WriteAll(certificate, response)) {
        SetStatus(L"无法写入证书文件，请检查目录权限。");
        g.writing = false;
        PaintState();
        return;
    }

    std::string verify;
    std::wstring verifyError;
    bool verified = RunEngine(L"verify \"" + artifact + L"\" \"" + certificate + L"\"", verify, verifyError);
    SetStatus(verified ? L"已导出，本地独立核验通过。" : L"已导出，但本地独立核验未通过，请重新导出。");

    // A modal success dialog used to keep g.writing true and suppress every
    // sampling timer until the user dismissed it. Report delivery inline instead.
    SetStatus(verified ? L"导出并核验通过。请一起交付作品和同名证书；记录仍在继续。\n保存位置："+folder
                       : L"已导出，但核验未通过。请不要交付这份证书，重新导出后再检查。");
    g.writing = false;
    PaintState();
}

HRESULT Dispatch(IDispatch* object,const wchar_t* name,WORD flags,VARIANT* args,UINT count,VARIANT* result=nullptr){
    if(!object)return E_POINTER;
    LPOLESTR key=const_cast<LPOLESTR>(name);DISPID id;HRESULT hr=object->GetIDsOfNames(IID_NULL,&key,1,LOCALE_USER_DEFAULT,&id);
    if(FAILED(hr))return hr;
    DISPID put=DISPID_PROPERTYPUT;DISPPARAMS parameters={args,(flags&DISPATCH_PROPERTYPUT)?&put:nullptr,count,(flags&DISPATCH_PROPERTYPUT)?1u:0u};
    if(result)VariantInit(result);
    EXCEPINFO exception={};
    HRESULT invoked=object->Invoke(id,IID_NULL,LOCALE_USER_DEFAULT,flags,&parameters,result,&exception,nullptr);
    if(FAILED(invoked)&&wcscmp(name,L"CreateCTP")==0){
        if(exception.pfnDeferredFillIn)exception.pfnDeferredFillIn(&exception);
        TraceHresult(L"CreateCTP Office exception",exception.scode);
        if(exception.bstrDescription)Trace(exception.bstrDescription);
    }
    if(exception.bstrSource)SysFreeString(exception.bstrSource);
    if(exception.bstrDescription)SysFreeString(exception.bstrDescription);
    if(exception.bstrHelpFile)SysFreeString(exception.bstrHelpFile);
    return invoked;
}
void LayoutControls(){
    if(!g.window)return;
    RECT client;GetClientRect(g.window,&client);
    const int dpi=(int)GetDpiForWindow(g.window);
    auto scale=[&](int value){return MulDiv(value,dpi?dpi:96,96);};
    const int margin=scale(16);
    const int width=client.right>margin*2?client.right-margin*2:8;
    HDC dc=GetDC(g.window);
    auto textHeight=[&](HWND control,HFONT font,int minimum){
        const int length=GetWindowTextLengthW(control);
        std::vector<wchar_t> text((size_t)length+1);
        GetWindowTextW(control,text.data(),length+1);
        HGDIOBJ old=SelectObject(dc,font);
        RECT measured={0,0,width,0};
        DrawTextW(dc,text.data(),length,&measured,DT_CALCRECT|DT_WORDBREAK|DT_NOPREFIX);
        SelectObject(dc,old);
        return measured.bottom>scale(minimum)?measured.bottom:scale(minimum);
    };
    const int introHeight=textHeight(g.intro,g.bodyFont,42);
    const int statusHeight=textHeight(g.status,g.statusFont,42);
    const int privacyHeight=textHeight(g.privacy,g.bodyFont,72);
    ReleaseDC(g.window,dc);
    struct Placement {HWND window;int top;int height;};
    std::vector<Placement> controls;
    int y=scale(18);
    auto add=[&](HWND control,int height,int gap){controls.push_back({control,y,height});y+=height+scale(gap);};
    add(g.heading,scale(30),8);
    add(g.intro,introHeight,18);
    add(g.status,statusHeight,8);
    add(g.counter,scale(24),16);
    add(g.startButton,scale(36),8);
    add(g.pauseButton,scale(36),8);
    add(g.exportButton,scale(36),8);
    if(g.pairing)add(g.cancelButton,scale(32),8);
    add(g.newButton,scale(32),8);
    add(g.verifierLink,scale(32),18);
    add(g.privacy,privacyHeight,18);
    SCROLLINFO info={sizeof(info),SIF_RANGE|SIF_PAGE|SIF_POS};
    info.nMin=0;info.nMax=y-1;info.nPage=(UINT)client.bottom;
    const int limit=y>client.bottom?y-client.bottom:0;
    if(g.scroll>limit)g.scroll=limit;
    info.nPos=g.scroll;SetScrollInfo(g.window,SB_VERT,&info,TRUE);
    // Move all children before repainting so scrolling cannot leave stale labels.
    for(const auto& control:controls)
        MoveWindow(control.window,margin,control.top-g.scroll,width,control.height,FALSE);
    RedrawWindow(g.window,nullptr,nullptr,RDW_INVALIDATE|RDW_ERASE|RDW_ALLCHILDREN);
}
void CreateControls(HWND window) {
    g.background=CreateSolidBrush(GetSysColor(COLOR_WINDOW));g.cardBrush=CreateSolidBrush(GetSysColor(COLOR_WINDOW));
    int dpi=(int)GetDpiForWindow(window);
    auto font=[&](int size,int weight){return CreateFontW(MulDiv(size,dpi?dpi:96,96),0,0,0,weight,FALSE,FALSE,FALSE,DEFAULT_CHARSET,OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Microsoft YaHei UI");};
    g.titleFont=font(-20,FW_SEMIBOLD);g.statusFont=font(-15,FW_SEMIBOLD);g.bodyFont=font(-14,FW_NORMAL);
    auto create=[&](const wchar_t* type,const wchar_t* text,DWORD style){
        HWND h=CreateWindowExW(0,type,text,WS_CHILD|WS_VISIBLE|style,0,0,10,10,window,nullptr,g_module,nullptr);
        SendMessageW(h,WM_SETFONT,(WPARAM)g.bodyFont,TRUE);return h;
    };
    g.heading=create(L"STATIC",L"创作记录",SS_LEFT);SendMessageW(g.heading,WM_SETFONT,(WPARAM)g.titleFont,TRUE);
    g.intro=create(L"STATIC",L"保存文档 → 开始记录 → 导出作品与证书",SS_LEFT);
    g.status=create(L"STATIC",L"请先保存文档，再点击开始记录。",SS_LEFT);SendMessageW(g.status,WM_SETFONT,(WPARAM)g.statusFont,TRUE);
    g.counter=create(L"STATIC",L"尚未开始",SS_LEFT);
    g.startButton=create(L"BUTTON",L"开始记录",BS_PUSHBUTTON|WS_TABSTOP);
    g.pauseButton=create(L"BUTTON",L"暂停记录",BS_PUSHBUTTON|WS_TABSTOP);
    g.exportButton=create(L"BUTTON",L"导出作品和证书",BS_PUSHBUTTON|WS_TABSTOP);
    g.newButton=create(L"BUTTON",L"开始另一份记录",BS_PUSHBUTTON|WS_TABSTOP);
    g.cancelButton=create(L"BUTTON",L"取消连接",BS_PUSHBUTTON|WS_TABSTOP);
    g.verifierLink=create(L"BUTTON",L"核验已有证书",BS_PUSHBUTTON|WS_TABSTOP);
#ifdef WORKPROOF_POWERPOINT
    g.privacy=create(L"STATIC",L"只记录幻灯片数、对象数、时间与保存摘要，不发送文字或图片。\n\n数量不变的文字、图片和样式修改可能无法识别。记录不能单独证明作者身份或原创性。",SS_LEFT);
#else
    g.privacy=create(L"STATIC",L"不采集正文。只记录编辑数量、段落数、时间与文件摘要。\n\n记录可能遗漏修改，不能单独证明作者身份或原创性。关闭侧栏后仍可通过 WorkProof 菜单暂停记录。",SS_LEFT);
#endif
    LayoutControls();
}
LRESULT CALLBACK FeedbackProc(HWND window,UINT message,WPARAM w,LPARAM l){
    if(message==WM_CREATE){SetTimer(window,1,1600,nullptr);return 0;}
    if(message==WM_TIMER||message==WM_LBUTTONDOWN||message==WM_KEYDOWN){DestroyWindow(window);return 0;}
    if(message==WM_PAINT){
        PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);RECT r;GetClientRect(window,&r);
        HBRUSH brush=CreateSolidBrush(RGB(20,42,36));FillRect(dc,&r,brush);DeleteObject(brush);
        SetBkMode(dc,TRANSPARENT);SetTextColor(dc,RGB(245,250,247));
        HFONT font=CreateFontW(-38,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Microsoft YaHei UI");
        HGDIOBJ old=SelectObject(dc,font);r.top=(r.bottom-120)/2;
        DrawTextW(dc,L"WorkProof 已加载\n创作记录已开始",-1,&r,DT_CENTER|DT_TOP|DT_NOPREFIX);
        SelectObject(dc,old);DeleteObject(font);EndPaint(window,&paint);return 0;
    }
    return DefWindowProcW(window,message,w,l);
}
void ShowLaunchFeedback(){
    WNDCLASSEXW cls={sizeof(cls)};cls.lpfnWndProc=FeedbackProc;cls.hInstance=g_module;cls.lpszClassName=L"WorkProofWordFeedback";cls.hCursor=LoadCursorW(nullptr,IDC_ARROW);
    RegisterClassExW(&cls);
    HWND owner=GetAncestor(g.window,GA_ROOT);MONITORINFO info={sizeof(info)};GetMonitorInfoW(MonitorFromWindow(owner,MONITOR_DEFAULTTONEAREST),&info);RECT r=info.rcMonitor;
    HWND feedback=CreateWindowExW(WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|WS_EX_TOPMOST,cls.lpszClassName,L"WorkProof 已开始记录",WS_POPUP,r.left,r.top,r.right-r.left,r.bottom-r.top,owner,nullptr,g_module,nullptr);
    if(feedback){
        BOOL animate=FALSE;
        SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION,0,&animate,0);
        // A single short transition follows the Windows accessibility setting.
        if(!animate||!AnimateWindow(feedback,140,AW_BLEND))ShowWindow(feedback,SW_SHOWNOACTIVATE);
        Trace(L"Recording success overlay shown");
    }
}

LRESULT CALLBACK PaneProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g.window = window;
            CreateControls(window);
            PaintState();
            return 0;
        case WM_PAINT: {
            PAINTSTRUCT paint;HDC dc=BeginPaint(window,&paint);
            FillRect(dc,&paint.rcPaint,g.background?g.background:GetSysColorBrush(COLOR_WINDOW));
            EndPaint(window,&paint);return 0;
        }
        case WM_ERASEBKGND: {
            RECT area;
            GetClientRect(window, &area);
            FillRect((HDC)wParam, &area, g.background);
            return 1;
        }
        case WM_CTLCOLORSTATIC: {
            HDC device = (HDC)wParam;
            HWND source = (HWND)lParam;
            SetBkMode(device, OPAQUE);
            SetBkColor(device,GetSysColor(COLOR_WINDOW));
            SetTextColor(device, GetSysColor(COLOR_WINDOWTEXT));
            // The two labels sit on the white card; every other label uses the canvas colour.
            if (source == g.status || source == g.counter) return (LRESULT)g.cardBrush;
            return (LRESULT)g.background;
        }
        case WM_SIZE:
            LayoutControls();return 0;
        case WM_MOUSEWHEEL:
            g.scroll-=GET_WHEEL_DELTA_WPARAM(wParam)/WHEEL_DELTA*60;
            if(g.scroll<0)g.scroll=0;LayoutControls();return 0;
        case WM_VSCROLL: {
            SCROLLINFO info={sizeof(info),SIF_ALL};GetScrollInfo(window,SB_VERT,&info);
            switch(LOWORD(wParam)){
                case SB_LINEUP:g.scroll-=24;break;case SB_LINEDOWN:g.scroll+=24;break;
                case SB_PAGEUP:g.scroll-=(int)info.nPage;break;case SB_PAGEDOWN:g.scroll+=(int)info.nPage;break;
                case SB_THUMBTRACK:g.scroll=info.nTrackPos;break;
            }
            if(g.scroll<0)g.scroll=0;LayoutControls();return 0;
        }
        case WM_TIMER:
            if (wParam == kSampleTimer) Sample();
            return 0;
        case WM_COMMAND: {
            HWND source = (HWND)lParam;
            if (source == g.startButton) BeginPairing();
            else if (source == g.pauseButton) TogglePause();
            else if (source == g.exportButton) Export();
            else if (source == g.newButton) NewRecording();
            else if (source == g.cancelButton) { g.cancelPairing = true; SetStatus(L"正在取消连接…"); }
            else if (source == g.verifierLink) {
                ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:4173/", nullptr, nullptr, SW_SHOWNORMAL);
            }
            return 0;
        }
        case WM_APP_LAUNCH: {
            if(g.pairing||!g.session.empty())return 0;
            DocSnapshot snapshot;std::wstring error;
            if(!ReadDocument(g.word,snapshot,error)){
                SetStatus(L"请在当前软件中保存作品，保存后将自动连接记录。");
                if(!SaveDocument(g.word,error)){SetStatus(L"尚未开始记录。请保存文档后点击开始记录。");g.launchFeedback=false;return 0;}
            }
            BeginPairing();return 0;
        }
        case WM_APP_PAIRED:
            FinishPairing((PairResult*)lParam);
            return 0;
        case WM_CLOSE:
            ShowWindow(window, SW_HIDE);
            return 0;
        case WM_DESTROY:
            KillTimer(window,kSampleTimer);g.paused=true;g.cancelPairing=true;++g.pairingGeneration;g.pairing=false;
            MSG pending;while(PeekMessageW(&pending,window,WM_APP_PAIRED,WM_APP_PAIRED,PM_REMOVE))delete (PairResult*)pending.lParam;
            if (g.background) DeleteObject(g.background);
            if (g.cardBrush) DeleteObject(g.cardBrush);
            if (g.titleFont) DeleteObject(g.titleFont);
            if (g.statusFont) DeleteObject(g.statusFont);
            if (g.bodyFont) DeleteObject(g.bodyFont);
            g.background = nullptr;
            g.cardBrush = nullptr;
            g.titleFont = nullptr;
            g.statusFont = nullptr;
            g.bodyFont = nullptr;
            g.window = nullptr;
            g.status = g.counter = g.startButton = g.pauseButton = g.exportButton = g.cancelButton = g.newButton = g.verifierLink = nullptr;
            return 0;
        default:
            break;
    }
    return DefWindowProcW(window, message, wParam, lParam);
}

bool EnsureClass() {
    static bool registered = false;
    if (registered) return true;
    WNDCLASSEXW description = { sizeof(WNDCLASSEXW) };
    description.style = CS_HREDRAW | CS_VREDRAW;
    description.lpfnWndProc = PaneProc;
    description.hInstance = g_module ? g_module : GetModuleHandleW(nullptr);
    description.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    description.hbrBackground = nullptr;
    description.lpszClassName = kClassName;
    registered = RegisterClassExW(&description) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    return registered;
}

} // namespace

void PaneAttachWord(IDispatch* application) {
    if(g.editorHook){UnhookWindowsHookEx(g.editorHook);g.editorHook=nullptr;}
    g.actions.Clear();
    if(application)g.editorHook=SetWindowsHookExW(WH_GETMESSAGE,EditorMessage,nullptr,GetCurrentThreadId());
    if (application) application->AddRef();
    IDispatch* previous=g.word;
    g.word=application;
    if (previous) previous->Release();
}

bool PaneCreated() { return g.window != nullptr; }

void PaneSetFactory(IDispatch* factory){
    if(factory)factory->AddRef();if(g.factory)g.factory->Release();g.factory=factory;
}
void PaneShow() {
    if(!g.taskPane){
        if(!g.factory){MessageBoxW(nullptr,L"Word 尚未提供侧栏接口。请重启 Word 后重试。",L"WorkProof",MB_OK|MB_ICONINFORMATION);return;}
        VARIANT args[3];for(auto& value:args)VariantInit(&value);
        // Bind to the actual document window; relying on Office's implicit
        // ActiveWindow can fail during the new-document startup transition.
        HRESULT windowResult=Dispatch(g.word,L"ActiveWindow",DISPATCH_PROPERTYGET,nullptr,0,&args[0]);
        if(FAILED(windowResult)||args[0].vt!=VT_DISPATCH||!args[0].pdispVal){
            VariantClear(&args[0]);
            MessageBoxW(nullptr,L"请先在 Word 中打开或新建一份文档，再打开创作记录。",L"WorkProof",MB_OK|MB_ICONINFORMATION);return;
        }
        args[1].vt=VT_BSTR;args[1].bstrVal=SysAllocString(L"WorkProof · 创作记录");
        args[2].vt=VT_BSTR;args[2].bstrVal=SysAllocString(kTaskPaneProgId);
        VARIANT result;VariantInit(&result);HRESULT hr=Dispatch(g.factory,L"CreateCTP",DISPATCH_METHOD,args,3,&result);
        for(auto& value:args)VariantClear(&value);TraceHresult(L"CreateCTP",hr);
        if(SUCCEEDED(hr)&&result.vt==VT_DISPATCH){g.taskPane=result.pdispVal;g.taskPane->AddRef();}VariantClear(&result);
        if(!g.taskPane){MessageBoxW(nullptr,L"Word 未能打开记录侧栏。请先保存当前文档后重试；若仍失败，请保留当前文档并反馈此提示。",L"WorkProof",MB_OK|MB_ICONINFORMATION);return;}
        VARIANT setting;VariantInit(&setting);setting.vt=VT_I4;setting.lVal=2;
        Dispatch(g.taskPane,L"DockPosition",DISPATCH_PROPERTYPUT,&setting,1);setting.lVal=360;Dispatch(g.taskPane,L"Width",DISPATCH_PROPERTYPUT,&setting,1);
    }
    VARIANT visible;VariantInit(&visible);visible.vt=VT_BOOL;visible.boolVal=VARIANT_TRUE;
    TraceHresult(L"Show task pane",Dispatch(g.taskPane,L"Visible",DISPATCH_PROPERTYPUT,&visible,1));
}
HWND PaneCreateChild(HWND parent,const RECT& rect){
    if(!parent||!EnsureClass())return nullptr;
    if(g.window)return GetParent(g.window)==parent?g.window:nullptr;
    return CreateWindowExW(WS_EX_CONTROLPARENT,kClassName,L"WorkProof 创作记录",WS_CHILD|WS_VISIBLE|WS_CLIPCHILDREN|WS_VSCROLL,
        rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,parent,nullptr,g_module,nullptr);
}
void PaneResizeChild(const RECT& rect){if(g.window)MoveWindow(g.window,rect.left,rect.top,rect.right-rect.left,rect.bottom-rect.top,TRUE);}
void PaneDestroyChild(){ClosePane();}
void PaneStart() { PaneShow(); if(g.window&&!g.pairing&&g.session.empty())BeginPairing(); }
void PaneLaunchRecording(){PaneShow();if(g.window){g.launchFeedback=true;PostMessageW(g.window,WM_APP_LAUNCH,0,0);}}
void PaneTogglePause() { PaneShow(); if(g.window)TogglePause(); }
void PaneExport() { PaneShow(); if(g.window)Export(); }
void PaneClose() {
    if(g.editorHook){UnhookWindowsHookEx(g.editorHook);g.editorHook=nullptr;}
    g.actions.Clear();
    ClosePane();
    if(g.taskPane){Dispatch(g.taskPane,L"Delete",DISPATCH_METHOD,nullptr,0);g.taskPane->Release();g.taskPane=nullptr;}
    PaneSetFactory(nullptr);
}

} // namespace workproof
