/**
 * 三大知識題點凍結答題彈窗控制器
 * - A: 捻花惹草（15 秒，等圖載入才啟動倒數）
 * - B: 數獨殘局（45 秒，5~8 格直覺填空 + 鍵盤與觸控數字盤）
 * - C: 加減學學（15 秒，家醫科衛教題 + 張醫師小叮嚀解析）
 */

import { QUIZ_TIME, CHEST_META } from './config.js';
import {
  createEndgamePuzzle,
  findConflicts,
  isBoardCompleteAndValid
} from './sudokuEngine.js';
import { audio } from './audio.js';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class QuizModalController {
  constructor() {
    this.overlayEl = document.getElementById('quiz-modal');
    this.badgeEl = document.getElementById('quiz-badge');
    this.titleEl = document.getElementById('quiz-title');
    this.timerTextEl = document.getElementById('quiz-timer-text');
    this.timerBarEl = document.getElementById('quiz-timer-bar');
    this.bodyEl = document.getElementById('quiz-body');

    this.active = false;
    this.finished = false;
    this.mode = null; // 'plant' | 'sudoku' | 'medical'
    this.timeLimit = 15;
    this.timeLeft = 15;
    this.lastTickSec = -1;
    this.rafId = null;
    this.lastFrameMs = 0;
    this.resolveCallback = null;
    this.autoCloseTimer = null;

    // 數獨互動狀態
    this.sudokuState = null;

    this._onKeyDown = this._handleKeyDown.bind(this);
  }

  isOpen() {
    return this.active;
  }

  closeImmediately() {
    this.active = false;
    this.finished = true;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.autoCloseTimer);
    this.overlayEl.classList.add('hidden');
    this.bodyEl.innerHTML = '';
    this.sudokuState = null;
    window.removeEventListener('keydown', this._onKeyDown);
  }

  async open({ type, payload, preloadResult, sudokuHoles, onResolve }) {
    this.closeImmediately();

    this.active = true;
    this.finished = false;
    this.mode = type;
    this.currentPayload = payload;
    this.timeLimit = QUIZ_TIME[type] || 15;
    this.timeLeft = this.timeLimit;
    this.lastTickSec = this.timeLimit;
    this.resolveCallback = onResolve;

    const meta = CHEST_META[type];
    this.badgeEl.textContent = `${meta.icon} ${meta.shortName}`;
    this.badgeEl.style.backgroundColor = meta.badgeBg;
    this.badgeEl.style.borderColor = meta.color;
    this.titleEl.textContent = meta.title;

    this._updateTimerUI();
    this.overlayEl.classList.remove('hidden');
    window.addEventListener('keydown', this._onKeyDown);

    if (type === 'plant') {
      await this._renderPlantQuiz(payload, preloadResult);
    } else if (type === 'sudoku') {
      this._renderSudokuQuiz(payload, sudokuHoles);
      this._startTimerLoop();
    } else if (type === 'medical') {
      this._renderMedicalQuiz(payload);
      this._startTimerLoop();
    }
  }

  _startTimerLoop() {
    cancelAnimationFrame(this.rafId);
    this.lastFrameMs = performance.now();

    const step = (now) => {
      if (!this.active || this.finished) return;
      const dt = Math.min(0.1, (now - this.lastFrameMs) / 1000);
      this.lastFrameMs = now;
      this.timeLeft = Math.max(0, this.timeLeft - dt);

      const ceilSec = Math.ceil(this.timeLeft);
      if (ceilSec !== this.lastTickSec && ceilSec <= 5 && ceilSec >= 1) {
        this.lastTickSec = ceilSec;
        audio.play('tick');
      }

      this._updateTimerUI();

      if (this.timeLeft <= 0) {
        this._handleTimeout();
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };

    this.rafId = requestAnimationFrame(step);
  }

  _updateTimerUI() {
    const ceil = Math.ceil(this.timeLeft);
    this.timerTextEl.textContent = `${ceil}s`;
    const pct = Math.max(0, Math.min(100, (this.timeLeft / this.timeLimit) * 100));
    this.timerBarEl.style.width = `${pct}%`;

    const urgent = this.timeLeft <= 5;
    this.timerBarEl.classList.toggle('urgent', urgent);
    this.timerTextEl.classList.toggle('urgent', urgent);
  }

  // ==========================================================
  // 題點 A：【捻花惹草】看圖四選一（等圖片載入後才開始倒數）
  // ==========================================================
  async _renderPlantQuiz(plantQuiz, preloadResult) {
    const { target, options } = plantQuiz;

    this.bodyEl.innerHTML = `
      <div class="plant-quiz-wrap">
        <div class="plant-photo-box" id="plant-photo-box">
          <div class="plant-loading" id="plant-loading-msg">🌿 正在讀取花草照片（載入後開始計時）…</div>
        </div>
        <p class="quiz-prompt">請辨識照片中的植物名稱（支援鍵盤 1–4）：</p>
        <div class="quiz-options-grid" id="quiz-options"></div>
        <div class="quiz-feedback hidden" id="quiz-feedback"></div>
      </div>
    `;

    const optionsEl = document.getElementById('quiz-options');
    options.forEach((optName, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-opt-btn';
      btn.dataset.index = String(idx);
      btn.innerHTML = `<span class="opt-key">${idx + 1}</span><span>${optName}</span>`;
      btn.addEventListener('click', () => this._submitPlantChoice(idx, target, options));
      optionsEl.appendChild(btn);
    });

    // 等預載圖片就緒（含安全超時 4.5s）再啟動倒數
    const photoBox = document.getElementById('plant-photo-box');
    const loadingMsg = document.getElementById('plant-loading-msg');

    let finalResult = preloadResult;
    if (finalResult && finalResult.status === 'loading') {
      finalResult = await Promise.race([
        finalResult.promise,
        new Promise((resolve) =>
          setTimeout(() => resolve({ status: 'error' }), 4500)
        )
      ]);
    }

    if (!this.active) return;

    if (finalResult && finalResult.status === 'ready' && finalResult.loadedUrl) {
      const img = document.createElement('img');
      img.src = finalResult.loadedUrl;
      img.alt = '待辨識花草照片';
      img.referrerPolicy = 'no-referrer';
      img.className = 'plant-quiz-img';
      photoBox.innerHTML = '';
      photoBox.appendChild(img);
    } else {
      loadingMsg.innerHTML = `
        <div class="plant-offline-fallback">
          <div style="font-size:2rem;margin-bottom:6px;">🌿</div>
          <div><strong>照片離線或連線受限，啟用形態線索模式</strong></div>
          <div style="margin-top:6px;color:#cbd5e1;font-size:0.9rem;">${target.family || ''}</div>
          <div style="margin-top:4px;color:#86efac;font-size:0.92rem;">${target.hint || '台灣常見庭園與野外植栽'}</div>
        </div>
      `;
    }

    this._startTimerLoop();
  }

  _submitPlantChoice(chosenIdx, target, options) {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.rafId);

    const isCorrect = options[chosenIdx] === target.name;
    const btns = this.bodyEl.querySelectorAll('.quiz-opt-btn');
    btns.forEach((btn, i) => {
      btn.disabled = true;
      if (options[i] === target.name) btn.classList.add('correct');
      else if (i === chosenIdx && !isCorrect) btn.classList.add('wrong');
    });

    const fb = document.getElementById('quiz-feedback');
    fb.classList.remove('hidden');
    fb.className = `quiz-feedback ${isCorrect ? 'ok' : 'fail'}`;
    fb.innerHTML = isCorrect
      ? `✅ 答對了！正是 <strong>${target.name}</strong>（${target.family || '植物圖鑑'}）`
      : `❌ 惜敗！正確答案是 <strong>${target.name}</strong>（${target.family || ''}）`;

    this._finishAfterDelay(isCorrect, 1050);
  }

  // ==========================================================
  // 題點 B：【數獨共享平台】局部殘局填空（5～8 格）
  // ==========================================================
  _renderSudokuQuiz(puzzleObj, holeCount) {
    const endgame = createEndgamePuzzle(puzzleObj.solution, holeCount);
    const board = endgame.initialBoard.slice();
    const fixedMask = board.map((n) => n !== 0);
    const firstBlank = endgame.blankIndices[0] ?? null;

    this.sudokuState = {
      puzzleName: puzzleObj.name || '精選數獨',
      puzzleIcon: puzzleObj.icon || '🔢',
      board,
      fixedMask,
      blankIndices: endgame.blankIndices,
      selectedIdx: firstBlank
    };

    this.bodyEl.innerHTML = `
      <div class="sudoku-quiz-wrap">
        <div class="sudoku-meta-row">
          <span>${this.sudokuState.puzzleIcon} ${this.sudokuState.puzzleName}</span>
          <span class="sudoku-remain-badge" id="sudoku-remain-badge">剩餘 ${endgame.holeCount} 格</span>
        </div>
        <div class="sudoku-board" id="sudoku-board" role="grid" aria-label="數獨殘局盤面"></div>
        <div class="sudoku-numpad" id="sudoku-numpad"></div>
        <div class="quiz-feedback hidden" id="quiz-feedback"></div>
      </div>
    `;

    this._buildSudokuBoardDOM();
    this._buildSudokuNumpadDOM();
    this._refreshSudokuBoard();
  }

  _buildSudokuBoardDOM() {
    const boardEl = document.getElementById('sudoku-board');
    boardEl.innerHTML = '';

    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 's-cell';
      cell.dataset.idx = String(i);

      if (c === 2 || c === 5) cell.classList.add('box-right');
      if (r === 2 || r === 5) cell.classList.add('box-bottom');

      if (this.sudokuState.fixedMask[i]) {
        cell.classList.add('fixed');
        cell.textContent = String(this.sudokuState.board[i]);
        cell.disabled = true;
      } else {
        cell.classList.add('editable');
        cell.addEventListener('click', () => {
          if (this.finished) return;
          this.sudokuState.selectedIdx = i;
          this._refreshSudokuBoard();
        });
      }

      boardEl.appendChild(cell);
    }
  }

  _buildSudokuNumpadDOM() {
    const padEl = document.getElementById('sudoku-numpad');
    padEl.innerHTML = '';

    for (let n = 1; n <= 9; n++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 's-num-btn';
      btn.textContent = String(n);
      btn.addEventListener('click', () => this._inputSudokuDigit(n));
      padEl.appendChild(btn);
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 's-num-btn clear';
    clearBtn.textContent = '清除';
    clearBtn.addEventListener('click', () => this._inputSudokuDigit(0));
    padEl.appendChild(clearBtn);
  }

  _inputSudokuDigit(num) {
    if (this.finished || !this.sudokuState) return;
    const idx = this.sudokuState.selectedIdx;
    if (idx === null || this.sudokuState.fixedMask[idx]) return;

    this.sudokuState.board[idx] = num;

    // 若填入非零數字，自動跳往下一格尚未填寫的空格，提高手機流暢度
    if (num !== 0) {
      const blanks = this.sudokuState.blankIndices;
      const curPos = blanks.indexOf(idx);
      for (let step = 1; step <= blanks.length; step++) {
        const candidate = blanks[(curPos + step) % blanks.length];
        if (this.sudokuState.board[candidate] === 0) {
          this.sudokuState.selectedIdx = candidate;
          break;
        }
      }
    }

    this._refreshSudokuBoard();

    if (isBoardCompleteAndValid(this.sudokuState.board)) {
      this.finished = true;
      cancelAnimationFrame(this.rafId);

      const fb = document.getElementById('quiz-feedback');
      fb.classList.remove('hidden');
      fb.className = 'quiz-feedback ok';
      fb.textContent = '🎉 數獨殘局全數無誤！護盾能量充能完畢！';
      this._finishAfterDelay(true, 900);
    }
  }

  _refreshSudokuBoard() {
    if (!this.sudokuState) return;
    const { board, fixedMask, selectedIdx, blankIndices } = this.sudokuState;
    const conflicts = findConflicts(board);

    const selR = selectedIdx !== null ? Math.floor(selectedIdx / 9) : -1;
    const selC = selectedIdx !== null ? selectedIdx % 9 : -1;
    const selBox = selR >= 0 ? Math.floor(selR / 3) * 3 + Math.floor(selC / 3) : -1;

    const cells = this.bodyEl.querySelectorAll('.s-cell');
    cells.forEach((cell, i) => {
      cell.classList.remove('selected', 'peer', 'conflict', 'filled');
      const r = Math.floor(i / 9);
      const c = i % 9;
      const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);

      if (!fixedMask[i]) {
        const val = board[i];
        cell.textContent = val === 0 ? '' : String(val);
        if (val !== 0) cell.classList.add('filled');
      }

      if (i === selectedIdx) {
        cell.classList.add('selected');
      } else if (selR >= 0 && (r === selR || c === selC || box === selBox)) {
        cell.classList.add('peer');
      }

      if (conflicts.has(i)) {
        cell.classList.add('conflict');
      }
    });

    const remainCount = blankIndices.filter((idx) => board[idx] === 0).length;
    const badge = document.getElementById('sudoku-remain-badge');
    if (badge) {
      badge.textContent =
        conflicts.size > 0
          ? '⚠️ 有數字衝突，請檢查紅格'
          : `剩餘 ${remainCount} 格`;
      badge.classList.toggle('warn', conflicts.size > 0);
    }
  }

  // ==========================================================
  // 題點 C：【加減學學】生活醫學觀念題
  // ==========================================================
  _renderMedicalQuiz(medItem) {
    this.bodyEl.innerHTML = `
      <div class="medical-quiz-wrap">
        <div class="med-cat-pill">🩺 ${medItem.category}</div>
        <h3 class="med-question">${medItem.question}</h3>
        <div class="quiz-options-grid single-col" id="quiz-options"></div>
        <div class="med-explanation hidden" id="med-explanation"></div>
      </div>
    `;

    const optionsEl = document.getElementById('quiz-options');
    medItem.options.forEach((optText, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-opt-btn';
      btn.innerHTML = `<span class="opt-key">${idx + 1}</span><span>${optText}</span>`;
      btn.addEventListener('click', () => this._submitMedicalChoice(idx, medItem));
      optionsEl.appendChild(btn);
    });
  }

  _submitMedicalChoice(chosenIdx, medItem) {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.rafId);

    const isCorrect = chosenIdx === medItem.answerIndex;
    const btns = this.bodyEl.querySelectorAll('.quiz-opt-btn');
    btns.forEach((btn, i) => {
      btn.disabled = true;
      if (i === medItem.answerIndex) btn.classList.add('correct');
      else if (i === chosenIdx && !isCorrect) btn.classList.add('wrong');
    });

    this._showMedicalExplanation(medItem, isCorrect, false);
  }

  _showMedicalExplanation(medItem, isCorrect, isTimeout) {
    const expEl = document.getElementById('med-explanation');
    if (!expEl) return;

    expEl.classList.remove('hidden');
    expEl.className = `med-explanation ${isCorrect ? 'ok' : 'fail'}`;
    const statusLine = isTimeout
      ? '⏰ 作答超時！'
      : isCorrect
        ? '✅ 觀念正確！'
        : '❌ 再想想看喔！';

    const videoLabel = medItem.videoTitle
      ? `📺 ${escapeHtml(medItem.videoTitle)}`
      : '📺 觀看《加減學學》解說';

    expEl.innerHTML = `
      <div class="med-exp-head">${statusLine}</div>
      <p class="med-exp-text">${medItem.explanation}</p>
      <div class="med-exp-actions">
        ${
          medItem.videoUrl
            ? `<a href="${escapeHtml(medItem.videoUrl)}" target="_blank" rel="noopener" class="btn-video-link" id="btn-med-video" title="前往 YouTube 觀看完整解說">${videoLabel}</a>`
            : ''
        }
        <button type="button" class="btn-continue-maze" id="btn-med-continue">繼續尋寶 →</button>
      </div>
    `;

    const videoLinkEl = document.getElementById('btn-med-video');
    if (videoLinkEl) {
      videoLinkEl.addEventListener('click', () => {
        clearTimeout(this.autoCloseTimer);
      });
    }

    document.getElementById('btn-med-continue').addEventListener('click', () => {
      clearTimeout(this.autoCloseTimer);
      this._finishNow(isCorrect);
    });

    const autoDelayMs = medItem.videoUrl ? 4500 : 2400;
    this.autoCloseTimer = setTimeout(() => {
      this._finishNow(isCorrect);
    }, autoDelayMs);
  }

  // ==========================================================
  // 超時、鍵盤快捷鍵與完成回呼
  // ==========================================================
  _handleTimeout() {
    if (this.finished) return;
    this.finished = true;
    cancelAnimationFrame(this.rafId);

    if (this.mode === 'medical' && this.currentPayload) {
      this.bodyEl.querySelectorAll('.quiz-opt-btn').forEach((b) => {
        b.disabled = true;
      });
      this._showMedicalExplanation(this.currentPayload, false, true);
      return;
    }

    const fb = document.getElementById('quiz-feedback');
    if (fb) {
      fb.classList.remove('hidden');
      fb.className = 'quiz-feedback fail';
      if (this.mode === 'plant' && this.currentPayload?.target) {
        fb.innerHTML = `⏰ 超時了！正確答案是 <strong>${this.currentPayload.target.name}</strong>，守衛開始加速追擊！`;
      } else {
        fb.textContent = '⏰ 作答時間到！護盾破裂，守衛開始加速追擊！';
      }
    }
    this._finishAfterDelay(false, 1100);
  }

  _handleKeyDown(e) {
    if (!this.active) return;

    // 攔截遊戲移動按鍵避免彈窗內滾動或混淆
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }

    if (this.finished) {
      if (e.key === 'Enter' && this.mode === 'medical') {
        const contBtn = document.getElementById('btn-med-continue');
        if (contBtn) contBtn.click();
      }
      return;
    }

    if (this.mode === 'plant' || this.mode === 'medical') {
      const idx = Number(e.key) - 1;
      const btns = this.bodyEl.querySelectorAll('.quiz-opt-btn');
      if (Number.isInteger(idx) && idx >= 0 && idx < btns.length) {
        btns[idx].click();
      }
      return;
    }

    if (this.mode === 'sudoku' && this.sudokuState) {
      if (e.key >= '1' && e.key <= '9') {
        this._inputSudokuDigit(Number(e.key));
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
        this._inputSudokuDigit(0);
      } else if (e.key === 'Tab' || e.key.startsWith('Arrow')) {
        e.preventDefault();
        const blanks = this.sudokuState.blankIndices;
        if (blanks.length === 0) return;
        const curPos = Math.max(0, blanks.indexOf(this.sudokuState.selectedIdx));
        const delta = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        this.sudokuState.selectedIdx = blanks[(curPos + delta + blanks.length) % blanks.length];
        this._refreshSudokuBoard();
      }
    }
  }

  _finishAfterDelay(isCorrect, delayMs) {
    clearTimeout(this.autoCloseTimer);
    this.autoCloseTimer = setTimeout(() => {
      this._finishNow(isCorrect);
    }, delayMs);
  }

  _finishNow(isCorrect) {
    const cb = this.resolveCallback;
    const left = this.timeLeft;
    this.closeImmediately();
    if (typeof cb === 'function') {
      cb(isCorrect, left);
    }
  }
}
