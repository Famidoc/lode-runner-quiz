/**
 * localStorage 遊戲進度、最高分、音量偏好、錯題複習池與本機排行榜管理
 */

const SAVE_KEY = 'lr_quiz_save_v1';
const MAX_LOCAL_LEADERBOARD = 30;

const DEFAULT_SAVE = {
  highScore: 0,
  unlockedLevel: 1,
  levelRecords: {},
  muted: false,
  playerName: '',
  localLeaderboard: [],
  plantWrongPool: [],
  medicalWrongPool: [],
  totalSolved: {
    plant: 0,
    sudoku: 0,
    medical: 0
  }
};

function sanitizeName(name) {
  return String(name ?? '').trim().slice(0, 16);
}

function readRawSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SAVE,
      ...parsed,
      playerName: sanitizeName(parsed.playerName),
      localLeaderboard: Array.isArray(parsed.localLeaderboard) ? parsed.localLeaderboard : [],
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

  setPlayerName(name) {
    const save = readRawSave();
    save.playerName = sanitizeName(name);
    writeSave(save);
    return save;
  },

  saveLocalLeaderboardEntry({ name, score, maxLevel, clearedAll, elapsedSec }) {
    const save = readRawSave();
    const numericScore = Math.max(0, Math.round(Number(score) || 0));
    if (numericScore <= 0) return save;

    const cleanName = sanitizeName(name) || '匿名探險家';
    const nextEntry = {
      name: cleanName,
      score: numericScore,
      maxLevel: Math.max(1, Math.round(Number(maxLevel) || 1)),
      clearedAll: Boolean(clearedAll),
      elapsedSec: Math.max(0, Math.round(Number(elapsedSec) || 0)),
      updatedAt: Date.now()
    };

    const byName = new Map();
    for (const item of save.localLeaderboard) {
      if (!item || (item.score || 0) <= 0) continue;
      const itemName = sanitizeName(item.name) || '匿名探險家';
      byName.set(itemName, { ...item, name: itemName });
    }

    const prev = byName.get(cleanName);
    if (!prev) {
      byName.set(cleanName, nextEntry);
    } else {
      const isBetterScore = nextEntry.score > prev.score;
      const isSameScoreBetterProgress =
        nextEntry.score === prev.score &&
        (nextEntry.maxLevel > (prev.maxLevel || 1) ||
          (nextEntry.maxLevel === (prev.maxLevel || 1) &&
            nextEntry.elapsedSec < (prev.elapsedSec ?? Infinity)));

      byName.set(cleanName, {
        name: cleanName,
        score: Math.max(prev.score, nextEntry.score),
        maxLevel: Math.max(prev.maxLevel || 1, nextEntry.maxLevel),
        clearedAll: Boolean(prev.clearedAll || nextEntry.clearedAll),
        elapsedSec: isBetterScore || isSameScoreBetterProgress ? nextEntry.elapsedSec : (prev.elapsedSec || nextEntry.elapsedSec),
        updatedAt: Date.now()
      });
    }

    save.localLeaderboard = Array.from(byName.values())
      .sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        if ((b.maxLevel || 0) !== (a.maxLevel || 0)) return (b.maxLevel || 0) - (a.maxLevel || 0);
        return (a.elapsedSec || 0) - (b.elapsedSec || 0);
      })
      .slice(0, MAX_LOCAL_LEADERBOARD);

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
