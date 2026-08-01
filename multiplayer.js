import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js';
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get,
  onDisconnect,
  off,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js';

import { firebaseConfig } from './firebase-config.js';
import { WHITE, BLACK, initialState, applyMove, generateLegalMoves, isInCheck } from './chess-rules.js';

let app = null;
let db = null;

function getDb() {
  if (!db) {
    app = initializeApp(firebaseConfig);
    db = getDatabase(app);
  }
  return db;
}

export function getPlayerId() {
  let id = localStorage.getItem('baseChessPlayerId');
  if (!id) {
    id = 'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('baseChessPlayerId', id);
  }
  return id;
}

// Stake amounts are partitioned as integer cents so two players who typed
// the same dollar amount land in the exact same queue node.
export function dollarsToStakeKey(dollarAmount) {
  return String(Math.round(Number(dollarAmount) * 100));
}

// Replays the full move log through the shared chess-rules engine so a
// client's board state can never drift from what's actually recorded —
// the same approach the Phase 3 resolver will use server-side.
export function replayMoves(movesObj) {
  let state = initialState();
  const moves = movesObj
    ? Object.entries(movesObj)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, m]) => m)
    : [];
  for (const m of moves) {
    state = applyMove(state, m);
  }
  return state;
}

export function findMatch(stakeAmount, walletAddress, { displayName, onWaiting, onMatched, onError }) {
  const database = getDb();
  const playerId = getPlayerId();
  const stakeKey = dollarsToStakeKey(stakeAmount);
  const stakeUsdcBaseUnits = Math.round(Number(stakeAmount) * 1_000_000);
  const queueRef = ref(database, `queues/${stakeKey}`);
  const myEntryRef = push(queueRef);
  let settled = false;

  set(myEntryRef, {
    playerId,
    walletAddress,
    displayName: displayName || 'Oyuncu',
    joinedAt: serverTimestamp(),
    matchedGameId: null,
  }).catch((err) => onError && onError(err));

  onDisconnect(myEntryRef).remove();

  const queueListener = onValue(queueRef, async (snapshot) => {
    if (settled) return;
    const all = snapshot.val() || {};
    const mine = all[myEntryRef.key];
    if (mine && mine.matchedGameId) {
      settled = true;
      off(queueRef, 'value', queueListener);
      onMatched && onMatched(mine.matchedGameId, playerId);
      return;
    }

    const waiting = Object.entries(all)
      .filter(([, v]) => v && !v.matchedGameId)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    onWaiting && onWaiting(waiting.length);

    if (waiting.length >= 2 && waiting[0][0] === myEntryRef.key) {
      const [[keyA, entryA], [keyB, entryB]] = waiting;
      const gameRef = push(ref(database, 'games'));
      const gameId = gameRef.key;

      try {
        await set(gameRef, {
          stakeKey,
          stakeUsdcBaseUnits,
          status: 'waiting_deposits',
          createdAt: serverTimestamp(),
          players: {
            white: { playerId: entryA.playerId, walletAddress: entryA.walletAddress, displayName: entryA.displayName },
            black: { playerId: entryB.playerId, walletAddress: entryB.walletAddress, displayName: entryB.displayName },
          },
          deposits: {
            white: { deposited: false, txHash: null },
            black: { deposited: false, txHash: null },
          },
          moves: null,
          turn: WHITE,
          result: null,
          presence: {
            white: { online: true },
            black: { online: true },
          },
        });
        await update(ref(database), {
          [`queues/${stakeKey}/${keyA}/matchedGameId`]: gameId,
          [`queues/${stakeKey}/${keyB}/matchedGameId`]: gameId,
        });
      } catch (err) {
        onError && onError(err);
      }
    }
  });

  return function cancel() {
    if (settled) return;
    settled = true;
    off(queueRef, 'value', queueListener);
    remove(myEntryRef).catch(() => {});
  };
}

// Direct 1-on-1 invite by wallet address, for playing a specific friend
// instead of the anonymous stake-matched queue. Creates the game record
// immediately (so the deposit screen works the same way for both paths) and
// leaves a pointer under /invites/{opponent address} for their client to find.
export async function createInvite(stakeAmount, myWalletAddress, displayName, opponentWalletAddress) {
  const database = getDb();
  const playerId = getPlayerId();
  const stakeUsdcBaseUnits = Math.round(Number(stakeAmount) * 1_000_000);
  const gameRef = push(ref(database, 'games'));
  const gameId = gameRef.key;
  const opponentKey = opponentWalletAddress.toLowerCase();

  await set(gameRef, {
    stakeUsdcBaseUnits,
    status: 'waiting_deposits',
    isInvite: true,
    createdAt: serverTimestamp(),
    players: {
      white: { playerId, walletAddress: myWalletAddress, displayName: displayName || 'Oyuncu' },
      black: { playerId: null, walletAddress: opponentWalletAddress, displayName: null },
    },
    deposits: {
      white: { deposited: false, txHash: null },
      black: { deposited: false, txHash: null },
    },
    moves: null,
    turn: WHITE,
    result: null,
    presence: {
      white: { online: true },
      black: { online: false },
    },
  });

  await set(ref(database, `invites/${opponentKey}/${gameId}`), {
    fromWalletAddress: myWalletAddress,
    fromDisplayName: displayName || 'Oyuncu',
    stakeUsdcBaseUnits,
    createdAt: serverTimestamp(),
  });

  return { gameId, playerId };
}

