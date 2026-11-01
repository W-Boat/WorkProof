#pragma once
#include <windows.h>
#include <string>
#include <vector>
#include <algorithm>
namespace workproof {
enum class ProcessStatus { Success, LaunchFailed, TimedOut, OutputLimit, ChildFailed, PipeFailed };
struct OwnedHandle {
    HANDLE value=nullptr;
    OwnedHandle()=default; explicit OwnedHandle(HANDLE h):value(h){}
    ~OwnedHandle(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);}
    OwnedHandle(const OwnedHandle&)=delete;OwnedHandle& operator=(const OwnedHandle&)=delete;
    void reset(){if(value&&value!=INVALID_HANDLE_VALUE)CloseHandle(value);value=nullptr;}
};
// No shell. Start suspended, assign a kill-on-close Job, then resume. Restrict inherited
// handles to NUL input and the merged output pipe; never inherit Word's document handles.
inline ProcessStatus RunControlledProcess(const std::wstring& executable,const std::wstring& arguments,
                                         std::string& output,DWORD timeoutMs=60000,size_t outputLimit=1024*1024){
    try {
    output.clear();const ULONGLONG began=GetTickCount64();
    OwnedHandle job(CreateJobObjectW(nullptr,nullptr));if(!job.value)return ProcessStatus::LaunchFailed;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if(!SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))return ProcessStatus::LaunchFailed;
    SECURITY_ATTRIBUTES security={sizeof(security),nullptr,TRUE};
    OwnedHandle reader,writer;
    if(!CreatePipe(&reader.value,&writer.value,&security,0)||!SetHandleInformation(reader.value,HANDLE_FLAG_INHERIT,0))return ProcessStatus::LaunchFailed;
    OwnedHandle input(CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,&security,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr));
    if(input.value==INVALID_HANDLE_VALUE)return ProcessStatus::LaunchFailed;
    SIZE_T bytes=0;InitializeProcThreadAttributeList(nullptr,1,0,&bytes);if(!bytes)return ProcessStatus::LaunchFailed;
    std::vector<unsigned char> attributes(bytes);
    auto list=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attributes.data());
    if(!InitializeProcThreadAttributeList(list,1,0,&bytes))return ProcessStatus::LaunchFailed;
    struct AttributeGuard {LPPROC_THREAD_ATTRIBUTE_LIST list;~AttributeGuard(){DeleteProcThreadAttributeList(list);}} guard{list};
    HANDLE inherited[]={writer.value,input.value};
    if(!UpdateProcThreadAttribute(list,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,inherited,sizeof(inherited),nullptr,nullptr))return ProcessStatus::LaunchFailed;
    STARTUPINFOEXW startup={};startup.StartupInfo.cb=sizeof(startup);startup.lpAttributeList=list;
    startup.StartupInfo.dwFlags=STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW;startup.StartupInfo.wShowWindow=SW_HIDE;
    startup.StartupInfo.hStdOutput=writer.value;startup.StartupInfo.hStdError=writer.value;startup.StartupInfo.hStdInput=input.value;
    std::wstring command=L"\""+executable+L"\" "+arguments;std::vector<wchar_t> line(command.begin(),command.end());line.push_back(0);
    PROCESS_INFORMATION info={};
    if(!CreateProcessW(executable.c_str(),line.data(),nullptr,nullptr,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW|EXTENDED_STARTUPINFO_PRESENT,nullptr,nullptr,&startup.StartupInfo,&info))return ProcessStatus::LaunchFailed;
    OwnedHandle process(info.hProcess),thread(info.hThread);
    auto stop=[&](ProcessStatus reason){TerminateJobObject(job.value,1);TerminateProcess(process.value,1);output.clear();return reason;};
    if(!AssignProcessToJobObject(job.value,process.value))return stop(ProcessStatus::LaunchFailed);
    writer.reset();input.reset();
    if(ResumeThread(thread.value)==static_cast<DWORD>(-1))return stop(ProcessStatus::LaunchFailed);
    bool eof=false;
    for(;;){
        if(GetTickCount64()-began>=timeoutMs)return stop(ProcessStatus::TimedOut);
        if(!eof){
            DWORD available=0;
            if(!PeekNamedPipe(reader.value,nullptr,0,nullptr,&available,nullptr)){
                if(GetLastError()!=ERROR_BROKEN_PIPE)return stop(ProcessStatus::PipeFailed);eof=true;
            }else if(available){
                char block[4096];DWORD read=0;
                // Never request more than Peek observed: ReadFile cannot block for future output.
                if(!ReadFile(reader.value,block,(std::min)(available,static_cast<DWORD>(sizeof(block))),&read,nullptr))return stop(ProcessStatus::PipeFailed);
                if(read>outputLimit-output.size())return stop(ProcessStatus::OutputLimit);
                output.append(block,read);continue;
            }
        }
        DWORD wait=WaitForSingleObject(process.value,0);
        if(wait==WAIT_FAILED)return stop(ProcessStatus::ChildFailed);
        if(wait==WAIT_OBJECT_0&&eof){DWORD code=1;if(!GetExitCodeProcess(process.value,&code)||code!=0)return stop(ProcessStatus::ChildFailed);return ProcessStatus::Success;}
        Sleep(5);
    }
    }catch(...){output.clear();return ProcessStatus::ChildFailed;} // RAII closes the Job before returning to Word.
}
}
