/**
 * 零依賴 ISO/IEC 18004 QR Code 產生器（Byte 模式 / ECC Level M / Version 1–7）
 * 專為離線與深色介面高對比掃碼最佳化，支援 SVG 輸出。
 */

const VERSION_TABLE = [
  null,
  { version: 1, size: 21, dataCodewords: 16, blocks: 1, ecPerBlock: 10, align: [] },
  { version: 2, size: 25, dataCodewords: 28, blocks: 1, ecPerBlock: 16, align: [6, 18] },
  { version: 3, size: 29, dataCodewords: 44, blocks: 1, ecPerBlock: 26, align: [6, 22] },
  { version: 4, size: 33, dataCodewords: 64, blocks: 2, ecPerBlock: 18, align: [6, 26] },
  { version: 5, size: 37, dataCodewords: 86, blocks: 2, ecPerBlock: 24, align: [6, 30] },
  { version: 6, size: 41, dataCodewords: 108, blocks: 4, ecPerBlock: 16, align: [6, 34] },
  { version: 7, size: 45, dataCodewords: 124, blocks: 4, ecPerBlock: 18, align: [6, 22, 38] }
];

// GF(256) 指數/對數表（本原多項式 0x11D）
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function getRsGeneratorPoly(degree) {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function computeRsRemainder(dataBytes, ecLength) {
  const gen = getRsGeneratorPoly(ecLength);
  const msg = new Uint8Array(dataBytes.length + ecLength);
  msg.set(dataBytes, 0);

  for (let i = 0; i < dataBytes.length; i++) {
    const coef = msg[i];
    if (coef === 0) continue;
    for (let j = 0; j < gen.length; j++) {
      msg[i + j] ^= gfMul(gen[j], coef);
    }
  }
  return msg.slice(dataBytes.length);
}

function encodeDataBits(bytes, dataCodewords) {
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte 模式指示碼 0100 + 8-bit 長度
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const maxBits = dataCodewords * 8;
  // 終止符最多 4 個 0
  const terminatorLen = Math.min(4, maxBits - bits.length);
  for (let i = 0; i < terminatorLen; i++) bits.push(0);

  // 補 0 對齊 byte 邊界
  while (bits.length % 8 !== 0) bits.push(0);

  // 交替補齊 0xEC / 0x11
  let padIdx = 0;
  while (bits.length < maxBits) {
    pushBits(padIdx % 2 === 0 ? 0xec : 0x11, 8);
    padIdx++;
  }

  const codewords = new Uint8Array(dataCodewords);
  for (let i = 0; i < dataCodewords; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bits[i * 8 + b];
    }
    codewords[i] = val;
  }
  return codewords;
}

function buildCodewordBits(bytes, spec) {
  const dataCodewords = encodeDataBits(bytes, spec.dataCodewords);
  const blockSize = spec.dataCodewords / spec.blocks;
  const dataBlocks = [];
  const ecBlocks = [];

  for (let b = 0; b < spec.blocks; b++) {
    const slice = dataCodewords.slice(b * blockSize, (b + 1) * blockSize);
    dataBlocks.push(slice);
    ecBlocks.push(computeRsRemainder(slice, spec.ecPerBlock));
  }

  const interleaved = [];
  for (let i = 0; i < blockSize; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      interleaved.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      interleaved.push(ecBlocks[b][i]);
    }
  }

  const bits = [];
  for (const cw of interleaved) {
    for (let bit = 7; bit >= 0; bit--) {
      bits.push((cw >> bit) & 1);
    }
  }
  return bits;
}

function createGrid(size, fill = 0) {
  return Array.from({ length: size }, () => new Uint8Array(size).fill(fill));
}

function placeFinder(modules, isFunction, top, left) {
  const size = modules.length;
  for (let dr = -1; dr <= 7; dr++) {
    for (let dc = -1; dc <= 7; dc++) {
      const r = top + dr;
      const c = left + dc;
      if (r < 0 || r >= size || c < 0 || c >= size) continue;
      const isBorder = dr === -1 || dr === 7 || dc === -1 || dc === 7;
      const isOuter = dr === 0 || dr === 6 || dc === 0 || dc === 6;
      const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
      modules[r][c] = !isBorder && (isOuter || isCenter) ? 1 : 0;
      isFunction[r][c] = 1;
    }
  }
}

