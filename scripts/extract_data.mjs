/**
 * 資料萃取腳本：從「捻花惹草」與「數獨共享平台 / Sudoku miner」匯出遊戲題庫
 * 執行方式：node scripts/extract_data.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const PLANTS_SOURCE = 'D:/antigravity/plants/js/data.js';
const SUDOKU_SOURCE = 'D:/antigravity/Sudoku miner/puzzles.js';

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 萃取花草形態精簡提示（優先取花朵/孢子或葉片描述前 ~50 字）
 */
function extractHint(plant) {
  const details = Array.isArray(plant.morphologyDetails) ? plant.morphologyDetails : [];
  const preferred =
    details.find((d) => /花|孢子|果/.test(d.label || '')) ||
    details.find((d) => /葉/.test(d.label || '')) ||
    details[0];

  if (!preferred || !preferred.value) {
    return plant.family ? `科別：${plant.family}` : '';
  }

  const clean = String(preferred.value).replace(/\s+/g, ' ').trim();
  return clean.length > 52 ? `${clean.slice(0, 50)}…` : clean;
}

function extractPlants() {
  if (!fs.existsSync(PLANTS_SOURCE)) {
    throw new Error(`找不到花草來源檔：${PLANTS_SOURCE}`);
  }
  const sourceText = fs.readFileSync(PLANTS_SOURCE, 'utf8');
  const match = sourceText.match(/const\s+DEFAULT_PLANT_DATA\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!match) {
    throw new Error('無法自 plants/js/data.js 解析 DEFAULT_PLANT_DATA');
  }

  const rawList = JSON.parse(match[1]);
  const plants = [];
  const seenNames = new Set();

  for (const item of rawList) {
    if (!item || !item.name || !item.imageUrl || !String(item.imageUrl).startsWith('http')) {
      continue;
    }
    const cleanName = String(item.name).trim();
    if (seenNames.has(cleanName)) continue;
    seenNames.add(cleanName);

    plants.push({
      id: item.id || `plant-${plants.length + 1}`,
      name: cleanName,
      englishName: item.englishName || '',
      scientificName: item.scientificName || '',
      family: item.family || '',
      locationNote: item.locationNote || '',
      imageUrl: String(item.imageUrl).trim(),
      aliases: Array.isArray(item.aliases) ? item.aliases.slice(0, 5) : [],
      hint: extractHint(item)
    });
  }

  const outPath = path.join(DATA_DIR, 'plants.json');
  fs.writeFileSync(outPath, JSON.stringify(plants, null, 2), 'utf8');
  return plants;
}

/**
 * 驗證完整數獨盤面（每列、每行、每 3x3 宮皆含 1~9）
 */
function validateSolvedBoard(boardStr) {
  if (typeof boardStr !== 'string' || !/^[1-9]{81}$/.test(boardStr)) {
    return false;
  }
  const grid = boardStr.split('').map(Number);
  const fullMask = 0b1111111110; // bits 1..9

  for (let i = 0; i < 9; i++) {
    let rowMask = 0;
    let colMask = 0;
    let boxMask = 0;
    const br = Math.floor(i / 3) * 3;
    const bc = (i % 3) * 3;

    for (let j = 0; j < 9; j++) {
      rowMask |= 1 << grid[i * 9 + j];
      colMask |= 1 << grid[j * 9 + i];
      const r = br + Math.floor(j / 3);
      const c = bc + (j % 3);
      boxMask |= 1 << grid[r * 9 + c];
    }
    if (rowMask !== fullMask || colMask !== fullMask || boxMask !== fullMask) {
      return false;
    }
  }
  return true;
}

/**
 * 回溯求解數獨（含 MRV 最小候選數啟發式與 80,000 步上限）
 */
function solveSudoku(seedStr, maxSteps = 80000) {
  if (typeof seedStr !== 'string' || !/^[0-9]{81}$/.test(seedStr)) {
    return null;
  }
  const board = seedStr.split('').map(Number);

  function isValid(r, c, num) {
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

  // 先驗證原始 seed 本身有無衝突
  for (let idx = 0; idx < 81; idx++) {
    if (board[idx] !== 0) {
      const val = board[idx];
      board[idx] = 0;
      const ok = isValid(Math.floor(idx / 9), idx % 9, val);
      board[idx] = val;
      if (!ok) return null;
    }
  }

  let steps = 0;

  function pickNextCell() {
    let bestIdx = -1;
    let bestCands = null;
    for (let idx = 0; idx < 81; idx++) {
      if (board[idx] !== 0) continue;
      const r = Math.floor(idx / 9);
      const c = idx % 9;
      const cands = [];
      for (let n = 1; n <= 9; n++) {
        if (isValid(r, c, n)) cands.push(n);
      }
      if (cands.length === 0) return { idx, cands };
      if (!bestCands || cands.length < bestCands.length) {
        bestIdx = idx;
        bestCands = cands;
        if (cands.length === 1) break;
      }
    }
    return bestIdx === -1 ? null : { idx: bestIdx, cands: bestCands };
  }

  function dfs() {
    if (++steps > maxSteps) return false;
    const next = pickNextCell();
    if (!next) return true; // 全部填滿
    if (next.cands.length === 0) return false;

    for (const n of next.cands) {
      board[next.idx] = n;
      if (dfs()) return true;
      board[next.idx] = 0;
    }
    return false;
  }

  if (!dfs()) return null;
  const solved = board.join('');
  return validateSolvedBoard(solved) ? solved : null;
}

function extractSudoku() {
  if (!fs.existsSync(SUDOKU_SOURCE)) {
    throw new Error(`找不到數獨來源檔：${SUDOKU_SOURCE}`);
  }
  const sourceText = fs.readFileSync(SUDOKU_SOURCE, 'utf8');
  const getLib = new Function(`${sourceText}\nreturn PUZZLE_LIBRARY;`);
  const library = getLib();

  if (!Array.isArray(library)) {
    throw new Error('無法自 Sudoku miner/puzzles.js 解析 PUZZLE_LIBRARY');
  }

  const verified = [];
  const seenSolutions = new Set();

  for (const item of library) {
    if (!item || !item.seed) continue;
    const seed = String(item.seed).trim();
    const solution = solveSudoku(seed, 80000);
    if (!solution || seenSolutions.has(solution)) continue;
    seenSolutions.add(solution);

    verified.push({
      id: item.id || `sudoku-${verified.length + 1}`,
      name: item.name || `精選數獨 #${verified.length + 1}`,
      icon: item.icon || '🔢',
      seed,
      solution
    });

    if (verified.length >= 80) break;
  }

  const outPath = path.join(DATA_DIR, 'sudoku.json');
  fs.writeFileSync(outPath, JSON.stringify(verified, null, 2), 'utf8');
  return verified;
}

function main() {
  ensureDir(DATA_DIR);
  const plants = extractPlants();
  const sudokus = extractSudoku();
  console.log(`✅ 萃取完成：`);
  console.log(`   - 花草題庫 (data/plants.json)：${plants.length} 種`);
  console.log(`   - 數獨題庫 (data/sudoku.json)：${sudokus.length} 組已驗證盤面`);
  if (plants.length < 20 || sudokus.length < 20) {
    console.error('❌ 萃取數量過少，請檢查來源檔案格式。');
    process.exit(1);
  }
}

main();
