import { createRequire } from 'node:module';
const require = createRequire('D:/kanet-tn12/kasia-console/');
export const kaspa = require('kaspa-wasm');
import { computeKttV2TokenArtifact } from 'file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/pool-bshard-artifacts.mjs';
export { computeKttV2TokenArtifact };
import { encodeKttV2TransferZeroOutAction, encodeKttV2TransferDelegatorAction, combineKttV2ActionAndRedeem } from 'file:///D:/kanet-tn12/scratch/_j2_wt_ktt_panel/kasia-console/src/lib/kcc20-token/ktt-v2-transfer-witness.mjs';
export { encodeKttV2TransferZeroOutAction, encodeKttV2TransferDelegatorAction, combineKttV2ActionAndRedeem };

export const RPC_URL = 'ws://127.0.0.1:29817';
export const NETWORK_ID = 'simnet';
export const FUND_PRIV_HEX = '982c3b5bb2ec24adb34191238ffb41645513a3a5c717d6266dadcd489836c04e';
export const FUND_ADDR = 'kaspasim:qzmr4ejrkqawklukvxtww8jj4c3ptqpru7cfxz0dezdfj868tgvy7m30cwm69';

export async function getRpc() {
  const rpc = new kaspa.RpcClient({ url: RPC_URL, encoding: kaspa.Encoding.Borsh, networkId: NETWORK_ID });
  await rpc.connect({});
  return rpc;
}

export function xOnlyPubkeyHex(priv) {
  const addr = priv.toPublicKey().toAddress('mainnet');
  const spk = kaspa.payToAddressScript(addr);
  const scriptBuf = Buffer.from(spk.script, 'hex');
  return scriptBuf.subarray(1, 33).toString('hex');
}

export function kttP2sh(scriptBytes) {
  // same as pool-bshard-artifacts.mjs's _kttP2sh, kept in sync manually (small, stable formula)
  const spk = kaspa.payToScriptHashScript(new Uint8Array(scriptBytes));
  return spk; // ScriptPublicKey object {version, script(hex without version)}
}

export async function pickUtxo(rpc, address, minSompi) {
  const { entries } = await rpc.getUtxosByAddresses({ addresses: [address] });
  for (const e of entries) {
    const amt = BigInt(e.entry?.amount ?? e.amount ?? 0);
    if (amt >= minSompi) return { outpoint: e.outpoint, amount: amt, scriptPublicKey: e.entry?.scriptPublicKey ?? e.scriptPublicKey };
  }
  throw new Error(`pickUtxo: no UTXO >= ${minSompi} at ${address}`);
}

export function mkChange(value, address) {
  const spk = kaspa.payToAddressScript(new kaspa.Address(address));
  return new kaspa.TransactionOutput(value, spk);
}
