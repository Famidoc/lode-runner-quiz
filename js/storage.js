/**
 * localStorage 遊戲進度、最高分、音量偏好、錯題複習池與本機排行榜管理
 */

const SAVE_KEY = 'lr_quiz_save_v1';
const MAX_LOCAL_LEADERBOARD = 30;

const LEGACY_PAR_TIMES = {
  1: 120,
  2: 140,
  3: 150,
  4: 170,
  5: 200,
  6: 185,
  7: 195,
  8: 210,
  9: 220,
  10: 230,
  11: 245,
  12: 260
};

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

function getEffectiveRunTime(entry) {
  const runSec = Number(entry?.runElapsedSec) || 0;
  if (runSec > 0) return runSec;
  const singleSec = Number(entry?.elapsedSec) || 0;
  return singleSec > 0 ? singleSec : Infinity;
}

function isBetterRunEntry(candidate, existing) {
  const cScore = candidate.score || 0;
  const eScore = existing.score || 0;
  if (cScore !== eScore) return cScore > eScore;
  const cLv = candidate.maxLevel || 1;
  const eLv = existing.maxLevel || 1;
  if (cLv !== eLv) return cLv > eLv;
  return getEffectiveRunTime(candidate) < getEffectiveRunTime(existing);
}

function backfillLegacyLevelScores(save) {
  const records = save.levelRecords || {};
  const ids = Object.keys(records)
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .sort((a, b) => a - b);

  let changed = false;

  for (const id of ids) {
    const rec = records[String(id)];
    if (!rec || rec.cleared !== true) continue;
    if (Number(rec.bestLevelScore) > 0) continue;

    const bestScore = Number(rec.bestScore) || 0;
    const prevRec = records[String(id - 1)];
    const prevBestScore = prevRec ? Number(prevRec.bestScore) || 0 : 0;

    let est = 0;
    if (id === 1 && bestScore >= 500 && bestScore <= 4500) {
      est = Math.round(bestScore);
    } else if (prevBestScore > 0) {
      const diff = Math.round(bestScore - prevBestScore);
      if (diff >= 1200 && diff <= 4200) {
        est = diff;
      }
    }

    if (est === 0 && bestScore >= 1200 && bestScore <= 4200) {
      est = Math.round(bestScore);
    }

    if (est === 0) {
      const par = LEGACY_PAR_TIMES[id] || 180;
      const rawTime = Number(rec.bestTime);
      const bestT = rec.bestTime !== null && Number.isFinite(rawTime) ? rawTime : Math.round(par * 0.5);
      const rawEst = 1800 + Math.max(0, Math.round((par - bestT) * 5));
      est = Math.max(1400, Math.min(3600, rawEst));
    }

    rec.bestLevelScore = est;
    rec.estimatedLevelScore = true;
    changed = true;
  }

  return changed;
}

function readRawSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return structuredClone(DEFAULT_SAVE);
    const parsed = JSON.parse(raw);
    const normalized = {
      ...DEFAULT_SAVE,
      ...parsed,
      playerName: sanitizeName(parsed.playerName),
      localLeaderboard: Array.isArray(parsed.localLeaderboard) ? parsed.localLeaderboard : [],
      levelRecords: { ...(parsed.levelRecords || {}) },
      totalSolved: { ...DEFAULT_SAVE.totalSolved, ...(parsed.totalSolved || {}) },
      plantWrongPool: Array.isArray(parsed.plantWrongPool) ? parsed.plantWrongPool : [],
      medicalWrongPool: Array.isArray(parsed.medicalWrongPool) ? parsed.medicalWrongPool : []
    };

    if (backfillLegacyLevelScores(normalized)) {
      writeSave(normalized);
    }
    return normalized;
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

  saveLocalLeaderboardEntry({
    name,
    score,
    levelScore = 0,
    careerScore = 0,
    maxLevel,
    runStartLevel = 1,
    clearedAll,
    elapsedSec,
    runElapsedSec = 0
  }) {
    const save = readRawSave();
    const numericScore = Math.max(0, Math.round(Number(score) || 0));
    if (numericScore <= 0) return save;

    const cleanName = sanitizeName(name) || '匿名探險家';
    const nextEntry = {
      name: cleanName,
      score: numericScore,
      levelScore: Math.max(0, Math.round(Number(levelScore) || 0)),
      careerScore: Math.max(0, Math.round(Number(careerScore) || 0)),
      maxLevel: Math.max(1, Math.round(Number(maxLevel) || 1)),
      runStartLevel: Math.max(1, Math.round(Number(runStartLevel) || 1)),
      clearedAll: Boolean(clearedAll),
      elapsedSec: Math.max(0, Math.round(Number(elapsedSec) || 0)),
      runElapsedSec: Math.max(0, Math.round(Number(runElapsedSec) || 0)),
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
      const takeIncoming = isBetterRunEntry(nextEntry, prev);
      const base = takeIncoming ? nextEntry : prev;
      byName.set(cleanName, {
        name: cleanName,
        score: base.score || 0,
        levelScore: base.levelScore || 0,
        careerScore: Math.max(prev.careerScore || 0, nextEntry.careerScore),
        maxLevel: base.maxLevel || 1,
        runStartLevel: base.runStartLevel || 0,
        clearedAll: Boolean(prev.clearedAll || nextEntry.clearedAll),
        elapsedSec: base.elapsedSec || 0,
        runElapsedSec: base.runElapsedSec || 0,
        updatedAt: Date.now()
      });
    }

    save.localLeaderboard = Array.from(byName.values())
      .sort((a, b) => {
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        if ((b.maxLevel || 0) !== (a.maxLevel || 0)) return (b.maxLevel || 0) - (a.maxLevel || 0);
        return getEffectiveRunTime(a) - getEffectiveRunTime(b);
      })
      .slice(0, MAX_LOCAL_LEADERBOARD);

    writeSave(save);
    return save;
  },

  recordLevelClear({ levelId, score, levelScore = 0, elapsedSec, totalLevels }) {
    const save = readRawSave();
    const key = String(levelId);
    const prev = save.levelRecords[key] || {
      bestScore: 0,
      bestLevelScore: 0,
      bestTime: null,
      cleared: false,
      estimatedLevelScore: false
    };
    const cleanLevelScore = Math.max(0, Math.round(Number(levelScore) || 0));
    const nextLevelScore =
      cleanLevelScore > 0
        ? prev.estimatedLevelScore
          ? cleanLevelScore
          : Math.max(prev.bestLevelScore || 0, cleanLevelScore)
        : prev.bestLevelScore || 0;
    const stillEstimated = cleanLevelScore > 0 ? false : Boolean(prev.estimatedLevelScore);

    save.levelRecords[key] = {
      bestScore: Math.max(prev.bestScore || 0, score),
      bestLevelScore: nextLevelScore,
      bestTime: prev.bestTime === null ? elapsedSec : Math.min(prev.bestTime, elapsedSec),
      cleared: true,
      estimatedLevelScore: stillEstimated
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

  getCareerSummary(saveData = null) {
    const save = saveData || readRawSave();
    const records = Object.values(save.levelRecords || {});
    let careerScore = 0;
    let scoredLevelsCount = 0;
    let clearedLevelsCount = 0;
    let estimatedLevelsCount = 0;

    for (const rec of records) {
      if (!rec) continue;
      if (rec.cleared) clearedLevelsCount += 1;
      const lvScore = Math.max(0, Math.round(Number(rec.bestLevelScore) || 0));
      if (lvScore > 0) {
        careerScore += lvScore;
        scoredLevelsCount += 1;
        if (rec.estimatedLevelScore) estimatedLevelsCount += 1;
      }
    }

    return { careerScore, scoredLevelsCount, clearedLevelsCount, estimatedLevelsCount };
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
