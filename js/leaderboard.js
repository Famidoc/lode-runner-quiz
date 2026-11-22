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

function isBetterEntry(candidate, existing) {
  const cScore = candidate.score || 0;
  const eScore = existing.score || 0;
  if (cScore !== eScore) return cScore > eScore;
  const cLv = candidate.maxLevel || 1;
  const eLv = existing.maxLevel || 1;
  if (cLv !== eLv) return cLv > eLv;
  return (candidate.elapsedSec ?? Infinity) < (existing.elapsedSec ?? Infinity);
}

function sortAndTrimEntries(entries, maxCount) {
  return entries
    .slice()
    .sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      if ((b.maxLevel || 0) !== (a.maxLevel || 0)) return (b.maxLevel || 0) - (a.maxLevel || 0);
      return (a.elapsedSec || 0) - (b.elapsedSec || 0);
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

  async submitScore({ name, score, maxLevel, clearedAll, elapsedSec }) {
    const cleanName = sanitizePlayerName(name);
    const numericScore = Math.max(0, Math.round(Number(score) || 0));
    const numericLevel = Math.max(1, Math.round(Number(maxLevel) || 1));
    const numericElapsed = Math.max(0, Math.round(Number(elapsedSec) || 0));

    storage.setPlayerName(cleanName);
    storage.saveLocalLeaderboardEntry({
      name: cleanName,
      score: numericScore,
      maxLevel: numericLevel,
      clearedAll: Boolean(clearedAll),
      elapsedSec: numericElapsed
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
        maxLevel: numericLevel,
        clearedAll: Boolean(clearedAll),
        elapsedSec: numericElapsed
      };

      const useIncomingTiming = !prev || isBetterEntry(incoming, prev);

      await setDoc(
        ref,
        {
          name: cleanName,
          score: prev ? Math.max(prev.score || 0, numericScore) : numericScore,
          maxLevel: prev ? Math.max(prev.maxLevel || 1, numericLevel) : numericLevel,
          clearedAll: Boolean((prev && prev.clearedAll) || clearedAll),
          elapsedSec: useIncomingTiming ? numericElapsed : prev.elapsedSec || numericElapsed,
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
        const { collection, getDocs } = this._fs;
        const colRef = collection(this._db, ...LEADERBOARD_CONFIG.collectionPath);
        const snap = await getDocs(colRef);

        const uniqueByName = new Map();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          if (!d || (d.score || 0) <= 0) return;
          const cleanName = sanitizePlayerName(d.name);
          const candidate = {
            name: cleanName,
            score: Math.round(Number(d.score) || 0),
            maxLevel: Math.round(Number(d.maxLevel) || 1),
            clearedAll: Boolean(d.clearedAll),
            elapsedSec: Math.round(Number(d.elapsedSec) || 0),
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
