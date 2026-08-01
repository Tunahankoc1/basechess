import { sdk } from 'https://esm.sh/@farcaster/frame-sdk';
import {
  encodeFunctionData,
  decodeFunctionResult,
  keccak256,
  toBytes,
  parseUnits,
} from 'https://esm.sh/viem@2.21.0';

import { chain } from './chain-config.js';

const USDC_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
];

const ESCROW_ABI = [
  {
    name: 'createGame',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'bytes32' }, { type: 'uint256' }],
    outputs: [],
  },
  { name: 'joinGame', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
  {
    name: 'games',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [
      { type: 'address' }, { type: 'address' }, { type: 'uint256' },
      { type: 'bool' }, { type: 'bool' }, { type: 'uint8' },
      { type: 'uint256' }, { type: 'uint256' },
    ],
  },
];

let provider = null;
let account = null;

export function toGameIdBytes32(firebaseGameId) {
  return keccak256(toBytes(firebaseGameId));
}

export function dollarsToUsdcBaseUnits(dollarAmount) {
  return parseUnits(String(dollarAmount), 6);
}

async function getProvider() {
  if (provider) return provider;
  try {
    const inMiniApp = await sdk.isInMiniApp();
    if (inMiniApp) {
      const sdkProvider = await sdk.wallet.getEthereumProvider();
      if (sdkProvider) {
        provider = sdkProvider;
        return provider;
      }
    }
  } catch (err) {
    // not running inside a Farcaster/Base host, fall back to injected provider
  }
  if (window.ethereum) {
    provider = window.ethereum;
  }
  return provider;
}

async function ensureNetwork(p) {
  const chainId = await p.request({ method: 'eth_chainId' });
  if (chainId === chain.chainIdHex) return;
  try {
    await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.chainIdHex }] });
  } catch (switchError) {
    if (switchError && switchError.code === 4902) {
      await p.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: chain.chainIdHex,
          chainName: chain.chainName,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: chain.blockExplorerUrls,
        }],
      });
    } else {
      throw switchError;
    }
  }
}

export async function connectWallet() {
  const p = await getProvider();
  if (!p) throw new Error('Cüzdan bulunamadı');
  const accounts = await p.request({ method: 'eth_requestAccounts' });
  account = accounts[0];
  await ensureNetwork(p);
  return account;
}

export function getConnectedAccount() {
  return account;
}

async function sendTx(to, data) {
  const p = await getProvider();
  const txHash = await p.request({
    method: 'eth_sendTransaction',
    params: [{ from: account, to, data }],
  });
  await waitForReceipt(p, txHash);
  return txHash;
}

async function waitForReceipt(p, txHash, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const receipt = await p.request({ method: 'eth_getTransactionReceipt', params: [txHash] });
    if (receipt) {
      if (receipt.status === '0x0') throw new Error('İşlem başarısız oldu (revert)');
      return receipt;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('İşlem onaylanması zaman aşımına uğradı');
}

async function readContract(address, abi, functionName, args) {
  const p = await getProvider();
  const data = encodeFunctionData({ abi, functionName, args });
  const result = await p.request({ method: 'eth_call', params: [{ to: address, data }, 'latest'] });
  return decodeFunctionResult({ abi, functionName, data: result });
}

export async function getUsdcBalance(address) {
  return readContract(chain.usdcAddress, USDC_ABI, 'balanceOf', [address]);
}

export async function getUsdcAllowance(owner) {
  return readContract(chain.usdcAddress, USDC_ABI, 'allowance', [owner, chain.escrowAddress]);
}

export async function approveUsdc(amountBaseUnits) {
  const data = encodeFunctionData({
    abi: USDC_ABI,
    functionName: 'approve',
    args: [chain.escrowAddress, amountBaseUnits],
  });
  return sendTx(chain.usdcAddress, data);
}

export async function createGameOnChain(gameIdBytes32, amountBaseUnits) {
  const data = encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: 'createGame',
    args: [gameIdBytes32, amountBaseUnits],
  });
  return sendTx(chain.escrowAddress, data);
}

export async function joinGameOnChain(gameIdBytes32) {
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: 'joinGame', args: [gameIdBytes32] });
  return sendTx(chain.escrowAddress, data);
}

export async function depositOnChain(gameIdBytes32) {
  const data = encodeFunctionData({ abi: ESCROW_ABI, functionName: 'deposit', args: [gameIdBytes32] });
  return sendTx(chain.escrowAddress, data);
}

export async function readGameOnChain(gameIdBytes32) {
  const [playerA, playerB, stakeAmount, depositedA, depositedB, status, createdAt, fundedAt] =
    await readContract(chain.escrowAddress, ESCROW_ABI, 'games', [gameIdBytes32]);
  return { playerA, playerB, stakeAmount, depositedA, depositedB, status, createdAt, fundedAt };
}
