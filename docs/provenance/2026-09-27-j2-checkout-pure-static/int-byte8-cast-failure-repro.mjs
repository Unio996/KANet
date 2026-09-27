process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const b8 = (n) => { const buf = Buffer.alloc(8); buf.writeBigInt64LE(BigInt(n)); return { kind: 'bytes', value: [...buf] }; };
try {
  const compiled = compileSilV100('D:/kanet-tn12/scratch/_j2_commission_impl_research/isolate2.sil', [b8(1)], 'IsolateTest2');
  console.log('OK, len=', compiled.script.length);
} catch (e) { console.error('FAILED:', e.message); }
