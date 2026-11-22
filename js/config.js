/**
 * 知識尋寶《Lode Runner》全域常數與生態串接設定
 */

export const APP_VERSION = 'v1.1.0';

export const COLS = 20;
export const ROWS = 12;
export const TILE_SIZE = 48; // 960 x 576 畫布內部分辨率

export const CANVAS_WIDTH = COLS * TILE_SIZE;
export const CANVAS_HEIGHT = ROWS * TILE_SIZE;

export const TILE = Object.freeze({
  AIR: 0,
  BRICK: 1,
  GRANITE: 2,
  LADDER: 3,
  ROPE: 4,
  EXIT_LADDER: 5
});

export const GAME_STATE = Object.freeze({
  READY: 'READY',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  QUIZ_FROZEN: 'QUIZ_FROZEN',
  LEVEL_CLEAR: 'LEVEL_CLEAR',
  GAME_OVER: 'GAME_OVER'
});

// 物理與時序常數（單位：格/秒 或 秒）
export const PHYSICS = Object.freeze({
  PLAYER_SPEED: 4.8,
  CLIMB_SPEED: 3.8,
  FALL_SPEED: 6.2,
  GHOST_SPEED: 3.35,
  GHOST_FRENZY_SPEED: 4.55,
  BRICK_REGEN_SEC: 5.0,
  BRICK_WARN_SEC: 1.2,
  GHOST_TRAP_SEC: 3.0,
  CHEST_COOLDOWN_SEC: 5.0,
  FRENZY_SEC: 5.0,
  INVINCIBLE_SEC: 1.8,
  RESPAWN_INVINCIBLE_SEC: 1.5,
  POST_WRONG_GRACE_SEC: 0.8,
  ROPE_DROP_COOLDOWN_SEC: 0.25,
  AI_REFRESH_SEC: 0.25,
  LADDER_SNAP_TOLERANCE: 0.38,
  DIG_ANIM_SEC: 0.24,
  MAX_LIVES: 3
});

// 知識題點時限（秒）
export const QUIZ_TIME = Object.freeze({
  plant: 15,
  sudoku: 45,
  medical: 30
});

// 知識寶箱視覺與標籤設定
export const CHEST_META = Object.freeze({
  plant: {
    key: 'plant',
    title: '捻花惹草・花草鑑別',
    shortName: '捻花惹草',
    icon: '🌿',
    color: '#22c55e',
    glow: 'rgba(34, 197, 94, 0.55)',
    badgeBg: '#14532d'
  },
  sudoku: {
    key: 'sudoku',
    title: '數獨共享・殘局填空',
    shortName: '數獨殘局',
    icon: '🔢',
    color: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.55)',
    badgeBg: '#0c4a6e'
  },
  medical: {
    key: 'medical',
    title: '加減學學・家醫常識',
    shortName: '加減學學',
    icon: '🩺',
    color: '#fb923c',
    glow: 'rgba(251, 146, 60, 0.55)',
    badgeBg: '#7c2d12'
  }
});

// 計分常數
export const SCORE = Object.freeze({
  CHEST_CORRECT: 300,
  TIME_BONUS_MULT: 10,
  GHOST_CRUSH: 150,
  LEVEL_CLEAR_BASE: 500,
  PAR_TIME_BONUS_MULT: 5,
  LIFE_BONUS: 200
});

// 外部生態網站與預留 GAS / API 串接點
export const ECOSYSTEM = Object.freeze({
  GAME_SITE_URL: 'https://famidoc.github.io/lode-runner-quiz/',
  PLANTS_SITE_URL: 'https://famidoc.github.io/plants/',
  SUDOKU_SITE_URL: 'https://famidoc.github.io/sudoku/sudoku.html',
  YOUTUBE_SEARCH_URL: 'https://www.youtube.com/results?search_query=%E5%8A%A0%E6%B8%9B%E5%AD%B8%E5%AD%B8+%E5%BC%B5%E6%96%87%E8%8F%AF'
});

// 雲端排行榜設定（共用既有 Firebase 專案並採獨立命名空間，與數獨完全隔離）
export const LEADERBOARD_CONFIG = Object.freeze({
  appId: 'lode-runner-quiz',
  collectionPath: ['artifacts', 'lode-runner-quiz', 'public', 'data', 'leaderboards'],
  maxDisplay: 30,
  firebaseConfig: {
    apiKey: 'AIzaSyA-1IsmCIMonv1gtTyBatAN5xaPgGxV-F8',
    authDomain: 'sudoku-hub-20df8.firebaseapp.com',
    projectId: 'sudoku-hub-20df8',
    storageBucket: 'sudoku-hub-20df8.firebasestorage.app',
    messagingSenderId: '137178297315',
    appId: '1:137178297315:web:340d1592423be29e1566d6'
  }
});

export const API_ENDPOINTS = Object.freeze({
  plantsGasUrl: '',
  sudokuApiUrl: '',
  medicalApiUrl: ''
});
