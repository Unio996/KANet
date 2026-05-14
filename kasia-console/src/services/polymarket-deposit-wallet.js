// Phase 3g Sub 9.14 — Polymarket V2 deposit wallet (POLY_1271 mode) integration.
//
// Why: V2 cutover 4/28 后 fresh EOA-import wallets (e.g. Bettor 0xb23d45c2) 在 Polymarket
// backend 不在 "allowed maker" 列表 — SDK direct EOA POST 必 reject "maker address not allowed,
// please use the deposit wallet flow". 必须走 deposit wallet (factory deploys per-EOA minimal proxy
// implementing EIP-1271) + signatureType=POLY_1271 (=3) + funder=deposit wallet.
//
// Sophie 5/12 V1 era trade 跑通是 V1 grandfathered (无 deposit wallet on chain — predict NOT deployed),
// 该 Bettor 路径不 break Sophie default EOA mode (per-wallet opt-in via agent_wallets.polymarket_funder_address).
//
// Architecture:
//   1. deployDepositWallet(privKey) — factory.deploy([EOA], [bytes32(uint160(EOA))]). Idempotent
//      via predictWalletAddress + getCode pre-check.
//   2. transferPusdToDepositWallet(privKey, depositWallet, amount) — std ERC20.transfer EOA→DW.
//   3. setupDepositWalletAllowances(privKey, depositWallet) — DW.execute(Batch, sig) where
//      Batch.Call[] = [pUSD.approve V2×3, CTF.setApprovalForAll V2×3]. EIP-712 signed by EOA.
//
// References:
//   - DepositWalletFactory  0x00000000000Fb5C9ADea0298D729A0CB3823Cc07
//   - Current implementation 0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB (minimal proxy template)
//   - id = bytes32(uint160(EOA))  // canonical per recent factory deploy events
//   - DepositWallet impl ABI: execute(Batch, bytes), isValidSignature(bytes32, bytes), initialize(address)

import { ethers } from 'ethers';

const POLYGON_RPC = 'https://polygon.drpc.org';
const FACTORY = '0x00000000000Fb5C9ADea0298D729A0CB3823Cc07';
const PUSD_TOKEN = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';  // canonical Polymarket V2 pUSD (matches polymarket.js)
const CTF_CONTRACT = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// EIP-712 domain — verified via chain query on deployed wallet (0x122D2d... eip712Domain()):
//   name="DepositWallet", version="1", chainId=137, verifyingContract=<the DW address>
const EIP712_DOMAIN_NAME = 'DepositWallet';
const EIP712_DOMAIN_VERSION = '1';

// V2 spenders (must match polymarket.js POLYMARKET_PUSD_SPENDERS)
const V2_SPENDERS = [
  { name: 'CTF Exchange V2',         address: '0xE111180000d2663C0091e4f400237545B87B996B' },
  { name: 'Neg Risk CTF Exchange V2', address: '0xe2222d279d744050d28e00520010520000310F59' },
  { name: 'Neg Risk Adapter (pUSD)',  address: '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296' },
];

const FACTORY_ABI = [
  'function deploy(address[] _owners, bytes32[] _ids) external',
  'function predictWalletAddress(address _implementation, bytes32 _id) external view returns (address)',
  'function implementation() external view returns (address)',
];

const DEPOSIT_WALLET_ABI = [
  // Batch struct ABI
  'function execute(tuple(address wallet, uint256 nonce, uint256 deadline, tuple(address target, uint256 value, bytes data)[] calls) _batch, bytes _signature) external',
  'function isValidSignature(bytes32 _hash, bytes _signature) external view returns (bytes4)',
  'function nonce() external view returns (uint256)',
  'function owner() external view returns (address)',
];

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const CTF_ABI = [
  'function setApprovalForAll(address operator, bool approved)',
];

// Canonical _id per recent Polymarket factory deploy events: bytes32(uint160(EOA)) = zeroPad(EOA, 32)
export function deriveDepositWalletId(eoaAddress) {
  return ethers.zeroPadValue(eoaAddress.toLowerCase(), 32);
}

// Predict deposit wallet address before deploy.
export async function predictDepositWallet(eoaAddress, providerOpt) {
  const provider = providerOpt || new ethers.JsonRpcProvider(POLYGON_RPC);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, provider);
  const impl = await factory.implementation();
  const id = deriveDepositWalletId(eoaAddress);
  const predicted = await factory.predictWalletAddress(impl, id);
  if (!providerOpt) provider.destroy?.();
  return { depositWallet: predicted, implementation: impl, id };
}

