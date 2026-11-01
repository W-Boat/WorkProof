#include "pane.h"
#include "engine.h"
#include <shlobj.h>
#include <shellapi.h>
#include <string>
#include <chrono>
#include <thread>

#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "comctl32.lib")

namespace workproof {
namespace {

const wchar_t kClassName[] = L"WorkProofWordPane";
const UINT kSampleTimer = 1;
const UINT WM_APP_PAIRED = WM_APP + 1;
const int kSampleIntervalMs = 1500;
const int kMaxCharacters = 8000000;

struct PairResult {
    std::wstring token;
    std::wstring error;
};

struct State {
    HWND window = nullptr;
    IDispatch* word = nullptr;
    HWND status = nullptr;
    HWND counter = nullptr;
    HWND startButton = nullptr;
    HWND pauseButton = nullptr;
    HWND exportButton = nullptr;
    HWND cancelButton = nullptr;
    HWND verifierLink = nullptr;
    HFONT titleFont = nullptr;
    HFONT bodyFont = nullptr;
    HFONT statusFont = nullptr;
    HBRUSH background = nullptr;
    HBRUSH cardBrush = nullptr;
    std::wstring token;
    std::wstring session;
    std::wstring identity;
    std::wstring documentName;
    long long sequence = 0;
    long long lastSampleMs = 0;
    long long lastCharacters = -1;
    long lastParagraphs = -1;
    bool paused = true;
    bool pairing = false;
    bool writing = false;
    bool cancelPairing = false;
    std::chrono::steady_clock::time_point started;
} g;

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

void SetStatus(const std::wstring& text) {
    if (g.status) SetWindowTextW(g.status, text.c_str());
}

void PaintState() {
    if (!g.window) return;
    bool recording = !g.paused && !g.session.empty();
    EnableWindow(g.startButton, !g.pairing && !g.writing && g.session.empty());
    EnableWindow(g.pauseButton, !g.pairing && !g.writing && !g.session.empty());
    SetWindowTextW(g.pauseButton, g.paused ? L"继续记录" : L"暂停记录");
    EnableWindow(g.exportButton, !g.pairing && !g.writing && recording);
    EnableWindow(g.cancelButton, g.pairing);
    ShowWindow(g.cancelButton, g.pairing ? SW_SHOW : SW_HIDE);
    wchar_t text[192];
    if (g.session.empty()) {
        swprintf_s(text, L"尚未开始 · 采样间隔 1.5 秒");
    } else {
        swprintf_s(text, L"已保存 %lld 条操作 · 采样间隔 1.5 秒", g.sequence);
    }
    SetWindowTextW(g.counter, text);
    InvalidateRect(g.window, nullptr, FALSE);
}

std::string EventJson(const char* kind, const DocSnapshot& snapshot, long long inserted, long long deleted,
                      const std::string& checkpoint) {
    char buffer[512];
    swprintf_s(buffer, L"{\"seq\":%lld,\"elapsed_ms\":%lld,\"kind\":\"%S\",\"inserted\":%lld,\"deleted\":%lld,"
                       L"\"chars\":%lld,\"checkpoint\":\"%S\",\"metrics\":{\"characters\":%lld,\"paragraphs\":%ld}}",
               g.sequence++, ElapsedMs(), kind, inserted, deleted, snapshot.characters, checkpoint.c_str(),
               snapshot.characters, snapshot.paragraphs);
    // The buffer above is assembled with wide characters only so numbers stay locale independent.
    std::wstring wide(buffer);
    return WideToUtf8(wide);
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

bool SendEvent(const char* kind, const DocSnapshot& snapshot, long long inserted, long long deleted,
               const std::string& checkpoint, std::wstring& error) {
    std::string body = "{\"events\":[" + EventJson(kind, snapshot, inserted, deleted, checkpoint) + "]}";
    std::string response;
    if (!Call(L"POST", L"/v1/sessions/" + g.session + L"/events", body, true, response, error)) return false;
    PaintState();
    return true;
}

void PairingThread() {
    std::string response;
    std::wstring error;
    long status = 0;
    if (!HttpJson(L"POST", L"/v1/native-pairing", "{\"source\":\"word\"}", std::wstring(), response, status) || status != 200) {
        PairResult* failure = new PairResult();
        failure->error = L"桌面端拒绝了连接请求。请确认 WorkProof 正在运行并更新到最新版本。";
        PostMessageW(g.window, WM_APP_PAIRED, 0, (LPARAM)failure);
        return;
    }
    std::wstring ticket = Utf8ToWide(JsonField(response, "ticket"));
    if (ticket.empty()) {
        PairResult* failure = new PairResult();
        failure->error = L"桌面端没有返回连接编号，请稍后重试。";
        PostMessageW(g.window, WM_APP_PAIRED, 0, (LPARAM)failure);
        return;
    }
    for (int attempt = 0; attempt < 120; ++attempt) {
        if (g.cancelPairing) {
            PairResult* cancelled = new PairResult();
            cancelled->error = L"已取消连接。桌面端未批准的请求会自动过期。";
            PostMessageW(g.window, WM_APP_PAIRED, 0, (LPARAM)cancelled);
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
            PostMessageW(g.window, WM_APP_PAIRED, 1, (LPARAM)success);
            return;
        }
    }
    PairResult* timeout = new PairResult();
    timeout->error = L"连接请求已失效。请重新点击开始，并在桌面窗口允许连接。";
    PostMessageW(g.window, WM_APP_PAIRED, 0, (LPARAM)timeout);
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
    SetStatus(L"请在桌面端 WorkProof 核对来源“word”，再点击允许连接。");
    PaintState();
    std::thread(PairingThread).detach();
}

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
    std::string body = "{\"file_name\":\"" + JsonEscape(WideToUtf8(snapshot.name)) +
                       "\",\"started_at\":\"" + JsonEscape(WideToUtf8(IsoUtcNow())) + "\",\"source\":\"word\"}";
    std::string response;
    if (!Call(L"POST", L"/v1/sessions", body, true, response, error)) { SetStatus(error); PaintState(); return; }
    g.session = Utf8ToWide(JsonField(response, "session_id"));
    if (g.session.empty()) { SetStatus(L"桌面端没有返回记录编号，本次开始未完成。"); PaintState(); return; }
    g.identity = snapshot.identity;
    g.documentName = snapshot.name;
    g.lastCharacters = snapshot.characters;
    g.lastParagraphs = snapshot.paragraphs;
    g.sequence = 0;
    g.started = std::chrono::steady_clock::now();
    g.lastSampleMs = 0;
    if (!SendEvent("start", snapshot, 0, 0, std::string(), error)) { SetStatus(error); PaintState(); return; }
    g.paused = false;
    SetTimer(g.window, kSampleTimer, kSampleIntervalMs, nullptr);
    SetStatus(L"记录中。只发送数量与摘要，不发送正文。");
    PaintState();
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
    bool changed = snapshot.characters != g.lastCharacters || snapshot.paragraphs != g.lastParagraphs;
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
        if (ReadDocument(g.word, snapshot, error)) SendEvent("pause", snapshot, 0, 0, std::string(), error);
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
    g.paused = false;
    g.lastSampleMs = ElapsedMs();
    SetTimer(g.window, kSampleTimer, kSampleIntervalMs, nullptr);
    SetStatus(L"继续记录中。");
    PaintState();
}

std::wstring ChooseFolder(HWND owner) {
    BROWSEINFOW browse = {0};
    browse.hwndOwner = owner;
    browse.lpszTitle = L"选择交付目录：会在其中新建子目录，不覆盖原作品。";
    browse.ulFlags = BIF_RETURNONLYFSDIRS | BIF_NEWDIALOGSTYLE;
    PIDLIST_ABSOLUTE list = SHBrowseForFolderW(&browse);
    if (!list) return std::wstring();
    wchar_t path[MAX_PATH] = {0};
    bool ok = SHGetPathFromIDListW(list, path) != FALSE;
    CoTaskMemFree(list);
    return ok ? std::wstring(path) : std::wstring();
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
    if (g.paused || g.session.empty() || g.writing) return;
    g.writing = true;
    PaintState();
    std::wstring error;
    DocSnapshot before;
    if (!ReadDocument(g.word, before, error)) { SetStatus(error); g.writing = false; PaintState(); return; }

    std::wstring parent = ChooseFolder(g.window);
    if (parent.empty()) { SetStatus(L"已取消导出。记录仍在继续。"); g.writing = false; PaintState(); return; }

    SYSTEMTIME now;
    GetLocalTime(&now);
    wchar_t suffix[64];
    swprintf_s(suffix, L"WorkProof-%04d%02d%02d-%02d%02d%02d", now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond);
    std::wstring folder = parent + L"\\" + suffix;
    CreateDirectoryW(folder.c_str(), nullptr);

    if (!SaveDocument(g.word, error)) { SetStatus(error); g.writing = false; PaintState(); return; }
    DocSnapshot saved;
    if (!ReadDocument(g.word, saved, error)) { SetStatus(error); g.writing = false; PaintState(); return; }
    if (saved.identity != before.identity || saved.characters != before.characters || saved.paragraphs != before.paragraphs) {
        SetStatus(L"保存后内容仍在变化，已停止导出。请再次保存并重试。");
        g.writing = false;
        PaintState();
        return;
    }

    std::wstring artifact = folder + L"\\" + g.documentName;
    if (!CopyFileW(saved.identity.c_str(), artifact.c_str(), FALSE)) {
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
    if (!ReadDocument(g.word, check, error) || check.characters != saved.characters || check.paragraphs != saved.paragraphs) {
        SetStatus(L"生成摘要期间文档发生变化，已停止导出。请重新导出。");
        g.writing = false;
        PaintState();
        return;
    }
    if (!SendEvent("save", check, 0, 0, hash, error)) { SetStatus(error); g.writing = false; PaintState(); return; }

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

    std::wstring message = L"已保存到：\n" + folder + L"\n\n作品：" + g.documentName + L"\n证书：" + g.documentName + L".wproof\n\n";
    message += verified ? L"本地独立核验：通过（作品与证书互相匹配）。" : L"本地独立核验：未通过，请不要交付这份证书。";
    message += L"\n\n请把这两份文件一起交付；之后任何修改都需要重新导出。";
    MessageBoxW(g.window, message.c_str(), L"WorkProof", MB_OK | MB_ICONINFORMATION);
    g.writing = false;
    PaintState();
}

void CreateControls(HWND window) {
    g.background = CreateSolidBrush(RGB(246, 248, 247));
    g.cardBrush = CreateSolidBrush(RGB(255, 255, 255));
    g.titleFont = CreateFontW(-30, 0, 0, 0, FW_BOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                              CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");
    g.statusFont = CreateFontW(-21, 0, 0, 0, FW_SEMIBOLD, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                               CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");
    g.bodyFont = CreateFontW(-18, 0, 0, 0, FW_NORMAL, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS,
                             CLEARTYPE_QUALITY, DEFAULT_PITCH, L"Microsoft YaHei UI");

    auto create = [&](const wchar_t* type, const wchar_t* text, DWORD style, int x, int y, int width, int height) {
        HWND control = CreateWindowExW(0, type, text, WS_CHILD | WS_VISIBLE | style, x, y, width, height,
                                       window, nullptr, nullptr, nullptr);
        SendMessageW(control, WM_SETFONT, (WPARAM)g.bodyFont, TRUE);
        return control;
    };

    create(L"STATIC", L"Word 创作记录", SS_LEFT, 22, 18, 400, 34);
    SendMessageW(GetWindow(window, GW_CHILD), WM_SETFONT, (WPARAM)g.titleFont, TRUE);
    create(L"STATIC", L"在 Word 里记录这份文档的创作过程，导出后与作品一起交付。", SS_LEFT, 22, 54, 410, 24);

    HWND card = CreateWindowExW(0, L"STATIC", L"", WS_CHILD | WS_VISIBLE | SS_WHITERECT, 22, 88, 410, 96, window, nullptr, nullptr, nullptr);
    (void)card;
    g.status = create(L"STATIC", L"请先保存文档，再点击开始。", SS_LEFT, 36, 100, 384, 60);
    SendMessageW(g.status, WM_SETFONT, (WPARAM)g.statusFont, TRUE);
    g.counter = create(L"STATIC", L"尚未开始", SS_LEFT, 36, 160, 384, 22);

    g.startButton = create(L"BUTTON", L"开始记录", BS_PUSHBUTTON | BS_FLAT, 22, 200, 104, 36);
    g.pauseButton = create(L"BUTTON", L"暂停记录", BS_PUSHBUTTON | BS_FLAT, 132, 200, 104, 36);
    g.exportButton = create(L"BUTTON", L"导出作品和证书", BS_PUSHBUTTON | BS_FLAT, 242, 200, 140, 36);
    g.cancelButton = create(L"BUTTON", L"取消连接", BS_PUSHBUTTON | BS_FLAT, 388, 200, 44, 36);
    ShowWindow(g.cancelButton, SW_HIDE);

    g.verifierLink = create(L"BUTTON", L"打开本地核验页", BS_PUSHBUTTON | BS_FLAT, 22, 248, 140, 30);

    create(L"STATIC",
           L"只发送编辑数量、段落数、时间与保存摘要，不发送正文、剪贴板或路径。采样可能合并或遗漏修改，"
           L"不能证明作者身份或原创性；关闭窗口即停止记录。",
           SS_LEFT, 22, 292, 410, 66);
}

LRESULT CALLBACK PaneProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
        case WM_CREATE:
            g.window = window;
            CreateControls(window);
            PaintState();
            return 0;
        case WM_ERASEBKGND: {
            RECT area;
            GetClientRect(window, &area);
            FillRect((HDC)wParam, &area, g.background);
            return 1;
        }
        case WM_CTLCOLORSTATIC: {
            HDC device = (HDC)wParam;
            HWND source = (HWND)lParam;
            SetBkMode(device, TRANSPARENT);
            SetTextColor(device, RGB(26, 36, 33));
            // The two labels sit on the white card; every other label uses the canvas colour.
            if (source == g.status || source == g.counter) return (LRESULT)g.cardBrush;
            return (LRESULT)g.background;
        }
        case WM_TIMER:
            if (wParam == kSampleTimer) Sample();
            return 0;
        case WM_COMMAND: {
            HWND source = (HWND)lParam;
            if (source == g.startButton) BeginPairing();
            else if (source == g.pauseButton) TogglePause();
            else if (source == g.exportButton) Export();
            else if (source == g.cancelButton) { g.cancelPairing = true; SetStatus(L"正在取消连接…"); }
            else if (source == g.verifierLink) {
                ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:4173/", nullptr, nullptr, SW_SHOWNORMAL);
            }
            return 0;
        }
        case WM_APP_PAIRED:
            FinishPairing((PairResult*)lParam);
            return 0;
        case WM_CLOSE:
            KillTimer(window, kSampleTimer);
            ShowWindow(window, SW_HIDE);
            return 0;
        case WM_DESTROY:
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
            g.status = g.counter = g.startButton = g.pauseButton = g.exportButton = g.cancelButton = g.verifierLink = nullptr;
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
    description.hInstance = GetModuleHandleW(nullptr);
    description.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    description.hbrBackground = nullptr;
    description.lpszClassName = kClassName;
    registered = RegisterClassExW(&description) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    return registered;
}

} // namespace

void PaneAttachWord(IDispatch* application) {
    if (application) g.word = application;
}

bool PaneCreated() { return g.window != nullptr; }

void PaneShow() {
    if (!EnsureClass()) return;
    if (!g.window) {
        g.window = CreateWindowExW(WS_EX_TOOLWINDOW, kClassName, L"WorkProof · Word 创作记录",
                                   WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
                                   CW_USEDEFAULT, CW_USEDEFAULT, 470, 420, nullptr, nullptr, nullptr, nullptr);
        if (!g.window) return;
    }
    ShowWindow(g.window, SW_SHOW);
    SetForegroundWindow(g.window);
}

void PaneStart() { PaneShow(); BeginPairing(); }
void PaneTogglePause() { PaneShow(); TogglePause(); }
void PaneExport() { PaneShow(); Export(); }
void PaneClose() { ClosePane(); }

} // namespace workproof
