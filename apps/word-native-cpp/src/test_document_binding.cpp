// Runs the production pane logic with deterministic Word/collector boundaries.
// No Office installation, network service or file chooser is needed by this CI fixture.
#include "pane.h"
#include "engine.h"
#include "addin.h"
#include <shlobj.h>
#include <shellapi.h>
#include <cstdio>

namespace {
bool loseNextEventResponse=false;
std::vector<std::string> eventBodies;
int folderCalls=0,copyCalls=0,saveCalls=0,httpCalls=0,sessionCalls=0,eventCalls=0;
workproof::DocSnapshot current={L"C:\\fixture\\A.docx",L"A.docx",80,2,false,true};
HRESULT FixtureCoCreate(REFCLSID,LPUNKNOWN,DWORD,REFIID,LPVOID* object){
    ++folderCalls;if(object)*object=nullptr;return E_ABORT;
}
BOOL WINAPI FixtureCopy(LPCWSTR,LPCWSTR,BOOL){++copyCalls;return FALSE;}
}
// Instrument only the actual OS side effects of Export; production branch logic is unchanged.
#define CoCreateInstance FixtureCoCreate
#define CopyFileW FixtureCopy
#include "pane.cpp"
#undef CopyFileW
#undef CoCreateInstance

namespace workproof {
HINSTANCE g_module=nullptr;
LONG g_objectCount=0;
void Trace(const wchar_t*){}
void TraceHresult(const wchar_t*,long){}
void TraceIid(const wchar_t*,const GUID&){}
bool ReadDocument(IDispatch*,DocSnapshot& snapshot,std::wstring&){snapshot=current;return true;}
bool SaveDocument(IDispatch*,std::wstring&){++saveCalls;return true;}
bool HttpJson(const std::wstring&,const std::wstring& path,const std::string& body,const std::wstring&,std::string& response,long& status){
    ++httpCalls;status=200;response="{}";
    if(path==L"/v1/sessions"){++sessionCalls;response="{\"session_id\":\"fixture-session\"}";}
    else if(path.find(L"/events")!=std::wstring::npos){
        ++eventCalls;eventBodies.push_back(body);
        if(loseNextEventResponse){loseNextEventResponse=false;return false;}
    }
    return true;
}
std::string JsonField(const std::string& json,const char* key){
    return std::string(key)=="session_id"&&json.find("fixture-session")!=std::string::npos?"fixture-session":"";
}
bool RunEngine(const std::wstring&,std::string&,std::wstring&){return false;}
bool Fingerprint(const std::wstring&,std::string&,long long&){return false;}
}

