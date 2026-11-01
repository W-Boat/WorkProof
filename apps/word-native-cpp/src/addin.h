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

struct __declspec(uuid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744")) IDTExtensibility2 : public IUnknown {
    virtual HRESULT __stdcall OnConnection(IDispatch* application, int connectMode, IDispatch* addInInstance, SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnDisconnection(int removeMode, SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnAddInsUpdate(SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnStartupComplete(SAFEARRAY** custom) = 0;
    virtual HRESULT __stdcall OnBeginShutdown(SAFEARRAY** custom) = 0;
};

struct __declspec(uuid("000C0396-0000-0000-C000-000000000046")) IRibbonExtensibility : public IUnknown {
    virtual HRESULT __stdcall GetCustomUI(BSTR ribbonId, BSTR* ribbonXml) = 0;
};

std::wstring RibbonXml();
std::wstring EnginePath();

} // namespace workproof
