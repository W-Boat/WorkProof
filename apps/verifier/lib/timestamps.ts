import * as asn1 from 'asn1js';
import {Certificate,CryptoEngine,SignedData,TimeStampReq,TimeStampResp,TSTInfo,setEngine} from 'pkijs';

const SHA256='2.16.840.1.101.3.4.2.1',TST='1.2.840.113549.1.9.16.1.4';
function fail():never{throw new Error('时间凭据未能通过检查。请确认请求、响应、证书与信任来源相互对应。');}
function bytes(value:ArrayBuffer|Uint8Array){return value instanceof Uint8Array?value:new Uint8Array(value);}
function equal(a:ArrayBuffer|Uint8Array,b:ArrayBuffer|Uint8Array){const x=bytes(a),y=bytes(b);return x.length===y.length&&x.every((v,i)=>v===y[i]);}
function parse(buffer:ArrayBuffer){const parsed=asn1.fromBER(buffer);if(parsed.offset!==buffer.byteLength)fail();return parsed.result;}
function sequence(value:unknown){if(!(value instanceof asn1.Sequence))fail();return value.valueBlock.value;}
function octets(value:unknown){if(!(value instanceof asn1.OctetString)||value.idBlock.isConstructed)fail();return value.valueBlock.valueHexView;}
function nonce(value:asn1.Integer|undefined){if(!value)fail();let v=value.valueBlock.valueHexView;if(!v.length||(v[0]&128))fail();while(v.length>1&&v[0]===0)v=v.slice(1);return v;}
const hex=(value:ArrayBuffer)=>Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');
export interface TimestampResult {time:string;trustFingerprints:string[];revocationChecked:false;identityVerified:false;creationTimeVerified:false}
export async function verifyTimestamp(signature:string,query:ArrayBuffer,response:ArrayBuffer,pem:string):Promise<TimestampResult>{
  if(!/^[a-f0-9]{128}$/i.test(signature)||query.byteLength>8192||response.byteLength>128*1024||pem.length>256*1024)fail();
  setEngine('WorkProof WebCrypto',new CryptoEngine({name:'WorkProof WebCrypto',crypto:globalThis.crypto,subtle:globalThis.crypto.subtle}));
  const input=Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16));
  const digest=await crypto.subtle.digest('SHA-256',input);
  const request=new TimeStampReq({schema:parse(query)}),reply=new TimeStampResp({schema:parse(response)});
  if(request.version!==1||request.messageImprint.hashAlgorithm.algorithmId!==SHA256||!equal(request.messageImprint.hashedMessage.valueBlock.valueHexView,digest)||![0,1].includes(reply.status.status)||!reply.timeStampToken||reply.timeStampToken.contentType!=='1.2.840.113549.1.7.2')fail();
  const signed=new SignedData({schema:reply.timeStampToken.content});
  if(signed.version!==3||signed.signerInfos.length!==1||(signed.certificates?.length??0)>10||signed.encapContentInfo.eContentType!==TST)fail();
  const info=new TSTInfo({schema:parse(octets(signed.encapContentInfo.eContent).slice().buffer)});
  if(info.version!==1||info.messageImprint.hashAlgorithm.algorithmId!==SHA256||!equal(info.messageImprint.hashedMessage.valueBlock.valueHexView,digest)||!equal(nonce(request.nonce),nonce(info.nonce))||(request.reqPolicy&&request.reqPolicy!==info.policy)||!Number.isFinite(info.genTime.getTime())||info.genTime.getTime()>Date.now()+300000)fail();
  const blocks=[...pem.matchAll(/-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\s]+?)\s*-----END CERTIFICATE-----/g)];
  if(!blocks.length||blocks.length>8||pem.replace(/-----BEGIN CERTIFICATE-----\s*[A-Za-z0-9+/=\s]+?\s*-----END CERTIFICATE-----/g,'').trim())fail();
  const roots=blocks.map(match=>new Certificate({schema:parse(Uint8Array.from(atob(match[1].replace(/\s/g,'')),v=>v.charCodeAt(0)).buffer)}));
  if(roots.some(cert=>!cert.extensions?.some(ext=>ext.extnID==='2.5.29.19'&&ext.parsedValue?.cA===true)))fail();
  const verified=await signed.verify({signer:0,data:input.buffer,trustedCerts:roots,checkChain:true,passedWhenNotRevValues:true,extendedMode:true});
  const signer=verified.signerCertificate;
  if(!verified.signatureVerified||!verified.signerCertificateVerified||!signer)fail();
  const now=new Date();
  if([...verified.certificatePath,signer].some(cert=>cert.notBefore.value>now||cert.notAfter.value<now))fail();
  const eku=signer.extensions?.filter(ext=>ext.extnID==='2.5.29.37');
  if(eku?.length!==1||!eku[0].critical||eku[0].parsedValue?.keyPurposes?.length!==1||eku[0].parsedValue.keyPurposes[0]!=='1.3.6.1.5.5.7.3.8')fail();
  const usage=signer.extensions?.find(ext=>ext.extnID==='2.5.29.15');
  if(usage&&!(usage.parsedValue?.valueBlock?.valueHexView?.[0]&192))fail();
  for(const oid of ['1.2.840.113549.1.9.3','1.2.840.113549.1.9.4']) {
    if(signed.signerInfos[0].signedAttrs?.attributes.filter(attr=>attr.type===oid).length!==1)fail();
  }
  const contentType=signed.signerInfos[0].signedAttrs!.attributes.find(attr=>attr.type==='1.2.840.113549.1.9.3')!;
  if(contentType.values.length!==1||!(contentType.values[0] instanceof asn1.ObjectIdentifier)||contentType.values[0].valueBlock.toString()!==TST)fail();
  // RFC3161 SigningCertificateV2 binds the selected signing certificate, not just its key.
  const attrs=signed.signerInfos[0].signedAttrs?.attributes.filter(attr=>attr.type==='1.2.840.113549.1.9.16.2.47');
  if(attrs?.length!==1||attrs[0].values.length!==1)fail();
  const ess=sequence(sequence(sequence(attrs[0].values[0])[0])[0]);
  let certHash=ess[0];
  if(certHash instanceof asn1.Sequence){if((sequence(certHash)[0] as asn1.ObjectIdentifier).valueBlock.toString()!==SHA256)fail();certHash=ess[1];}
  if(!equal(octets(certHash),await crypto.subtle.digest('SHA-256',signer.toSchema().toBER(false))))fail();
  const trustFingerprints=await Promise.all(roots.map(async cert=>hex(await crypto.subtle.digest('SHA-256',cert.toSchema().toBER(false)))));
  return {time:info.genTime.toISOString(),trustFingerprints,revocationChecked:false,identityVerified:false,creationTimeVerified:false};
}
