import fs from 'node:fs';
const hex = (a) => Buffer.from(a).toString('hex');
const c = Object.values(JSON.parse(fs.readFileSync('v100_P9.json', 'utf8')).contracts)[0].compiled;   // T1 代币探针产物 = 代币模板
const { offset, len } = c.state_span; const bc = c.bytecode;
const prefix = hex(bc.slice(0, offset)), suffix = hex(bc.slice(offset + len)), thash = hex(c.template_hash);
const b = (h) => ({ kind: 'bytes', value: [...Buffer.from(h, 'hex')] }), i = (n) => ({ kind: 'int', value: n });
fs.writeFileSync('P13.a.json', JSON.stringify([b(thash), i(0), i(4)]));
fs.writeFileSync('P13.b.json', JSON.stringify([b('9'.repeat(64)), i(7), i(4)]));
fs.writeFileSync('P13.derived.json', JSON.stringify({ token_template_hash: thash, prefix, suffix_len: suffix.length / 2, state_span: c.state_span, bytecode_len: bc.length }, null, 2));
const S = (n) => ({ token_tmpl_hash: '0x' + thash, nonce: n });
const mk = (cov) => ({ utxo_value: 1000, covenant_id: cov, state: S(0) });
const out = (cov) => ({ value: 1000, covenant_id: cov, state: S(1) });
const M = '0x' + 'aa'.repeat(32);
const tokIn = (tail) => ({ utxo_value: 500, signature_script_hex: '00' + tail });     // 代币模板输入: sigScript 尾部 = 代币模板后缀
const bare = { utxo_value: 500, signature_script_hex: '00aabb' };
const wit = (p, s) => ['0x' + p, '0x' + s];
const oneOff = (h) => h.slice(0, -2) + ((parseInt(h.slice(-2), 16) ^ 1).toString(16).padStart(2, '0'));
const ctor = ['0x' + thash, 0, 4];
const T = (name, expect, inputs, args = wit(prefix, suffix)) => ({ name, function: 'attest', constructor_args: ctor, args, expect, tx: { active_input_index: 0, inputs, outputs: [out(M)] } });
const tests = [
  T('p13_no_token_input_true_bytes_pass', 'pass', [mk(M), bare]),
  T('p13_one_token_template_input_fail', 'fail', [mk(M), tokIn(suffix)]),
  T('p13_two_token_template_inputs_fail', 'fail', [mk(M), tokIn(suffix), tokIn(suffix)]),
  T('p13_witness_suffix_one_byte_off_dies_at_blake3_fail', 'fail', [mk(M), bare], wit(prefix, oneOff(suffix))),
  T('p13_witness_prefix_one_byte_off_dies_at_blake3_fail', 'fail', [mk(M), bare], wit(oneOff(prefix), suffix)),
  T('p13_input_tail_one_byte_off_not_a_match_pass', 'pass', [mk(M), tokIn(oneOff(suffix))]),
  T('p13_attacker_bytes_matching_nothing_fail', 'fail', [mk(M), bare], wit('00', '00')),
  T('harness_flip_pass_vector', 'fail', [mk(M), bare]),
];
fs.writeFileSync('P13.test.json', JSON.stringify({ tests }, null, 2));
console.log('token tmpl hash', thash.slice(0, 16), 'prefix', prefix, 'suffix bytes', suffix.length / 2, 'tests', tests.length);