int main(){
    using namespace workproof;
    g_module=GetModuleHandleW(nullptr);
    HWND host=CreateWindowExW(0,L"STATIC",L"Document binding fixture",WS_OVERLAPPED,0,0,600,700,nullptr,nullptr,g_module,nullptr);
    RECT bounds={0,0,360,600};
    if(!host||!PaneCreateChild(host,bounds)){std::puts("FAIL: real pane child creation");return 1;}
    // The approval callback must still bind to A even if Word switched to B while approval was pending.
    g.identity=current.identity;g.documentName=current.name;g.pairing=true;
    current.identity=L"C:\\fixture\\B.docx";current.name=L"B.docx";
    auto switched=new PairResult();switched->token=L"fixture-approved-token";
    FinishPairing(switched);
    if(!g.session.empty()||g.pairing||sessionCalls||eventCalls){std::puts("FAIL: switched approval created a session");return 1;}
    // Positive control: returning to A permits the same actual callback to create a session/start event.
    current.identity=g.identity;current.name=L"A.docx";g.pairing=true;
    auto approved=new PairResult();approved->token=L"fixture-approved-token";
    FinishPairing(approved);
    if(g.session!=L"fixture-session"||g.paused||sessionCalls!=1||eventCalls!=1){std::puts("FAIL: matching document did not start");return 1;}
    // A lost acknowledgement must retain the exact event, including sequence and timestamp.
    const long long sequenceBefore=g.sequence;
    const size_t payloadCount=eventBodies.size();
    loseNextEventResponse=true;std::wstring retryError;
    if(SendEvent("edit",current,3,0,"",retryError)||g.sequence!=sequenceBefore||g.pendingEvent.empty()){
        std::puts("FAIL: lost acknowledgement advanced or discarded the pending event");return 1;
    }
    const std::string pending=g.pendingEvent;
    if(eventBodies.size()!=payloadCount+1||eventBodies.back()!=pending){std::puts("FAIL: pending event differs from sent bytes");return 1;}
    if(!FlushPending(retryError)||g.sequence!=sequenceBefore+1||!g.pendingEvent.empty()||eventBodies.size()!=payloadCount+2||eventBodies.back()!=pending){
        std::puts("FAIL: acknowledgement retry changed bytes or advanced sequence incorrectly");return 1;
    }
    if(!SendEvent("edit",current,1,0,"",retryError)||g.sequence!=sequenceBefore+2||eventBodies.size()!=payloadCount+3||
       eventBodies.back().find("\"seq\":"+std::to_string(sequenceBefore+1)+",")==std::string::npos){
        std::puts("FAIL: next event did not use the following sequence");return 1;
    }
    // Pausing after a document switch must stop sampling locally without sending B's metrics.
    current.identity=L"C:\\fixture\\B.docx";current.name=L"B.docx";
    const int beforePause=httpCalls;
    TogglePause();
    if(!g.paused||httpCalls!=beforePause){std::puts("FAIL: switched pause submitted foreign document data");return 1;}
    g.paused=false;
    // Switch and immediately export, before any sampling timer can detect the new document.
    current.identity=L"C:\\fixture\\B.docx";current.name=L"B.docx";
    const int requestsBefore=httpCalls;
    Export();
    if(!g.paused||g.writing||folderCalls||saveCalls||copyCalls||httpCalls!=requestsBefore){
        std::puts("FAIL: switched export reached folder/save/copy/collector effects");return 1;
    }
    // Positive control for instrumentation: on A, export reaches the folder boundary (cancelled by fixture).
    current.identity=g.identity;current.name=L"A.docx";g.paused=false;
    Export();
    if(folderCalls!=1||saveCalls||copyCalls||g.writing){std::puts("FAIL: matching export did not reach chooser safely");return 1;}
    // Reset is guarded while recording, busy or pairing, and cannot drop unacknowledged bytes.
    const std::wstring oldSession=g.session;
    if(ResetPausedRecording()||g.session!=oldSession){std::puts("FAIL: active recording reset");return 1;}
    g.paused=true;g.writing=true;
    if(ResetPausedRecording()){std::puts("FAIL: export busy reset");return 1;}
    g.writing=false;g.pairing=true;
    if(ResetPausedRecording()){std::puts("FAIL: approval busy reset");return 1;}
    g.pairing=false;
    current.identity=g.identity;
    loseNextEventResponse=true;
    SendEvent("pause",current,0,0,"",retryError);
    const std::string unacknowledged=g.pendingEvent;const long long resetSequence=g.sequence;
    loseNextEventResponse=true;
    if(ResetPausedRecording()||g.session!=oldSession||g.pendingEvent!=unacknowledged||g.sequence!=resetSequence){
        std::puts("FAIL: reset discarded unacknowledged old record");return 1;
    }
    const size_t beforeReset=eventBodies.size();
    if(!ResetPausedRecording()||!g.session.empty()||!g.token.empty()||!g.identity.empty()||!g.documentName.empty()||
       !g.pendingEvent.empty()||g.sequence||g.lastCharacters!=-1||g.lastParagraphs!=-1||g.lastSlides!=-1||g.lastShapes!=-1||
       eventBodies.size()!=beforeReset+1||eventBodies.back()!=unacknowledged){
        std::puts("FAIL: confirmed reset failed to flush old bytes and clear local binding");return 1;
    }
    PaneDestroyChild();DestroyWindow(host);
    std::puts("PASS: pending approval and immediate export remain bound to their original document");
    return 0;
}
