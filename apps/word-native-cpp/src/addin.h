#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <string>
#include <vector>

namespace workproof {

// Fixed identity: the installer, the CI probe and Word all use these values.
extern const CLSID CLSID_Connect;
extern const IID IID_IExtensibility2;
extern const IID IID_IRibbon;
extern const IID IID_ITaskPaneConsumer;
extern HINSTANCE g_module;
extern LONG g_objectCount;

struct __declspec(uuid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")) IDTExtensibility2 : public IDispatch {
    virtual HRESULT __stdcall OnConnection(IDispatch* application, int connectMode, IDispatch* addInInstance, SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnDisconnection(int removeMode, SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnAddInsUpdate(SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnStartupComplete(SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnBeginShutdown(SAFEARRAY** custom) = 0;
};

struct __declspec(uuid("000C0396-0000-0000-C000-000000000046")) IRibbonExtensibility : public IDispatch {
    virtual HRESULT __stdcall GetCustomUI(BSTR ribbonId, BSTR* ribbonXml) = 0;
};

struct __declspec(uuid("000C033E-0000-0000-C000-000000000046")) ITaskPaneConsumer : public IDispatch {
    virtual HRESULT __stdcall CTPFactoryAvailable(IDispatch* factory) = 0;
};

void Trace(const wchar_t* message);
void TraceHresult(const wchar_t* step, long result);
void TraceIid(const wchar_t* step, const GUID& value);

std::wstring RibbonXml();
std::wstring EnginePath();

} // namespace workproof
