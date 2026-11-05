#include "action_metrics.h"
#include <cassert>
#include <iostream>
int main(){
    workproof::ActionMetrics actions;
    actions.Key(0x08,false,false,false,3);actions.Key(0x2e,false,false,false);
    actions.Key('C',true,false,false);actions.Key('V',true,false,false);
    actions.Key('Z',true,false,false);actions.Key('Z',true,true,false);
    actions.Key('Y',true,false,false);actions.Key('B',true,false,false);
    actions.Key(0x20,false,false,false);actions.Key(0x0d,false,false,false);
    actions.Key(0x27,false,false,false);actions.Key('C',true,false,true);
    assert(actions.values[actions.Backspace]==3&&actions.values[actions.DeleteForward]==1);
    assert(actions.values[actions.Copy]==1&&actions.values[actions.Paste]==1);
    assert(actions.values[actions.Undo]==1&&actions.values[actions.Redo]==2);
    assert(actions.values[actions.Format]==1&&actions.values[actions.Space]==1);
    assert(actions.values[actions.Enter]==1&&actions.values[actions.Move]==1);
    assert(actions.Json().find("clipboard")==std::string::npos);
    actions.Key(0x2d,true,false,false);actions.Key(0x2d,false,true,false);actions.Key(0x2e,false,true,false);
    assert(actions.values[actions.Copy]==2&&actions.values[actions.Paste]==2&&actions.values[actions.Cut]==1);
    actions.Add(actions.Backspace,1000000000U);assert(actions.values[actions.Backspace]==1000000000ULL);
    actions.Clear();assert(!actions.Any()&&actions.Json().empty());
    std::cout<<"PASS bounded editor command counts; no text or clipboard capture\n";
}
