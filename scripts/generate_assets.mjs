/**
 * 產生 PWA PNG 圖示（180 / 192 / 512 / maskable）與 1200×630 Open Graph 社群封面圖
 * 執行方式：node scripts/generate_assets.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'assets', 'icons');
const OG_PATH = path.join(ROOT, 'assets', 'og-cover.png');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到 Chrome 或 Edge 瀏覽器以渲染高解析度 PNG');
}

function buildIconSvgMarkup({ rounded = false, scale = 1 } = {}) {
  const rxAttr = rounded ? ' rx="96"' : '';
  const tx = (512 * (1 - scale)) / 2;
  const groupOpen = scale === 1 ? '<g>' : `<g transform="translate(${tx}, ${tx}) scale(${scale})">`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#060b14"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <radialGradient id="halo" cx="50%" cy="42%" r="48%">
      <stop offset="0%" stop-color="rgba(56,189,248,0.22)"/>
      <stop offset="100%" stop-color="rgba(56,189,248,0)"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512"${rxAttr} fill="url(#bg)"/>
  <rect width="512" height="512"${rxAttr} fill="url(#halo)"/>
  ${groupOpen}
    <!-- 底層磚塊 -->
    <rect x="64" y="348" width="120" height="72" rx="8" fill="#b45309" stroke="#f59e0b" stroke-width="6"/>
    <rect x="328" y="348" width="120" height="72" rx="8" fill="#b45309" stroke="#f59e0b" stroke-width="6"/>
    <!-- 梯子 -->
    <line x1="216" y1="120" x2="216" y2="420" stroke="#cbd5e1" stroke-width="14" stroke-linecap="round"/>
    <line x1="296" y1="120" x2="296" y2="420" stroke="#cbd5e1" stroke-width="14" stroke-linecap="round"/>
    <line x1="216" y1="170" x2="296" y2="170" stroke="#f59e0b" stroke-width="12"/>
    <line x1="216" y1="240" x2="296" y2="240" stroke="#f59e0b" stroke-width="12"/>
    <line x1="216" y1="310" x2="296" y2="310" stroke="#f59e0b" stroke-width="12"/>
    <line x1="216" y1="380" x2="296" y2="380" stroke="#f59e0b" stroke-width="12"/>
    <!-- 知識寶箱 -->
    <rect x="176" y="88" width="160" height="106" rx="22" fill="url(#gold)" stroke="#fef08a" stroke-width="8"/>
    <circle cx="256" cy="141" r="24" fill="#0f172a"/>
    <circle cx="256" cy="141" r="12" fill="#38bdf8"/>
  </g>
</svg>`;
}

function buildIconHtml(opts) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  body { display: flex; align-items: stretch; justify-content: stretch; }
</style>
</head>
<body>${buildIconSvgMarkup(opts)}</body>
</html>`;
}

function buildOgCoverHtml() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1200px;
    height: 630px;
    overflow: hidden;
    font-family: "Noto Sans TC", "Microsoft JhengHei", "Segoe UI", sans-serif;
    background: #060b14;
    color: #f8fafc;
  }
  .card {
    position: relative;
    width: 1200px;
    height: 630px;
    background:
      radial-gradient(circle at 78% 36%, rgba(56, 189, 248, 0.16), transparent 46%),
      radial-gradient(circle at 20% 85%, rgba(245, 158, 11, 0.14), transparent 42%),
      linear-gradient(135deg, #09111f 0%, #0d1a2e 55%, #060b14 100%);
    overflow: hidden;
    display: flex;
    align-items: center;
    padding: 52px 58px;
  }
  .grid-bg {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, rgba(148, 163, 184, 0.06) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
    background-size: 48px 48px;
    pointer-events: none;
  }
  .frame-border {
    position: absolute;
    inset: 18px;
    border-radius: 26px;
    border: 2px solid rgba(56, 189, 248, 0.25);
    pointer-events: none;
  }
  .left-col {
    position: relative;
    z-index: 2;
    width: 660px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .eyebrow-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .badge {
    background: linear-gradient(135deg, #fbbf24, #d97706);
    color: #09111f;
    font-weight: 900;
    font-size: 16px;
    letter-spacing: 0.08em;
    padding: 6px 14px;
    border-radius: 8px;
  }
  .eyebrow {
    font-size: 20px;
    font-weight: 700;
    color: #facc15;
    letter-spacing: 0.05em;
  }
  .title {
    font-size: 62px;
    font-weight: 900;
    line-height: 1.15;
    letter-spacing: 0.01em;
    color: #ffffff;
    text-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
  }
  .title .accent {
    background: linear-gradient(90deg, #fde047, #38bdf8);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .trio-row {
    display: flex;
    gap: 12px;
    margin-top: 6px;
  }
  .trio-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 18px;
    border-radius: 999px;
    font-size: 21px;
    font-weight: 800;
    background: rgba(15, 23, 42, 0.85);
    border: 2px solid;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  }
  .trio-pill.plant { border-color: #22c55e; color: #86efac; }
  .trio-pill.sudoku { border-color: #38bdf8; color: #7dd3fc; }
  .trio-pill.medical { border-color: #fb923c; color: #fed7aa; }
  .subline {
    font-size: 23px;
    font-weight: 600;
    color: #cbd5e1;
    margin-top: 4px;
  }
  .credit {
    margin-top: 10px;
    font-size: 18px;
    font-weight: 700;
    color: #94a3b8;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .credit-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #38bdf8;
  }
  .right-col {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding-left: 20px;
  }
  .scene-box {
    width: 440px;
    height: 440px;
    border-radius: 28px;
    background: linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(6, 11, 20, 0.96));
    border: 2px solid rgba(250, 204, 21, 0.35);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
    overflow: hidden;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="grid-bg"></div>
    <div class="frame-border"></div>
    <div class="left-col">
      <div class="eyebrow-row">
        <span class="badge">LODE RUNNER PWA</span>
        <span class="eyebrow">1980s 經典復刻 × 三大知識融合</span>
      </div>
      <h1 class="title">知識尋寶<br/><span class="accent">《Lode Runner》</span></h1>
      <div class="trio-row">
        <div class="trio-pill plant">🌿 捻花惹草</div>
        <div class="trio-pill sudoku">🔢 數獨共享</div>
        <div class="trio-pill medical">🩺 加減學學</div>
      </div>
      <div class="subline">12 關迷宮動作益智・全球英雄榜・支援離線 PWA</div>
      <div class="credit">
        <span class="credit-dot"></span>
        <span>@2026 by Famidoc Chang</span>
      </div>
    </div>
    <div class="right-col">
      <div class="scene-box">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 440 440" width="440" height="440">
          <defs>
            <linearGradient id="brickFace" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#d97706"/>
              <stop offset="100%" stop-color="#92400e"/>
            </linearGradient>
            <linearGradient id="graniteFace" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#475569"/>
              <stop offset="100%" stop-color="#1e293b"/>
            </linearGradient>
            <radialGradient id="exitGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="rgba(250,204,21,0.35)"/>
              <stop offset="100%" stop-color="rgba(250,204,21,0)"/>
            </radialGradient>
            <linearGradient id="ghostGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#c084fc"/>
              <stop offset="100%" stop-color="#6d28d9"/>
            </linearGradient>
          </defs>

          <!-- 背景光柱 -->
          <rect x="70" y="0" width="50" height="440" fill="rgba(56,189,248,0.04)"/>
          <rect x="260" y="0" width="60" height="440" fill="rgba(56,189,248,0.04)"/>

          <!-- 頂部過關金梯光暈與梯子 -->
          <rect x="330" y="18" width="54" height="114" fill="url(#exitGlow)"/>
          <line x1="342" y1="20" x2="342" y2="128" stroke="#fde047" stroke-width="5" stroke-linecap="round"/>
          <line x1="372" y1="20" x2="372" y2="128" stroke="#fde047" stroke-width="5" stroke-linecap="round"/>
          <line x1="342" y1="40" x2="372" y2="40" stroke="#fef08a" stroke-width="4"/>
          <line x1="342" y1="68" x2="372" y2="68" stroke="#fef08a" stroke-width="4"/>
          <line x1="342" y1="96" x2="372" y2="96" stroke="#fef08a" stroke-width="4"/>

          <!-- 鋼索 -->
          <line x1="76" y1="148" x2="310" y2="148" stroke="#fbbf24" stroke-width="4.5"/>
          <line x1="76" y1="147" x2="310" y2="147" stroke="#fef3c7" stroke-width="1.5" stroke-dasharray="8 8"/>

          <!-- 中層平台磚塊 (2.5D) -->
          <g transform="translate(40, 210)">
            <polygon points="0,0 7,-5 175,-5 168,0" fill="#f59e0b"/>
            <polygon points="168,0 175,-5 175,43 168,48" fill="#78350f"/>
            <rect x="0" y="0" width="168" height="48" fill="url(#brickFace)" stroke="#451a03" stroke-width="2"/>
            <line x1="56" y1="0" x2="56" y2="48" stroke="#451a03" stroke-width="2"/>
            <line x1="112" y1="0" x2="112" y2="48" stroke="#451a03" stroke-width="2"/>
            <line x1="0" y1="24" x2="168" y2="24" stroke="#451a03" stroke-width="2"/>
          </g>

          <g transform="translate(264, 210)">
            <polygon points="0,0 7,-5 139,-5 132,0" fill="#f59e0b"/>
            <polygon points="132,0 139,-5 139,43 132,48" fill="#78350f"/>
            <rect x="0" y="0" width="132" height="48" fill="url(#brickFace)" stroke="#451a03" stroke-width="2"/>
            <line x1="44" y1="0" x2="44" y2="48" stroke="#451a03" stroke-width="2"/>
            <line x1="88" y1="0" x2="88" y2="48" stroke="#451a03" stroke-width="2"/>
            <line x1="0" y1="24" x2="132" y2="24" stroke="#451a03" stroke-width="2"/>
          </g>

          <!-- 主梯子 -->
          <line x1="222" y1="210" x2="222" y2="352" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>
          <line x1="252" y1="210" x2="252" y2="352" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>
          <line x1="222" y1="234" x2="252" y2="234" stroke="#f59e0b" stroke-width="4"/>
          <line x1="222" y1="266" x2="252" y2="266" stroke="#f59e0b" stroke-width="4"/>
          <line x1="222" y1="298" x2="252" y2="298" stroke="#f59e0b" stroke-width="4"/>
          <line x1="222" y1="330" x2="252" y2="330" stroke="#f59e0b" stroke-width="4"/>

          <!-- 底部花崗岩基座 -->
          <g transform="translate(24, 352)">
            <polygon points="0,0 7,-5 399,-5 392,0" fill="#64748b"/>
            <rect x="0" y="0" width="392" height="52" fill="url(#graniteFace)" stroke="#334155" stroke-width="2"/>
            <line x1="56" y1="0" x2="56" y2="52" stroke="#334155" stroke-width="2"/>
            <line x1="112" y1="0" x2="112" y2="52" stroke="#334155" stroke-width="2"/>
            <line x1="168" y1="0" x2="168" y2="52" stroke="#334155" stroke-width="2"/>
            <line x1="224" y1="0" x2="224" y2="52" stroke="#334155" stroke-width="2"/>
            <line x1="280" y1="0" x2="280" y2="52" stroke="#334155" stroke-width="2"/>
            <line x1="336" y1="0" x2="336" y2="52" stroke="#334155" stroke-width="2"/>
          </g>

          <!-- 左上角綠寶箱 (捻花惹草) -->
          <g transform="translate(76, 166)">
            <circle cx="22" cy="18" r="28" fill="rgba(34,197,94,0.28)"/>
            <rect x="2" y="4" width="40" height="30" rx="7" fill="#22c55e" stroke="#0f172a" stroke-width="2.5"/>
            <rect x="6" y="7" width="32" height="9" rx="4" fill="rgba(255,255,255,0.28)"/>
            <text x="22" y="25" font-size="18" text-anchor="middle">🌿</text>
          </g>

          <!-- 右中藍寶箱 (數獨) -->
          <g transform="translate(326, 166)">
            <circle cx="22" cy="18" r="28" fill="rgba(56,189,248,0.28)"/>
            <rect x="2" y="4" width="40" height="30" rx="7" fill="#38bdf8" stroke="#0f172a" stroke-width="2.5"/>
            <rect x="6" y="7" width="32" height="9" rx="4" fill="rgba(255,255,255,0.28)"/>
            <text x="22" y="25" font-size="18" text-anchor="middle">🔢</text>
          </g>

          <!-- 底部橘寶箱 (加減學學) -->
          <g transform="translate(104, 308)">
            <circle cx="22" cy="18" r="28" fill="rgba(251,146,60,0.28)"/>
            <rect x="2" y="4" width="40" height="30" rx="7" fill="#fb923c" stroke="#0f172a" stroke-width="2.5"/>
            <rect x="6" y="7" width="32" height="9" rx="4" fill="rgba(255,255,255,0.28)"/>
            <text x="22" y="25" font-size="18" text-anchor="middle">🩺</text>
          </g>

          <!-- 探險家主角 -->
          <g transform="translate(174, 158)">
            <ellipse cx="0" cy="48" rx="18" ry="5" fill="rgba(0,0,0,0.4)"/>
            <line x1="-6" y1="30" x2="-10" y2="46" stroke="#1e40af" stroke-width="7" stroke-linecap="round"/>
            <line x1="6" y1="30" x2="10" y2="46" stroke="#1e40af" stroke-width="7" stroke-linecap="round"/>
            <rect x="-11" y="10" width="22" height="22" rx="6" fill="#eab308"/>
            <line x1="-10" y1="14" x2="-17" y2="26" stroke="#fde047" stroke-width="5.5" stroke-linecap="round"/>
            <line x1="10" y1="14" x2="17" y2="26" stroke="#fde047" stroke-width="5.5" stroke-linecap="round"/>
            <circle cx="0" cy="0" r="11" fill="#fde68a"/>
            <path d="M-12,-2 A12,12 0 0,1 12,-2 Z" fill="#38bdf8"/>
            <circle cx="8" cy="-4" r="3.5" fill="#fef08a"/>
            <circle cx="4" cy="1" r="2" fill="#0f172a"/>
          </g>

          <!-- 幽靈守衛 -->
          <g transform="translate(324, 324)">
            <circle cx="0" cy="0" r="30" fill="rgba(168,85,247,0.3)"/>
            <path d="M-20,0 A20,20 0 0,1 20,0 L20,22 L12,15 L4,22 L-4,15 L-12,22 L-20,15 Z" fill="url(#ghostGrad)" stroke="#f3e8ff" stroke-width="2"/>
            <circle cx="-7" cy="-3" r="5" fill="#ffffff"/>
            <circle cx="7" cy="-3" r="5" fill="#ffffff"/>
            <circle cx="-9" cy="-3" r="2.5" fill="#0f172a"/>
            <circle cx="5" cy="-3" r="2.5" fill="#0f172a"/>
          </g>
        </svg>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderHtmlToPng({ browserPath, htmlContent, outPath, renderWidth, renderHeight, width, height, opaqueRgb = false }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-assets-'));
  const htmlPath = path.join(tmpDir, 'render.html');
  const rawShotPath = path.join(tmpDir, 'raw.png');
  fs.writeFileSync(htmlPath, htmlContent, 'utf8');

  try {
    const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
    const bgArgs = opaqueRgb ? [] : ['--default-background-color=00000000'];
    execFileSync(
      browserPath,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        ...bgArgs,
        `--window-size=${renderWidth},${renderHeight}`,
        `--screenshot=${rawShotPath}`,
        fileUrl
      ],
      { stdio: 'pipe', timeout: 25000 }
    );

    // 使用 Python Pillow 縮放至精確像素尺寸並最佳化 PNG 體積
    execFileSync(
      'python',
      [
        '-c',
        `
from PIL import Image
im = Image.open(r"${rawShotPath}").convert("${opaqueRgb ? 'RGB' : 'RGBA'}")
if im.size != (${renderWidth}, ${renderHeight}):
    im = im.crop((0, 0, ${renderWidth}, ${renderHeight}))
if im.size != (${width}, ${height}):
    im = im.resize((${width}, ${height}), Image.Resampling.LANCZOS)
im.save(r"${outPath}", "PNG", optimize=True)
print("${path.basename(outPath)}:", im.size)
        `.trim()
      ],
      { stdio: 'inherit', timeout: 15000 }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
  const browserPath = findBrowser();

  const jobs = [
    {
      outPath: path.join(ICONS_DIR, 'apple-touch-icon.png'),
      renderWidth: 512,
      renderHeight: 512,
      width: 180,
      height: 180,
      opaqueRgb: true,
      htmlContent: buildIconHtml({ rounded: false, scale: 0.9 })
    },
    {
      outPath: path.join(ICONS_DIR, 'icon-192.png'),
      renderWidth: 512,
      renderHeight: 512,
      width: 192,
      height: 192,
      opaqueRgb: false,
      htmlContent: buildIconHtml({ rounded: true, scale: 1 })
    },
    {
      outPath: path.join(ICONS_DIR, 'icon-512.png'),
      renderWidth: 512,
      renderHeight: 512,
      width: 512,
      height: 512,
      opaqueRgb: false,
      htmlContent: buildIconHtml({ rounded: true, scale: 1 })
    },
    {
      outPath: path.join(ICONS_DIR, 'icon-maskable-192.png'),
      renderWidth: 512,
      renderHeight: 512,
      width: 192,
      height: 192,
      opaqueRgb: true,
      htmlContent: buildIconHtml({ rounded: false, scale: 0.74 })
    },
    {
      outPath: path.join(ICONS_DIR, 'icon-maskable-512.png'),
      renderWidth: 512,
      renderHeight: 512,
      width: 512,
      height: 512,
      opaqueRgb: true,
      htmlContent: buildIconHtml({ rounded: false, scale: 0.74 })
    },
    {
      outPath: OG_PATH,
      renderWidth: 1200,
      renderHeight: 630,
      width: 1200,
      height: 630,
      opaqueRgb: true,
      htmlContent: buildOgCoverHtml()
    }
  ];

  for (const job of jobs) {
    renderHtmlToPng({ browserPath, ...job });
  }
  console.log('✅ 所有 PWA 圖示與 OG 封面圖產生完成！');
}

main();
