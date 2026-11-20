/**
 * 2.5D HTML5 Canvas 迷宮、光影、角色與知識寶箱繪圖引擎
 */

import {
  COLS,
  ROWS,
  TILE_SIZE,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  TILE,
  GAME_STATE,
  PHYSICS,
  CHEST_META
} from './config.js';

export class MazeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._setupResolution();
  }

  _setupResolution() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = CANVAS_WIDTH * dpr;
    this.canvas.height = CANVAS_HEIGHT * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(engine, nowMs) {
    const ctx = this.ctx;
    const t = nowMs * 0.001;

    this._drawBackdrop(ctx, engine, t);

    if (!engine.level) return;

    this._drawTiles(ctx, engine, t);
    this._drawDugHoles(ctx, engine, t);
    this._drawChests(ctx, engine, t);
    this._drawGhosts(ctx, engine, t);
    this._drawPlayer(ctx, engine, t);
    this._drawParticles(ctx, engine);
    this._drawFloatingTexts(ctx, engine);
    this._drawOverlays(ctx, engine, t);
  }

  _drawBackdrop(ctx, engine, t) {
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    if (engine.frenzyTimer > 0) {
      grad.addColorStop(0, '#1f0c18');
      grad.addColorStop(0.55, '#190f24');
      grad.addColorStop(1, '#120816');
    } else {
      grad.addColorStop(0, '#09111f');
      grad.addColorStop(0.6, '#0d1a2e');
      grad.addColorStop(1, '#08101e');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 微妙遺跡磚牆網格背景（營造景深層次）
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.045)';
    ctx.lineWidth = 1;
    for (let c = 0; c <= COLS; c++) {
      const x = c * TILE_SIZE;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let r = 0; r <= ROWS; r++) {
      const y = r * TILE_SIZE;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // 遠景環境光柱
    ctx.fillStyle = 'rgba(56, 189, 248, 0.025)';
    for (let i = 0; i < 4; i++) {
      const cx = (i * 240 + 120 + Math.sin(t * 0.4 + i) * 14);
      ctx.fillRect(cx - 26, 0, 52, CANVAS_HEIGHT);
    }

    // 若進入加速追擊警報，邊緣閃爍紅光
    if (engine.frenzyTimer > 0) {
      const pulse = 0.14 + Math.sin(t * 14) * 0.08;
      ctx.strokeStyle = `rgba(239, 68, 68, ${pulse + 0.25})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, CANVAS_WIDTH - 8, CANVAS_HEIGHT - 8);
    }
  }

  _drawTiles(ctx, engine, t) {
    const grid = engine.grid;
    const depth = 6; // 2.5D 立體斜面厚度

    // 第一輪：先畫 2.5D 頂部投影與右側陰影
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = grid[r][c];
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;

        if (tile === TILE.BRICK && !engine.dugHoles.has(`${c},${r}`)) {
          // 右側與下方柔和投影
          ctx.fillStyle = 'rgba(0, 0, 0, 0.36)';
          ctx.fillRect(x + 5, y + 6, TILE_SIZE, TILE_SIZE);
        } else if (tile === TILE.GRANITE) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
          ctx.fillRect(x + 4, y + 5, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // 第二輪：畫所有實心方塊、梯子與鋼索本體
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tile = grid[r][c];
        const x = c * TILE_SIZE;
        const y = r * TILE_SIZE;

        if (tile === TILE.BRICK) {
          if (!engine.dugHoles.has(`${c},${r}`)) {
            this._drawBrickTile(ctx, x, y, depth);
          }
        } else if (tile === TILE.GRANITE) {
          this._drawGraniteTile(ctx, x, y, depth);
        } else if (tile === TILE.LADDER) {
          this._drawLadderTile(ctx, x, y, false, t);
        } else if (tile === TILE.ROPE) {
          this._drawRopeTile(ctx, x, y, c);
        } else if (tile === TILE.EXIT_LADDER && engine.exitActive) {
          this._drawLadderTile(ctx, x, y, true, t);
        }
      }
    }
  }

  _drawBrickTile(ctx, x, y, depth) {
    // 2.5D 頂面高光斜面
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE, y);
    ctx.closePath();
    ctx.fill();

    // 2.5D 右側面
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.moveTo(x + TILE_SIZE, y);
    ctx.lineTo(x + TILE_SIZE + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE + depth, y + TILE_SIZE - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE);
    ctx.closePath();
    ctx.fill();

    // 正面暖砂岩磚
    const grad = ctx.createLinearGradient(x, y, x, y + TILE_SIZE);
    grad.addColorStop(0, '#d97706');
    grad.addColorStop(1, '#92400e');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    // 磚縫紋理
    ctx.strokeStyle = 'rgba(69, 26, 3, 0.75)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);

    const midY = y + TILE_SIZE * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x + TILE_SIZE, midY);
    ctx.moveTo(x + TILE_SIZE * 0.5, y);
    ctx.lineTo(x + TILE_SIZE * 0.5, midY);
    ctx.moveTo(x + TILE_SIZE * 0.25, midY);
    ctx.lineTo(x + TILE_SIZE * 0.25, y + TILE_SIZE);
    ctx.moveTo(x + TILE_SIZE * 0.75, midY);
    ctx.lineTo(x + TILE_SIZE * 0.75, y + TILE_SIZE);
    ctx.stroke();
  }

  _drawGraniteTile(ctx, x, y, depth) {
    // 頂部金屬斜面
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE, y);
    ctx.closePath();
    ctx.fill();

    // 右側面
    ctx.fillStyle = '#1e293b';
    ctx.beginPath();
    ctx.moveTo(x + TILE_SIZE, y);
    ctx.lineTo(x + TILE_SIZE + depth, y - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE + depth, y + TILE_SIZE - depth * 0.7);
    ctx.lineTo(x + TILE_SIZE, y + TILE_SIZE);
    ctx.closePath();
    ctx.fill();

    // 花崗岩正面
    const grad = ctx.createLinearGradient(x, y, x + TILE_SIZE, y + TILE_SIZE);
    grad.addColorStop(0, '#475569');
    grad.addColorStop(1, '#1e293b');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    // 邊框與角落鉚釘
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);

    ctx.fillStyle = '#94a3b8';
    const pad = 7;
    for (const [rx, ry] of [
      [x + pad, y + pad],
      [x + TILE_SIZE - pad, y + pad],
      [x + pad, y + TILE_SIZE - pad],
      [x + TILE_SIZE - pad, y + TILE_SIZE - pad]
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawLadderTile(ctx, x, y, isExit, t) {
    const railOffset = 10;
    const leftX = x + railOffset;
    const rightX = x + TILE_SIZE - railOffset;

    if (isExit) {
      // 隱藏過關梯子的金色光暈
      const glowAlpha = 0.25 + Math.sin(t * 6) * 0.12;
      ctx.fillStyle = `rgba(250, 204, 21, ${glowAlpha})`;
      ctx.fillRect(x + 5, y, TILE_SIZE - 10, TILE_SIZE);
    }

    // 梯身陰影
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(leftX + 3, y);
    ctx.lineTo(leftX + 3, y + TILE_SIZE);
    ctx.moveTo(rightX + 3, y);
    ctx.lineTo(rightX + 3, y + TILE_SIZE);
    ctx.stroke();

    // 兩側立柱
    ctx.strokeStyle = isExit ? '#fde047' : '#cbd5e1';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(leftX, y);
    ctx.lineTo(leftX, y + TILE_SIZE);
    ctx.moveTo(rightX, y);
    ctx.lineTo(rightX, y + TILE_SIZE);
    ctx.stroke();

    // 橫槓
    ctx.strokeStyle = isExit ? '#fef08a' : '#f59e0b';
    ctx.lineWidth = 3.5;
    for (let i = 0; i < 4; i++) {
      const ry = y + 6 + i * (TILE_SIZE / 4);
      ctx.beginPath();
      ctx.moveTo(leftX, ry);
      ctx.lineTo(rightX, ry);
      ctx.stroke();
    }
  }

  _drawRopeTile(ctx, x, y) {
    const ry = y + 11;
    // 投影
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, ry + 3);
    ctx.lineTo(x + TILE_SIZE, ry + 3);
    ctx.stroke();

    // 鋼索主體
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(x, ry);
    ctx.lineTo(x + TILE_SIZE, ry);
    ctx.stroke();

    // 金屬光點紋理
    ctx.strokeStyle = '#fef3c7';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(x, ry - 0.5);
    ctx.lineTo(x + TILE_SIZE, ry - 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawDugHoles(ctx, engine, t) {
    for (const hole of engine.dugHoles.values()) {
      const x = hole.col * TILE_SIZE;
      const y = hole.row * TILE_SIZE;

      // 凹陷陰影框
      ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
      ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);

      if (hole.timer <= PHYSICS.BRICK_WARN_SEC) {
        // 復原倒數最後 1.2 秒：橘紅閃爍警告框
        const ratio = 1 - hole.timer / PHYSICS.BRICK_WARN_SEC;
        const flash = 0.4 + Math.sin(t * 28) * 0.35;
        ctx.strokeStyle = `rgba(251, 146, 60, ${flash})`;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
        ctx.setLineDash([]);

        // 底部漸升提示條
        ctx.fillStyle = 'rgba(245, 158, 11, 0.38)';
        const fillH = (TILE_SIZE - 8) * ratio;
        ctx.fillRect(x + 4, y + TILE_SIZE - 4 - fillH, TILE_SIZE - 8, fillH);
      } else {
        ctx.strokeStyle = 'rgba(217, 119, 6, 0.28)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 4, y + 4, TILE_SIZE - 8, TILE_SIZE - 8);
      }
    }
  }

  _drawChests(ctx, engine, t) {
    for (const ch of engine.chests) {
      if (ch.collected) continue;

      const meta = CHEST_META[ch.type];
      const cx = (ch.col + 0.5) * TILE_SIZE;
      const bob = Math.sin(t * 3.4 + ch.bobPhase) * 3.5;
      const cy = (ch.row + 0.54) * TILE_SIZE + bob;

      // 底座發光投影
      ctx.fillStyle = ch.cooldown > 0 ? 'rgba(239, 68, 68, 0.25)' : meta.glow;
      ctx.beginPath();
      ctx.ellipse(cx, (ch.row + 0.92) * TILE_SIZE, 14, 4, 0, 0, Math.PI * 2);
      ctx.fill();

      // 外圈光暈
      const haloGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 24);
      haloGrad.addColorStop(0, ch.cooldown > 0 ? 'rgba(239,68,68,0.45)' : meta.glow);
      haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haloGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();

      // 2.5D 寶箱盒體
      const w = 28;
      const h = 22;
      const left = cx - w / 2;
      const top = cy - h / 2;

      ctx.fillStyle = ch.cooldown > 0 ? '#475569' : meta.color;
      this._roundRect(ctx, left, top, w, h, 5);
      ctx.fill();

      // 寶箱上蓋高光
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      this._roundRect(ctx, left + 2, top + 2, w - 4, 7, 3);
      ctx.fill();

      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 2;
      this._roundRect(ctx, left, top, w, h, 5);
      ctx.stroke();

      // 中央知識圖示
      ctx.font = '15px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch.cooldown > 0 ? '🔒' : meta.icon, cx, cy + 1);

      // 冷卻倒數弧線
      if (ch.cooldown > 0) {
        const pct = ch.cooldown / PHYSICS.CHEST_COOLDOWN_SEC;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 20, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
        ctx.stroke();

        ctx.fillStyle = '#fecaca';
        ctx.font = 'bold 11px monospace';
        ctx.fillText(`${Math.ceil(ch.cooldown)}s`, cx, top - 8);
      }
    }
  }

  _drawPlayer(ctx, engine, t) {
    const p = engine.player;
    if (!p) return;

    // 無敵時閃爍效果
    if (p.invincibleTimer > 0 && Math.floor(t * 16) % 2 === 0) {
      ctx.save();
      ctx.globalAlpha = 0.55;
    } else {
      ctx.save();
    }

    const cx = (p.x + 0.5) * TILE_SIZE;
    const cy = (p.y + 0.5) * TILE_SIZE;

    // 腳下陰影
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 20, 13, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 挖洞光束特效
    if (p.digAnimTimer > 0 && p.digTarget) {
      const tx = (p.digTarget.col + 0.5) * TILE_SIZE;
      const ty = (p.digTarget.row + 0.3) * TILE_SIZE;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx + p.facing * 10, cy + 4);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }

    // 角色身體繪製
    const stride = p.action === 'run' || p.action === 'climb' ? Math.sin(p.animPhase) * 5 : 0;

    // 雙腿
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 4, cy + 8);
    ctx.lineTo(cx - 5 + stride, cy + 19);
    ctx.moveTo(cx + 4, cy + 8);
    ctx.lineTo(cx + 5 - stride, cy + 19);
    ctx.stroke();

    // 軀幹（亮金探險夾克）
    ctx.fillStyle = '#eab308';
    this._roundRect(ctx, cx - 8, cy - 5, 16, 15, 4);
    ctx.fill();

    // 手臂（吊鋼索時高舉）
    ctx.strokeStyle = '#fde047';
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (p.action === 'rope') {
      ctx.moveTo(cx - 6, cy - 3);
      ctx.lineTo(cx - 6, cy - 16);
      ctx.moveTo(cx + 6, cy - 3);
      ctx.lineTo(cx + 6, cy - 16);
    } else if (p.action === 'climb') {
      ctx.moveTo(cx - 7, cy - 2);
      ctx.lineTo(cx - 10, cy - 11 - stride * 0.6);
      ctx.moveTo(cx + 7, cy - 2);
      ctx.lineTo(cx + 10, cy - 11 + stride * 0.6);
    } else {
      ctx.moveTo(cx - 7, cy - 2);
      ctx.lineTo(cx - 11 - stride * 0.5, cy + 6);
      ctx.moveTo(cx + 7, cy - 2);
      ctx.lineTo(cx + 11 + stride * 0.5, cy + 6);
    }
    ctx.stroke();

    // 頭部與探險安全帽
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.arc(cx, cy - 11, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // 安全帽 + 頭燈
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(cx, cy - 13, 8.2, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(cx + p.facing * 5.5, cy - 14.5, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 眼神方向
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(cx + p.facing * 3, cy - 10.5, 1.5, 0, Math.PI * 2);
    ctx.fill();

    // 答題凍結護盾 / 答對無敵光環
    if (engine.state === GAME_STATE.QUIZ_FROZEN) {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (p.invincibleTimer > 0) {
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 22 + Math.sin(t * 14) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawGhosts(ctx, engine, t) {
    const frenzy = engine.frenzyTimer > 0;

    for (const g of engine.ghosts) {
      const cx = (g.x + 0.5) * TILE_SIZE;
      const hover = g.state === 'TRAPPED' ? 0 : Math.sin(t * 5 + g.id) * 2;
      const cy = (g.y + 0.5) * TILE_SIZE + hover;

      ctx.save();

      // 光暈背景
      const auraColor = frenzy
        ? 'rgba(239, 68, 68, 0.35)'
        : g.state === 'TRAPPED'
          ? 'rgba(56, 189, 248, 0.25)'
          : 'rgba(168, 85, 247, 0.3)';
      ctx.fillStyle = auraColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 21, 0, Math.PI * 2);
      ctx.fill();

      // 幽靈主體（圓頂波浪底）
      const bodyGrad = ctx.createLinearGradient(cx, cy - 16, cx, cy + 18);
      if (frenzy) {
        bodyGrad.addColorStop(0, '#f87171');
        bodyGrad.addColorStop(1, '#b91c1c');
      } else if (g.state === 'TRAPPED') {
        bodyGrad.addColorStop(0, '#7dd3fc');
        bodyGrad.addColorStop(1, '#0284c7');
      } else {
        bodyGrad.addColorStop(0, '#c084fc');
        bodyGrad.addColorStop(1, '#6d28d9');
      }

      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.arc(cx, cy - 3, 14, Math.PI, 0);
      ctx.lineTo(cx + 14, cy + 14);
      for (let i = 2; i >= -2; i--) {
        const wx = cx + i * 5.6;
        const wy = cy + (Math.abs(i) % 2 === 0 ? 15 : 10);
        ctx.lineTo(wx, wy);
      }
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = frenzy ? '#fecaca' : '#f3e8ff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 雙眼
      const lookX = g.facing * 2.2;
      for (const ex of [-5, 5]) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cx + ex, cy - 4, 3.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = frenzy ? '#7f1d1d' : '#0f172a';
        ctx.beginPath();
        ctx.arc(cx + ex + lookX * 0.6, cy - 4, 1.9, 0, Math.PI * 2);
        ctx.fill();
      }

      // 困洞倒數條 & 暈眩星
      if (g.state === 'TRAPPED') {
        const starAngle = t * 5;
        ctx.fillStyle = '#fde047';
        for (let s = 0; s < 3; s++) {
          const sx = cx + Math.cos(starAngle + (s * Math.PI * 2) / 3) * 11;
          const sy = cy - 18 + Math.sin(starAngle + (s * Math.PI * 2) / 3) * 3;
          ctx.beginPath();
          ctx.arc(sx, sy, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        const pct = Math.max(0, g.trapTimer / PHYSICS.GHOST_TRAP_SEC);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(cx - 14, cy + 16, 28, 4);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(cx - 14, cy + 16, 28 * pct, 4);
      }

      ctx.restore();
    }
  }

  _drawParticles(ctx, engine) {
    for (const pt of engine.particles) {
      const alpha = Math.max(0, pt.life / pt.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x * TILE_SIZE, pt.y * TILE_SIZE, pt.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  _drawFloatingTexts(ctx, engine) {
    for (const ft of engine.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(ft.text, ft.x * TILE_SIZE + 1, ft.y * TILE_SIZE + 1);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x * TILE_SIZE, ft.y * TILE_SIZE);
      ctx.restore();
    }
  }

  _drawOverlays(ctx, engine) {
    // 頂部動態提示橫幅
    if (engine.bannerTimer > 0 && engine.bannerText) {
      ctx.save();
      const alpha = Math.min(1, engine.bannerTimer * 1.4);
      ctx.globalAlpha = alpha;
      ctx.font = 'bold 16px "Noto Sans TC", "Segoe UI", sans-serif';
      const textWidth = ctx.measureText(engine.bannerText).width;
      const boxW = Math.min(CANVAS_WIDTH - 40, textWidth + 38);
      const boxX = (CANVAS_WIDTH - boxW) / 2;
      const boxY = 14;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.86)';
      this._roundRect(ctx, boxX, boxY, boxW, 36, 18);
      ctx.fill();

      ctx.strokeStyle = engine.exitActive ? '#facc15' : '#38bdf8';
      ctx.lineWidth = 1.5;
      this._roundRect(ctx, boxX, boxY, boxW, 36, 18);
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(engine.bannerText, CANVAS_WIDTH / 2, boxY + 18);
      ctx.restore();
    }

    // 暫停遮罩
    if (engine.state === GAME_STATE.PAUSED) {
      ctx.fillStyle = 'rgba(2, 6, 23, 0.65)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 34px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⏸ 遊戲暫停', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 14);
      ctx.font = '16px "Noto Sans TC", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.fillText('按 P / ESC 或點擊「繼續」恢復尋寶', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 24);
    }

    // 時間凍結護盾標示
    if (engine.state === GAME_STATE.QUIZ_FROZEN) {
      ctx.fillStyle = 'rgba(14, 116, 144, 0.22)';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
