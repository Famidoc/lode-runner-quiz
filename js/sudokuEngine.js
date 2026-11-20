/**
 * 數獨殘局生成與即時檢查引擎
 * - 確保挖出的 5～8 個空格皆可透過「唯一候選數（Naked Single）」無猜測推導完成
 * - 同時保證唯一解與 45 秒動作節奏流暢性
 */

function isValidPlacement(board, idx, num) {
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;

  for (let i = 0; i < 9; i++) {
    if (board[r * 9 + i] === num) return false;
    if (board[i * 9 + c] === num) return false;
    const rr = br + Math.floor(i / 3);
    const cc = bc + (i % 3);
    if (board[rr * 9 + cc] === num) return false;
  }
  return true;
}

function getCandidates(board, idx) {
  if (board[idx] !== 0) return [];
  const r = Math.floor(idx / 9);
  const c = idx % 9;
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  const used = new Uint8Array(10);

  for (let i = 0; i < 9; i++) {
    used[board[r * 9 + i]] = 1;
    used[board[i * 9 + c]] = 1;
    const rr = br + Math.floor(i / 3);
    const cc = bc + (i % 3);
    used[board[rr * 9 + cc]] = 1;
  }

  const cands = [];
  for (let n = 1; n <= 9; n++) {
    if (!used[n]) cands.push(n);
  }
  return cands;
}

/**
 * 以確定性的 Naked Single（唯一候選數）迭代推導，回傳是否能完全解開
 * 若每一步皆能靠單一格唯一候選數推導填滿，則該殘局必有唯一解且難度親民
 */
export function solveByNakedSingles(puzzleArr) {
  const b = puzzleArr.slice();
  let progress = true;

  while (progress) {
    progress = false;
    for (let i = 0; i < 81; i++) {
      if (b[i] !== 0) continue;
      const cands = getCandidates(b, i);
      if (cands.length === 0) return false; // 死路
      if (cands.length === 1) {
        b[i] = cands[0];
        progress = true;
      }
    }
  }

  return b.every((n) => n >= 1 && n <= 9);
}

/**
 * 從一個 81 字元已解完的數獨盤面，安全挖出指定數量 (5~8) 的直覺殘局空格
 */
export function createEndgamePuzzle(solvedStr, holeCount = 6) {
  const targetHoles = Math.max(5, Math.min(8, holeCount));
  const solution = String(solvedStr).split('').map(Number);

  if (solution.length !== 81 || solution.some((n) => n < 1 || n > 9)) {
    throw new Error('無效的數獨完整盤面');
  }

  const board = solution.slice();
  const indices = Array.from({ length: 81 }, (_, i) => i);

  // Fisher-Yates 洗牌
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const blankIndices = [];

  for (const idx of indices) {
    if (blankIndices.length >= targetHoles) break;
    const saved = board[idx];
    board[idx] = 0;
    if (solveByNakedSingles(board)) {
      blankIndices.push(idx);
    } else {
      board[idx] = saved;
    }
  }

  // 極端狀況補齊：以行/列/宮只缺一格的補挖確保達到至少 5 格
  if (blankIndices.length < 5) {
    for (const idx of indices) {
      if (blankIndices.length >= 5) break;
      if (board[idx] === 0) continue;
      const saved = board[idx];
      board[idx] = 0;
      if (solveByNakedSingles(board)) {
        blankIndices.push(idx);
      } else {
        board[idx] = saved;
      }
    }
  }

  blankIndices.sort((a, b) => a - b);

  return {
    initialBoard: board,
    solution,
    blankIndices,
    holeCount: blankIndices.length
  };
}

/**
 * 找出目前盤面中所有互相衝突的格位索引 Set
 */
export function findConflicts(boardArr) {
  const conflicts = new Set();

  for (let i = 0; i < 81; i++) {
    const val = boardArr[i];
    if (!val || val === 0) continue;

    const r = Math.floor(i / 9);
    const c = i % 9;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;

    for (let j = 0; j < 9; j++) {
      const rowIdx = r * 9 + j;
      if (rowIdx !== i && boardArr[rowIdx] === val) {
        conflicts.add(i);
        conflicts.add(rowIdx);
      }
      const colIdx = j * 9 + c;
      if (colIdx !== i && boardArr[colIdx] === val) {
        conflicts.add(i);
        conflicts.add(colIdx);
      }
      const boxIdx = (br + Math.floor(j / 3)) * 9 + (bc + (j % 3));
      if (boxIdx !== i && boardArr[boxIdx] === val) {
        conflicts.add(i);
        conflicts.add(boxIdx);
      }
    }
  }

  return conflicts;
}

/**
 * 檢查數獨盤面是否已完全填滿且無任何規則衝突
 */
export function isBoardCompleteAndValid(boardArr) {
  if (!Array.isArray(boardArr) || boardArr.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    if (boardArr[i] < 1 || boardArr[i] > 9) return false;
  }
  return findConflicts(boardArr).size === 0;
}

/**
 * 備用即時完整盤面產生器（若題庫載入異常時作為安全兜底）
 */
export function generateFallbackSolvedBoard() {
  const board = new Array(81).fill(0);

  function solve(idx) {
    if (idx === 81) return true;
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => Math.random() - 0.5);
    for (const n of nums) {
      if (isValidPlacement(board, idx, n)) {
        board[idx] = n;
        if (solve(idx + 1)) return true;
        board[idx] = 0;
      }
    }
    return false;
  }

  solve(0);
  return board.join('');
}
