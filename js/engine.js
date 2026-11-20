/**
 * Lode Runner 2D 網格物理、挖洞、鬼 AI、寶箱凍結答題與獎懲核心引擎
 */

import {
  COLS,
  ROWS,
  TILE,
  GAME_STATE,
  PHYSICS,
  SCORE,
  CHEST_META
} from './config.js';
import { computeNextStep } from './pathfinding.js';
import { audio } from './audio.js';

export class LodeRunnerEngine {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.state = GAME_STATE.READY;

    this.level = null;
    this.grid = [];
    this.lives = PHYSICS.MAX_LIVES;
    this.score = 0;
    this.elapsedSec = 0;

    this.player = null;
    this.ghosts = [];
    this.chests = [];
    this.dugHoles = new Map();

    this.exitActive = false;
    this.frenzyTimer = 0;
    this.postWrongGraceTimer = 0;
    this.bannerText = '';
    this.bannerTimer = 0;

    this.particles = [];
    this.floatingTexts = [];
    this.stepSoundTimer = 0;
    this.aiTickAccumulator = 0;

    this.input = {
      left: false,
      right: false,
      up: false,
      down: false
    };
  }

  loadLevel(levelData, { preserveScore = false } = {}) {
    this.level = levelData;
    this.grid = levelData.grid.map((row) => row.slice());
    if (!preserveScore) {
      this.score = 0;
    }
    this.lives = PHYSICS.MAX_LIVES;
    this.elapsedSec = 0;
    this.exitActive = false;
    this.frenzyTimer = 0;
    this.postWrongGraceTimer = 0;
    this.dugHoles.clear();
    this.particles = [];
    this.floatingTexts = [];

    this.chests = levelData.chests.map((ch) => ({
      type: ch.type,
      col: ch.col,
      row: ch.row,
      collected: false,
      cooldown: 0,
      bobPhase: Math.random() * Math.PI * 2
    }));

    this._resetEntities();
    this.state = GAME_STATE.PLAYING;
    this.showBanner(`第 ${levelData.id} 關：${levelData.name}`, 2.4);
    this._emitHud();
  }

  _resetEntities() {
    const sp = this.level.playerSpawn;
    this.player = {
      x: sp.col,
      y: sp.row,
      facing: 1,
      animPhase: 0,
      action: 'idle', // idle | run | climb | rope | fall | dig
      ropeDropTimer: 0,
      digCooldown: 0,
      digAnimTimer: 0,
      digTarget: null,
      invincibleTimer: PHYSICS.RESPAWN_INVINCIBLE_SEC
    };

    this.ghosts = this.level.ghosts.map((g, index) => ({
      id: index,
      spawnCol: g.col,
      spawnRow: g.row,
      x: g.col,
      y: g.row,
      facing: index % 2 === 0 ? -1 : 1,
      animPhase: Math.random() * 4,
      state: 'CHASE', // CHASE | TRAPPED | CLIMBING_OUT
      trapTimer: 0,
      climbStartY: g.row,
      climbProgress: 0,
      exitDir: 1,
      moveDir: { dc: 0, dr: 0 },
      stunTimer: 0
    }));

    this.dugHoles.clear();
    this.frenzyTimer = 0;
    this.postWrongGraceTimer = 0;
    this.aiTickAccumulator = PHYSICS.AI_REFRESH_SEC;
  }

  setInput(key, pressed) {
    if (key in this.input) {
      this.input[key] = Boolean(pressed);
    }
  }

  clearInputs() {
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
  }

  togglePause() {
    if (this.state === GAME_STATE.PLAYING) {
      this.state = GAME_STATE.PAUSED;
      this.clearInputs();
      this._emitHud();
    } else if (this.state === GAME_STATE.PAUSED) {
      this.state = GAME_STATE.PLAYING;
      this._emitHud();
    }
  }

  showBanner(text, duration = 2.0) {
    this.bannerText = text;
    this.bannerTimer = duration;
  }

  _emitHud() {
    if (typeof this.callbacks.onHudUpdate === 'function') {
      this.callbacks.onHudUpdate(this.getHudSnapshot());
    }
  }

  getHudSnapshot() {
    return {
      state: this.state,
      levelId: this.level?.id || 1,
      levelName: this.level?.name || '',
      lives: this.lives,
      score: this.score,
      elapsedSec: this.elapsedSec,
      exitActive: this.exitActive,
      frenzyTimer: this.frenzyTimer,
      chests: this.chests.map((c) => ({
        type: c.type,
        collected: c.collected,
        cooldown: c.cooldown
      }))
    };
  }

  // --- 地圖單元查詢工具 ---
  _tileAt(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return TILE.GRANITE;
    return this.grid[r][c];
  }

  _isSolid(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
    const t = this.grid[r][c];
    if (t === TILE.GRANITE) return true;
    if (t === TILE.BRICK) {
      return !this.dugHoles.has(`${c},${r}`);
    }
    return false;
  }

  _isLadder(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    const t = this.grid[r][c];
    return t === TILE.LADDER || (this.exitActive && t === TILE.EXIT_LADDER);
  }

  _isRope(c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return false;
    return this.grid[r][c] === TILE.ROPE;
  }

  _hasTrappedGhostAt(c, r) {
    return this.ghosts.some(
      (g) =>
        g.state === 'TRAPPED' &&
        Math.round(g.x) === c &&
        Math.round(g.y) === r
    );
  }

  _hasSupportBelow(c, r) {
    return (
      this._isSolid(c, r + 1) ||
      this._isLadder(c, r + 1) ||
      this._hasTrappedGhostAt(c, r + 1)
    );
  }

  // --- 玩家左右挖洞 ---
  dig(dir) {
    if (this.state !== GAME_STATE.PLAYING || !this.player) return false;
    if (dir !== -1 && dir !== 1) return false;

    const p = this.player;
    p.facing = dir;
    if (p.digCooldown > 0) return false;

    const col = Math.round(p.x);
    const row = Math.round(p.y);

    // 不可在半空中或吊鋼索時挖洞
    const onLadder = this._isLadder(col, row);
    const onRope = this._isRope(col, row) && p.ropeDropTimer <= 0;
    const grounded =
      Math.abs(p.y - row) <= 0.14 && (this._hasSupportBelow(col, row) || onLadder);
    if (!grounded || onRope) return false;

    const tc = col + dir;
    const tr = row + 1;
    if (tc < 0 || tc >= COLS || tr < 0 || tr >= ROWS - 1) return false;

    // 目標格必須是可挖磚塊且尚未被挖
    if (this.grid[tr][tc] !== TILE.BRICK || this.dugHoles.has(`${tc},${tr}`)) {
      return false;
    }

    // 目標磚塊正上方一格不可被實體磚塊、梯子、鋼索或未收集寶箱佔用
    const aboveTile = this._tileAt(tc, row);
    if (
      this._isSolid(tc, row) ||
      this._isLadder(tc, row) ||
      aboveTile === TILE.ROPE
    ) {
      return false;
    }
    const chestBlocking = this.chests.some(
      (ch) => !ch.collected && ch.col === tc && ch.row === row
    );
    if (chestBlocking) return false;

    // 執行挖洞
    this.dugHoles.set(`${tc},${tr}`, {
      col: tc,
      row: tr,
      timer: PHYSICS.BRICK_REGEN_SEC
    });

    // 對齊玩家微調站位並播放動畫
    p.x = col + (p.x - col) * 0.4;
    p.digCooldown = PHYSICS.DIG_ANIM_SEC;
    p.digAnimTimer = PHYSICS.DIG_ANIM_SEC;
    p.digTarget = { col: tc, row: tr };
    p.action = 'dig';

    audio.play('dig');
    this._spawnParticles(tc + 0.5, tr + 0.35, '#d97706', 12, 3.2);
    return true;
  }

  // --- 遊戲主迴圈更新 ---
  update(rawDt) {
    const dt = Math.min(Math.max(rawDt, 0), 0.05);

    this._updateParticles(dt);

    if (this.bannerTimer > 0) {
      this.bannerTimer = Math.max(0, this.bannerTimer - dt);
    }

    if (this.state !== GAME_STATE.PLAYING) {
      return;
    }

    this.elapsedSec += dt;

    if (this.frenzyTimer > 0) {
      this.frenzyTimer = Math.max(0, this.frenzyTimer - dt);
    }
    if (this.postWrongGraceTimer > 0) {
      this.postWrongGraceTimer = Math.max(0, this.postWrongGraceTimer - dt);
    }

    // 更新寶箱冷卻與浮動相位
    for (const ch of this.chests) {
      ch.bobPhase += dt * 3.2;
      if (ch.cooldown > 0) {
        ch.cooldown = Math.max(0, ch.cooldown - dt);
      }
    }

    this._updateDugHoles(dt);
    this._updatePlayer(dt);
    if (this.state !== GAME_STATE.PLAYING) return;

    this._updateGhosts(dt);
    if (this.state !== GAME_STATE.PLAYING) return;

    this._checkCollisions();
    this._emitHud();
  }

  _updateDugHoles(dt) {
    const restored = [];
    for (const [key, hole] of this.dugHoles.entries()) {
      hole.timer -= dt;
      if (hole.timer <= 0) {
        restored.push([key, hole]);
      }
    }

    for (const [key, hole] of restored) {
      this.dugHoles.delete(key);
      this._spawnParticles(hole.col + 0.5, hole.row + 0.5, '#f59e0b', 10, 2.5);

      // 檢查是否有鬼被復原磚塊活埋
      for (const g of this.ghosts) {
        const gc = Math.round(g.x);
        const gr = Math.round(g.y);
        if (gc === hole.col && gr === hole.row) {
          this._crushAndRespawnGhost(g);
        }
      }

      // 檢查玩家是否仍困在該復原磚格內
      const pc = Math.round(this.player.x);
      const pr = Math.round(this.player.y);
      if (pc === hole.col && pr === hole.row) {
        this._handlePlayerDeath('你被復原的磚塊壓扁了！');
        return;
      }
    }
  }

  _crushAndRespawnGhost(ghost) {
    this.score += SCORE.GHOST_CRUSH;
    audio.play('crush');
    this._spawnParticles(ghost.x + 0.5, ghost.y + 0.5, '#a855f7', 16, 4.0);
    this._spawnFloatingText(ghost.x + 0.5, ghost.y, `+${SCORE.GHOST_CRUSH}`, '#e879f9');

    // 從頂端安全空位（遠離玩家）重生
    const candidates = [];
    for (let r = 0; r <= 2; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!this._isSolid(c, r) && Math.abs(c - this.player.x) >= 4) {
          candidates.push({ c, r });
        }
      }
    }
    const pick =
      candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : { c: ghost.spawnCol, r: ghost.spawnRow };

    ghost.x = pick.c;
    ghost.y = pick.r;
    ghost.state = 'CHASE';
    ghost.trapTimer = 0;
    ghost.stunTimer = 0.6;
    ghost.moveDir = { dc: 0, dr: 0 };
  }

  _updatePlayer(dt) {
    const p = this.player;
    if (p.invincibleTimer > 0) p.invincibleTimer = Math.max(0, p.invincibleTimer - dt);
    if (p.ropeDropTimer > 0) p.ropeDropTimer = Math.max(0, p.ropeDropTimer - dt);
    if (p.digCooldown > 0) p.digCooldown = Math.max(0, p.digCooldown - dt);
    if (p.digAnimTimer > 0) p.digAnimTimer = Math.max(0, p.digAnimTimer - dt);

    const col = Math.round(p.x);
    const row = Math.round(p.y);
    const onLadder = this._isLadder(col, row);
    const ladderBelow = this._isLadder(col, row + 1);
    const onRopeTile = this._isRope(col, row);
    const hangingOnRope =
      onRopeTile && p.ropeDropTimer <= 0 && Math.abs(p.y - row) <= 0.25;
    const grounded =
      p.y >= row - 0.08 &&
      p.y <= row + 0.1 &&
      this._hasSupportBelow(col, row);

    const wantsUp = this.input.up;
    const wantsDown = this.input.down;
    const wantsLeft = this.input.left;
    const wantsRight = this.input.right;

    // 1. 半空中未獲支撐且未攀爬：強制自由落體
    if (!onLadder && !hangingOnRope && !grounded) {
      p.action = 'fall';
      p.x += (col - p.x) * Math.min(1, dt * 10);
      const nextY = p.y + PHYSICS.FALL_SPEED * dt;
      const destRow = Math.floor(nextY);
      const supportAtRow =
        this._isSolid(col, destRow + 1) || this._hasTrappedGhostAt(col, destRow + 1);

      if (supportAtRow && nextY >= destRow) {
        p.y = destRow;
      } else if (this._isRope(col, Math.round(nextY)) && p.ropeDropTimer <= 0) {
        p.y = Math.round(nextY);
      } else {
        p.y = Math.min(ROWS - 2, nextY);
      }
      return;
    }

    // 2. 吊鋼索時按「下」放手下落
    if (hangingOnRope && wantsDown && !this._isSolid(col, row + 1)) {
      p.ropeDropTimer = PHYSICS.ROPE_DROP_COOLDOWN_SEC;
      p.y = row + 0.16;
      p.action = 'fall';
      return;
    }

    // 3. 攀爬梯子（支援水平自動對齊容錯）
    const canClimbUp =
      wantsUp &&
      (onLadder ||
        (this._isLadder(Math.round(p.x), row) &&
          Math.abs(p.x - Math.round(p.x)) <= PHYSICS.LADDER_SNAP_TOLERANCE));
    const canClimbDown =
      wantsDown &&
      (onLadder ||
        ladderBelow ||
        (this._isLadder(Math.round(p.x), row + 1) &&
          Math.abs(p.x - Math.round(p.x)) <= PHYSICS.LADDER_SNAP_TOLERANCE));

    if (canClimbUp || canClimbDown) {
      const targetCol = Math.round(p.x);
      p.x += (targetCol - p.x) * Math.min(1, dt * 18);

      if (canClimbUp) {
        const nextY = p.y - PHYSICS.CLIMB_SPEED * dt;
        const headRow = Math.floor(nextY);
        // 到達頂端且出口已啟用
        if (this.exitActive && this._tileAt(targetCol, 0) === TILE.EXIT_LADDER && nextY <= 0.12) {
          p.y = 0;
          this._triggerLevelClear();
          return;
        }
        if (nextY >= 0 && !this._isSolid(targetCol, headRow)) {
          // 確保仍在梯子上或爬上梯頂平台
          if (this._isLadder(targetCol, Math.ceil(nextY)) || this._isLadder(targetCol, row)) {
            p.y = nextY;
            p.action = 'climb';
            p.animPhase += dt * 10;
            this._tickStepSound(dt);
          }
        }
      } else if (canClimbDown) {
        const nextY = p.y + PHYSICS.CLIMB_SPEED * dt;
        const footRow = Math.floor(nextY + 0.99);
        if (
          footRow < ROWS &&
          !this._isSolid(targetCol, footRow) &&
          !this._hasTrappedGhostAt(targetCol, footRow)
        ) {
          p.y = nextY;
          p.action = 'climb';
          p.animPhase += dt * 10;
          this._tickStepSound(dt);
        } else {
          p.y = Math.round(p.y);
        }
      }
      return;
    }

    // 4. 水平移動（地上、鋼索、或在梯子上橫向離開）
    if (hangingOnRope) {
      p.y += (row - p.y) * Math.min(1, dt * 16);
    } else if (grounded && !onLadder) {
      p.y = row;
    }

    const dirX = (wantsRight ? 1 : 0) - (wantsLeft ? 1 : 0);
    if (dirX !== 0) {
      p.facing = dirX;
      // 若在梯子中間橫移，先稍微垂直對齊當前格列以確保走進通道
      if (onLadder && Math.abs(p.y - row) <= 0.35) {
        p.y += (row - p.y) * Math.min(1, dt * 14);
      }

      const step = dirX * PHYSICS.PLAYER_SPEED * dt;
      const nextX = Math.max(0, Math.min(COLS - 1, p.x + step));
      const edgeCol = dirX > 0 ? Math.ceil(nextX - 0.15) : Math.floor(nextX + 0.15);
      const curRow = Math.round(p.y);

      if (!this._isSolid(edgeCol, curRow)) {
        p.x = nextX;
        p.animPhase += dt * 12;
        p.action = hangingOnRope ? 'rope' : 'run';
        if (!hangingOnRope) this._tickStepSound(dt);
      } else {
        p.x = dirX > 0 ? Math.min(p.x, edgeCol - 1) : Math.max(p.x, edgeCol + 1);
      }
    } else if (p.digAnimTimer <= 0) {
      p.action = hangingOnRope ? 'rope' : onLadder ? 'climb' : 'idle';
    }

    // 檢查是否已經抵達已啟用的隱藏過關梯子頂端
    if (
      this.exitActive &&
      this._tileAt(Math.round(p.x), 0) === TILE.EXIT_LADDER &&
      p.y <= 0.12
    ) {
      this._triggerLevelClear();
    }
  }

  _tickStepSound(dt) {
    this.stepSoundTimer -= dt;
    if (this.stepSoundTimer <= 0) {
      this.stepSoundTimer = 0.22;
      audio.play('step');
    }
  }

  _updateGhosts(dt) {
    const trappedCells = new Set();
    for (const g of this.ghosts) {
      if (g.state === 'TRAPPED') {
        trappedCells.add(`${Math.round(g.x)},${Math.round(g.y)}`);
      }
    }

    this.aiTickAccumulator += dt;
    const refreshAI = this.aiTickAccumulator >= PHYSICS.AI_REFRESH_SEC;
    if (refreshAI) {
      this.aiTickAccumulator = 0;
    }

    const pc = Math.round(this.player.x);
    const pr = Math.round(this.player.y);

    for (const g of this.ghosts) {
      if (g.stunTimer > 0) {
        g.stunTimer = Math.max(0, g.stunTimer - dt);
        continue;
      }

      // 狀態 1：困在磚洞中
      if (g.state === 'TRAPPED') {
        g.trapTimer -= dt;
        g.animPhase += dt * 8;
        if (g.trapTimer <= 0) {
          g.state = 'CLIMBING_OUT';
          g.climbStartY = g.y;
          g.climbProgress = 0;
          const dirToPlayer = this.player.x >= g.x ? 1 : -1;
          const gc = Math.round(g.x);
          const gr = Math.round(g.y);
          // 選擇不被擋住的爬出側
          if (gc + dirToPlayer >= 0 && gc + dirToPlayer < COLS && !this._isSolid(gc + dirToPlayer, gr - 1)) {
            g.exitDir = dirToPlayer;
          } else if (gc - dirToPlayer >= 0 && gc - dirToPlayer < COLS && !this._isSolid(gc - dirToPlayer, gr - 1)) {
            g.exitDir = -dirToPlayer;
          } else {
            g.exitDir = 0;
          }
        }
        continue;
      }

      // 狀態 2：正在從洞口爬出
      if (g.state === 'CLIMBING_OUT') {
        g.climbProgress += dt / 0.65;
        if (g.climbProgress >= 1) {
          g.y = Math.max(0, Math.round(g.climbStartY) - 1);
          g.x = Math.max(0, Math.min(COLS - 1, Math.round(g.x) + g.exitDir * 0.72));
          g.state = 'CHASE';
          g.moveDir = { dc: g.exitDir || 1, dr: 0 };
        } else {
          g.y = g.climbStartY - g.climbProgress;
          if (g.climbProgress > 0.65) {
            g.x += g.exitDir * dt * 1.4;
          }
        }
        continue;
      }

      // 狀態 3：正常追擊
      const gc = Math.round(g.x);
      const gr = Math.round(g.y);

      // 檢查是否踩進已被挖開的空洞內
      if (this.dugHoles.has(`${gc},${gr}`) && Math.abs(g.x - gc) < 0.35) {
        g.x = gc;
        g.y = gr;
        g.state = 'TRAPPED';
        g.trapTimer = PHYSICS.GHOST_TRAP_SEC;
        audio.play('trap');
        this._spawnParticles(gc + 0.5, gr + 0.4, '#38bdf8', 8, 2.2);
        continue;
      }

      const onLadder = this._isLadder(gc, gr);
      const onRope = this._isRope(gc, gr);
      const belowSolid = this._isSolid(gc, gr + 1);
      const belowLadder = this._isLadder(gc, gr + 1);
      const belowTrapped = trappedCells.has(`${gc},${gr + 1}`);
      const grounded =
        g.y >= gr - 0.08 && g.y <= gr + 0.1 && (belowSolid || belowLadder || belowTrapped);

      // 半空下落
      if (!onLadder && !onRope && !grounded) {
        g.x += (gc - g.x) * Math.min(1, dt * 10);
        const nextY = g.y + PHYSICS.FALL_SPEED * dt;
        const destR = Math.floor(nextY);
        const support =
          this._isSolid(gc, destR + 1) || trappedCells.has(`${gc},${destR + 1}`);
        if (support && nextY >= destR) {
          g.y = destR;
        } else {
          g.y = Math.min(ROWS - 2, nextY);
        }
        continue;
      }

      if (refreshAI) {
        g.moveDir = computeNextStep(
          this.grid,
          this.dugHoles,
          this.exitActive,
          trappedCells,
          gc,
          gr,
          pc,
          pr
        );
      }

      const speed =
        this.frenzyTimer > 0 ? PHYSICS.GHOST_FRENZY_SPEED : PHYSICS.GHOST_SPEED;
      const { dc, dr } = g.moveDir;

      if (dr !== 0 && (onLadder || (dr > 0 && (belowLadder || onRope)))) {
        g.x += (gc - g.x) * Math.min(1, dt * 12);
        const nextY = g.y + dr * speed * 0.85 * dt;
        const checkR = dr > 0 ? Math.floor(nextY + 0.98) : Math.floor(nextY);
        if (!this._isSolid(gc, checkR)) {
          g.y = Math.max(0, Math.min(ROWS - 2, nextY));
          g.animPhase += dt * 9;
        }
      } else if (dc !== 0) {
        g.facing = dc;
        if (onRope || grounded || onLadder) {
          g.y += (gr - g.y) * Math.min(1, dt * 12);
        }
        const nextX = Math.max(0, Math.min(COLS - 1, g.x + dc * speed * dt));
        const edgeC = dc > 0 ? Math.ceil(nextX - 0.15) : Math.floor(nextX + 0.15);
        if (!this._isSolid(edgeC, gr)) {
          g.x = nextX;
          g.animPhase += dt * 10;
        }
      }
    }
  }

  _checkCollisions() {
    const p = this.player;

    // 1. 檢查知識寶箱碰觸
    for (const ch of this.chests) {
      if (ch.collected || ch.cooldown > 0) continue;
      const dist = Math.hypot(p.x - ch.col, p.y - ch.row);
      if (dist < 0.62) {
        this.state = GAME_STATE.QUIZ_FROZEN;
        this.clearInputs();
        audio.play('chestOpen');
        if (typeof this.callbacks.onQuizTrigger === 'function') {
          this.callbacks.onQuizTrigger(ch);
        }
        return;
      }
    }

    // 2. 檢查與鬼接觸（無敵、剛答錯緩衝、或鬼困在洞裡均不扣命）
    if (p.invincibleTimer > 0 || this.postWrongGraceTimer > 0) return;

    for (const g of this.ghosts) {
      if (g.state === 'TRAPPED') continue;
      const dx = Math.abs(p.x - g.x);
      const dy = Math.abs(p.y - g.y);
      if (dx < 0.52 && dy < 0.55) {
        this._handlePlayerDeath('你被守衛抓到了！');
        return;
      }
    }
  }

  /**
   * 知識彈窗作答完畢後由 main.js 呼叫，恢復迷宮並套用獎懲
   */
  resolveQuiz(chestType, isCorrect, timeLeft = 0) {
    const chest = this.chests.find((c) => c.type === chestType);
    if (!chest) {
      this.state = GAME_STATE.PLAYING;
      return;
    }

    const meta = CHEST_META[chestType];

    if (isCorrect) {
      chest.collected = true;
      chest.cooldown = 0;
      const bonus = SCORE.CHEST_CORRECT + Math.max(0, Math.round(timeLeft)) * SCORE.TIME_BONUS_MULT;
      this.score += bonus;
      this.player.invincibleTimer = PHYSICS.INVINCIBLE_SEC;

      audio.play('correct');
      this._spawnParticles(chest.col + 0.5, chest.row + 0.5, meta.color, 22, 4.6);
      this._spawnFloatingText(chest.col + 0.5, chest.row, `+${bonus}`, meta.color);

      if (this.chests.every((c) => c.collected)) {
        this.exitActive = true;
        audio.play('exitReveal');
        this.showBanner('✨ 三大知識寶箱集齊！隱藏過關天梯已顯現！', 3.4);
      } else {
        const remaining = this.chests.filter((c) => !c.collected).length;
        this.showBanner(`${meta.icon} 成功收服「${meta.shortName}」！還剩 ${remaining} 個寶箱`, 2.2);
      }
    } else {
      chest.cooldown = PHYSICS.CHEST_COOLDOWN_SEC;
      this.frenzyTimer = PHYSICS.FRENZY_SEC;
      this.postWrongGraceTimer = PHYSICS.POST_WRONG_GRACE_SEC;

      // 防暴斃緩衝：把貼身距離過近的鬼微幅推退並暫停 0.8s
      for (const g of this.ghosts) {
        const dist = Math.hypot(g.x - this.player.x, g.y - this.player.y);
        if (dist < 2.6 && g.state === 'CHASE') {
          g.stunTimer = PHYSICS.POST_WRONG_GRACE_SEC;
          const pushDir = g.x >= this.player.x ? 1 : -1;
          const targetC = Math.round(g.x + pushDir);
          if (targetC >= 0 && targetC < COLS && !this._isSolid(targetC, Math.round(g.y))) {
            g.x = targetC;
          }
        }
      }

      audio.play('wrong');
      this._spawnParticles(chest.col + 0.5, chest.row + 0.5, '#ef4444', 16, 3.8);
      this.showBanner('⚡ 護盾破裂！寶箱鎖定 5 秒、守衛進入加速追擊！', 2.8);
    }

    this.state = GAME_STATE.PLAYING;
    this._emitHud();
  }

  _handlePlayerDeath(reason) {
    audio.play('hurt');
    this._spawnParticles(this.player.x + 0.5, this.player.y + 0.5, '#f43f5e', 24, 4.5);

    this.lives -= 1;
    this.clearInputs();

    if (this.lives <= 0) {
      this.state = GAME_STATE.GAME_OVER;
      audio.play('gameOver');
      this._emitHud();
      if (typeof this.callbacks.onGameOver === 'function') {
        this.callbacks.onGameOver({
          score: this.score,
          levelId: this.level.id,
          reason
        });
      }
      return;
    }

    // 保留已收服的寶箱，重置角色與守衛位置並給予短暫無敵閃爍
    this._resetEntities();
    this.showBanner(`${reason}（剩餘 ${this.lives} 條命，已收集寶箱保留）`, 2.6);
    this._emitHud();
  }

  _triggerLevelClear() {
    if (this.state === GAME_STATE.LEVEL_CLEAR) return;
    this.state = GAME_STATE.LEVEL_CLEAR;
    this.clearInputs();

    const parBonus = Math.max(0, Math.round((this.level.parTime - this.elapsedSec) * SCORE.PAR_TIME_BONUS_MULT));
    const totalBonus = SCORE.LEVEL_CLEAR_BASE + parBonus;
    this.score += totalBonus;

    audio.play('levelClear');
    this._emitHud();

    if (typeof this.callbacks.onLevelClear === 'function') {
      this.callbacks.onLevelClear({
        levelId: this.level.id,
        levelName: this.level.name,
        score: this.score,
        levelBonus: totalBonus,
        elapsedSec: Math.round(this.elapsedSec),
        livesLeft: this.lives
      });
    }
  }

  // --- 粒子與飄浮得分特效 ---
  _spawnParticles(x, y, color, count = 10, speed = 3) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const mag = (0.3 + Math.random() * 0.7) * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * mag,
        vy: Math.sin(angle) * mag - 1.0,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 2.5 + Math.random() * 3.5,
        color
      });
    }
  }

  _spawnFloatingText(x, y, text, color = '#fde047') {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 1.05,
      maxLife: 1.05
    });
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += 6.5 * dt;
      pt.life -= dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= 0.9 * dt;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
  }
}
