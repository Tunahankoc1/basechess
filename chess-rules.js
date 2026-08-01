// Pure chess rules: no DOM, no SDK, no browser APIs. Shared by the browser
// client (game.js) and, in Phase 3, the serverless resolver (api/resolve.js)
// so both sides can never disagree about what counts as a legal move or a
// checkmate.

export const WHITE = 'w';
export const BLACK = 'b';

export const SLIDING = {
  B: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  R: [[-1, 0], [1, 0], [0, -1], [0, 1]],
  Q: [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]],
};
export const KNIGHT_OFFSETS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
export const KING_OFFSETS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

export function initialBoard() {
  return [
    ['bR', 'bN', 'bB', 'bQ', 'bK', 'bB', 'bN', 'bR'],
    ['bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP', 'bP'],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    [null, null, null, null, null, null, null, null],
    ['wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP', 'wP'],
    ['wR', 'wN', 'wB', 'wQ', 'wK', 'wB', 'wN', 'wR'],
  ];
}

export function initialState() {
  return {
    board: initialBoard(),
    turn: WHITE,
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    lastMove: null,
  };
}

export function cloneState(state) {
  return {
    board: state.board.map((row) => row.slice()),
    turn: state.turn,
    castling: { ...state.castling },
    enPassant: state.enPassant ? { ...state.enPassant } : null,
    lastMove: state.lastMove ? { from: { ...state.lastMove.from }, to: { ...state.lastMove.to } } : null,
  };
}

export function inBounds(r, c) {
  return r >= 0 && r < 8 && c >= 0 && c < 8;
}
export function colorOf(piece) {
  return piece ? piece[0] : null;
}
export function typeOf(piece) {
  return piece ? piece[1] : null;
}
export function opposite(side) {
  return side === WHITE ? BLACK : WHITE;
}

export function isSquareAttacked(board, r, c, bySide) {
  if (bySide === WHITE) {
    if (inBounds(r + 1, c - 1) && board[r + 1][c - 1] === 'wP') return true;
    if (inBounds(r + 1, c + 1) && board[r + 1][c + 1] === 'wP') return true;
  } else {
    if (inBounds(r - 1, c - 1) && board[r - 1][c - 1] === 'bP') return true;
    if (inBounds(r - 1, c + 1) && board[r - 1][c + 1] === 'bP') return true;
  }
  for (const [dr, dc] of KNIGHT_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === bySide + 'N') return true;
  }
  for (const [dr, dc] of KING_OFFSETS) {
    const nr = r + dr, nc = c + dc;
    if (inBounds(nr, nc) && board[nr][nc] === bySide + 'K') return true;
  }
  for (const [dr, dc] of SLIDING.B) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === bySide && (typeOf(p) === 'B' || typeOf(p) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  for (const [dr, dc] of SLIDING.R) {
    let nr = r + dr, nc = c + dc;
    while (inBounds(nr, nc)) {
      const p = board[nr][nc];
      if (p) {
        if (colorOf(p) === bySide && (typeOf(p) === 'R' || typeOf(p) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

export function findKing(board, side) {
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === side + 'K') return { r, c };
    }
  }
  return null;
}

export function isInCheck(state, side) {
  const k = findKing(state.board, side);
  if (!k) return false;
  return isSquareAttacked(state.board, k.r, k.c, opposite(side));
}

export function addPawnMove(moves, r, c, nr, nc, lastRow, capturedPiece, onlyQueenPromo) {
  const captured = capturedPiece ? typeOf(capturedPiece) : null;
  if (nr === lastRow) {
    const promos = onlyQueenPromo ? ['Q'] : ['Q', 'R', 'B', 'N'];
    for (const promo of promos) {
      moves.push({ from: { r, c }, to: { r: nr, c: nc }, promotion: promo, captured });
    }
  } else {
    moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured });
  }
}

export function pseudoMovesForSquare(state, r, c, onlyQueenPromo) {
  const board = state.board;
  const piece = board[r][c];
  if (!piece) return [];
  const side = colorOf(piece);
  const type = typeOf(piece);
  const moves = [];

  if (type === 'P') {
    const dir = side === WHITE ? -1 : 1;
    const startRow = side === WHITE ? 6 : 1;
    const lastRow = side === WHITE ? 0 : 7;
    if (inBounds(r + dir, c) && !board[r + dir][c]) {
      addPawnMove(moves, r, c, r + dir, c, lastRow, null, onlyQueenPromo);
      if (r === startRow && !board[r + 2 * dir][c]) {
        moves.push({ from: { r, c }, to: { r: r + 2 * dir, c }, doubleStep: true });
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (target && colorOf(target) !== side) {
        addPawnMove(moves, r, c, nr, nc, lastRow, target, onlyQueenPromo);
      } else if (state.enPassant && state.enPassant.r === nr && state.enPassant.c === nc) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, isEnPassant: true, captured: 'P' });
      }
    }
  } else if (type === 'N') {
    for (const [dr, dc] of KNIGHT_OFFSETS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || colorOf(target) !== side) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: target ? typeOf(target) : null });
      }
    }
  } else if (type === 'K') {
    for (const [dr, dc] of KING_OFFSETS) {
      const nr = r + dr, nc = c + dc;
      if (!inBounds(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || colorOf(target) !== side) {
        moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: target ? typeOf(target) : null });
      }
    }
    const rights = state.castling;
    const homeRow = side === WHITE ? 7 : 0;
    if (r === homeRow && c === 4 && !isSquareAttacked(board, r, c, opposite(side))) {
      const kSideOk = side === WHITE ? rights.wK : rights.bK;
      const qSideOk = side === WHITE ? rights.wQ : rights.bQ;
      if (
        kSideOk && !board[r][5] && !board[r][6] &&
        !isSquareAttacked(board, r, 5, opposite(side)) &&
        !isSquareAttacked(board, r, 6, opposite(side)) &&
        board[r][7] === side + 'R'
      ) {
        moves.push({ from: { r, c }, to: { r, c: 6 }, isCastle: 'king' });
      }
      if (
        qSideOk && !board[r][3] && !board[r][2] && !board[r][1] &&
        !isSquareAttacked(board, r, 3, opposite(side)) &&
        !isSquareAttacked(board, r, 2, opposite(side)) &&
        board[r][0] === side + 'R'
      ) {
        moves.push({ from: { r, c }, to: { r, c: 2 }, isCastle: 'queen' });
      }
    }
  } else {
    const dirs = SLIDING[type];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (!target) {
          moves.push({ from: { r, c }, to: { r: nr, c: nc } });
        } else {
          if (colorOf(target) !== side) moves.push({ from: { r, c }, to: { r: nr, c: nc }, captured: typeOf(target) });
          break;
        }
        nr += dr; nc += dc;
      }
    }
  }
  return moves;
}

