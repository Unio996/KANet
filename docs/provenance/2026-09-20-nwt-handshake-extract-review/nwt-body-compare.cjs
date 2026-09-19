const fs=require('fs');
const rel=fs.readFileSync('f5x_before_relay.mjs','utf8').replace(/\r\n/g,'\n');
const fx=fs.readFileSync('f5x_fixture.txt','utf8').replace(/\r\n/g,'\n');
const mod=fs.readFileSync('f5x_mod.mjs','utf8').replace(/\r\n/g,'\n');
// 1) from original relay.mjs: text from "const _acceptedPeers" through the closing of doAcceptHandshake
const s=rel.indexOf('const _acceptedPeers = new Set()');
const e=rel.indexOf('async function poll()');
const orig=rel.slice(s,e).replace(/\s+$/,'');
console.log('orig span chars',orig.length,' fixture chars',fx.replace(/\s+$/,'').length);
console.log('fixture === original span (trim end):', fx.replace(/\s+$/,'')===orig);
// 2) module body vs original: strip factory wrapper, dedent 2, consoleUrl->CONSOLE_URL
const ms=mod.indexOf('const _acceptedPeers');
const me=mod.lastIndexOf('  };\n}')+3;
const body=mod.slice(ms,me).split('\n').map(l=>l.startsWith('  ')?l.slice(2):l).join('\n').replace(/return async function doAcceptHandshake/,'async function doAcceptHandshake').replace(/consoleUrl/g,'CONSOLE_URL').replace(/\s+$/,'');
// the module has a blank line between Set and return; orig has blank line and function
console.log('module body === original span:', body===orig);
if(body!==orig){const a=body.split('\n'),b=orig.split('\n');for(let i=0;i<Math.max(a.length,b.length);i++){if(a[i]!==b[i]){console.log('first diff line',i,'\n mod :',JSON.stringify(a[i]),'\n orig:',JSON.stringify(b[i]));break;}}}
// 3) count occurrences of doAcceptHandshake in original
console.log('doAcceptHandshake occurrences in original relay.mjs:', (rel.match(/doAcceptHandshake/g)||[]).length);
