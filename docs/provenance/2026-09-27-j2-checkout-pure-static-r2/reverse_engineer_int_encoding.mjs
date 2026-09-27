process.env.SILVERC_V100_PATH = 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const { compileSilV100 } = await import('file:///D:/kanet-tn12/kasia-console/src/lib/pool-bshard-artifacts.mjs');
const SIL_PATH = 'D:/kanet-tn12/scratch/_j2_commission_impl_research/reverse_engineer_int_encoding.sil';

function compileWith(v) {
  const compiled = compileSilV100(SIL_PATH, [{ kind: 'int', value: v }], 'IntEncodeProbe');
  return Buffer.from(compiled.script);
}

const values = [0, 1, 2, 15, 16, 17, 127, 128, 129, 255, 256, 32767, 32768, 65535, 65536,
  16777215, 16777216, 2147483647, 2147483648, 4294967295, 4294967296,
  -1, -2, -127, -128, -129, -32768, -32769, 1000000000, 999999999999,
  Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 1];

for (const v of values) {
  const script = compileWith(v);
  console.log(v, '->', script.length, 'bytes total, hex:', script.toString('hex'));
}
