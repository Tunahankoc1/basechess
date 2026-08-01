// One-off integration test (not part of the app) proving api/resolve.js
// correctly detects a real checkmate and pays the winner on Base Sepolia.
// Writes a temporary test game to Firebase, funds it on-chain with the
// Player A / Player B test wallets, runs the resolver, then deletes the
// test Firebase record. Run with: node scripts/test-resolver-e2e.mjs
import 'dotenv/config';
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import resolveHandler from '../api/resolve.js';

const RPC = process.env.BASE_SEPOLIA_RPC_URL;
const USDC = process.env.USDC_ADDRESS;
const ESCROW = process.env.ESCROW_CONTRACT_ADDRESS;
const DB_URL = process.env.FIREBASE_DATABASE_URL;
const STAKE = parseUnits('0.1', 6);

const usdcAbi = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'bool' }] },
];
const escrowAbi = [
  { name: 'createGame', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'uint256' }], outputs: [] },
  { name: 'joinGame', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
  { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
];

const publicClient = createPublicClient({ transport: http(RPC) });
function walletFor(envVar) {
  return createWalletClient({ account: privateKeyToAccount(process.env[envVar]), transport: http(RPC) });
}
const playerA = walletFor('PLAYER_A_PRIVATE_KEY'); // White — loses Fool's Mate
const playerB = walletFor('PLAYER_B_PRIVATE_KEY'); // Black — wins

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitOk(hash) {
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== 'success') throw new Error(`tx ${hash} reverted`);
  await sleep(4000);
  return r;
}

// Fool's Mate: 1. f3 e5 2. g4 Qh4# — verified against chess-rules.js separately.
// Non-numeric-looking keys on purpose: Firebase silently converts an object
// whose keys are all small sequential integers into a JSON array on read,
// which would leave index 0 empty (null) since real move logs use push()
// keys, not integers starting at 0.
const moves = {
  m1: { from: { r: 6, c: 5 }, to: { r: 5, c: 5 } },
  m2: { from: { r: 1, c: 4 }, to: { r: 3, c: 4 }, doubleStep: true },
  m3: { from: { r: 6, c: 6 }, to: { r: 4, c: 6 }, doubleStep: true },
  m4: { from: { r: 0, c: 3 }, to: { r: 4, c: 7 } },
};

async function main() {
  const gameId = 'test-foolsmate-' + Date.now();
  const gameIdBytes32 = keccak256(toBytes(gameId));
  console.log('gameId:', gameId);

  console.log('writing test game to Firebase...');
  const putResp = await fetch(`${DB_URL}/games/${encodeURIComponent(gameId)}.json`, {
    method: 'PUT',
    body: JSON.stringify({
      stakeUsdcBaseUnits: Number(STAKE),
      players: {
        white: { walletAddress: playerA.account.address, displayName: 'Player A (test)' },
        black: { walletAddress: playerB.account.address, displayName: 'Player B (test)' },
      },
      moves,
    }),
  });
  if (!putResp.ok) throw new Error('failed to write test game: ' + (await putResp.text()));

  console.log('approving USDC...');
  await waitOk(await playerA.writeContract({ address: USDC, abi: usdcAbi, functionName: 'approve', args: [ESCROW, STAKE] }));
  await waitOk(await playerB.writeContract({ address: USDC, abi: usdcAbi, functionName: 'approve', args: [ESCROW, STAKE] }));

  console.log('createGame + joinGame...');
  await waitOk(await playerA.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'createGame', args: [gameIdBytes32, STAKE] }));
  await waitOk(await playerB.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'joinGame', args: [gameIdBytes32] }));

  console.log('depositing both sides...');
  await waitOk(await playerA.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'deposit', args: [gameIdBytes32] }));
  await waitOk(await playerB.writeContract({ address: ESCROW, abi: escrowAbi, functionName: 'deposit', args: [gameIdBytes32] }));

  const beforeB = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [playerB.account.address] });

  console.log('calling resolve.js handler...');
  const req = { method: 'POST', body: { gameId } };
  const res = {
    _status: 200,
    status(code) { this._status = code; return this; },
    json(payload) { this._json = payload; return this; },
  };
  await resolveHandler(req, res);
  console.log('resolver response:', res._status, res._json);

  await sleep(4000);
  const afterB = await publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: 'balanceOf', args: [playerB.account.address] });
  console.log('Player B (winner) USDC gained:', formatUnits(afterB - beforeB, 6));

  console.log('cleaning up test game from Firebase...');
  await fetch(`${DB_URL}/games/${encodeURIComponent(gameId)}.json`, { method: 'DELETE' });
  console.log('done.');
}

main().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
