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
import { renderQrSvg } from './qrcode.js';
import { leaderboardService } from './leaderboard.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}分${String(r).padStart(2, '0')}秒`;
}

class GameApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new MazeRenderer(this.canvas);
    this.quizModal = new QuizModalController();

    this.gameData = null;
    this.saveData = storage.load();
    this.currentLevelIdx = 0;
    this.levelRunQuestions = null;
    this.deferredPrompt = null;
    this._modalPausedGame = false;
    this._returnToModalId = null;
    this._lastResultSummary = null;
    this._submittingLb = false;

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
    this._bindPwaInstall();
  }

  async init() {
    audio.setMuted(this.saveData.muted);
    this._updateMuteBtn();
    this._updateHighScoreUI();

    try {
      this.gameData = await loadAllGameData();
      this._renderLevelSelectGrid();
      this.startLevel(Math.min(this.saveData.unlockedLevel - 1, this.gameData.levels.length - 1), {
        preserveScore: false,
        waitForStart: true
      });
      this._showStartOverlay();
      this._syncReadyOverlay();
      leaderboardService.init().catch(() => {});
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

  startLevel(levelIdx, { preserveScore = false, waitForStart = true } = {}) {
    if (!this.gameData) return;
    const total = this.gameData.levels.length;
    this.currentLevelIdx = Math.max(0, Math.min(total - 1, levelIdx));
    const levelObj = this.gameData.levels[this.currentLevelIdx];

    this._prepareLevelQuestions(levelObj);
    this._modalPausedGame = false;
    this._returnToModalId = null;
    this._hideSubModals();
    this.engine.loadLevel(levelObj, { preserveScore, waitForStart });
    this._updateHud(this.engine.getHudSnapshot());
    this._syncReadyOverlay();
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
    const totalLevels = this.gameData.levels.length;
    this.saveData = storage.recordLevelClear({
      levelId: summary.levelId,
      score: summary.score,
      levelScore: summary.levelScore,
      elapsedSec: summary.elapsedSec,
      totalLevels
    });
    this._updateHighScoreUI();
    this._renderLevelSelectGrid();

    const career = storage.getCareerSummary(this.saveData);
    const isFinal = this.currentLevelIdx >= totalLevels - 1;

    const modal = document.getElementById('clear-modal');
    document.getElementById('clear-title').textContent = isFinal
      ? `🏆 恭喜全破 ${totalLevels} 關！`
      : `🎉 第 ${summary.levelId} 關過關！`;
    document.getElementById('clear-subtitle').textContent = summary.levelName;
    document.getElementById('clear-score').textContent = String(summary.score);
    document.getElementById('clear-level-score').textContent = String(summary.levelScore ?? summary.score);
    document.getElementById('clear-time').textContent =
      summary.runElapsedSec && summary.runElapsedSec !== summary.elapsedSec
        ? `${formatDuration(summary.elapsedSec)} / 整趟 ${formatDuration(summary.runElapsedSec)}`
        : formatDuration(summary.elapsedSec);
    document.getElementById('clear-lives').textContent =
      `${'❤️'.repeat(Math.max(0, summary.livesLeft))} (+${summary.lifeBonus ?? 0}分)`;

    const bonusStrip = document.getElementById('clear-bonus-strip');
    if (bonusStrip) {
      bonusStrip.innerHTML = `
        <div>🎁 過關 +500・速通 +${summary.parBonus ?? 0}・愛心 +${summary.lifeBonus ?? 0}</div>
        <div>🏅 ${totalLevels} 關累計總積分：<strong>${career.careerScore} 分</strong>（已計 ${career.scoredLevelsCount} / ${totalLevels} 關）</div>
      `;
    }

    // 渲染本關遇到的三大知識回顧與生態連結卡片
    const reviewEl = document.getElementById('clear-review-list');
    const q = this.levelRunQuestions;
    const plantLink = `${ECOSYSTEM.PLANTS_SITE_URL}?plant=${encodeURIComponent(q.plant.target.name)}`;
    const sudokuTargetId = q.sudoku.puzzle.cloudId || q.sudoku.puzzle.cloudDocId || '';
    const sudokuLink = sudokuTargetId
      ? `${ECOSYSTEM.SUDOKU_SITE_URL}?id=${encodeURIComponent(sudokuTargetId)}`
      : ECOSYSTEM.SUDOKU_SITE_URL;
    const sudokuIdTag = q.sudoku.puzzle.cloudId
      ? `題號 #${String(q.sudoku.puzzle.cloudId).padStart(4, '0')}・`
      : '';
    const medUrl = q.medical.videoUrl || ECOSYSTEM.YOUTUBE_SEARCH_URL;
    const medLinkLabel = q.medical.videoTitle
      ? `📺 觀看：${escapeHtml(q.medical.videoTitle)} →`
      : '📺 前往《加減學學》頻道 →';

    reviewEl.innerHTML = `
      <div class="review-card plant">
        <div class="review-label">🌿 捻花惹草</div>
        <div class="review-main"><strong>${q.plant.target.name}</strong>（${q.plant.target.family || '植物圖鑑'}）</div>
        <a href="${plantLink}" target="_blank" rel="noopener" class="review-link">前往圖鑑看詳情 →</a>
      </div>
      <div class="review-card sudoku">
        <div class="review-label">🔢 數獨共享平台</div>
        <div class="review-main"><strong>${escapeHtml(q.sudoku.puzzle.name)}</strong>（${sudokuIdTag}${q.sudoku.holes} 格殘局挑戰）</div>
        <a href="${escapeHtml(sudokuLink)}" target="_blank" rel="noopener" class="review-link">前往挑戰完整數獨${q.sudoku.puzzle.cloudId ? ` (#${String(q.sudoku.puzzle.cloudId).padStart(4, '0')})` : ''} →</a>
      </div>
      <div class="review-card medical">
        <div class="review-label">🩺 加減學學家醫觀念</div>
        <div class="review-main">${q.medical.explanation}</div>
        <a href="${escapeHtml(medUrl)}" target="_blank" rel="noopener" class="review-link">${medLinkLabel}</a>
      </div>
    `;

    this._lastResultSummary = {
      score: summary.score,
      levelScore: summary.levelScore ?? summary.score,
      careerScore: career.careerScore,
      maxLevel: summary.levelId,
      runStartLevel: summary.runStartLevel || summary.levelId,
      clearedAll: isFinal,
      elapsedSec: summary.elapsedSec,
      runElapsedSec: summary.runElapsedSec ?? summary.elapsedSec
    };
    this._prepareLbSubmitBox('clear', summary.score > 0);

    const nextBtn = document.getElementById('btn-next-level');
    nextBtn.textContent = isFinal ? '🏆 重溫第 1 關（挑戰更高分）' : '▶ 進入下一關';

    modal.classList.remove('hidden');
  }

  _handleGameOver(info) {
    this._syncHighScore();
    const career = storage.getCareerSummary(this.saveData);
    const singleElapsed = info.elapsedSec ?? Math.round(this.engine.elapsedSec || 0);
    const runElapsed = info.runElapsedSec ?? Math.round((this.engine.runElapsedBaseSec || 0) + singleElapsed);

    const modal = document.getElementById('gameover-modal');
    document.getElementById('gameover-reason').textContent = info.reason || '生命耗盡！';
    document.getElementById('gameover-score').textContent = String(info.score);
    document.getElementById('gameover-level-score').textContent = String(info.levelScore ?? this.engine.levelScore ?? 0);
    document.getElementById('gameover-time').textContent =
      runElapsed > singleElapsed
        ? `${formatDuration(singleElapsed)} / 整趟 ${formatDuration(runElapsed)}`
        : formatDuration(singleElapsed);
    document.getElementById('gameover-best').textContent = String(this.saveData.highScore);

    this._lastResultSummary = {
      score: info.score,
      levelScore: info.levelScore ?? this.engine.levelScore ?? 0,
      careerScore: career.careerScore,
      maxLevel: info.levelId || this.currentLevelIdx + 1,
      runStartLevel: info.runStartLevel || this.engine.runStartLevel || this.currentLevelIdx + 1,
      clearedAll: false,
      elapsedSec: singleElapsed,
      runElapsedSec: runElapsed
    };
    this._prepareLbSubmitBox('gameover', info.score > 0);

    modal.classList.remove('hidden');
  }

  _updateHud(snap) {
    const total = this.gameData?.levels?.length || 12;
    document.getElementById('hud-level').textContent = `第 ${snap.levelId} / ${total} 關`;
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
      pauseBtn.textContent =
        snap.state === GAME_STATE.READY
          ? '▶ 開始'
          : snap.state === GAME_STATE.PAUSED
            ? '▶ 繼續'
            : '⏸ 暫停';
    }

    this._syncReadyOverlay();
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

    const total = this.gameData.levels.length;
    const career = storage.getCareerSummary(this.saveData);
    const careerBar = document.getElementById('levels-career-bar');
    if (careerBar) {
      const hint =
        career.scoredLevelsCount === 0 && career.clearedLevelsCount > 0
          ? '過關後自動開始累計各關單關最高分'
          : `已登錄單關成績 ${career.scoredLevelsCount} / ${total} 關`;
      careerBar.innerHTML = `
        <span>🏅 ${total} 關累計總積分：<strong>${career.careerScore} 分</strong></span>
        <span>${hint}</span>
      `;
    }

    this.gameData.levels.forEach((lvl, idx) => {
      const unlocked = lvl.id <= this.saveData.unlockedLevel;
      const rec = this.saveData.levelRecords[String(lvl.id)];
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `level-card ${unlocked ? '' : 'locked'}`;
      card.disabled = !unlocked;
      const bestLine = rec?.bestLevelScore
        ? `單關最高 ${rec.bestLevelScore} 分 (${formatDuration(rec.bestTime)})`
        : rec?.cleared
          ? `已通關 (${formatDuration(rec.bestTime)})`
          : unlocked
            ? '點擊挑戰'
            : '通關前一關解鎖';

      card.innerHTML = `
        <div class="level-card-num">第 ${lvl.id} 關 ${rec?.cleared ? '✅' : unlocked ? '' : '🔒'}</div>
        <div class="level-card-title">${lvl.name}</div>
        <div class="level-card-meta">守衛 ${lvl.ghosts.length} 名・數獨 ${lvl.sudokuHoles} 格</div>
        <div class="level-card-best">${bestLine}</div>
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
      tip.textContent = `全 ${this.gameData.levels.length} 關｜已載入 ${this.gameData.plants.length} 種花草、${this.gameData.sudokus.length} 組數獨、${this.gameData.medical.length} 題家醫衛教！`;
    }
    el.classList.remove('hidden');
  }

  _hideSubModals() {
    [
      'start-modal',
      'levels-modal',
      'clear-modal',
      'gameover-modal',
      'leaderboard-modal',
      'qr-modal'
    ].forEach((id) => {
      document.getElementById(id)?.classList.add('hidden');
    });
  }

  _anyModalBlockingMaze() {
    if (this.quizModal.isOpen()) return true;
    return [
      'start-modal',
      'levels-modal',
      'clear-modal',
      'gameover-modal',
      'leaderboard-modal',
      'qr-modal'
    ].some((id) => !document.getElementById(id)?.classList.contains('hidden'));
  }

  _syncReadyOverlay() {
    const overlay = document.getElementById('ready-overlay');
    if (!overlay) return;
    const show = this.engine.state === GAME_STATE.READY && !this._anyModalBlockingMaze();
    overlay.classList.toggle('hidden', !show);
    if (show) {
      const titleEl = document.getElementById('ready-title');
      const descEl = document.getElementById('ready-desc');
      if (titleEl) {
        titleEl.textContent = this.engine.readyTitle || `第 ${this.engine.level?.id || 1} 關`;
      }
      if (descEl) {
        descEl.textContent =
          this.engine.readyReason || '觀察迷宮與守衛位置，準備好再出發！';
      }
    }
  }

  _startFromReady() {
    audio.unlock();
    this.engine.startPlaying();
    this._syncReadyOverlay();
  }

  _openOverlayModal(modalId, { returnTo = null } = {}) {
    if (this.quizModal.isOpen()) return false;
    if (!returnTo && this.engine.state === GAME_STATE.PLAYING) {
      this.engine.togglePause();
      this._modalPausedGame = true;
    }
    this._returnToModalId = returnTo;
    this._hideSubModals();
    document.getElementById(modalId)?.classList.remove('hidden');
    this._syncReadyOverlay();
    return true;
  }

  _closeOverlayModal(modalId) {
    document.getElementById(modalId)?.classList.add('hidden');
    if (this._returnToModalId) {
      const targetId = this._returnToModalId;
      this._returnToModalId = null;
      document.getElementById(targetId)?.classList.remove('hidden');
      this._syncReadyOverlay();
      return;
    }
    if (this._modalPausedGame && !this._anyModalBlockingMaze()) {
      this._modalPausedGame = false;
      if (this.engine.state === GAME_STATE.PAUSED) {
        this.engine.togglePause();
      }
    }
    this._syncReadyOverlay();
  }

  _exitToHome() {
    audio.unlock();
    this.engine.clearInputs();
    this._modalPausedGame = false;
    this._returnToModalId = null;
    this._hideSubModals();

    const total = this.gameData?.levels?.length || 1;
    const unlockedIdx = Math.min(Math.max(0, (this.saveData.unlockedLevel || 1) - 1), total - 1);
    this.startLevel(unlockedIdx, { preserveScore: false, waitForStart: true });
    this._showStartOverlay();
    this._syncReadyOverlay();
  }

  _prepareLbSubmitBox(prefix, visible) {
    const box = document.getElementById(`${prefix}-lb-box`);
    const input = document.getElementById(`${prefix}-lb-name`);
    const btn = document.getElementById(`btn-${prefix}-lb-submit`);
    const status = document.getElementById(`${prefix}-lb-status`);
    if (!box) return;

    box.classList.toggle('hidden', !visible);
    if (input) input.value = this.saveData.playerName || '';
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🏆 登錄分數';
    }
    if (status) {
      status.classList.add('hidden');
      status.innerHTML = '';
    }
  }

  async _submitLeaderboardFrom(prefix) {
    if (this._submittingLb || !this._lastResultSummary) return;
    const input = document.getElementById(`${prefix}-lb-name`);
    const btn = document.getElementById(`btn-${prefix}-lb-submit`);
    const status = document.getElementById(`${prefix}-lb-status`);
    if (!btn || !status) return;

    this._submittingLb = true;
    btn.disabled = true;
    btn.textContent = '⏳ 登錄中…';

    try {
      const res = await leaderboardService.submitScore({
        name: input?.value || '',
        ...this._lastResultSummary
      });

      this.saveData = storage.load();
      ['clear-lb-name', 'gameover-lb-name'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = res.cleanName;
      });

      const modeText = res.syncedCloud
        ? `☁️ 「${escapeHtml(res.cleanName)}」已登錄全球排行榜！`
        : `📱 「${escapeHtml(res.cleanName)}」已存於本機排行榜（離線模式）！`;

      status.innerHTML = `<span>${modeText}</span><button type="button" class="btn-inline-link" id="btn-${prefix}-view-lb">查看排行榜 →</button>`;
      status.classList.remove('hidden');

      document.getElementById(`btn-${prefix}-view-lb`)?.addEventListener('click', () => {
        this._openLeaderboardModal({ returnTo: `${prefix}-modal` });
      });

      btn.textContent = '✅ 更新分數';
    } finally {
      btn.disabled = false;
      this._submittingLb = false;
    }
  }

  async _openLeaderboardModal({ returnTo = null } = {}) {
    if (!this._openOverlayModal('leaderboard-modal', { returnTo })) return;
    await this._refreshLeaderboardContent();
  }

  async _refreshLeaderboardContent() {
    const badge = document.getElementById('lb-mode-badge');
    const summaryEl = document.getElementById('lb-my-summary');
    const listEl = document.getElementById('leaderboard-list');
    const totalLevels = this.gameData?.levels?.length || 12;

    if (badge) {
      badge.textContent = '連線中…';
      badge.className = 'lb-mode-badge local';
    }
    if (listEl) {
      listEl.innerHTML = '<div class="lb-empty">⏳ 正在讀取英雄排行榜…</div>';
    }
    if (summaryEl) {
      const myName = this.saveData.playerName ? escapeHtml(this.saveData.playerName) : '尚未設定暱稱';
      const career = storage.getCareerSummary(this.saveData);
      summaryEl.innerHTML = `
        <span>我的暱稱：<strong>${myName}</strong></span>
        <span>🔥 連續闖關最高：<strong>${this.saveData.highScore || 0} 分</strong></span>
        <span>🏅 各關累計總積分：<strong>${career.careerScore} 分</strong>（解鎖 ${this.saveData.unlockedLevel || 1} / ${totalLevels} 關）</span>
      `;
    }

    const { mode, entries } = await leaderboardService.fetchTopEntries();

    if (badge) {
      badge.textContent = mode === 'cloud' ? '☁️ 全球雲端榜' : '📱 本機離線榜';
      badge.className = `lb-mode-badge ${mode}`;
    }

    if (!listEl) return;
    if (!entries || entries.length === 0) {
      listEl.innerHTML = '<div class="lb-empty">目前還沒有玩家上榜，快去過關搶下第 1 名吧！</div>';
      return;
    }

    const myName = this.saveData.playerName || '';
    listEl.innerHTML = entries
      .map((entry, idx) => {
        const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
        const topClass = idx < 3 ? ` top-${idx + 1}` : '';
        const meClass = myName && entry.name === myName ? ' is-me' : '';
        const hasRange = entry.runStartLevel > 0 && entry.runStartLevel < (entry.maxLevel || 1);
        const levelTag = entry.clearedAll
          ? `🏆 全破 ${hasRange ? `${entry.runStartLevel}→` : ''}${totalLevels} 關`
          : hasRange
            ? `第 ${entry.runStartLevel}→${entry.maxLevel} 關`
            : `最高第 ${entry.maxLevel || 1} 關`;
        const singleScoreTag = entry.levelScore > 0 ? `・單關 ${entry.levelScore} 分` : '';
        const timeTag =
          entry.runElapsedSec > 0
            ? `・單關 ${formatDuration(entry.elapsedSec)} / 整趟 ${formatDuration(entry.runElapsedSec)}`
            : entry.elapsedSec > 0
              ? `・單關 ${formatDuration(entry.elapsedSec)}`
              : '';
        const subScoreLabel = entry.careerScore > 0 ? `累計 ${entry.careerScore}` : '連關總分';

        return `
          <div class="lb-row${topClass}${meClass}">
            <div class="lb-rank">${rankIcon}</div>
            <div class="lb-player-info">
              <div class="lb-player-name">${escapeHtml(entry.name)}</div>
              <div class="lb-player-meta">${levelTag}${singleScoreTag}${timeTag}</div>
            </div>
            <div class="lb-score-col">
              <div class="lb-score-val">${entry.score}</div>
              <div class="lb-score-sub">${subScoreLabel}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  _getShareUrl() {
    const { protocol, hostname, origin, pathname } = window.location;
    const isLocal =
      !hostname ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.');
    if ((protocol === 'https:' || protocol === 'http:') && !isLocal) {
      const cleanPath = pathname.replace(/index\.html$/i, '');
      return `${origin}${cleanPath.endsWith('/') ? cleanPath : `${cleanPath}/`}`;
    }
    return ECOSYSTEM.GAME_SITE_URL;
  }

  _openQrModal({ returnTo = null } = {}) {
    if (!this._openOverlayModal('qr-modal', { returnTo })) return;
    const url = this._getShareUrl();
    const wrap = document.getElementById('qr-svg-wrap');
    const urlEl = document.getElementById('qr-url-text');
    const copyBtn = document.getElementById('btn-qr-copy');

    if (wrap) {
      wrap.innerHTML = renderQrSvg(url, { size: 220, margin: 4 });
    }
    if (urlEl) {
      urlEl.textContent = url;
    }
    if (copyBtn) {
      copyBtn.textContent = '📋 複製連結';
    }
  }

  _bindPwaInstall() {
    const startInstallBtn = document.getElementById('btn-pwa-install-start');
    const qrInstallBtn = document.getElementById('btn-pwa-install-qr');

    const updateInstallButtons = (show) => {
      startInstallBtn?.classList.toggle('hidden', !show);
      qrInstallBtn?.classList.toggle('hidden', !show);
    };

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      updateInstallButtons(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      updateInstallButtons(false);
    });

    const triggerInstall = async () => {
      if (!this.deferredPrompt) return;
      this.deferredPrompt.prompt();
      await this.deferredPrompt.userChoice.catch(() => {});
      this.deferredPrompt = null;
      updateInstallButtons(false);
    };

    startInstallBtn?.addEventListener('click', triggerInstall);
    qrInstallBtn?.addEventListener('click', triggerInstall);
  }

  _bindDOM() {
    document.getElementById('btn-start-play').addEventListener('click', () => {
      audio.unlock();
      this._hideSubModals();
      this._modalPausedGame = false;
      this._returnToModalId = null;
      if (
        this.engine.state === GAME_STATE.GAME_OVER ||
        this.engine.state === GAME_STATE.LEVEL_CLEAR
      ) {
        this.startLevel(this.currentLevelIdx, { preserveScore: false, waitForStart: true });
      } else if (this.engine.state === GAME_STATE.PAUSED) {
        this.engine.state = GAME_STATE.READY;
        this.engine._emitHud();
      } else {
        this._syncReadyOverlay();
      }
    });

    document.getElementById('btn-ready-start').addEventListener('click', () => {
      this._startFromReady();
    });

    document.getElementById('btn-open-levels-from-start').addEventListener('click', () => {
      this._renderLevelSelectGrid();
      this._openOverlayModal('levels-modal', { returnTo: 'start-modal' });
    });

    document.getElementById('btn-open-lb-from-start').addEventListener('click', () => {
      this._openLeaderboardModal({ returnTo: 'start-modal' });
    });

    document.getElementById('btn-open-qr-from-start').addEventListener('click', () => {
      this._openQrModal({ returnTo: 'start-modal' });
    });

    document.getElementById('btn-levels').addEventListener('click', () => {
      this._renderLevelSelectGrid();
      this._openOverlayModal('levels-modal');
    });

    document.getElementById('btn-close-levels').addEventListener('click', () => {
      this._closeOverlayModal('levels-modal');
    });

    document.getElementById('btn-leaderboard').addEventListener('click', () => {
      this._openLeaderboardModal();
    });

    document.getElementById('btn-lb-refresh').addEventListener('click', () => {
      this._refreshLeaderboardContent();
    });

    document.getElementById('btn-close-leaderboard').addEventListener('click', () => {
      this._closeOverlayModal('leaderboard-modal');
    });

    document.getElementById('btn-qrcode').addEventListener('click', () => {
      this._openQrModal();
    });

    document.getElementById('btn-close-qr').addEventListener('click', () => {
      this._closeOverlayModal('qr-modal');
    });

    document.getElementById('btn-qr-copy').addEventListener('click', async () => {
      const url = this._getShareUrl();
      const copyBtn = document.getElementById('btn-qr-copy');
      try {
        await navigator.clipboard.writeText(url);
      } catch (_) {
        const tmp = document.createElement('textarea');
        tmp.value = url;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        tmp.remove();
      }
      if (copyBtn) {
        copyBtn.textContent = '✅ 已複製網址！';
        setTimeout(() => {
          copyBtn.textContent = '📋 複製連結';
        }, 2000);
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

    document.getElementById('btn-clear-exit').addEventListener('click', () => {
      this._exitToHome();
    });

    document.getElementById('btn-clear-lb-submit').addEventListener('click', () => {
      this._submitLeaderboardFrom('clear');
    });

    document.getElementById('btn-gameover-retry').addEventListener('click', () => {
      audio.unlock();
      this.startLevel(this.currentLevelIdx, { preserveScore: false });
    });

    document.getElementById('btn-gameover-levels').addEventListener('click', () => {
      this._renderLevelSelectGrid();
      this._openOverlayModal('levels-modal', { returnTo: 'gameover-modal' });
    });

    document.getElementById('btn-gameover-exit').addEventListener('click', () => {
      this._exitToHome();
    });

    document.getElementById('btn-gameover-lb-submit').addEventListener('click', () => {
      this._submitLeaderboardFrom('gameover');
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

      if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) {
        return;
      }

      if (this._anyModalBlockingMaze()) {
        return;
      }

      if (this.engine.state === GAME_STATE.READY) {
        if (e.code === 'Space' || e.code === 'Enter') {
          e.preventDefault();
          this._startFromReady();
        } else if (e.code === 'KeyR') {
          e.preventDefault();
          this.startLevel(this.currentLevelIdx, { preserveScore: false, waitForStart: true });
        }
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
