#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <string>

namespace workproof {

struct DocSnapshot {
    std::wstring identity;   // FullName, never leaves this machine
    std::wstring name;       // file name only
    long long characters;
    long paragraphs;
    bool readOnly;
    bool saved;
    long slides = 0;
    long long shapes = 0;
    HWND editorWindow = nullptr; // Local document-window boundary; never serialized.
    std::wstring layoutSignature; // Optional numeric style samples, kept local.
    std::wstring formatSignature;
    long selectionStart = -1, selectionEnd = -1;
};

// Late-bound access to the running Word instance. Everything stays on the caller's (Word UI) thread.
bool ReadDocument(IDispatch* application, DocSnapshot& snapshot, std::wstring& error);
bool SaveDocument(IDispatch* application, std::wstring& error);

// Local collector on 127.0.0.1; native clients never send an Origin header.
bool HttpJson(const std::wstring& method, const std::wstring& path, const std::string& body,
              const std::wstring& bearer, std::string& response, long& status);
std::string JsonField(const std::string& json, const char* key);
bool RunEngine(const std::wstring& arguments, std::string& output, std::wstring& error);
bool Fingerprint(const std::wstring& path, std::string& hash, long long& bytes);

} // namespace workproof
