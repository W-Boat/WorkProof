#include "controlled_process.h"
#include <cstdio>
#include <string>

int wmain(int argc,wchar_t** argv){
    if(argc>=2&&wcscmp(argv[1],L"--normal")==0){DWORD n;WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),"fixture-ok",10,&n,nullptr);return 0;}
    if(argc>=2&&wcscmp(argv[1],L"--hold")==0){Sleep(60000);return 0;}
    if(argc>=2&&wcscmp(argv[1],L"--flood")==0){char block[4096]={};DWORD n;for(int i=0;i<1024;i++)if(!WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),block,sizeof(block),&n,nullptr))break;Sleep(60000);return 0;}
    if(argc>=3&&wcscmp(argv[1],L"--tree")==0){
        wchar_t exe[32768]={};GetModuleFileNameW(nullptr,exe,32768);std::wstring command=L"\""+std::wstring(exe)+L"\" --hold";
        STARTUPINFOW startup={sizeof(startup)};startup.dwFlags=STARTF_USESTDHANDLES;
        startup.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);startup.hStdError=GetStdHandle(STD_ERROR_HANDLE);startup.hStdInput=GetStdHandle(STD_INPUT_HANDLE);
        PROCESS_INFORMATION info={};std::vector<wchar_t> line(command.begin(),command.end());line.push_back(0);
        if(!CreateProcessW(exe,line.data(),nullptr,nullptr,TRUE,CREATE_NO_WINDOW,nullptr,nullptr,&startup,&info))return 3;
        FILE* file=nullptr;_wfopen_s(&file,argv[2],L"w");if(!file){TerminateProcess(info.hProcess,1);CloseHandle(info.hProcess);CloseHandle(info.hThread);return 4;}
        fprintf(file,"%lu",info.dwProcessId);fclose(file);CloseHandle(info.hProcess);CloseHandle(info.hThread);return 0;
    }
    wchar_t exe[32768]={};GetModuleFileNameW(nullptr,exe,32768);std::string output;
    auto require=[](bool condition,const char* description){if(!condition){printf("FAIL: %s\n",description);return false;}return true;};
    if(!require(workproof::RunControlledProcess(exe,L"--normal",output,3000)==workproof::ProcessStatus::Success&&output=="fixture-ok","normal output"))return 1;
    ULONGLONG began=GetTickCount64();
    if(!require(workproof::RunControlledProcess(exe,L"--hold",output,300)==workproof::ProcessStatus::TimedOut&&output.empty()&&GetTickCount64()-began<4000,"silent child deadline"))return 1;
    if(!require(workproof::RunControlledProcess(exe,L"--flood",output,3000,4096)==workproof::ProcessStatus::OutputLimit&&output.empty(),"output limit terminates child"))return 1;
    wchar_t temp[MAX_PATH]={},marker[MAX_PATH]={};GetTempPathW(MAX_PATH,temp);GetTempFileNameW(temp,L"wpj",0,marker);
    std::wstring arguments=L"--tree \""+std::wstring(marker)+L"\"";
    auto result=workproof::RunControlledProcess(exe,arguments,output,1000);
    FILE* file=nullptr;_wfopen_s(&file,marker,L"r");unsigned long pid=0;if(file){fscanf_s(file,"%lu",&pid);fclose(file);}DeleteFileW(marker);
    HANDLE descendant=pid?OpenProcess(SYNCHRONIZE,FALSE,pid):nullptr;
    bool stopped=descendant?WaitForSingleObject(descendant,3000)==WAIT_OBJECT_0:GetLastError()==ERROR_INVALID_PARAMETER;
    if(descendant)CloseHandle(descendant);
    if(!require(result==workproof::ProcessStatus::TimedOut&&pid&&stopped&&output.empty(),"exited parent with stdout-holding descendant is bounded and killed"))return 1;
    printf("PASS: normal output, silent timeout, output overflow and inherited-pipe descendant cleanup\n");return 0;
}
