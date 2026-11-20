/**
 * Lode Runner 鬼（守衛）網格 BFS 尋路引擎
 * 地圖尺寸 20×12，每次尋路成本低於 0.1ms，可精準規劃爬梯、吊鋼索與下樓包抄路線。
 */

import { COLS, ROWS, TILE } from './config.js';

function isSolidTile(grid, dugHoles, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
  const tile = grid[r][c];
  if (tile === TILE.GRANITE) return true;
  if (tile === TILE.BRICK) {
    return !dugHoles.has(`${c},${r}`);
  }
  return false;
}

function isLadderTile(grid, c, r, exitActive) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  const tile = grid[r][c];
  return tile === TILE.LADDER || (exitActive && tile === TILE.EXIT_LADDER);
}

function isRopeTile(grid, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
  return grid[r][c] === TILE.ROPE;
}

/**
 * 計算從 (fromCol, fromRow) 前往 (targetCol, targetRow) 的最佳第一步方向
 * @returns {{ dc: number, dr: number }}
 */
export function computeNextStep(
  grid,
  dugHoles,
  exitActive,
  trappedGhostCells,
  fromCol,
  fromRow,
  targetCol,
  targetRow
) {
  const sc = Math.max(0, Math.min(COLS - 1, fromCol));
  const sr = Math.max(0, Math.min(ROWS - 1, fromRow));
  const tc = Math.max(0, Math.min(COLS - 1, targetCol));
  const tr = Math.max(0, Math.min(ROWS - 1, targetRow));

  if (sc === tc && sr === tr) {
    return { dc: 0, dr: 0 };
  }

  const total = COLS * ROWS;
  const visited = new Uint8Array(total);
  const firstMove = new Int16Array(total).fill(-1);
  const queue = new Int16Array(total);
  let head = 0;
  let tail = 0;

  const startIdx = sr * COLS + sc;
  const targetIdx = tr * COLS + tc;
  visited[startIdx] = 1;
  queue[tail++] = startIdx;

  let bestFallbackIdx = startIdx;
  let bestFallbackDist = Math.abs(sc - tc) + Math.abs(sr - tr);

  const tryEnqueue = (nc, nr, originIdx) => {
    if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
    if (isSolidTile(grid, dugHoles, nc, nr)) return;
    const nIdx = nr * COLS + nc;
    if (visited[nIdx]) return;

    visited[nIdx] = 1;
    firstMove[nIdx] = originIdx === startIdx ? nIdx : firstMove[originIdx];
    queue[tail++] = nIdx;

    const dist = Math.abs(nc - tc) + Math.abs(nr - tr) * 1.4;
    if (dist < bestFallbackDist) {
      bestFallbackDist = dist;
      bestFallbackIdx = nIdx;
    }
  };

  while (head < tail) {
    const idx = queue[head++];
    if (idx === targetIdx) {
      break;
    }

    const c = idx % COLS;
    const r = Math.floor(idx / COLS);

    const onLadder = isLadderTile(grid, c, r, exitActive);
    const onRope = isRopeTile(grid, c, r);
    const belowSolid = isSolidTile(grid, dugHoles, c, r + 1);
    const belowLadder = isLadderTile(grid, c, r + 1, exitActive);
    const belowTrappedGhost = trappedGhostCells.has(`${c},${r + 1}`);
    const supported = belowSolid || belowLadder || onLadder || onRope || belowTrappedGhost;

    if (!supported) {
      tryEnqueue(c, r + 1, idx);
      continue;
    }

    // 水平移動（注意避免與高處無意義繞遠：先探索水平與攀爬）
    tryEnqueue(c - 1, r, idx);
    tryEnqueue(c + 1, r, idx);

    if (onLadder) {
      tryEnqueue(c, r - 1, idx);
    }

    if (onLadder || belowLadder || onRope) {
      if (!belowSolid) {
        tryEnqueue(c, r + 1, idx);
      }
    }
  }

  const chosenNext = visited[targetIdx] ? firstMove[targetIdx] : firstMove[bestFallbackIdx];
  if (chosenNext < 0) {
    return { dc: 0, dr: 0 };
  }

  const nextC = chosenNext % COLS;
  const nextR = Math.floor(chosenNext / COLS);
  return {
    dc: Math.sign(nextC - sc),
    dr: Math.sign(nextR - sr)
  };
}
