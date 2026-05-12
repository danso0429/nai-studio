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
      // redirect = "null" means "use word as-is"
      return { word, normalized: word, freq, category, redirect: 'null', priority: 0, aliases };
    }).filter(Boolean);
    console.log(`[NAI Studio] Loaded ${tagDB.length} tags`);
  } catch {
    console.log('[NAI Studio] No db.csv found, tag search disabled');
  }
}

function searchTagsInDB(query) {
  if (!tagDB.length) return [];
  const q = query.toLowerCase().replace(/ /g, '_');
  const exact = [];
  const prefix = [];
  const contains = [];
  for (const tag of tagDB) {
    const w = tag.word.toLowerCase();
    if (w === q) { exact.push(tag); continue; }
    if (w.startsWith(q)) { prefix.push(tag); if (prefix.length > 50) continue; continue; }
    if (contains.length < 20) {
      if (w.includes(q)) { contains.push(tag); continue; }
      // Also match aliases
      if (tag.aliases && tag.aliases.some(a => a.toLowerCase().includes(q))) {
        contains.push(tag);
      }
    }
  }
  return [...exact, ...prefix.sort((a, b) => b.freq - a.freq), ...contains].slice(0, 30);
}

function lookupTag(query) {
  const q = (query || '').toLowerCase().replace(/ /g, '_');
  return tagDB.find(t => t.word.toLowerCase() === q) || null;
}

function setPieces(pieces) {
  piecesDB = pieces || [];
}

function searchPieces(query) {
  const q = (query || '').toLowerCase();
  return piecesDB.filter(p => p.toLowerCase().includes(q)).slice(0, 30);
}

module.exports = { loadTagDB, searchTagsInDB, lookupTag, setPieces, searchPieces };