function placeAlignment(modules, isFunction, centerR, centerC) {
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const dist = Math.max(Math.abs(dr), Math.abs(dc));
      modules[centerR + dr][centerC + dc] = dist === 2 || dist === 0 ? 1 : 0;
      isFunction[centerR + dr][centerC + dc] = 1;
    }
  }
}

function getFormatWord(mask) {
  // ECC Level M indicator = 0b00
  const data = (0b00 << 3) | (mask & 0b111);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function getVersionWord(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

function writeFormatInfo(modules, isFunction, mask, markReserved = false) {
  const size = modules.length;
  const word = getFormatWord(mask);

  const setCell = (r, c, bit) => {
    modules[r][c] = bit;
    if (markReserved) isFunction[r][c] = 1;
  };

  // 第一份：左上角定位圖樣周圍
  for (let i = 0; i <= 5; i++) setCell(8, i, (word >> (14 - i)) & 1);
  setCell(8, 7, (word >> 8) & 1);
  setCell(8, 8, (word >> 7) & 1);
  setCell(7, 8, (word >> 6) & 1);
  for (let i = 0; i <= 5; i++) setCell(5 - i, 8, (word >> (5 - i)) & 1);

  // 第二份：左下與右上定位圖樣周圍
  for (let i = 0; i < 7; i++) setCell(size - 1 - i, 8, (word >> (14 - i)) & 1);
  for (let i = 0; i < 8; i++) setCell(8, size - 8 + i, (word >> (7 - i)) & 1);
}

function writeVersionInfo(modules, isFunction, version) {
  if (version < 7) return;
  const size = modules.length;
  const word = getVersionWord(version);
  for (let i = 0; i < 18; i++) {
    const bit = (word >> i) & 1;
    const a = Math.floor(i / 3);
    const b = i % 3;
    modules[size - 11 + b][a] = bit;
    isFunction[size - 11 + b][a] = 1;
    modules[a][size - 11 + b] = bit;
    isFunction[a][size - 11 + b] = 1;
  }
}

function isMaskMatch(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function applyMask(baseModules, isFunction, mask) {
  const size = baseModules.length;
  const grid = baseModules.map((row) => row.slice());
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!isFunction[r][c] && isMaskMatch(mask, r, c)) {
        grid[r][c] ^= 1;
      }
    }
  }
  writeFormatInfo(grid, isFunction, mask, false);
  return grid;
}