// Watches for invites addressed to my wallet address (case-insensitive key).
export function listenForInvites(myWalletAddress, { onInvites }) {
  const database = getDb();
  const invitesRef = ref(database, `invites/${myWalletAddress.toLowerCase()}`);
  const listener = onValue(invitesRef, (snapshot) => {
    const data = snapshot.val() || {};
    const invites = Object.entries(data).map(([gameId, invite]) => ({ gameId, ...invite }));
    onInvites(invites);
  });
  return function unsubscribe() {
    off(invitesRef, 'value', listener);
  };
}

export async function acceptInvite(gameId, myWalletAddress, displayName) {
  const database = getDb();
  const playerId = getPlayerId();
  await update(ref(database, `games/${gameId}/players/black`), {
    playerId,
    walletAddress: myWalletAddress,
    displayName: displayName || 'Oyuncu',
  });
  await update(ref(database, `games/${gameId}/presence/black`), { online: true });
  await remove(ref(database, `invites/${myWalletAddress.toLowerCase()}/${gameId}`));
  return playerId;
}

export async function declineInvite(gameId, myWalletAddress) {
  const database = getDb();
  await remove(ref(database, `invites/${myWalletAddress.toLowerCase()}/${gameId}`));
  await update(ref(database, `games/${gameId}`), { status: 'declined' });
}

export async function cancelInvite(gameId, opponentWalletAddress) {
  const database = getDb();
  await remove(ref(database, `invites/${opponentWalletAddress.toLowerCase()}/${gameId}`));
  await update(ref(database, `games/${gameId}`), { status: 'declined' });
}

export async function markDeposited(gameId, color, txHash) {
  const database = getDb();
  await update(ref(database, `games/${gameId}/deposits/${color}`), { deposited: true, txHash });

  const snapshot = await get(ref(database, `games/${gameId}/deposits`));
  const both = snapshot.val();
  if (both?.white?.deposited && both?.black?.deposited) {
    await update(ref(database, `games/${gameId}`), { status: 'active' });
  }
}

export function subscribeToGame(gameId, playerId, { onState, onError }) {
  const database = getDb();
  const gameRef = ref(database, `games/${gameId}`);

  const listener = onValue(
    gameRef,
    (snapshot) => {
      const data = snapshot.val();
      if (!data) return;

      const myColor =
        data.players?.white?.playerId === playerId
          ? WHITE
          : data.players?.black?.playerId === playerId
            ? BLACK
            : null;

      const state = replayMoves(data.moves);
      onState &&
        onState({
          gameData: data,
          state,
          myColor,
          isMyTurn: myColor === state.turn,
        });
    },
    (err) => onError && onError(err),
  );

  return function unsubscribe() {
    off(gameRef, 'value', listener);
  };
}

export function markPresence(gameId, myColor) {
  const database = getDb();
  const meRef = ref(database, `games/${gameId}/presence/${myColor === WHITE ? 'white' : 'black'}`);
  set(meRef, { online: true, lastSeenAt: serverTimestamp() });
  onDisconnect(meRef).set({ online: false, lastSeenAt: serverTimestamp() });
}

export async function submitMove(gameId, move, currentState) {
  const database = getDb();
  const movesRef = ref(database, `games/${gameId}/moves`);
  const newMoveRef = push(movesRef);
  const nextState = applyMove(currentState, move);

  await set(newMoveRef, move);
  await update(ref(database, `games/${gameId}`), { turn: nextState.turn });

  const legal = generateLegalMoves(nextState, true);
  if (legal.length === 0) {
    const outcome = isInCheck(nextState, nextState.turn) ? 'checkmate' : 'stalemate';
    const winner = outcome === 'checkmate' ? (nextState.turn === WHITE ? 'black' : 'white') : null;
    await update(ref(database, `games/${gameId}`), {
      status: 'finished',
      result: { outcome, winner },
    });
  }
}

export function leaveGame(gameId) {
  const database = getDb();
  remove(ref(database, `games/${gameId}`)).catch(() => {});
}
