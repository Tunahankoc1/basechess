import { sdk } from 'https://esm.sh/@farcaster/frame-sdk';
import {
  WHITE,
  BLACK,
  colorOf,
  findKing,
  initialState,
  applyMove,
  generateLegalMoves,
  isInCheck,
  typeOf,
} from './chess-rules.js';

const AI_DEPTH = 2;
const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
const PIECE_UNICODE = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

// ---------- practice-mode AI (minimax + alpha-beta, queen-promotion only) ----------

function evaluate(state) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p) continue;
      const val = VALUES[typeOf(p)];
      score += colorOf(p) === WHITE ? val : -val;
    }
  }
  return score;
}

function minimax(state, depth, alpha, beta) {
  const legal = generateLegalMoves(state, true);
  if (legal.length === 0) {
    if (isInCheck(state, state.turn)) {
      return state.turn === WHITE ? -100000 - depth : 100000 + depth;
    }
    return 0;
  }
  if (depth === 0) return evaluate(state);

  if (state.turn === WHITE) {
    let best = -Infinity;
    for (const m of legal) {
      const score = minimax(applyMove(state, m), depth - 1, alpha, beta);
      if (score > best) best = score;
      if (best > alpha) alpha = best;
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const m of legal) {
    const score = minimax(applyMove(state, m), depth - 1, alpha, beta);
    if (score < best) best = score;
    if (best < beta) beta = best;
    if (beta <= alpha) break;
  }
  return best;
}

function findBestMoveForAI(state) {
  const legal = generateLegalMoves(state, true);
  if (legal.length === 0) return null;
  const moves = legal.slice().sort(() => Math.random() - 0.5);
  let bestMove = moves[0];
  let bestScore = Infinity;
  let alpha = -Infinity, beta = Infinity;
  for (const m of moves) {
    const score = minimax(applyMove(state, m), AI_DEPTH - 1, alpha, beta);
    if (score < bestScore) {
      bestScore = score;
      bestMove = m;
    }
    if (bestScore < beta) beta = bestScore;
  }
  return bestMove;
}

// ---------- shared board rendering (used by both practice and online modes) ----------

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');

function renderBoard(state, { selected, legalTargets, onSquareClick, flip }) {
  boardEl.innerHTML = '';
  const checkedSide = isInCheck(state, state.turn) ? state.turn : null;
  const kingInCheckPos = checkedSide ? findKing(state.board, checkedSide) : null;

  for (let i = 0; i < 64; i++) {
    const r = flip ? 7 - Math.floor(i / 8) : Math.floor(i / 8);
    const c = flip ? 7 - (i % 8) : i % 8;

    const sq = document.createElement('div');
    sq.className = 'square ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
    sq.dataset.r = String(r);
    sq.dataset.c = String(c);

    const piece = state.board[r][c];
    if (piece) {
      sq.textContent = PIECE_UNICODE[piece];
      sq.classList.add(colorOf(piece) === WHITE ? 'white-piece' : 'black-piece');
    }
    if (selected && selected.r === r && selected.c === c) sq.classList.add('selected');
    if (legalTargets.some((m) => m.to.r === r && m.to.c === c)) {
      sq.classList.add(piece ? 'capture-target' : 'move-target');
    }
    if (
      state.lastMove &&
      ((state.lastMove.from.r === r && state.lastMove.from.c === c) ||
        (state.lastMove.to.r === r && state.lastMove.to.c === c))
    ) {
      sq.classList.add('last-move');
    }
    if (kingInCheckPos && kingInCheckPos.r === r && kingInCheckPos.c === c) {
      sq.classList.add('in-check');
    }
    if (onSquareClick) sq.addEventListener('click', () => onSquareClick(r, c));
    boardEl.appendChild(sq);
  }
}

function updateStatus(text) {
  statusEl.textContent = text;
}

// ---------- screen navigation ----------

const screens = {
  modeSelect: document.getElementById('modeSelectScreen'),
  stake: document.getElementById('stakeScreen'),
  matchmaking: document.getElementById('matchmakingScreen'),
  deposit: document.getElementById('depositScreen'),
  game: document.getElementById('gameScreen'),
};

function showScreen(name) {
  for (const el of Object.values(screens)) el.classList.add('hidden');
  screens[name].classList.remove('hidden');
}

const newGameBtn = document.getElementById('newGameBtn');
const leaveOnlineBtn = document.getElementById('leaveOnlineBtn');
const practiceModeBtn = document.getElementById('practiceModeBtn');
const onlineModeBtn = document.getElementById('onlineModeBtn');
const backFromStakeBtn = document.getElementById('backFromStakeBtn');
const findMatchBtn = document.getElementById('findMatchBtn');
const cancelMatchBtn = document.getElementById('cancelMatchBtn');
const stakeInput = document.getElementById('stakeInput');
const matchmakingText = document.getElementById('matchmakingText');
const connectWalletBtn = document.getElementById('connectWalletBtn');
const walletStatusEl = document.getElementById('walletStatus');
const depositStatusEl = document.getElementById('depositStatus');
const myDepositStateEl = document.getElementById('myDepositState');
const opponentDepositStateEl = document.getElementById('opponentDepositState');
const depositBtn = document.getElementById('depositBtn');
const leaveDepositBtn = document.getElementById('leaveDepositBtn');

// ---------- practice mode (human vs built-in AI) ----------

let practiceGame = initialState();
let practiceSelected = null;
let practiceLegalTargets = [];
let practiceGameOver = false;
const humanSide = WHITE;

function renderPractice() {
  renderBoard(practiceGame, {
    selected: practiceSelected,
    legalTargets: practiceLegalTargets,
    onSquareClick: onPracticeSquareClick,
  });
}

function onPracticeSquareClick(r, c) {
  if (practiceGameOver || practiceGame.turn !== humanSide) return;
  const piece = practiceGame.board[r][c];

  if (practiceSelected) {
    const move = practiceLegalTargets.find((m) => m.to.r === r && m.to.c === c);
    if (move) {
      performHumanMove(move);
      return;
    }
  }

  if (piece && colorOf(piece) === humanSide) {
    practiceSelected = { r, c };
    practiceLegalTargets = generateLegalMoves(practiceGame, true).filter(
      (m) => m.from.r === r && m.from.c === c,
    );
  } else {
    practiceSelected = null;
    practiceLegalTargets = [];
  }
  renderPractice();
}

function performHumanMove(move) {
  practiceGame = applyMove(practiceGame, move);
  practiceSelected = null;
  practiceLegalTargets = [];
  renderPractice();
  if (!checkPracticeGameEnd()) {
    updateStatus('Bilgisayar düşünüyor...');
    setTimeout(aiMove, 300);
  }
}

function aiMove() {
  const move = findBestMoveForAI(practiceGame);
  if (!move) {
    checkPracticeGameEnd();
    return;
  }
  practiceGame = applyMove(practiceGame, move);
  renderPractice();
  checkPracticeGameEnd();
}

function checkPracticeGameEnd() {
  const legal = generateLegalMoves(practiceGame, true);
  if (legal.length === 0) {
    practiceGameOver = true;
    if (isInCheck(practiceGame, practiceGame.turn)) {
      updateStatus(practiceGame.turn === humanSide ? 'Şah mat! Kaybettin.' : 'Şah mat! Kazandın! 🎉');
    } else {
      updateStatus('Pat! Berabere.');
    }
    return true;
  }
  if (isInCheck(practiceGame, practiceGame.turn)) {
    updateStatus(practiceGame.turn === humanSide ? 'Şah! Sıra sende.' : 'Şah çekildi, bilgisayar düşünüyor...');
  } else {
    updateStatus(practiceGame.turn === humanSide ? 'Sıra sende' : 'Bilgisayar düşünüyor...');
  }
  return false;
}

function startPracticeGame() {
  practiceGame = initialState();
  practiceSelected = null;
  practiceLegalTargets = [];
  practiceGameOver = false;
  newGameBtn.classList.remove('hidden');
  leaveOnlineBtn.classList.add('hidden');
  showScreen('game');
  updateStatus('Sıra sende (Beyaz)');
  renderPractice();
}

practiceModeBtn.addEventListener('click', startPracticeGame);
newGameBtn.addEventListener('click', startPracticeGame);

// ---------- online mode (Firebase-synced 2-player + Base Sepolia USDC escrow) ----------

let cancelMatchmaking = null;
let unsubscribeGame = null;
let onlineGameId = null;
let onlinePlayerId = null;
let onlineSelected = null;
let onlineLegalTargets = [];
let myWalletAddress = null;
let depositInProgress = false;
let resolveTriggered = false;

function stopOnlineListeners() {
  if (cancelMatchmaking) { cancelMatchmaking(); cancelMatchmaking = null; }
  if (unsubscribeGame) { unsubscribeGame(); unsubscribeGame = null; }
}

function shortAddress(addr) {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

onlineModeBtn.addEventListener('click', () => {
  showScreen('stake');
});

backFromStakeBtn.addEventListener('click', () => {
  showScreen('modeSelect');
});

connectWalletBtn.addEventListener('click', async () => {
  connectWalletBtn.disabled = true;
  try {
    const wallet = await import('./wallet.js');
    myWalletAddress = await wallet.connectWallet();
    walletStatusEl.textContent = 'Bağlandı: ' + shortAddress(myWalletAddress);
    walletStatusEl.classList.add('connected');
    findMatchBtn.disabled = false;
  } catch (err) {
    walletStatusEl.textContent = 'Cüzdan bağlanamadı: ' + (err.message || 'bilinmeyen hata');
  } finally {
    connectWalletBtn.disabled = false;
  }
});

findMatchBtn.addEventListener('click', async () => {
  const amount = Number(stakeInput.value || '1');
  if (!amount || amount < 0.5) {
    stakeInput.focus();
    return;
  }
  if (!myWalletAddress) return;

  const { findMatch } = await import('./multiplayer.js');
  matchmakingText.textContent = 'Aynı miktarı seçen bir rakip aranıyor...';
  showScreen('matchmaking');

  cancelMatchmaking = findMatch(amount, myWalletAddress, {
    onWaiting: (count) => {
      matchmakingText.textContent =
        count > 1 ? 'Rakip bulundu, oyun kuruluyor...' : 'Aynı miktarı seçen bir rakip aranıyor...';
    },
    onMatched: async (gameId, playerId) => {
      onlineGameId = gameId;
      onlinePlayerId = playerId;
      cancelMatchmaking = null;
      resolveTriggered = false;
      const { subscribeToGame, markPresence } = await import('./multiplayer.js');
      unsubscribeGame = subscribeToGame(gameId, playerId, {
        onState: (payload) => {
          if (unsubscribeGame && !payload._presenceMarked) {
            markPresence(gameId, payload.myColor);
            payload._presenceMarked = true;
          }
          renderOnlineState(payload);
        },
        onError: () => updateStatus('Bağlantı hatası, tekrar dene.'),
      });
    },
    onError: () => {
      matchmakingText.textContent = 'Bir hata oluştu, tekrar dene.';
    },
  });
});

cancelMatchBtn.addEventListener('click', () => {
  stopOnlineListeners();
  showScreen('stake');
});

leaveOnlineBtn.addEventListener('click', () => {
  stopOnlineListeners();
  onlineGameId = null;
  onlinePlayerId = null;
  showScreen('modeSelect');
});

leaveDepositBtn.addEventListener('click', () => {
  stopOnlineListeners();
  onlineGameId = null;
  onlinePlayerId = null;
  showScreen('modeSelect');
});

let latestOnlineState = null;
let latestOnlineMyColor = null;
let latestOnlineIsMyTurn = false;
let latestGameStatus = null;
let latestGameData = null;

function renderOnlineState({ gameData, state, myColor, isMyTurn }) {
  latestOnlineState = state;
  latestOnlineMyColor = myColor;
  latestOnlineIsMyTurn = isMyTurn;
  latestGameStatus = gameData.status;
  latestGameData = gameData;

  if (gameData.status === 'waiting_deposits') {
    renderDepositScreen(gameData, myColor);
    return;
  }

  newGameBtn.classList.add('hidden');
  leaveOnlineBtn.classList.remove('hidden');
  showScreen('game');

  onlineSelected = null;
  onlineLegalTargets = [];

  renderBoard(state, {
    selected: onlineSelected,
    legalTargets: onlineLegalTargets,
    onSquareClick: gameData.status === 'active' ? onOnlineSquareClick : null,
    flip: myColor === BLACK,
  });

  if (gameData.status === 'finished' && gameData.result) {
    const { outcome, winner } = gameData.result;
    if (outcome === 'stalemate') {
      updateStatus('Pat! Berabere.');
    } else {
      const iWon = (winner === 'white' && myColor === WHITE) || (winner === 'black' && myColor === BLACK);
      updateStatus(iWon ? 'Şah mat! Kazandın! 🎉' : 'Şah mat! Kaybettin.');
    }
    triggerResolveOnce();
    return;
  }

  const inCheck = isInCheck(state, state.turn);
  if (isMyTurn) {
    updateStatus(inCheck ? 'Şah! Sıra sende.' : 'Sıra sende');
  } else {
    updateStatus(inCheck ? 'Rakibe şah çekildi, bekleniyor...' : 'Rakip düşünüyor...');
  }
}

function renderDepositScreen(gameData, myColor) {
  showScreen('deposit');
  const mine = myColor === WHITE ? gameData.deposits?.white : gameData.deposits?.black;
  const theirs = myColor === WHITE ? gameData.deposits?.black : gameData.deposits?.white;

  myDepositStateEl.textContent = 'Sen: ' + (mine?.deposited ? 'yatırıldı ✓' : 'bekleniyor');
  myDepositStateEl.classList.toggle('ready', !!mine?.deposited);
  opponentDepositStateEl.textContent = 'Rakip: ' + (theirs?.deposited ? 'yatırıldı ✓' : 'bekleniyor');
  opponentDepositStateEl.classList.toggle('ready', !!theirs?.deposited);

  if (mine?.deposited) {
    depositBtn.disabled = true;
    depositBtn.textContent = 'Yatırıldı';
    depositStatusEl.textContent = 'Rakibin yatırması bekleniyor...';
  } else if (!depositInProgress) {
    depositBtn.disabled = false;
    depositBtn.textContent = 'Yatır';
    depositStatusEl.textContent = (gameData.stakeUsdcBaseUnits / 1_000_000) + ' USDC yatıracaksın';
  }
}

function setDepositStatus(text) {
  depositStatusEl.textContent = text;
}

depositBtn.addEventListener('click', async () => {
  if (depositInProgress || !latestGameData || !onlineGameId) return;
  depositInProgress = true;
  depositBtn.disabled = true;

  try {
    const wallet = await import('./wallet.js');
    const { markDeposited } = await import('./multiplayer.js');
    const gameIdBytes32 = wallet.toGameIdBytes32(onlineGameId);
    const amount = BigInt(latestGameData.stakeUsdcBaseUnits);

    if (latestOnlineMyColor === WHITE) {
      setDepositStatus('Oyun zincire kaydediliyor...');
      const onChain = await wallet.readGameOnChain(gameIdBytes32).catch(() => null);
      if (!onChain || onChain.status === 0) {
        await wallet.createGameOnChain(gameIdBytes32, amount);
      }
    } else {
      setDepositStatus('Rakibin oyunu kurması bekleniyor...');
      await waitForOnChainGameCreated(wallet, gameIdBytes32);
      setDepositStatus('Oyuna katılınıyor...');
      const onChain = await wallet.readGameOnChain(gameIdBytes32);
      const ZERO = '0x0000000000000000000000000000000000000000';
      if (onChain.playerB === ZERO) {
        await wallet.joinGameOnChain(gameIdBytes32);
      }
    }

    setDepositStatus('USDC harcama izni isteniyor...');
    const allowance = await wallet.getUsdcAllowance(myWalletAddress);
    if (allowance < amount) {
      await wallet.approveUsdc(amount);
    }

    setDepositStatus('Yatırılıyor...');
    const txHash = await wallet.depositOnChain(gameIdBytes32);

    await markDeposited(onlineGameId, latestOnlineMyColor === WHITE ? 'white' : 'black', txHash);
    setDepositStatus('Yatırıldı! Rakip bekleniyor...');
  } catch (err) {
    setDepositStatus('Hata: ' + (err.message || 'işlem başarısız'));
    depositBtn.disabled = false;
  } finally {
    depositInProgress = false;
  }
});

async function waitForOnChainGameCreated(wallet, gameIdBytes32, attempts = 60) {
  const ZERO = '0x0000000000000000000000000000000000000000';
  for (let i = 0; i < attempts; i++) {
    const g = await wallet.readGameOnChain(gameIdBytes32).catch(() => null);
    if (g && g.playerA !== ZERO) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Zaman aşımı: rakip oyunu zincirde kurmadı');
}

async function triggerResolveOnce() {
  if (resolveTriggered || !onlineGameId) return;
  resolveTriggered = true;
  try {
    await fetch('/api/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: onlineGameId }),
    });
  } catch (err) {
    // resolver call is best-effort from the client; the game result and
    // on-chain funds are independently verifiable regardless of this request
  }
}

async function onOnlineSquareClick(r, c) {
  if (!latestOnlineIsMyTurn || latestGameStatus !== 'active') return;
  const piece = latestOnlineState.board[r][c];

  if (onlineSelected) {
    const move = onlineLegalTargets.find((m) => m.to.r === r && m.to.c === c);
    if (move) {
      const { submitMove } = await import('./multiplayer.js');
      onlineSelected = null;
      onlineLegalTargets = [];
      await submitMove(onlineGameId, move, latestOnlineState);
      return;
    }
  }

  if (piece && colorOf(piece) === latestOnlineMyColor) {
    onlineSelected = { r, c };
    onlineLegalTargets = generateLegalMoves(latestOnlineState, true).filter(
      (m) => m.from.r === r && m.from.c === c,
    );
  } else {
    onlineSelected = null;
    onlineLegalTargets = [];
  }

  renderBoard(latestOnlineState, {
    selected: onlineSelected,
    legalTargets: onlineLegalTargets,
    onSquareClick: onOnlineSquareClick,
    flip: latestOnlineMyColor === BLACK,
  });
}

showScreen('modeSelect');
sdk.actions.ready();