function evaluatePenalty(grid) {
  const size = grid.length;
  let penalty = 0;

  // Rule 1：同色連續 5 格以上
  for (let r = 0; r < size; r++) {
    let runColor = grid[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = grid[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = grid[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2：2x2 同色方塊
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  // Rule 3：類定位圖樣 1011101 + 4 個 0
  const hasFinderLike = (line) => {
    let hits = 0;
    for (let i = 0; i <= line.length - 11; i++) {
      const p1 =
        line[i] === 1 && line[i + 1] === 0 && line[i + 2] === 1 &&
        line[i + 3] === 1 && line[i + 4] === 1 && line[i + 5] === 0 &&
        line[i + 6] === 1 && line[i + 7] === 0 && line[i + 8] === 0 &&
        line[i + 9] === 0 && line[i + 10] === 0;
      const p2 =
        line[i] === 0 && line[i + 1] === 0 && line[i + 2] === 0 &&
        line[i + 3] === 0 && line[i + 4] === 1 && line[i + 5] === 0 &&
        line[i + 6] === 1 && line[i + 7] === 1 && line[i + 8] === 1 &&
        line[i + 9] === 0 && line[i + 10] === 1;
      if (p1 || p2) hits++;
    }
    return hits;
  };
  const colLine = new Uint8Array(size);
  for (let r = 0; r < size; r++) penalty += hasFinderLike(grid[r]) * 40;
  for (let c = 0; c < size; c++) {
    for (let r = 0; r < size; r++) colLine[r] = grid[r][c];
    penalty += hasFinderLike(colLine) * 40;
  }

  // Rule 4：黑白比例平衡
  let darkCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) darkCount++;
    }
  }
  const percent = (darkCount * 100) / (size * size);
  const prev5 = Math.floor(percent / 5) * 5;
  const next5 = prev5 + 5;
  penalty += Math.min(Math.abs(prev5 - 50) / 5, Math.abs(next5 - 50) / 5) * 10;

  return penalty;
}

/**
 * 產生 QR Code 二維點陣（1 為深色、0 為淺色）
 */
export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''));
  const spec = VERSION_TABLE.find((entry) => entry && bytes.length <= entry.dataCodewords - 2);
  if (!spec) {
    throw new Error(`QR Code 內容過長 (${bytes.length} bytes)，目前最多支援 122 bytes`);
  }

  const { version, size, align } = spec;
  const modules = createGrid(size, 0);
  const isFunction = createGrid(size, 0);

  // 1. 三個定位圖樣與分隔白邊
  placeFinder(modules, isFunction, 0, 0);
  placeFinder(modules, isFunction, 0, size - 7);
  placeFinder(modules, isFunction, size - 7, 0);

  // 2. 校正圖樣（避開與三個定位圖樣重疊者）
  for (const cy of align) {
    for (const cx of align) {
      const overlapsFinder =
        (cy <= 8 && cx <= 8) ||
        (cy <= 8 && cx >= size - 9) ||
        (cy >= size - 9 && cx <= 8);
      if (!overlapsFinder) {
        placeAlignment(modules, isFunction, cy, cx);
      }
    }
  }

  // 3. 時序圖樣
  for (let i = 8; i < size - 8; i++) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (!isFunction[6][i]) {
      modules[6][i] = bit;
      isFunction[6][i] = 1;
    }
    if (!isFunction[i][6]) {
      modules[i][6] = bit;
      isFunction[i][6] = 1;
    }
  }

  // 4. 固定黑點 (Dark Module) 與保留 Format / Version 區域
  modules[size - 8][8] = 1;
  isFunction[size - 8][8] = 1;
  writeFormatInfo(modules, isFunction, 0, true);
  writeVersionInfo(modules, isFunction, version);

  // 5. 填入交錯後的資料與 RS 校驗位元
  const bits = buildCodewordBits(bytes, spec);
  let bitIdx = 0;
  let col = size - 1;
  let upward = true;

  while (col > 0) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!isFunction[row][c]) {
          modules[row][c] = bitIdx < bits.length ? bits[bitIdx++] : 0;
        }
      }
    }
    col -= 2;
    upward = !upward;
  }

  // 6. 挑選罰分最低的 Mask
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestGrid = null;
  for (let m = 0; m < 8; m++) {
    const candidate = applyMask(modules, isFunction, m);
    const score = evaluatePenalty(candidate);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = m;
      bestGrid = candidate;
    }
  }

  return {
    version,
    size,
    mask: bestMask,
    modules: bestGrid.map((row) => Array.from(row))
  };
}

/**
 * 將 QR Code 點陣渲染為精簡高對比 SVG 字串（預設含 4 格白色 Quiet Zone）
 */
export function renderQrSvg(
  text,
  { size = 220, margin = 4, dark = '#0f172a', light = '#ffffff' } = {}
) {
  const qr = generateQrMatrix(text);
  const total = qr.size + margin * 2;
  const pathParts = [];

  for (let r = 0; r < qr.size; r++) {
    let c = 0;
    while (c < qr.size) {
      if (qr.modules[r][c] === 1) {
        const start = c;
        while (c < qr.size && qr.modules[r][c] === 1) c++;
        const len = c - start;
        pathParts.push(`M${start + margin},${r + margin}h${len}v1h-${len}z`);
      } else {
        c++;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" role="img" aria-label="遊戲網址 QR Code" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="${light}"/>`,
    `<path d="${pathParts.join('')}" fill="${dark}"/>`,
    '</svg>'
  ].join('');
}
