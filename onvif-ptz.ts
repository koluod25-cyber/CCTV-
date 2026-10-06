import * as Crypto from "expo-crypto";

export type OnvifPtzCredentials = { username?: string; password?: string };
export type PtzDirection = "up" | "down" | "left" | "right";
export type PtzCommand =
  | { type: "move"; direction: PtzDirection; speed?: number }
  | { type: "zoom"; direction: "in" | "out"; speed?: number }
  | { type: "stop" };

const PTZ = "http://www.onvif.org/ver20/ptz/wsdl";
const DEVICE = "http://www.onvif.org/ver10/device/wsdl/GetCapabilities";

function esc(s: string) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function all(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>[\\s\\S]*?</(?:[\\w-]+:)?${name}>`,"gi");
  return xml.match(re) ?? [];
}
function strip(s: string) {
  return s.replace(/<[^>]+>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim();
}
function bytesToBase64(bytes: Uint8Array) {
  const a="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let r="";
  for(let i=0;i<bytes.length;i+=3){const x=bytes[i]??0,y=bytes[i+1]??0,z=bytes[i+2]??0,t=(x<<16)|(y<<8)|z;r+=a[(t>>18)&63]+a[(t>>12)&63]+(i+1<bytes.length?a[(t>>6)&63]:"=")+(i+2<bytes.length?a[t&63]:"=");}
  return r;
}
async function security(c: OnvifPtzCredentials) {
  if(!c.username||!c.password)return "";
  const nonce=await Crypto.getRandomBytesAsync(20), created=new Date().toISOString();
  const input=new TextEncoder().encode(`${bytesToBase64(nonce)}${created}${c.password}`);
  const digest=await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1,input as unknown as BufferSource);
  return `<wsse:Security soap:mustUnderstand="1" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd"><wsse:UsernameToken><wsse:Username>${esc(c.username)}</wsse:Username><wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.1#PasswordDigest">${bytesToBase64(new Uint8Array(digest))}</wsse:Password><wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#Base64Binary">${bytesToBase64(nonce)}</wsse:Nonce><wsu:Created>${created}</wsu:Created></wsse:UsernameToken></wsse:Security>`;
}
async function soap(endpoint:string,action:string,body:string,c:OnvifPtzCredentials) {
  const envelope=`<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Header>${await security(c)}</s:Header><s:Body>${body}</s:Body></s:Envelope>`;
  const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":`application/soap+xml; charset=utf-8; action="${action}"`},body:envelope});
  const text=await r.text();
  if(!r.ok||/<(?:[\w-]+:)?Fault\b/i.test(text))throw new Error(`ONVIF PTZ HTTP ${r.status}: ${text.slice(0,250)}`);
  return text;
}
async function getPtzUrl(device:string,c:OnvifPtzCredentials) {
  const xml=await soap(device,DEVICE,`<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><tds:Category>PTZ</tds:Category></tds:GetCapabilities>`,c);
  const urls=all(xml,"PTZ").flatMap(x=>all(x,"XAddr")).map(strip).filter(x=>/^https?:\/\//i.test(x));
  if(!urls[0])throw new Error("Kamera tidak mengumumkan layanan PTZ melalui ONVIF.");
  return urls[0];
}
export async function sendOnvifPtzCommand(deviceServiceUrl:string,profileToken:string,credentials:OnvifPtzCredentials,command:PtzCommand) {
  if(!deviceServiceUrl||!profileToken)throw new Error("Endpoint ONVIF atau Media Profile tidak tersedia.");
  const url=await getPtzUrl(deviceServiceUrl,credentials);
  if(command.type==="stop"){
    await soap(url,`${PTZ}/Stop`,`<tptz:Stop xmlns:tptz="${PTZ}"><tptz:ProfileToken>${esc(profileToken)}</tptz:ProfileToken><tptz:PanTilt>true</tptz:PanTilt><tptz:Zoom>true</tptz:Zoom></tptz:Stop>`,credentials);
    return {ok:true as const,message:"PTZ berhenti."};
  }
  const s=Math.max(.1,Math.min(1,command.speed??.5));
  const x=command.type==="move"?(command.direction==="left"?-s:command.direction==="right"?s:0):0;
  const y=command.type==="move"?(command.direction==="up"?s:command.direction==="down"?-s:0):0;
  const z=command.type==="zoom"?(command.direction==="in"?s:-s):0;
  await soap(url,`${PTZ}/ContinuousMove`,`<tptz:ContinuousMove xmlns:tptz="${PTZ}" xmlns:tt="http://www.onvif.org/ver10/schema"><tptz:ProfileToken>${esc(profileToken)}</tptz:ProfileToken><tptz:Velocity><tt:PanTilt x="${x.toFixed(3)}" y="${y.toFixed(3)}"/><tt:Zoom x="${z.toFixed(3)}"/></tptz:Velocity></tptz:ContinuousMove>`,credentials);
  return {ok:true as const,message:"Perintah PTZ berhasil dikirim."};
}
