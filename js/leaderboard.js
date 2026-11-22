/**
 * 雙模排行榜服務：
 * - 優先連線共用 Firebase Firestore（獨立命名空間 artifacts/lode-runner-quiz/public/data/leaderboards）
 * - 離線、超時或網路受阻時自動退回 localStorage 本機排行榜
 */

import { LEADERBOARD_CONFIG } from './config.js';
import { storage } from './storage.js';

const FIREBASE_VERSION = '11.6.1';
const INIT_TIMEOUT_MS = 6000;

function simpleHash(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function sanitizePlayerName(name) {
  return String(name ?? '').trim().slice(0, 16) || '匿名探險家';
}

function getEffectiveRunTime(entry) {
  const runSec = Number(entry?.runElapsedSec) || 0;
  if (runSec > 0) return runSec;
  const singleSec = Number(entry?.elapsedSec) || 0;
  return singleSec > 0 ? singleSec : Infinity;
}

function isBetterEntry(candidate, existing) {
  const cScore = candidate.score || 0;
  const eScore = existing.score || 0;
  if (cScore !== eScore) return cScore > eScore;
  const cLv = candidate.maxLevel || 1;
  const eLv = existing.maxLevel || 1;
  if (cLv !== eLv) return cLv > eLv;
  return getEffectiveRunTime(candidate) < getEffectiveRunTime(existing);
}

function sortAndTrimEntries(entries, maxCount) {
  return entries
    .slice()
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      if ((b.maxLevel || 0) !== (a.maxLevel || 0)) return (b.maxLevel || 0) - (a.maxLevel || 0);
      return getEffectiveRunTime(a) - getEffectiveRunTime(b);
    })
    .slice(0, maxCount);
}

class LeaderboardService {
  constructor() {
    this._initPromise = null;
    this._ready = false;
    this._db = null;
    this._auth = null;
    this._uid = null;
    this._fs = null;
  }

  getMode() {
    return this._ready && this._db && this._uid ? 'cloud' : 'local';
  }

  async init() {
    if (this._ready && this._db && this._uid) return true;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInitWithTimeout();
    const ok = await this._initPromise;
    if (!ok) {
      this._initPromise = null;
    }
    return ok;
  }