export function applyMove(state, move) {
  const next = cloneState(state);
  const board = next.board;
  const { from, to } = move;
  const piece = board[from.r][from.c];
  const side = colorOf(piece);
  const type = typeOf(piece);

  next.enPassant = null;

  if (move.isEnPassant) {
    const capRow = side === WHITE ? to.r + 1 : to.r - 1;
    board[capRow][to.c] = null;
  }

  board[from.r][from.c] = null;
  board[to.r][to.c] = move.promotion ? side + move.promotion : piece;

  if (move.isCastle === 'king') {
    board[from.r][5] = board[from.r][7];
    board[from.r][7] = null;
  } else if (move.isCastle === 'queen') {
    board[from.r][3] = board[from.r][0];
    board[from.r][0] = null;
  }

  if (move.doubleStep) {
    next.enPassant = { r: (from.r + to.r) / 2, c: from.c };
  }

  if (type === 'K') {
    if (side === WHITE) { next.castling.wK = false; next.castling.wQ = false; }
    else { next.castling.bK = false; next.castling.bQ = false; }
  }
  if (type === 'R') {
    if (side === WHITE && from.r === 7 && from.c === 0) next.castling.wQ = false;
    if (side === WHITE && from.r === 7 && from.c === 7) next.castling.wK = false;
    if (side === BLACK && from.r === 0 && from.c === 0) next.castling.bQ = false;
    if (side === BLACK && from.r === 0 && from.c === 7) next.castling.bK = false;
  }
  if (to.r === 7 && to.c === 0) next.castling.wQ = false;
  if (to.r === 7 && to.c === 7) next.castling.wK = false;
  if (to.r === 0 && to.c === 0) next.castling.bQ = false;
  if (to.r === 0 && to.c === 7) next.castling.bK = false;

  next.turn = opposite(side);
  next.lastMove = { from, to };
  return next;
}

export function generateLegalMoves(state, onlyQueenPromo) {
  const side = state.turn;
  const board = state.board;
  let all = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece && colorOf(piece) === side) {
        all = all.concat(pseudoMovesForSquare(state, r, c, onlyQueenPromo));
      }
    }
  }
  const legal = [];
  for (const m of all) {
    const next = applyMove(state, m);
    if (!isInCheck(next, side)) legal.push(m);
  }
  return legal;
}
