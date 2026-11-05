#pragma once
#include <array>
#include <string>

namespace workproof {
// Counts editor keyboard commands, not their success or any clipboard contents.
// Kept independent from Windows hooks so both architectures exercise the mapping.
struct ActionMetrics {
    enum Index {Backspace,DeleteForward,Space,Enter,Copy,Paste,Cut,Undo,Redo,Format,Move,Count};
    std::array<unsigned long long,Count> values{};
    void Add(Index index,unsigned repeat=1){
        const auto next=values[index]+repeat;
        values[index]=next>1000000000ULL?1000000000ULL:next;
    }
    void Key(unsigned key,bool control,bool shift,bool alt,unsigned repeat=1){
        if(alt)return;
        if(control){
            switch(key){
                case 'C':Add(Copy,repeat);return;case 'V':Add(Paste,repeat);return;
                case 'X':Add(Cut,repeat);return;case 'Z':Add(shift?Redo:Undo,repeat);return;
                case 'Y':Add(Redo,repeat);return;
                case 'B':case 'I':case 'U':case 0x20:Add(Format,repeat);return;
            }
        }
        if(shift&&key==0x2d){Add(Paste,repeat);return;}
        if(control&&key==0x2d){Add(Copy,repeat);return;}
        if(shift&&key==0x2e){Add(Cut,repeat);return;}
        if(key==0x08)Add(Backspace,repeat);
        else if(key==0x2e)Add(DeleteForward,repeat);
        else if(key==0x20&&!control)Add(Space,repeat);
        else if(key==0x0d)Add(Enter,repeat);
        else if(key>=0x21&&key<=0x28)Add(Move,repeat);
    }
    bool Any()const{for(auto n:values)if(n)return true;return false;}
    void Clear(){values.fill(0);}
    std::string Json()const{
        const char* names[]={"backspace","delete_forward","space","enter","copy","paste","cut","undo_commands","redo_commands","format_commands","cursor_moves"};
        std::string result;
        for(unsigned i=0;i<Count;++i)if(values[i]){
            if(!result.empty())result+=",";
            result+="\""+std::string(names[i])+"\":"+std::to_string(values[i]);
        }
        return result;
    }
};
}
