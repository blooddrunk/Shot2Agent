import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
if (process.platform !== 'win32' || !process.argv[2]) throw Error('Usage: Windows node claude-gateway-windows-probe.mjs <absolute-claude.exe> [model]');
for (const base of [process.env.ProgramFiles, process.env.PROGRAMDATA]) {
 if (!base || ['managed-settings.json','managed-settings.d','managed-mcp.json'].some(n=>existsSync(join(base,'ClaudeCode',n)))) throw Error('CLAUDE_MANAGED_POLICY_REFUSED');
}
const policyScript="$ErrorActionPreference='Stop'; try { foreach ($h in @([Microsoft.Win32.RegistryHive]::LocalMachine,[Microsoft.Win32.RegistryHive]::CurrentUser)) { $b=[Microsoft.Win32.RegistryKey]::OpenBaseKey($h,[Microsoft.Win32.RegistryView]::Registry64); try { $k=$b.OpenSubKey('SOFTWARE\\Policies\\ClaudeCode'); if ($null -ne $k) { $k.Dispose(); exit 1 } } finally { $b.Dispose() } }; Write-Output 'absent' } catch { exit 2 }";
const policy=execFileSync(join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',policyScript],{encoding:'utf8',timeout:5000,maxBuffer:16384,stdio:'pipe',windowsHide:true,shell:false});
if(policy.trim()!=='absent')throw Error('CLAUDE_MANAGED_POLICY_REFUSED');
const root=mkdtempSync(join(tmpdir(),'shot-m6-gateway-'));
const model = process.argv[3] ?? 'glm-5.3-flash';
if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model)) throw Error('INVALID_GATEWAY_MODEL');
let imageSeen=false, calls=0, modelSeen=false, authSeen=false;
const server=createServer(async(req,res)=>{
 let body='';for await(const c of req){body+=c;if(body.length>1024*1024){res.writeHead(413);res.end();return;}}
 if(req.url.includes('/messages')) {
  calls++;const b=JSON.parse(body);modelSeen=b.model===model;authSeen=req.headers.authorization==='Bearer synthetic-not-a-credential';
  imageSeen ||= b.messages?.some(m=>Array.isArray(m.content)&&m.content.some(c=>c.type==='image'&&c.source?.type==='base64'&&c.source.data===png));
  if(b.stream){res.writeHead(200,{'Content-Type':'text/event-stream'});
   for(const [event,data] of [['message_start',{type:'message_start',message:{id:'msg_synthetic',type:'message',role:'assistant',model,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}}],['content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}}],['content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'SHOT2AGENT 42 synthetic transport fixture'}}],['content_block_stop',{type:'content_block_stop',index:0}],['message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}}],['message_stop',{type:'message_stop'}]])res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
   res.end();
  } else {res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({id:'msg_synthetic',type:'message',role:'assistant',model,content:[{type:'text',text:'SHOT2AGENT 42 synthetic transport fixture'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:8}}));}
 } else {res.writeHead(200,{'Content-Type':'application/json'});res.end('{}');}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const args=['--model',model,'--setting-sources','','--restricted','--safe-mode','-p','--input-format','stream-json','--output-format','stream-json','--verbose','--tools','','--disallowedTools','mcp__*','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--settings','{"disableAllHooks":true}'];
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['systemroot','windir','path','temp','tmp','programfiles','programdata'].includes(k.toLowerCase())));
Object.assign(env,{HOME:root,USERPROFILE:root,CLAUDE_CONFIG_DIR:join(root,'.claude'),ANTHROPIC_AUTH_TOKEN:'synthetic-not-a-credential',ANTHROPIC_MODEL:model,ANTHROPIC_DEFAULT_OPUS_MODEL:model,ANTHROPIC_DEFAULT_SONNET_MODEL:model,ANTHROPIC_DEFAULT_HAIKU_MODEL:model,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_GIT_BASH_PATH:'C:\\Program Files\\Git\\bin\\bash.exe'});
const child=spawn(resolve(process.argv[2]),args,{cwd:root,env,shell:false,windowsHide:true});let out='',err='';
child.stdout.on('data',c=>{out+=c;if(out.length>1024*1024)child.kill();});child.stderr.on('data',c=>{err+=c;if(err.length>16384)child.kill();});
child.stdin.end(JSON.stringify({type:'user',message:{role:'user',content:[{type:'text',text:'Read synthetic image only'},{type:'image',source:{type:'base64',media_type:'image/png',data:png}}]},parent_tool_use_id:null})+'\n');
const timer=setTimeout(()=>child.kill(),20000);
const code=await new Promise(r=>child.on('close',r));clearTimeout(timer);server.closeAllConnections();await new Promise(r=>server.close(r));
let parsed;try{parsed=out.trim().split('\n').map(l=>JSON.parse(l)).find(v=>v.type==='result');}catch { /* malformed final is reported below */ }
let secretOnDisk=false;
function scan(path) { for(const entry of readdirSync(path,{withFileTypes:true})) { const child=join(path,entry.name); if(entry.isDirectory())scan(child); else if(entry.isFile() && readFileSync(child).includes(Buffer.from('synthetic-not-a-credential')))secretOnDisk=true; } }
scan(root);
process.stdout.write(JSON.stringify({model,secretOnDisk,code,imageSeen,modelSeen,authSeen,calls,finalType:parsed?.type,subtype:parsed?.subtype,isError:parsed?.is_error,transportMarker:parsed?.result?.includes('SHOT2AGENT 42'),diagnosticPresent:!!err,structuredFinal:!!parsed}) + '\n');
rmSync(root,{recursive:true,force:true});
if (secretOnDisk || code !== 0 || !imageSeen || !modelSeen || !authSeen || calls !== 1 || parsed?.type !== 'result' || parsed?.subtype !== 'success' || parsed?.is_error !== false) process.exitCode = 1;
