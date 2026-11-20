/**
 * 關卡結構與 BFS 可達性驗證腳本
 * 執行方式：node scripts/verify_levels.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEVELS_PATH = path.resolve(__dirname, '../data/levels.json');

const COLS = 20;
const ROWS = 12;
const TILE = { AIR: 0, BRICK: 1, GRANITE: 2, LADDER: 3, ROPE: 4, EXIT_LADDER: 5 };

function isSolid(t) {
  return t === TILE.BRICK || t === TILE.GRANITE;
}

function isLadder(t, exitActive) {
  return t === TILE.LADDER || (exitActive && t === TILE.EXIT_LADDER);
}

/**
 * 計算玩家在網格上的合法相鄰狀態（僅使用移動/攀爬/吊繩/下落，不依賴挖洞也應可達）
 */
function getReachableNodes(grid, startCol, startRow, exitActive) {
  const visited = new Set();
  const queue = [[startCol, startRow]];
  visited.add(`${startCol},${startRow}`);

  const at = (c, r) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? grid[r][c] : TILE.GRANITE);

  while (queue.length > 0) {
    const [c, r] = queue.shift();
    const cur = at(c, r);
    const below = at(c, r + 1);
    const onLadder = isLadder(cur, exitActive);
    const onRope = cur === TILE.ROPE;
    const supported =
      isSolid(below) ||
      isLadder(below, exitActive) ||
      onLadder ||
      onRope;

    const push = (nc, nr) => {
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) return;
      if (isSolid(at(nc, nr))) return;
      const key = `${nc},${nr}`;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push([nc, nr]);
      }
    };

    if (!supported) {
      // 半空中只能垂直下落
      push(c, r + 1);
      continue;
    }

    // 左 / 右移動
    push(c - 1, r);
    push(c + 1, r);

    // 上爬梯子
    if (onLadder) {
      push(c, r - 1);
    }

    // 向下（梯子、空梯頂、放手離開鋼索）
    if (onLadder || isLadder(below, exitActive) || onRope) {
      if (!isSolid(below)) {
        push(c, r + 1);
      }
    }
  }

  return visited;
}

function main() {
  const levels = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8'));
  let allPassed = true;

  for (const lvl of levels) {
    const errors = [];
    const { grid, playerSpawn, ghosts, chests } = lvl;

    if (!Array.isArray(grid) || grid.length !== ROWS) {
      errors.push(`列數錯誤：預期 ${ROWS}，實際 ${grid?.length}`);
    } else {
      for (let r = 0; r < ROWS; r++) {
        if (!Array.isArray(grid[r]) || grid[r].length !== COLS) {
          errors.push(`第 ${r} 列欄數錯誤：實際 ${grid[r]?.length}`);
          continue;
        }
        for (let c = 0; c < COLS; c++) {
          const v = grid[r][c];
          if (!Number.isInteger(v) || v < 0 || v > 5) {
            errors.push(`非法磚塊值 (${c},${r}) = ${v}`);
          }
          if (r === ROWS - 1 && v !== TILE.GRANITE) {
            errors.push(`底層第 ${ROWS - 1} 列 (${c},${r}) 必須為花崗岩 2，實際為 ${v}`);
          }
        }
      }
    }

    // 檢查出生點與寶箱
    const occupied = new Set();
    const checkPos = (label, pos, requireSolidBelow) => {
      if (!pos || pos.col < 0 || pos.col >= COLS || pos.row < 0 || pos.row >= ROWS - 1) {
        errors.push(`${label} 座標超界：${JSON.stringify(pos)}`);
        return;
      }
      const tile = grid[pos.row][pos.col];
      const below = grid[pos.row + 1][pos.col];
      if (tile !== TILE.AIR) {
        errors.push(`${label} (${pos.col},${pos.row}) 必須位於空氣 0，實際為 ${tile}`);
      }
      if (requireSolidBelow ? !isSolid(below) : !(isSolid(below) || below === TILE.LADDER)) {
        errors.push(`${label} (${pos.col},${pos.row}) 下方無支撐，實際為 ${below}`);
      }
      const key = `${pos.col},${pos.row}`;
      if (occupied.has(key)) {
        errors.push(`${label} 與其他實體座標重疊 (${key})`);
      }
      occupied.add(key);
    };

    checkPos('玩家出生點', playerSpawn, false);
    ghosts.forEach((g, idx) => {
      checkPos(`鬼 #${idx + 1}`, g, false);
      const dist = Math.abs(g.col - playerSpawn.col) + Math.abs(g.row - playerSpawn.row);
      if (dist < 5) {
        errors.push(`鬼 #${idx + 1} 與玩家初始距離過近 (${dist} < 5)`);
      }
    });

    const chestTypes = new Set();
    chests.forEach((ch) => {
      chestTypes.add(ch.type);
      checkPos(`寶箱(${ch.type})`, ch, true);
    });
    for (const req of ['plant', 'sudoku', 'medical']) {
      if (!chestTypes.has(req)) errors.push(`缺少寶箱類型：${req}`);
    }

    // 確認隱藏過關梯子至少有一格位於第 0 列
    const exitTopTiles = [];
    for (let c = 0; c < COLS; c++) {
      if (grid[0][c] === TILE.EXIT_LADDER) exitTopTiles.push({ col: c, row: 0 });
    }
    if (exitTopTiles.length === 0) {
      errors.push('第 0 列缺少隱藏過關梯子 (5)');
    }

    // BFS 可達性檢查（未開啟傳送門時可達 3 寶箱；開啟傳送門後可達第 0 列過關梯子）
    if (errors.length === 0) {
      const reachBeforeExit = getReachableNodes(grid, playerSpawn.col, playerSpawn.row, false);
      for (const ch of chests) {
        if (!reachBeforeExit.has(`${ch.col},${ch.row}`)) {
          errors.push(`從玩家出生點無法抵達寶箱 ${ch.type} (${ch.col},${ch.row})`);
        }
      }
      const reachWithExit = getReachableNodes(grid, playerSpawn.col, playerSpawn.row, true);
      const canExit = exitTopTiles.some((t) => reachWithExit.has(`${t.col},${t.row}`));
      if (!canExit) {
        errors.push('隱藏過關梯子顯現後仍無法抵達第 0 列出口');
      }
    }

    if (errors.length > 0) {
      allPassed = false;
      console.error(`❌ 關卡 ${lvl.id}「${lvl.name}」驗證失敗：`);
      errors.forEach((e) => console.error(`   - ${e}`));
    } else {
      console.log(`✅ 關卡 ${lvl.id}「${lvl.name}」驗證通過 (${ghosts.length} 鬼, ${chests.length} 寶箱, BFS 可達)`);
    }
  }

  if (!allPassed) process.exit(1);
}

main();
