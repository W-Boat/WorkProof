#include "addin.h"

namespace workproof {

std::wstring RibbonXml() {
    // Single quotes keep the markup a plain string literal; Office accepts this form.
    return std::wstring(
        LR"(<customUI xmlns='http://schemas.microsoft.com/office/2009/07/customui'><ribbon><tabs>)"
        LR"(<tab id='workproofTab' label='WorkProof'><group id='workproofGroup' label='创作过程记录'>)"
        LR"(<button id='workproofOpen' label='打开创作记录' size='large' onAction='OpenRecorder' )"
        LR"(screentip='记录当前作品的创作过程' )"
#ifdef WORKPROOF_POWERPOINT
        LR"(supertip='只记录幻灯片和对象数量、时间及文件摘要；不读取文字、图片和备注，也无法追踪同数量的内容替换。'/>)"
#else
        LR"(supertip='只保存编辑数量与摘要，不发送正文；导出后得到作品与 .wproof 证书。'/>)"
#endif
        LR"(<button id='workproofStart' label='开始记录' size='normal' onAction='StartRecording' )"
        LR"(screentip='在桌面端核对来源并允许连接后开始记录'/>)"
        LR"(<button id='workproofPause' label='暂停 / 继续' size='normal' onAction='TogglePause' )"
        LR"(screentip='继续时会标明未记录的时间'/>)"
        LR"(<button id='workproofExport' label='导出作品和证书' imageMso='FileSaveAs' size='normal' onAction='ExportRecord' )"
        LR"(screentip='保存作品并生成绑定的 .wproof 证书'/>)"
        LR"(</group></tab></tabs></ribbon></customUI>)");
}

std::wstring EnginePath() {
    wchar_t buffer[MAX_PATH * 2] = {0};
    DWORD length = GetModuleFileNameW(g_module, buffer, (DWORD)(sizeof(buffer) / sizeof(buffer[0])));
    if (length == 0 || length >= sizeof(buffer) / sizeof(buffer[0])) return L"workproof-engine.exe";
    std::wstring path(buffer, length);
    size_t slash = path.find_last_of(L'\\');
    if (slash == std::wstring::npos) return L"workproof-engine.exe";
    return path.substr(0, slash + 1) + L"workproof-engine.exe";
}

} // namespace workproof
