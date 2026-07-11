// Tag DB (danbooru.csv format) + Pieces DB (frontend-loaded names).
// State is module-local; server.js calls these functions from endpoint handlers.

const fs = require('fs').promises;

let tagDB = [];
let tagDBByFreq = [];
let piecesDB = [];

async function loadTagDB(dbPath) {
  try {
    const content = await fs.readFile(dbPath, 'utf-8');
    tagDB = content.split('\n').filter(Boolean).map(line => {
      // danbooru.csv format: word,category,freq,"alias1,alias2,..."
      // or SDStudio format: word,category,freq,redirect
      const i1 = line.indexOf(',');
      if (i1 === -1) return null;
      const i2 = line.indexOf(',', i1 + 1);
      if (i2 === -1) return null;
      const i3 = line.indexOf(',', i2 + 1);
      if (i3 === -1) return null;
      const word = line.substring(0, i1);
      const category = parseInt(line.substring(i1 + 1, i2)) || 0;
      const freq = parseInt(line.substring(i2 + 1, i3)) || 0;
      let rest = line.substring(i3 + 1).replace(/^"|"$/g, '');
      // If rest contains commas, it's aliases — split and store for search
      const aliases = rest ? rest.split(',').map(a => a.trim()) : [];
      // M8: cache lowercased word + aliases for index/search to avoid per-keystroke toLowerCase().
      // redirect = "null" means "use word as-is"
      return {
        word, normalized: word, freq, category, redirect: 'null', priority: 0, aliases,
        _w: word.toLowerCase(),
        _aliases: aliases.map(a => a.toLowerCase()),
      };
    }).filter(Boolean);
    // M8: sort by lowercased word — enables binary search for prefix queries.
    tagDB.sort((a, b) => (a._w < b._w ? -1 : a._w > b._w ? 1 : 0));
    // full substring 검색은 freq 내림차순 결과만 필요. 같은 tag 객체의 참조 배열을 한 번
    // 정렬해 두면 요청마다 전체 matches를 만들고 다시 sort하지 않고 limit에서 조기 종료.
    // V8 sort는 stable이므로 동률은 tagDB의 기존 알파벳 순서까지 그대로 보존한다.
    tagDBByFreq = tagDB.slice().sort((a, b) => b.freq - a.freq);
    console.log(`[NAI Studio] Loaded ${tagDB.length} tags`);
  } catch {
    console.log('[NAI Studio] No db.csv found, tag search disabled');
  }
}

// M8: lower-bound binary search for prefix matching. Returns first index where _w >= q.
function _lowerBound(q) {
  let lo = 0, hi = tagDB.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tagDB[mid]._w < q) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// 원본 sdstudio 동작 호환: db.csv의 word는 underscore 형식이지만, 클라에 노출 시 space로
// 변환해 표시·insert. 검색 query는 그대로 underscore 매칭 (사용자가 space로 쳐도 매칭됨).
function _toDisplay(tag) {
  return {
    ...tag,
    word: tag.word.replace(/_/g, ' '),
    aliases: (tag.aliases || []).map((a) => a.replace(/_/g, ' ')),
  };
}

function searchTagsInDB(query) {
  if (!tagDB.length) return [];
  const q = query.toLowerCase().replace(/ /g, '_');
  const exact = [];
  const prefix = [];

  // M8: binary-search to first prefix-match; iterate forward while startsWith(q).
  // 100k DB에서 prefix lookup이 O(log N + matches)로 줄어듦.
  const start = _lowerBound(q);
  for (let i = start; i < tagDB.length; i++) {
    const tag = tagDB[i];
    if (!tag._w.startsWith(q)) break;
    if (tag._w === q) exact.push(tag);
    else { prefix.push(tag); if (prefix.length >= 50) break; }
  }

  // contains는 prefix 매칭 못 된 항목 — full scan 유지하되 limit 20 도달 시 즉시 break.
  // alias 매칭은 _aliases pre-cache로 toLowerCase 비용 제거.
  const contains = [];
  for (let i = 0; i < tagDB.length && contains.length < 20; i++) {
    const tag = tagDB[i];
    const w = tag._w;
    if (w === q || w.startsWith(q)) continue; // already in exact/prefix
    if (w.includes(q)) { contains.push(tag); continue; }
    if (tag._aliases.length > 0 && tag._aliases.some(a => a.includes(q))) {
      contains.push(tag);
    }
  }

  return [...exact, ...prefix.sort((a, b) => b.freq - a.freq), ...contains]
    .slice(0, 30)
    .map(_toDisplay);
}

// 태그 검색 도구(⑥) 전용: substring 매칭 전체를 freq(학습량) 내림차순으로. 자동완성
// searchTagsInDB(exact+prefix+contains 혼합·30 cap)와 분리 — 검색 도구는 '포함' 매칭 위주로
// 더 많은 결과. freq 정렬 참조 배열을 순회해 limit 도달 즉시 종료 — 기존 결과 순서 동일.
function searchTagsFull(query, limit) {
  if (!tagDBByFreq.length) return [];
  const q = (query || '').toLowerCase().replace(/ /g, '_');
  if (!q) return [];
  const lim = Math.min(Math.max(parseInt(limit) || 100, 1), 500);
  // 긴 query는 match가 적어 freq 배열을 끝까지 random-access하는 비용이 더 클 수 있다.
  // 알파벳 순 tagDB의 연속 scan + 소량 sort가 실제 측정상 빠르므로 기존 경로를 유지.
  if (q.length >= 8) {
    const matches = [];
    for (let i = 0; i < tagDB.length; i++) {
      const tag = tagDB[i];
      if (
        tag._w.includes(q) ||
        (tag._aliases.length > 0 && tag._aliases.some((a) => a.includes(q)))
      ) {
        matches.push(tag);
      }
    }
    matches.sort((a, b) => b.freq - a.freq);
    return matches.slice(0, lim).map(_toDisplay);
  }
  const matches = [];
  for (let i = 0; i < tagDBByFreq.length; i++) {
    const tag = tagDBByFreq[i];
    if (
      tag._w.includes(q) ||
      (tag._aliases.length > 0 && tag._aliases.some((a) => a.includes(q)))
    ) {
      matches.push(tag);
      if (matches.length >= lim) break;
    }
  }
  return matches.map(_toDisplay);
}

function lookupTag(query) {
  const q = (query || '').toLowerCase().replace(/ /g, '_');
  // M8: exact lookup via binary search — O(log N).
  const idx = _lowerBound(q);
  const t = idx < tagDB.length && tagDB[idx]._w === q ? tagDB[idx] : null;
  return t ? _toDisplay(t) : null;
}

function setPieces(pieces) {
  piecesDB = pieces || [];
}

function searchPieces(query) {
  const q = (query || '').toLowerCase();
  return piecesDB.filter(p => p.toLowerCase().includes(q)).slice(0, 30);
}

module.exports = { loadTagDB, searchTagsInDB, searchTagsFull, lookupTag, setPieces, searchPieces };
