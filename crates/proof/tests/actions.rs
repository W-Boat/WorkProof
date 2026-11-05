use std::collections::BTreeMap;
use workproof_protocol::{Event,validate_event,event_hash,genesis};

#[test]
fn action_counts_are_bounded_and_committed_by_the_hash_chain(){
    let mut event=Event{seq:0,elapsed_ms:1500,kind:"interaction".into(),inserted:0,deleted:0,chars:42,
        checkpoint:String::new(),metrics:BTreeMap::from([("backspace".into(),3),("copy".into(),1)])};
    assert!(validate_event(&event));
    let original=event_hash(&genesis("actions"),&event);
    event.metrics.insert("copy".into(),2);
    assert_ne!(event_hash(&genesis("actions"),&event),original);
    event.metrics.insert("copy".into(),1_000_000_001);assert!(!validate_event(&event));
    event.metrics.remove("copy");event.metrics.insert("clipboard_text".into(),1);assert!(!validate_event(&event));
    event.metrics.remove("clipboard_text");
    for kind in ["format","layout"]{event.kind=kind.into();assert!(validate_event(&event));}
}
