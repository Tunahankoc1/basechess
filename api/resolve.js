// Vercel serverless function: independently verifies a finished game's move
// log against the SAME chess-rules engine the client uses, then — only if
// that replay genuinely ends in checkmate/stalemate — calls resolve()/
// resolveDraw() on ChessEscrow using the resolver's private key. Firebase is
// treated as untrusted input here; this function is the actual source of
// truth for releasing funds, not the client's local "you won" message.
import { createPublicClient, createWalletClient, http, keccak256, toBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { initialState, applyMove, generateLegalMoves, isInCheck, WHITE, BLACK } from '../chess-rules.js';
import { chain } from '../chain-config.js'
const RPC_URL = chain.rpcUrls[0];
const ESCROW_ADDRESS = chain.escrowAddress;
const RESOLVER_PRIVATE_KEY = process.env.RESOLVER_PRIVATE_KEY;
const FIREBASE_DATABASE_URL = process.env.FIREBASE_DATABASE_URL;

const ESCROW_ABI = [
  { name: 'resolve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [] },
  { name: 'resolveDraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32' }], outputs: [] },
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

const GAME_STATUS = { NotCreated: 0, WaitingForOpponent: 1, Funded: 2, Resolved: 3, Refunded: 4, Cancelled: 5 };
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function movesEqual(a, b) {
  return (
    a.from.r === b.from.r &&
    a.from.c === b.from.c &&
    a.to.r === b.to.r &&
    a.to.c === b.to.c &&
    (a.promotion || null) === (b.promotion || null)
  );
}

function replayAndVerify(movesObj) {
  const moves = movesObj
    ? Object.entries(movesObj)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, m]) => m)
    : [];

  let state = initialState();
  for (const move of moves) {
    const legal = generateLegalMoves(state, true);
    const legalMatch = legal.find((m) => movesEqual(m, move));
    if (!legalMatch) {
      throw new Error('illegal move found in move log, refusing to resolve');
    }
    state = applyMove(state, legalMatch);
  }

  const legalNow = generateLegalMoves(state, true);
  if (legalNow.length !== 0) {
    throw new Error('game is not actually over yet');
  }

  const inCheck = isInCheck(state, state.turn);
  const outcome = inCheck ? 'checkmate' : 'stalemate';
  const winnerColor = outcome === 'checkmate' ? (state.turn === WHITE ? BLACK : WHITE) : null;
  return { outcome, winnerColor };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const gameId = req.body?.gameId;
  if (!gameId || typeof gameId !== 'string') {
    res.status(400).json({ error: 'gameId required' });
    return;
  }

  try {
    const gameResp = await fetch(`${FIREBASE_DATABASE_URL}/games/${encodeURIComponent(gameId)}.json`);
    const gameData = await gameResp.json();
    if (!gameData) {
      res.status(404).json({ error: 'game not found' });
      return;
    }

    const { outcome, winnerColor } = replayAndVerify(gameData.moves);
    const gameIdBytes32 = keccak256(toBytes(gameId));

    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    const [playerA, playerB, , , , status] = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'games',
      args: [gameIdBytes32],
    });

    if (status === GAME_STATUS.Resolved || status === GAME_STATUS.Refunded) {
      res.status(200).json({ ok: true, alreadyResolved: true });
      return;
    }
    if (status !== GAME_STATUS.Funded) {
      res.status(409).json({ error: 'on-chain game is not funded, cannot resolve', status });
      return;
    }
    if (playerA === ZERO_ADDRESS || playerB === ZERO_ADDRESS) {
      res.status(409).json({ error: 'on-chain players missing' });
      return;
    }

    const account = privateKeyToAccount(RESOLVER_PRIVATE_KEY);
    const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

    let txHash;
    if (outcome === 'stalemate') {
      txHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'resolveDraw',
        args: [gameIdBytes32],
      });
    } else {
      const winnerAddress =
        winnerColor === WHITE ? gameData.players?.white?.walletAddress : gameData.players?.black?.walletAddress;
      if (!winnerAddress) throw new Error('winner wallet address missing from game record');
      txHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'resolve',
        args: [gameIdBytes32, winnerAddress],
      });
    }

    await publicClient.waitForTransactionReceipt({ hash: txHash });

    await fetch(`${FIREBASE_DATABASE_URL}/games/${encodeURIComponent(gameId)}/result.json`, {
      method: 'PATCH',
      body: JSON.stringify({ resolvedTxHash: txHash }),
    });

    res.status(200).json({ ok: true, outcome, winnerColor, txHash });
  } catch (err) {
    res.status(500).json({ error: err.message || 'resolve failed' });
  }
}
