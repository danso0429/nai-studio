// Tag DB (danbooru.csv format) + Pieces DB (frontend-loaded names).
// State is module-local; server.js calls these functions from endpoint handlers.

const fs = require('fs').promises;

let tagDB = [];
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

module.exports = { loadTagDB, searchTagsInDB, lookupTag, setPieces, searchPieces };
