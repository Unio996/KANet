import { readFileSync } from 'fs';
const buf = readFileSync('D:/kanet-tn12/shared/vendor/kaspa-wasm/kaspa_bg.wasm');
let p = 8; // skip magic+version
function leb() { let r=0, s=0, b; do { b=buf[p++]; r|= (b&0x7f)<<s; s+=7; } while (b&0x80); return r>>>0; }
while (p < buf.length) {
  const id = buf[p++]; const size = leb(); const start = p;
  if (id === 5) { const n = leb(); for (let i=0;i<n;i++){ const flags=leb(); const min=leb(); const max = (flags&1)? leb() : null; console.log(`memory[${i}] flags=${flags} min=${min} pages (${(min*64/1024).toFixed(0)} MB) max=${max===null?'NONE(=4GiB wasm32 cap)':max+' pages ('+(max*64/1024).toFixed(0)+' MB)'} shared=${!!(flags&2)}`);} }
  if (id === 2) { const n = leb(); let q=p; /* imports: look for memory import */ for (let i=0;i<n;i++){ const ml=leb(); p+=ml; const fl=leb(); p+=fl; const kind=buf[p++]; if(kind===0) leb(); else if(kind===1){p++; const f=leb(); leb(); if(f&1) leb();} else if(kind===2){const f=leb(); const mn=leb(); const mx=(f&1)?leb():null; console.log(`IMPORTED memory min=${mn} max=${mx===null?'NONE':mx}`);} else if(kind===3){p++;p++;} } p=q; }
  p = start + size;
}