  async _doInitWithTimeout() {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return false;
    }

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve(false), INIT_TIMEOUT_MS);
    });

    const connectPromise = (async () => {
      try {
        const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
        const [appMod, authMod, fsMod] = await Promise.all([
          import(`${base}/firebase-app.js`),
          import(`${base}/firebase-auth.js`),
          import(`${base}/firebase-firestore.js`)
        ]);

        const app = appMod.getApps().length
          ? appMod.getApps().find((a) => a.name === 'lode-runner-lb') ||
            appMod.initializeApp(LEADERBOARD_CONFIG.firebaseConfig, 'lode-runner-lb')
          : appMod.initializeApp(LEADERBOARD_CONFIG.firebaseConfig, 'lode-runner-lb');

        const auth = authMod.getAuth(app);
        const db = fsMod.getFirestore(app);

        const user =
          auth.currentUser ||
          (await new Promise((resolve, reject) => {
            const unsub = authMod.onAuthStateChanged(
              auth,
              async (u) => {
                unsub();
                if (u) {
                  resolve(u);
                } else {
                  try {
                    const cred = await authMod.signInAnonymously(auth);
                    resolve(cred.user);
                  } catch (err) {
                    reject(err);
                  }
                }
              },
              (err) => {
                unsub();
                reject(err);
              }
            );
          }));

        if (!user?.uid) return false;

        this._auth = auth;
        this._db = db;
        this._uid = user.uid;
        this._fs = fsMod;
        this._ready = true;
        return true;
      } catch (err) {
        console.warn('雲端排行榜連線失敗，改用本機模式:', err?.message || err);
        this._ready = false;
        return false;
      }
    })();

    return Promise.race([connectPromise, timeoutPromise]);
  }

  async submitScore({
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
    const cleanName = sanitizePlayerName(name);
    const numericScore = Math.max(0, Math.round(Number(score) || 0));
    const numericLevelScore = Math.max(0, Math.round(Number(levelScore) || 0));
    const numericCareerScore = Math.max(0, Math.round(Number(careerScore) || 0));
    const numericLevel = Math.max(1, Math.round(Number(maxLevel) || 1));
    const numericStartLevel = Math.max(1, Math.round(Number(runStartLevel) || 1));
    const numericElapsed = Math.max(0, Math.round(Number(elapsedSec) || 0));
    const numericRunElapsed = Math.max(0, Math.round(Number(runElapsedSec) || 0));

    storage.setPlayerName(cleanName);
    storage.saveLocalLeaderboardEntry({
      name: cleanName,
      score: numericScore,
      levelScore: numericLevelScore,
      careerScore: numericCareerScore,
      maxLevel: numericLevel,
      runStartLevel: numericStartLevel,
      clearedAll: Boolean(clearedAll),
      elapsedSec: numericElapsed,
      runElapsedSec: numericRunElapsed
    });

    if (numericScore <= 0) {
      return { syncedCloud: false, cleanName };
    }

    const connected = await this.init();
    if (!connected || !this._db || !this._uid || !this._fs) {
      return { syncedCloud: false, cleanName };
    }

    try {
      const { doc, getDoc, setDoc } = this._fs;
      const docId = `${this._uid}_${simpleHash(cleanName)}`;
      const ref = doc(this._db, ...LEADERBOARD_CONFIG.collectionPath, docId);

      let prev = null;
      try {
        const snap = await getDoc(ref);
        if (snap.exists()) prev = snap.data();
      } catch (_) {
        // 讀取舊紀錄失敗時仍嘗試直接寫入
      }

      const incoming = {
        name: cleanName,
        score: numericScore,
        levelScore: numericLevelScore,
        careerScore: numericCareerScore,
        maxLevel: numericLevel,
        runStartLevel: numericStartLevel,
        clearedAll: Boolean(clearedAll),
        elapsedSec: numericElapsed,
        runElapsedSec: numericRunElapsed
      };

      const takeIncoming = !prev || isBetterEntry(incoming, prev);
      const base = takeIncoming ? incoming : prev;

      await setDoc(
        ref,
        {
          name: cleanName,
          score: Math.round(Number(base.score) || 0),
          levelScore: Math.round(Number(base.levelScore) || 0),
          careerScore: Math.max(Math.round(Number(prev?.careerScore) || 0), numericCareerScore),
          maxLevel: Math.round(Number(base.maxLevel) || 1),
          runStartLevel: Math.round(Number(base.runStartLevel) || 0),
          clearedAll: Boolean((prev && prev.clearedAll) || clearedAll),
          elapsedSec: Math.round(Number(base.elapsedSec) || 0),
          runElapsedSec: Math.round(Number(base.runElapsedSec) || 0),
          updatedAt: Date.now()
        },
        { merge: true }
      );

      return { syncedCloud: true, cleanName };
    } catch (err) {
      console.warn('寫入雲端排行榜失敗，已保留於本機排行榜:', err?.message || err);
      return { syncedCloud: false, cleanName };
    }
  }

  async fetchTopEntries() {
    const connected = await this.init();
    if (connected && this._db && this._fs) {
      try {
        const { collection, getDocs, query, orderBy, limit } = this._fs;
        const colRef = collection(this._db, ...LEADERBOARD_CONFIG.collectionPath);
        const q = query(colRef, orderBy('score', 'desc'), limit(100));
        const snap = await getDocs(q);

        const uniqueByName = new Map();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (!d || (d.score || 0) <= 0) return;
          const cleanName = sanitizePlayerName(d.name);
          const candidate = {
            name: cleanName,
            score: Math.round(Number(d.score) || 0),
            levelScore: Math.round(Number(d.levelScore) || 0),
            careerScore: Math.round(Number(d.careerScore) || 0),
            maxLevel: Math.round(Number(d.maxLevel) || 1),
            runStartLevel: Math.round(Number(d.runStartLevel) || 0),
            clearedAll: Boolean(d.clearedAll),
            elapsedSec: Math.round(Number(d.elapsedSec) || 0),
            runElapsedSec: Math.round(Number(d.runElapsedSec) || 0),
            updatedAt: d.updatedAt || 0
          };
          const existing = uniqueByName.get(cleanName);
          if (!existing || isBetterEntry(candidate, existing)) {
            uniqueByName.set(cleanName, candidate);
          }
        });

        const entries = sortAndTrimEntries(
          Array.from(uniqueByName.values()),
          LEADERBOARD_CONFIG.maxDisplay
        );
        return { mode: 'cloud', entries };
      } catch (err) {
        console.warn('讀取雲端排行榜失敗，退回本機紀錄:', err?.message || err);
      }
    }

    const save = storage.load();
    const localEntries = sortAndTrimEntries(
      save.localLeaderboard || [],
      LEADERBOARD_CONFIG.maxDisplay
    );
    return { mode: 'local', entries: localEntries };
  }
}

export const leaderboardService = new LeaderboardService();
