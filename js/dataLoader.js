/**
 * 模組化題庫與關卡載入器（支援靜態 JSON 與預留 GAS / API 串接擴充）
 */

import { API_ENDPOINTS } from './config.js';

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`載入失敗 (${res.status}): ${url}`);
  }
  return res.json();
}

/**
 * 將 Google Drive 縮圖網址轉換為 Weserv 備援代理網址，降低部分行動網路封鎖風險
 */
export function buildImageCandidates(imageUrl) {
  const primary = String(imageUrl || '').trim();
  if (!primary) return [];
  const encoded = encodeURIComponent(primary);
  const proxy = `https://images.weserv.nl/?url=${encoded}&w=1000&output=webp`;
  return [primary, proxy];
}

/**
 * 預載植物圖片（並回傳可立刻顯示的狀態物件）
 */
export function preloadPlantImage(plant) {
  const result = {
    plantId: plant?.id || '',
    status: 'loading', // loading | ready | error
    loadedUrl: '',
    imgElement: null,
    promise: null
  };

  const candidates = buildImageCandidates(plant?.imageUrl);
  if (candidates.length === 0) {
    result.status = 'error';
    result.promise = Promise.resolve(result);
    return result;
  }

  result.promise = new Promise((resolve) => {
    let idx = 0;

    const tryNext = () => {
      if (idx >= candidates.length) {
        result.status = 'error';
        resolve(result);
        return;
      }
      const url = candidates[idx++];
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';

      const timer = setTimeout(() => {
        img.onload = null;
        img.onerror = null;
        tryNext();
      }, 4500);

      img.onload = () => {
        clearTimeout(timer);
        if (img.naturalWidth > 0) {
          result.status = 'ready';
          result.loadedUrl = url;
          result.imgElement = img;
          resolve(result);
        } else {
          tryNext();
        }
      };

      img.onerror = () => {
        clearTimeout(timer);
        tryNext();
      };

      img.src = url;
    };

    tryNext();
  });

  return result;
}

/**
 * 若未來於 config.js 填入 GAS / API URL，將嘗試遠端合併擴充題庫，失敗時靜默退回本地 JSON
 */
async function fetchWithOptionalRemote(localPath, remoteUrl) {
  const localData = await fetchJson(localPath);
  if (!remoteUrl) return localData;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(remoteUrl, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) return localData;
    const remoteJson = await res.json();
    if (Array.isArray(remoteJson) && remoteJson.length > 0) {
      return remoteJson;
    }
    if (remoteJson && Array.isArray(remoteJson.plants) && remoteJson.plants.length > 0) {
      return remoteJson.plants;
    }
  } catch (_) {
    // 遠端 API 逾時或離線時退回本地題庫
  }
  return localData;
}

export async function loadAllGameData() {
  const [levels, plants, sudokus, medical] = await Promise.all([
    fetchJson('./data/levels.json'),
    fetchWithOptionalRemote('./data/plants.json', API_ENDPOINTS.plantsGasUrl),
    fetchWithOptionalRemote('./data/sudoku.json', API_ENDPOINTS.sudokuApiUrl),
    fetchWithOptionalRemote('./data/medical.json', API_ENDPOINTS.medicalApiUrl)
  ]);

  return { levels, plants, sudokus, medical };
}
