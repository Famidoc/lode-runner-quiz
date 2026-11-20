/**
 * localStorage 遊戲進度、最高分、音量偏好與錯題複習池管理
 */

const SAVE_KEY = 'lr_quiz_save_v1';

const DEFAULT_SAVE = {
  highScore: 0,
  unlockedLevel: 1,
  levelRecords: {},
  muted: false,
  plantWrongPool: [],
  medicalWrongPool: [],
  totalSolved: {
    plant: 0,
    sudoku: 0,
    medical: 0
  }
};

function readRawSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      levelRecords: { ...(parsed.levelRecords || {}) },
      totalSolved: { ...DEFAULT_SAVE.totalSolved, ...(parsed.totalSolved || {}) },
      plantWrongPool: Array.isArray(parsed.plantWrongPool) ? parsed.plantWrongPool : [],
      medicalWrongPool: Array.isArray(parsed.medicalWrongPool) ? parsed.medicalWrongPool : []
    };
  } catch (_) {
    return structuredClone(DEFAULT_SAVE);
  }
}

function writeSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch (_) {
    // 忽略隱私模式或配額限制
  }
}

export const storage = {
  load() {
    return readRawSave();
  },

  setMuted(muted) {
    const save = readRawSave();
    save.muted = Boolean(muted);
    writeSave(save);
    return save;
  },

  recordLevelClear({ levelId, score, elapsedSec, totalLevels }) {
    const save = readRawSave();
    const key = String(levelId);
    const prev = save.levelRecords[key] || { bestScore: 0, bestTime: null, cleared: false };

    save.levelRecords[key] = {
      bestScore: Math.max(prev.bestScore || 0, score),
      bestTime: prev.bestTime === null ? elapsedSec : Math.min(prev.bestTime, elapsedSec),
      cleared: true
    };

    if (score > save.highScore) {
      save.highScore = score;
    }

    const nextUnlock = Math.min(totalLevels, levelId + 1);
    if (nextUnlock > save.unlockedLevel) {
      save.unlockedLevel = nextUnlock;
    }

    writeSave(save);
    return save;
  },

  updateHighScore(score) {
    const save = readRawSave();
    if (score > save.highScore) {
      save.highScore = score;
      writeSave(save);
    }
    return save;
  },

  recordQuizOutcome(type, itemId, isCorrect) {
    const save = readRawSave();
    if (isCorrect && save.totalSolved[type] !== undefined) {
      save.totalSolved[type] += 1;
    }

    if (type === 'plant' && itemId) {
      const set = new Set(save.plantWrongPool);
      if (isCorrect) set.delete(itemId);
      else set.add(itemId);
      save.plantWrongPool = Array.from(set).slice(-30);
    } else if (type === 'medical' && itemId) {
      const set = new Set(save.medicalWrongPool);
      if (isCorrect) set.delete(itemId);
      else set.add(itemId);
      save.medicalWrongPool = Array.from(set).slice(-30);
    }

    writeSave(save);
    return save;
  }
};
