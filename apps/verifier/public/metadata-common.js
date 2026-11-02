// Shared bounded XML envelope for optional image metadata. No links are resolved.
function metadataXmpPacket(text,location){
  if(new TextEncoder().encode(text).length>65536||/\0|<!DOCTYPE|<!ENTITY/i.test(text)||/<\?xml[^?]*encoding\s*=\s*['"](?!utf-8['"])/i.test(text))throw Error('Unsupported XMP envelope');
  return {text,location};
}