// Deploy deposit wallet for EOA. Idempotent (pre-check via code length).
export async function deployDepositWallet(privateKey) {
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const { depositWallet, implementation, id } = await predictDepositWallet(wallet.address, provider);

    // Idempotency check
    const code = await provider.getCode(depositWallet);
    if (code !== '0x') {
      return { ok: true, depositWallet, implementation, alreadyDeployed: true };
    }

    // Deploy
    const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);
    const tx = await factory.deploy([wallet.address], [id]);
    console.log(`[deposit-wallet] deploy TX: ${tx.hash} (EOA=${wallet.address} → DW=${depositWallet})`);
    const receipt = await tx.wait();

    const codeAfter = await provider.getCode(depositWallet);
    if (codeAfter === '0x') {
      return { ok: false, error: `deploy TX confirmed but no code at ${depositWallet}` };
    }
    return { ok: true, depositWallet, implementation, txHash: tx.hash, gasUsed: receipt.gasUsed.toString() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    provider.destroy?.();
  }
}

// Transfer pUSD from EOA to deposit wallet (standard ERC20.transfer).
export async function transferPusdToDepositWallet(privateKey, depositWallet, amount, pusdTokenAddr) {
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const pusd = new ethers.Contract(pusdTokenAddr || PUSD_TOKEN, ERC20_ABI, wallet);
    const eoaBalance = await pusd.balanceOf(wallet.address);
    const transferAmount = amount > 0n && amount < eoaBalance ? amount : eoaBalance;
    if (transferAmount <= 0n) {
      return { ok: false, error: `no pUSD to transfer (EOA balance ${eoaBalance})` };
    }
    const tx = await pusd.transfer(depositWallet, transferAmount);
    console.log(`[deposit-wallet] pUSD transfer TX: ${tx.hash} (${transferAmount} units EOA→DW)`);
    await tx.wait();
    return { ok: true, txHash: tx.hash, amount: transferAmount.toString() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    provider.destroy?.();
  }
}

// Setup deposit-wallet allowances via execute(Batch, signature).
// Batch contains 6 Calls: 3× pUSD.approve(V2 spender) + 3× CTF.setApprovalForAll(V2 spender).
// EIP-712 signed by EOA (deposit wallet's owner per initialize()).
export async function setupDepositWalletAllowances(privateKey, depositWalletAddr, pusdTokenAddr) {
  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const dw = new ethers.Contract(depositWalletAddr, DEPOSIT_WALLET_ABI, wallet);
    const dwOwner = await dw.owner();
    if (dwOwner.toLowerCase() !== wallet.address.toLowerCase()) {
      return { ok: false, error: `deposit wallet owner mismatch: dw.owner=${dwOwner} vs signer=${wallet.address}` };
    }
    const nonce = await dw.nonce();
    const deadline = Math.floor(Date.now() / 1000) + 3600;  // 1h

    // Build Call[]:
    const pusdIface = new ethers.Interface(ERC20_ABI);
    const ctfIface = new ethers.Interface(CTF_ABI);
    const MAX = ethers.MaxUint256;
    const calls = [];
    for (const s of V2_SPENDERS) {
      calls.push({ target: pusdTokenAddr || PUSD_TOKEN, value: 0n, data: pusdIface.encodeFunctionData('approve', [s.address, MAX]) });
    }
    for (const s of V2_SPENDERS) {
      calls.push({ target: CTF_CONTRACT, value: 0n, data: ctfIface.encodeFunctionData('setApprovalForAll', [s.address, true]) });
    }

    const batch = { wallet: depositWalletAddr, nonce, deadline, calls };

    // EIP-712 domain — verified via on-chain eip712Domain() call (chain truth, not guessed)
    const domain = {
      name: EIP712_DOMAIN_NAME,       // "DepositWallet"
      version: EIP712_DOMAIN_VERSION, // "1"
      chainId: 137,
      verifyingContract: depositWalletAddr,
    };
    const types = {
      Call: [
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      Batch: [
        { name: 'wallet', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'calls', type: 'Call[]' },
      ],
    };

    const signature = await wallet.signTypedData(domain, types, batch);
    const tx = await dw.execute(batch, signature);
    console.log(`[deposit-wallet] execute(Batch[6 calls]) TX: ${tx.hash}`);
    const receipt = await tx.wait();
    return { ok: true, txHash: tx.hash, callCount: calls.length, gasUsed: receipt.gasUsed.toString() };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    provider.destroy?.();
  }
}
