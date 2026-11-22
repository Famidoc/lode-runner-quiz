/**
 * 知識尋寶《Lode Runner》主控程式與 UI 綁定
 */

import { GAME_STATE, ECOSYSTEM, APP_VERSION } from './config.js';
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

function shuffleArray(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
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
    this._confirmCallback = null;
    this._lastRenderSignature = '';
    this._forceRenderNextFrame = true;
    this._clearDpadVisuals = () => {};
    this.sessionSeen = {
      plant: new Set(),
      sudoku: new Set(),
      medical: new Set()
    };

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
    this._bindLifecycleAutoPause();
  }

  async init() {
    const verEl = document.getElementById('app-version');
    if (verEl) verEl.textContent = `(${APP_VERSION})`;
    this._checkInAppBrowser();

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
      if (document.hidden) {
        this.lastFrameTime = now;
        requestAnimationFrame(tick);
        return;
      }

      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      this.engine.update(dt);

      const st = this.engine.state;
      const needsActiveRedraw =
        this._forceRenderNextFrame ||
        st === GAME_STATE.PLAYING ||
        st === GAME_STATE.READY ||
        this.engine.particles.length > 0 ||
        this.engine.floatingTexts.length > 0 ||
        this.engine.bannerTimer > 0;

      const sig = `${st}|${this.engine.level?.id || 0}|${this.engine.score}|${this.engine.lives}|${this.engine.exitActive}|${this.engine.frenzyTimer > 0}`;
      if (needsActiveRedraw || sig !== this._lastRenderSignature) {
        this.renderer.render(this.engine, now);
        this._lastRenderSignature = sig;
        this._forceRenderNextFrame = false;
      }

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  _pickSessionItem(type, allItems, wrongPool = []) {
    if (!Array.isArray(allItems) || allItems.length === 0) return null;
    const seen = this.sessionSeen[type];
    let picked = null;

    if (wrongPool.length > 0 && Math.random() < 0.45) {
      const unseenWrong = wrongPool
        .filter((id) => !seen.has(id))
        .map((id) => allItems.find((item) => item.id === id))
        .filter(Boolean);
      if (unseenWrong.length > 0) {
        picked = unseenWrong[Math.floor(Math.random() * unseenWrong.length)];
      }
    }

    if (!picked) {
      let unseen = allItems.filter((item) => !seen.has(item.id));
      if (unseen.length === 0) {
        seen.clear();
        unseen = allItems;
      }
      picked = unseen[Math.floor(Math.random() * unseen.length)];
    }

    if (picked?.id) {
      seen.add(picked.id);
    }
    return picked;
  }

  /**
   * 為本關抽取三大知識題點（含本趟不重複與錯題複習）並立即預載花草圖片
   */
  _prepareLevelQuestions(levelObj) {
    const { plants, sudokus, medical } = this.gameData;

    // 1. 題點 A：捻花惹草（優先複習未於本趟出現的錯題）
    const targetPlant = this._pickSessionItem('plant', plants, this.saveData.plantWrongPool);
    const distractors = shuffleArray(
      plants.filter((p) => p.id !== targetPlant.id && p.name !== targetPlant.name)
    ).slice(0, 3);
    const plantOptions = shuffleArray([targetPlant.name, ...distractors.map((d) => d.name)]);
    const plantPreload = preloadPlantImage(targetPlant);

    // 2. 題點 B：數獨殘局（同趟盡量不重複）
    const sudokuObj =
      sudokus && sudokus.length > 0
        ? this._pickSessionItem('sudoku', sudokus)
        : {
            id: 'fallback',
            name: '經典隨機盤面',
            icon: '🔢',
            solution: generateFallbackSolvedBoard()
          };

    // 3. 題點 C：加減學學（優先複習未於本趟出現的錯題）
    const medObj = this._pickSessionItem('medical', medical, this.saveData.medicalWrongPool);

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

    if (!preserveScore) {
      this.sessionSeen.plant.clear();
      this.sessionSeen.sudoku.clear();
      this.sessionSeen.medical.clear();
    }

    this._prepareLevelQuestions(levelObj);
    this._modalPausedGame = false;
    this._returnToModalId = null;
    this._confirmCallback = null;
    this._clearDpadVisuals();
    this._hideSubModals();
    this.engine.loadLevel(levelObj, { preserveScore, waitForStart });
    this._forceRenderNextFrame = true;
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
        <div class="review-main"><strong>${escapeHtml(q.plant.target.name)}</strong>（${escapeHtml(q.plant.target.family || '植物圖鑑')}）</div>
        <a href="${escapeHtml(plantLink)}" target="_blank" rel="noopener" class="review-link">前往圖鑑看詳情 →</a>
      </div>
      <div class="review-card sudoku">
        <div class="review-label">🔢 數獨共享平台</div>
        <div class="review-main"><strong>${escapeHtml(q.sudoku.puzzle.name)}</strong>（${sudokuIdTag}${q.sudoku.holes} 格殘局挑戰）</div>
        <a href="${escapeHtml(sudokuLink)}" target="_blank" rel="noopener" class="review-link">前往挑戰完整數獨${q.sudoku.puzzle.cloudId ? ` (#${String(q.sudoku.puzzle.cloudId).padStart(4, '0')})` : ''} →</a>
      </div>
      <div class="review-card medical">
        <div class="review-label">🩺 加減學學家醫觀念</div>
        <div class="review-main">${escapeHtml(q.medical.explanation)}</div>
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
        career.estimatedLevelsCount > 0
          ? `含舊紀錄回補 ${career.estimatedLevelsCount} 關（重玩將覆寫為精準分）`
          : career.scoredLevelsCount === 0 && career.clearedLevelsCount > 0
            ? '過關後自動開始累計各關單關最高分'
            : `已登錄單關成績 ${career.scoredLevelsCount} / ${total} 關`;
      careerBar.innerHTML = `
        <span>🏅 ${total} 關累計總積分：<strong>${career.careerScore} 分</strong></span>
        <span>${escapeHtml(hint)}</span>
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
        ? rec.estimatedLevelScore
          ? `單關約 ${rec.bestLevelScore} 分 (${formatDuration(rec.bestTime)})`
          : `單關最高 ${rec.bestLevelScore} 分 (${formatDuration(rec.bestTime)})`
        : rec?.cleared
          ? `已通關 (${formatDuration(rec.bestTime)})`
          : unlocked
            ? '點擊挑戰'
            : '通關前一關解鎖';

      card.innerHTML = `
        <div class="level-card-num">第 ${lvl.id} 關 ${rec?.cleared ? '✅' : unlocked ? '' : '🔒'}</div>
        <div class="level-card-title">${escapeHtml(lvl.name)}</div>
        <div class="level-card-meta">守衛 ${lvl.ghosts.length} 名・數獨 ${lvl.sudokuHoles} 格</div>
        <div class="level-card-best">${escapeHtml(bestLine)}</div>
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
      'qr-modal',
      'confirm-modal'
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
      'qr-modal',
      'confirm-modal'
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
    this._clearDpadVisuals();
    this._modalPausedGame = false;
    this._returnToModalId = null;
    this._confirmCallback = null;
    this._hideSubModals();

    const total = this.gameData?.levels?.length || 1;
    const unlockedIdx = Math.min(Math.max(0, (this.saveData.unlockedLevel || 1) - 1), total - 1);
    this.startLevel(unlockedIdx, { preserveScore: false, waitForStart: true });
    this._showStartOverlay();
    this._syncReadyOverlay();
  }

  _openConfirmModal({ title, message, okText = '確定', onConfirm }) {
    if (this.quizModal.isOpen()) return;
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('btn-confirm-ok');
    if (titleEl) titleEl.textContent = title || '⚠️ 確認操作';
    if (msgEl) msgEl.textContent = message || '';
    if (okBtn) okBtn.textContent = okText;

    this._confirmCallback = typeof onConfirm === 'function' ? onConfirm : null;
    this._openOverlayModal('confirm-modal');
  }

  _requestRetryCurrentLevel({ waitForStart = false } = {}) {
    if (this.quizModal.isOpen()) return;
    if ((this.engine.score || 0) <= 0) {
      this.startLevel(this.currentLevelIdx, { preserveScore: false, waitForStart });
      return;
    }

    this._openConfirmModal({
      title: '🔄 重新挑戰本關？',
      message: `目前連續闖關總分為 ${this.engine.score} 分。重試本關將從第 ${this.engine.level?.id || 1} 關重新計算（連關分數會歸零），確定要重試嗎？`,
      okText: '確定重試',
      onConfirm: () => {
        this.startLevel(this.currentLevelIdx, { preserveScore: false, waitForStart });
      }
    });
  }

  _checkInAppBrowser() {
    const banner = document.getElementById('inapp-browser-banner');
    if (!banner) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('lr_inapp_dismissed') === '1';
    } catch (_) {
      dismissed = false;
    }
    const ua = navigator.userAgent || '';
    const isInApp = /\b(Line\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger)\b/i.test(ua);
    if (isInApp && !dismissed) {
      banner.classList.remove('hidden');
    }

    document.getElementById('btn-close-inapp-banner')?.addEventListener('click', () => {
      banner.classList.add('hidden');
      try {
        sessionStorage.setItem('lr_inapp_dismissed', '1');
      } catch (_) {}
    });
  }

  _handleAppBackground() {
    this.engine.clearInputs();
    this._clearDpadVisuals();
    if (this.engine.state === GAME_STATE.PLAYING) {
      this.engine.togglePause();
    }
  }

  _bindLifecycleAutoPause() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this._handleAppBackground();
      }
    });
    window.addEventListener('blur', () => {
      this._handleAppBackground();
    });
    window.addEventListener('pagehide', () => {
      this._handleAppBackground();
    });
  }

  async _copyTextToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const tmp = document.createElement('textarea');
      tmp.value = text;
      tmp.setAttribute('readonly', '');
      tmp.style.position = 'fixed';
      tmp.style.opacity = '0';
      document.body.appendChild(tmp);
      tmp.select();
      document.execCommand('copy');
      tmp.remove();
    }
  }

  _buildScoreShareText(context) {
    const summary = this._lastResultSummary || {};
    const totalLevels = this.gameData?.levels?.length || 12;
    const score = summary.score ?? this.engine.score ?? 0;
    const maxLv = summary.maxLevel || this.engine.level?.id || 1;
    const singleScore = summary.levelScore ?? 0;
    const timeText = summary.runElapsedSec
      ? formatDuration(summary.runElapsedSec)
      : formatDuration(summary.elapsedSec || 0);

    if (context === 'clear') {
      if (summary.clearedAll) {
        return `🏆 我全破了《知識尋寶 Lode Runner》全部 ${totalLevels} 關！連續闖關總分 ${score} 分（耗時 ${timeText}），邊玩邊答花草、數獨與家醫題，來挑戰我的紀錄吧！`;
      }
      return `🎉 我剛在《知識尋寶 Lode Runner》通過第 ${maxLv} 關！連續總分 ${score} 分（本關 ${singleScore} 分，耗時 ${timeText}），一起來動腦尋寶！`;
    }

    return `🎮 我在《知識尋寶 Lode Runner》推進到第 ${maxLv} 關、拿下 ${score} 分！快來邊閃守衛邊挑戰花草・數獨・家醫知識！`;
  }

  async _shareContent({ title, text, url, buttonEl, defaultLabel }) {
    const shareUrl = url || this._getShareUrl();
    let shared = false;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text, url: shareUrl });
        shared = true;
      } catch (err) {
        if (err && err.name === 'AbortError') {
          return;
        }
      }
    }

    if (!shared) {
      const payload = text ? `${text}\n${shareUrl}` : shareUrl;
      await this._copyTextToClipboard(payload);
    }

    if (buttonEl) {
      buttonEl.textContent = shared ? '✅ 已分享！' : '✅ 已複製分享文！';
      setTimeout(() => {
        buttonEl.textContent = defaultLabel;
      }, 2200);
    }
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
      const careerNote =
        career.estimatedLevelsCount > 0
          ? `含舊關回補・解鎖 ${this.saveData.unlockedLevel || 1} / ${totalLevels} 關`
          : `解鎖 ${this.saveData.unlockedLevel || 1} / ${totalLevels} 關`;
      summaryEl.innerHTML = `
        <span>我的暱稱：<strong>${myName}</strong></span>
        <span>🔥 連續闖關最高：<strong>${this.saveData.highScore || 0} 分</strong></span>
        <span>🏅 各關累計總積分：<strong>${career.careerScore} 分</strong>（${careerNote}）</span>
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
      await this._copyTextToClipboard(url);
      if (copyBtn) {
        copyBtn.textContent = '✅ 已複製網址！';
        setTimeout(() => {
          copyBtn.textContent = '📋 複製連結';
        }, 2000);
      }
    });

    document.getElementById('btn-qr-share')?.addEventListener('click', (e) => {
      const url = this._getShareUrl();
      this._shareContent({
        title: '知識尋寶《Lode Runner》',
        text: '推薦一款結合 1980s 淘金者、捻花惹草、數獨與加減學學衛教的離線 PWA 遊戲，手機直接就能玩！',
        url,
        buttonEl: e.currentTarget,
        defaultLabel: '📤 分享給朋友'
      });
    });

    document.getElementById('btn-clear-share')?.addEventListener('click', (e) => {
      this._shareContent({
        title: '知識尋寶《Lode Runner》戰績分享',
        text: this._buildScoreShareText('clear'),
        url: this._getShareUrl(),
        buttonEl: e.currentTarget,
        defaultLabel: '📤 分享戰績'
      });
    });

    document.getElementById('btn-gameover-share')?.addEventListener('click', (e) => {
      this._shareContent({
        title: '知識尋寶《Lode Runner》戰績分享',
        text: this._buildScoreShareText('gameover'),
        url: this._getShareUrl(),
        buttonEl: e.currentTarget,
        defaultLabel: '📤 分享戰績'
      });
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      if (this.quizModal.isOpen()) return;
      audio.unlock();
      this.engine.togglePause();
    });

    document.getElementById('btn-retry').addEventListener('click', () => {
      audio.unlock();
      this._requestRetryCurrentLevel();
    });

    document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
      this._confirmCallback = null;
      this._closeOverlayModal('confirm-modal');
    });

    document.getElementById('btn-confirm-ok')?.addEventListener('click', () => {
      const cb = this._confirmCallback;
      this._confirmCallback = null;
      this._closeOverlayModal('confirm-modal');
      if (typeof cb === 'function') {
        cb();
      }
    });

    ['levels-modal', 'leaderboard-modal', 'qr-modal', 'confirm-modal'].forEach((modalId) => {
      const el = document.getElementById(modalId);
      el?.addEventListener('click', (e) => {
        if (e.target === el) {
          if (modalId === 'confirm-modal') this._confirmCallback = null;
          this._closeOverlayModal(modalId);
        }
      });
    });

    [
      ['clear-lb-name', 'clear'],
      ['gameover-lb-name', 'gameover']
    ].forEach(([inputId, prefix]) => {
      document.getElementById(inputId)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault();
          e.currentTarget.blur();
          this._submitLeaderboardFrom(prefix);
        }
      });
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

      if (e.code === 'Escape' && !this.quizModal.isOpen()) {
        const dismissible = ['confirm-modal', 'qr-modal', 'leaderboard-modal', 'levels-modal'].find(
          (id) => !document.getElementById(id)?.classList.contains('hidden')
        );
        if (dismissible) {
          e.preventDefault();
          if (dismissible === 'confirm-modal') this._confirmCallback = null;
          this._closeOverlayModal(dismissible);
          return;
        }
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
          this._requestRetryCurrentLevel({ waitForStart: true });
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
        this._requestRetryCurrentLevel();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code in keyMap) {
        this.engine.setInput(keyMap[e.code], false);
      }
    });
  }

  _bindTouchControls() {
    const touchPanel = document.querySelector('.touch-controls');
    touchPanel?.addEventListener('contextmenu', (e) => e.preventDefault());

    const dpad = document.querySelector('.dpad');
    const holdButtons = Array.from(document.querySelectorAll('[data-move]'));
    const dirToBtn = new Map(holdButtons.map((b) => [b.dataset.move, b]));

    let activePointerId = null;
    let activeDir = null;

    const setActiveDirection = (nextDir) => {
      if (nextDir === activeDir) return;
      if (activeDir) {
        dirToBtn.get(activeDir)?.classList.remove('active');
        this.engine.setInput(activeDir, false);
      }
      activeDir = nextDir;
      if (activeDir) {
        dirToBtn.get(activeDir)?.classList.add('active');
        this.engine.setInput(activeDir, true);
      }
    };

    this._clearDpadVisuals = () => {
      activePointerId = null;
      if (activeDir) {
        dirToBtn.get(activeDir)?.classList.remove('active');
        activeDir = null;
      }
      holdButtons.forEach((b) => b.classList.remove('active'));
    };

    const resolveDpadDir = (clientX, clientY) => {
      const hitBtn = document.elementFromPoint(clientX, clientY)?.closest?.('[data-move]');
      if (hitBtn && dpad?.contains(hitBtn)) {
        return hitBtn.dataset.move;
      }
      if (!dpad) return null;

      // 手指滑過按鈕間縫隙時，依最接近之方向鍵區域平滑判定
      const padRect = dpad.getBoundingClientRect();
      if (
        clientX < padRect.left - 36 ||
        clientX > padRect.right + 36 ||
        clientY < padRect.top - 36 ||
        clientY > padRect.bottom + 36
      ) {
        return null;
      }

      let bestDir = null;
      let bestDist = Infinity;
      for (const btn of holdButtons) {
        const r = btn.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        const dist = Math.hypot(clientX - cx, clientY - cy);
        if (dist < bestDist) {
          bestDist = dist;
          bestDir = btn.dataset.move;
        }
      }
      return bestDist <= 68 ? bestDir : null;
    };

    if (dpad) {
      dpad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        audio.unlock();
        activePointerId = e.pointerId;
        try {
          dpad.setPointerCapture(e.pointerId);
        } catch (_) {}
        setActiveDirection(resolveDpadDir(e.clientX, e.clientY));
      });

      dpad.addEventListener('pointermove', (e) => {
        if (activePointerId !== e.pointerId) return;
        e.preventDefault();
        setActiveDirection(resolveDpadDir(e.clientX, e.clientY));
      });

      const endDpad = (e) => {
        if (activePointerId !== e.pointerId) return;
        e.preventDefault();
        activePointerId = null;
        setActiveDirection(null);
        try {
          if (dpad.hasPointerCapture(e.pointerId)) {
            dpad.releasePointerCapture(e.pointerId);
          }
        } catch (_) {}
      };

      dpad.addEventListener('pointerup', endDpad);
      dpad.addEventListener('pointercancel', endDpad);
      dpad.addEventListener('lostpointercapture', () => {
        activePointerId = null;
        setActiveDirection(null);
      });
    }

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

// 註冊離線 Service Worker 並處理可控新版本提示
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let refreshing = false;
    let pendingWorker = null;

    const showUpdateToast = (worker) => {
      if (!worker) return;
      pendingWorker = worker;
      const banner = document.getElementById('sw-update-banner');
      banner?.classList.remove('hidden');
    };

    document.getElementById('btn-sw-reload')?.addEventListener('click', () => {
      if (pendingWorker) {
        pendingWorker.postMessage({ type: 'SKIP_WAITING' });
      }
    });

    document.getElementById('btn-sw-dismiss')?.addEventListener('click', () => {
      document.getElementById('sw-update-banner')?.classList.add('hidden');
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateToast(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateToast(installing);
            }
          });
        });
      })
      .catch(() => {});
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  app.init();
});
