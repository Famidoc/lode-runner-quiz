/**
 * 知識尋寶《Lode Runner》主控程式與 UI 綁定
 */

import { GAME_STATE, ECOSYSTEM } from './config.js';
import { audio } from './audio.js';
import { storage } from './storage.js';
import { loadAllGameData, preloadPlantImage } from './dataLoader.js';
import { LodeRunnerEngine } from './engine.js';
import { MazeRenderer } from './renderer.js';
import { QuizModalController } from './quizModal.js';
import { generateFallbackSolvedBoard } from './sudokuEngine.js';

class GameApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new MazeRenderer(this.canvas);
    this.quizModal = new QuizModalController();

    this.gameData = null;
    this.saveData = storage.load();
    this.currentLevelIdx = 0;
    this.levelRunQuestions = null;

    this.engine = new LodeRunnerEngine({
      onHudUpdate: (snap) => this._updateHud(snap),
      onQuizTrigger: (chest) => this._handleQuizTrigger(chest),
      onLevelClear: (summary) => this._handleLevelClear(summary),
      onGameOver: (info) => this._handleGameOver(info)
    });

    this.lastFrameTime = performance.now();
    this._bindDOM();
    this._bindKeyboard();
    this._bindTouchControls();
  }

  async init() {
    audio.setMuted(this.saveData.muted);
    this._updateMuteBtn();
    this._updateHighScoreUI();

    try {
      this.gameData = await loadAllGameData();
      this._renderLevelSelectGrid();
      this.startLevel(Math.min(this.saveData.unlockedLevel - 1, this.gameData.levels.length - 1), {
        pauseAtStart: true
      });
      this._showStartOverlay();
    } catch (err) {
      console.error('初始化失敗:', err);
      const loadingTip = document.getElementById('start-loading-tip');
      if (loadingTip) {
        loadingTip.textContent = `資料載入失敗：${err.message}（請使用本地 HTTP 伺服器或網站存取）`;
        loadingTip.style.color = '#fca5a5';
      }
    }

    this._startLoop();
  }

  _startLoop() {
    const tick = (now) => {
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      this.engine.update(dt);
      this.renderer.render(this.engine, now);

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /**
   * 為本關抽取三大知識題點並立即預載花草圖片
   */
  _prepareLevelQuestions(levelObj) {
    const { plants, sudokus, medical } = this.gameData;

    // 1. 題點 A：捻花惹草（優先複習錯題池）
    let targetPlant = null;
    if (this.saveData.plantWrongPool.length > 0 && Math.random() < 0.5) {
      const wrongPickId =
        this.saveData.plantWrongPool[
          Math.floor(Math.random() * this.saveData.plantWrongPool.length)
        ];
      targetPlant = plants.find((p) => p.id === wrongPickId) || null;
    }
    if (!targetPlant) {
      targetPlant = plants[Math.floor(Math.random() * plants.length)];
    }

    const distractors = plants
      .filter((p) => p.id !== targetPlant.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);
    const plantOptions = [targetPlant.name, ...distractors.map((d) => d.name)].sort(
      () => Math.random() - 0.5
    );
    const plantPreload = preloadPlantImage(targetPlant);

    // 2. 題點 B：數獨殘局
    const sudokuObj =
      sudokus && sudokus.length > 0
        ? sudokus[Math.floor(Math.random() * sudokus.length)]
        : {
            id: 'fallback',
            name: '經典隨機盤面',
            icon: '🔢',
            solution: generateFallbackSolvedBoard()
          };

    // 3. 題點 C：加減學學（優先複習錯題池）
    let medObj = null;
    if (this.saveData.medicalWrongPool.length > 0 && Math.random() < 0.5) {
      const wrongMedId =
        this.saveData.medicalWrongPool[
          Math.floor(Math.random() * this.saveData.medicalWrongPool.length)
        ];
      medObj = medical.find((m) => m.id === wrongMedId) || null;
    }
    if (!medObj) {
      medObj = medical[Math.floor(Math.random() * medical.length)];
    }

    this.levelRunQuestions = {
      plant: {
        target: targetPlant,
        options: plantOptions,
        preload: plantPreload
      },
      sudoku: {
        puzzle: sudokuObj,
        holes: levelObj.sudokuHoles || 5
      },
      medical: medObj
    };
  }

  startLevel(levelIdx, { preserveScore = false, pauseAtStart = false } = {}) {
    if (!this.gameData) return;
    const total = this.gameData.levels.length;
    this.currentLevelIdx = Math.max(0, Math.min(total - 1, levelIdx));
    const levelObj = this.gameData.levels[this.currentLevelIdx];

    this._prepareLevelQuestions(levelObj);
    this.engine.loadLevel(levelObj, { preserveScore });

    if (pauseAtStart) {
      this.engine.state = GAME_STATE.PAUSED;
    }

    this._hideSubModals();
    this._updateHud(this.engine.getHudSnapshot());
  }

  async _handleQuizTrigger(chest) {
    if (!this.levelRunQuestions) return;

    if (chest.type === 'plant') {
      const q = this.levelRunQuestions.plant;
      await this.quizModal.open({
        type: 'plant',
        payload: { target: q.target, options: q.options },
        preloadResult: q.preload,
        onResolve: (ok, left) => {
          this.saveData = storage.recordQuizOutcome('plant', q.target.id, ok);
          this.engine.resolveQuiz('plant', ok, left);
          this._syncHighScore();
        }
      });
    } else if (chest.type === 'sudoku') {
      const s = this.levelRunQuestions.sudoku;
      await this.quizModal.open({
        type: 'sudoku',
        payload: s.puzzle,
        sudokuHoles: s.holes,
        onResolve: (ok, left) => {
          this.saveData = storage.recordQuizOutcome('sudoku', s.puzzle.id, ok);
          this.engine.resolveQuiz('sudoku', ok, left);
          this._syncHighScore();
        }
      });
    } else if (chest.type === 'medical') {
      const m = this.levelRunQuestions.medical;
      await this.quizModal.open({
        type: 'medical',
        payload: m,
        onResolve: (ok, left) => {
          this.saveData = storage.recordQuizOutcome('medical', m.id, ok);
          this.engine.resolveQuiz('medical', ok, left);
          this._syncHighScore();
        }
      });
    }
  }

  _syncHighScore() {
    this.saveData = storage.updateHighScore(this.engine.score);
    this._updateHighScoreUI();
  }

  _handleLevelClear(summary) {
    this.saveData = storage.recordLevelClear({
      levelId: summary.levelId,
      score: summary.score,
      elapsedSec: summary.elapsedSec,
      totalLevels: this.gameData.levels.length
    });
    this._updateHighScoreUI();
    this._renderLevelSelectGrid();

    const modal = document.getElementById('clear-modal');
    document.getElementById('clear-title').textContent = `🎉 第 ${summary.levelId} 關過關！`;
    document.getElementById('clear-subtitle').textContent = summary.levelName;
    document.getElementById('clear-score').textContent = String(summary.score);
    document.getElementById('clear-time').textContent = `${summary.elapsedSec} 秒`;
    document.getElementById('clear-lives').textContent = `${summary.livesLeft} / 3`;

    // 渲染本關遇到的三大知識回顧與生態連結卡片
    const reviewEl = document.getElementById('clear-review-list');
    const q = this.levelRunQuestions;
    const plantLink = `${ECOSYSTEM.PLANTS_SITE_URL}?plant=${encodeURIComponent(q.plant.target.name)}`;
    const medUrl = q.medical.videoUrl || ECOSYSTEM.YOUTUBE_SEARCH_URL;

    reviewEl.innerHTML = `
      <div class="review-card plant">
        <div class="review-label">🌿 捻花惹草</div>
        <div class="review-main"><strong>${q.plant.target.name}</strong>（${q.plant.target.family || '植物圖鑑'}）</div>
        <a href="${plantLink}" target="_blank" rel="noopener" class="review-link">前往圖鑑看詳情 →</a>
      </div>
      <div class="review-card sudoku">
        <div class="review-label">🔢 數獨共享平台</div>
        <div class="review-main"><strong>${q.sudoku.puzzle.name}</strong>（${q.sudoku.holes} 格殘局挑戰）</div>
        <a href="${ECOSYSTEM.SUDOKU_SITE_URL}" target="_blank" rel="noopener" class="review-link">前往挑戰完整數獨 →</a>
      </div>
      <div class="review-card medical">
        <div class="review-label">🩺 加減學學家醫觀念</div>
        <div class="review-main">${q.medical.explanation}</div>
        <a href="${medUrl}" target="_blank" rel="noopener" class="review-link">📺 前往《加減學學》頻道 →</a>
      </div>
    `;

    const nextBtn = document.getElementById('btn-next-level');
    const isFinal = this.currentLevelIdx >= this.gameData.levels.length - 1;
    nextBtn.textContent = isFinal ? '🏆 重溫第 1 關（挑戰更高分）' : '▶ 進入下一關';

    modal.classList.remove('hidden');
  }

  _handleGameOver(info) {
    this._syncHighScore();
    const modal = document.getElementById('gameover-modal');
    document.getElementById('gameover-reason').textContent = info.reason || '生命耗盡！';
    document.getElementById('gameover-score').textContent = String(info.score);
    document.getElementById('gameover-best').textContent = String(this.saveData.highScore);
    modal.classList.remove('hidden');
  }

  _updateHud(snap) {
    document.getElementById('hud-level').textContent = `第 ${snap.levelId} 關`;
    document.getElementById('hud-score').textContent = String(snap.score);
    document.getElementById('hud-time').textContent = `${Math.floor(snap.elapsedSec)}s`;

    // 生命愛心
    const livesEl = document.getElementById('hud-lives');
    livesEl.textContent = '❤️'.repeat(Math.max(0, snap.lives)) + '🖤'.repeat(Math.max(0, 3 - snap.lives));

    // 三大知識寶箱燈號
    for (const ch of snap.chests) {
      const pill = document.getElementById(`hud-chest-${ch.type}`);
      if (!pill) continue;
      pill.classList.toggle('done', ch.collected);
      pill.classList.toggle('locked', !ch.collected && ch.cooldown > 0);
    }

    // 傳送門狀態與警報狀態
    const portalBadge = document.getElementById('hud-portal');
    if (snap.frenzyTimer > 0) {
      portalBadge.textContent = `🚨 狂暴追擊 ${Math.ceil(snap.frenzyTimer)}s`;
      portalBadge.className = 'hud-status frenzy';
    } else if (snap.exitActive) {
      portalBadge.textContent = '🪜 過關天梯已開啟！';
      portalBadge.className = 'hud-status exit-open';
    } else {
      const done = snap.chests.filter((c) => c.collected).length;
      portalBadge.textContent = `📦 寶箱 ${done} / 3`;
      portalBadge.className = 'hud-status';
    }

    const pauseBtn = document.getElementById('btn-pause');
    if (pauseBtn) {
      pauseBtn.textContent = snap.state === GAME_STATE.PAUSED ? '▶ 繼續' : '⏸ 暫停';
    }
  }

  _updateHighScoreUI() {
    document.getElementById('hud-best').textContent = String(this.saveData.highScore || 0);
  }

  _updateMuteBtn() {
    const btn = document.getElementById('btn-mute');
    if (btn) {
      btn.textContent = this.saveData.muted ? '🔇 靜音' : '🔊 音效';
    }
  }

  _renderLevelSelectGrid() {
    const grid = document.getElementById('level-select-grid');
    if (!grid || !this.gameData) return;
    grid.innerHTML = '';

    this.gameData.levels.forEach((lvl, idx) => {
      const unlocked = lvl.id <= this.saveData.unlockedLevel;
      const rec = this.saveData.levelRecords[String(lvl.id)];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `level-card ${unlocked ? '' : 'locked'}`;
      card.disabled = !unlocked;
      card.innerHTML = `
        <div class="level-card-num">第 ${lvl.id} 關 ${rec?.cleared ? '✅' : unlocked ? '' : '🔒'}</div>
        <div class="level-card-title">${lvl.name}</div>
        <div class="level-card-meta">守衛 ${lvl.ghosts.length} 名・數獨 ${lvl.sudokuHoles} 格</div>
        <div class="level-card-best">${rec?.bestScore ? `最高 ${rec.bestScore} 分 (${rec.bestTime}s)` : unlocked ? '點擊挑戰' : '通關前一關解鎖'}</div>
      `;
      card.addEventListener('click', () => {
        audio.unlock();
        this.startLevel(idx, { preserveScore: false });
      });
      grid.appendChild(card);
    });
  }

  _showStartOverlay() {
    const el = document.getElementById('start-modal');
    const tip = document.getElementById('start-loading-tip');
    if (tip) {
      tip.textContent = `已載入 ${this.gameData.plants.length} 種花草、${this.gameData.sudokus.length} 組數獨盤面、${this.gameData.medical.length} 題家醫衛教！`;
    }
    el.classList.remove('hidden');
  }

  _hideSubModals() {
    ['start-modal', 'levels-modal', 'clear-modal', 'gameover-modal'].forEach((id) => {
      document.getElementById(id)?.classList.add('hidden');
    });
  }

  _anyModalBlockingMaze() {
    if (this.quizModal.isOpen()) return true;
    return ['start-modal', 'levels-modal', 'clear-modal', 'gameover-modal'].some(
      (id) => !document.getElementById(id)?.classList.contains('hidden')
    );
  }

  _bindDOM() {
    document.getElementById('btn-start-play').addEventListener('click', () => {
      audio.unlock();
      this._hideSubModals();
      if (this.engine.state === GAME_STATE.PAUSED) {
        this.engine.state = GAME_STATE.PLAYING;
      }
      this.engine._emitHud();
    });

    document.getElementById('btn-open-levels-from-start').addEventListener('click', () => {
      this._hideSubModals();
      document.getElementById('levels-modal').classList.remove('hidden');
    });

    document.getElementById('btn-levels').addEventListener('click', () => {
      if (this.quizModal.isOpen()) return;
      if (this.engine.state === GAME_STATE.PLAYING) {
        this.engine.togglePause();
      }
      this._renderLevelSelectGrid();
      document.getElementById('levels-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-levels').addEventListener('click', () => {
      document.getElementById('levels-modal').classList.add('hidden');
      if (this.engine.state === GAME_STATE.PAUSED) {
        this.engine.togglePause();
      }
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      if (this.quizModal.isOpen()) return;
      audio.unlock();
      this.engine.togglePause();
    });

    document.getElementById('btn-retry').addEventListener('click', () => {
      if (this.quizModal.isOpen()) return;
      audio.unlock();
      this.startLevel(this.currentLevelIdx, { preserveScore: false });
    });

    document.getElementById('btn-mute').addEventListener('click', () => {
      audio.unlock();
      const next = !this.saveData.muted;
      this.saveData = storage.setMuted(next);
      audio.setMuted(next);
      this._updateMuteBtn();
    });

    document.getElementById('btn-next-level').addEventListener('click', () => {
      audio.unlock();
      const isFinal = this.currentLevelIdx >= this.gameData.levels.length - 1;
      const nextIdx = isFinal ? 0 : this.currentLevelIdx + 1;
      this.startLevel(nextIdx, { preserveScore: !isFinal });
    });

    document.getElementById('btn-replay-level').addEventListener('click', () => {
      audio.unlock();
      this.startLevel(this.currentLevelIdx, { preserveScore: false });
    });

    document.getElementById('btn-gameover-retry').addEventListener('click', () => {
      audio.unlock();
      this.startLevel(this.currentLevelIdx, { preserveScore: false });
    });

    document.getElementById('btn-gameover-levels').addEventListener('click', () => {
      this._hideSubModals();
      this._renderLevelSelectGrid();
      document.getElementById('levels-modal').classList.remove('hidden');
    });
  }

  _bindKeyboard() {
    const keyMap = {
      ArrowLeft: 'left',
      KeyA: 'left',
      ArrowRight: 'right',
      KeyD: 'right',
      ArrowUp: 'up',
      KeyW: 'up',
      ArrowDown: 'down',
      KeyS: 'down'
    };

    window.addEventListener('keydown', (e) => {
      audio.unlock();

      if (this._anyModalBlockingMaze()) {
        return;
      }

      if (e.code in keyMap) {
        e.preventDefault();
        this.engine.setInput(keyMap[e.code], true);
        return;
      }

      if (e.code === 'KeyZ' || e.code === 'KeyQ' || e.code === 'KeyJ') {
        e.preventDefault();
        this.engine.dig(-1);
        return;
      }

      if (e.code === 'KeyX' || e.code === 'KeyE' || e.code === 'KeyK') {
        e.preventDefault();
        this.engine.dig(1);
        return;
      }

      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        this.engine.togglePause();
        return;
      }

      if (e.code === 'KeyR') {
        e.preventDefault();
        this.startLevel(this.currentLevelIdx, { preserveScore: false });
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code in keyMap) {
        this.engine.setInput(keyMap[e.code], false);
      }
    });

    window.addEventListener('blur', () => {
      this.engine.clearInputs();
    });
  }

  _bindTouchControls() {
    const holdButtons = document.querySelectorAll('[data-move]');
    holdButtons.forEach((btn) => {
      const dir = btn.dataset.move;
      const press = (e) => {
        e.preventDefault();
        audio.unlock();
        btn.classList.add('active');
        this.engine.setInput(dir, true);
      };
      const release = (e) => {
        e.preventDefault();
        btn.classList.remove('active');
        this.engine.setInput(dir, false);
      };

      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    });

    const digLeft = document.getElementById('btn-dig-left');
    const digRight = document.getElementById('btn-dig-right');

    const bindDig = (el, dir) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        audio.unlock();
        el.classList.add('active');
        this.engine.dig(dir);
      });
      const rel = () => el.classList.remove('active');
      el.addEventListener('pointerup', rel);
      el.addEventListener('pointercancel', rel);
      el.addEventListener('pointerleave', rel);
    };

    bindDig(digLeft, -1);
    bindDig(digRight, 1);
  }
}

// 註冊離線 Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  app.init();
});
