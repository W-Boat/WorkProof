#include <windows.h>
#include <string>

namespace workproof {

// Small append-only trace so a host-side load failure can be diagnosed without a debugger.
// It records only our own lifecycle events; no document text or path is ever written.
void Trace(const wchar_t* message) {
    wchar_t temp[MAX_PATH] = {0};
    DWORD length = GetTempPathW(MAX_PATH, temp);
    if (length == 0) return;
    std::wstring path(temp, length);
    path += L"workproof-word-addin.log";
    HANDLE file = CreateFileW(path.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return;
    SYSTEMTIME now;
    GetLocalTime(&now);
    wchar_t line[512];
    int written = swprintf_s(line, L"%04d-%02d-%02d %02d:%02d:%02d.%03d [%lu] %s\r\n",
                             now.wYear, now.wMonth, now.wDay, now.wHour, now.wMinute, now.wSecond,
                             now.wMilliseconds, (unsigned long)GetCurrentProcessId(), message);
    if (written > 0) {
        DWORD bytes = 0;
        WriteFile(file, line, (DWORD)(written * sizeof(wchar_t)), &bytes, nullptr);
    }
    CloseHandle(file);
    OutputDebugStringW(message);
    OutputDebugStringW(L"\n");
}

void TraceHresult(const wchar_t* step, long result) {
    wchar_t buffer[256];
    swprintf_s(buffer, L"%s hr=0x%08lX", step, (unsigned long)result);
    Trace(buffer);
}

} // namespace workproof
