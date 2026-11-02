// Actions fixture only. Delay then run the adjacent real Rust inspector with inherited pipes.
#include <windows.h>
#include <process.h>
#include <string>
int wmain() {
    wchar_t path[32768];
    DWORD count=GetModuleFileNameW(nullptr,path,32768);
    if (!count || count>=32768) return 101;
    std::wstring executable(path,count);
    executable=executable.substr(0,executable.find_last_of(L"\\/"))+L"\\real-inspector.exe";
    Sleep(2000);
    const wchar_t* args[]={executable.c_str(),nullptr};
    auto result=_wspawnv(_P_WAIT,executable.c_str(),args);
    return result<0 ? 102 : static_cast<int>(result);
}
