// Generate nainai diffusion-noise icon. Deterministic (seeded).
// Output: ../public/icons/nainai.svg

const fs = require('fs');
const path = require('path');

const SEED = 91;
let s = SEED;
function rand() {
  s = (s * 1103515245 + 12345) & 0x7fffffff;
  return s / 0x7fffffff;
}

const GRID = 10;
const SIZE = 512;
const CELL = SIZE / GRID;

const cells = [];
for (let j = 0; j < GRID; j++) {
  for (let i = 0; i < GRID; i++) {
    // Diagonal clarity: top-right clean, bottom-left noisy.
    const d = (i + (GRID - 1 - j)) / (2 * (GRID - 1));
    // Three-zone: pure noise (d<0.35) → transition → pure clean (d>0.7).
    let noise;
    if (d < 0.30) noise = 1.0;
    else if (d > 0.72) noise = 0.0;
    else noise = 1 - (d - 0.30) / 0.42;

    // Noise pixel: wide hue range (blue→magenta) + wide lightness for visible chaos.
    const nH = 220 + rand() * 100;     // 220-320 (blue→magenta)
    const nS = 30 + rand() * 70;       // 30-100% sat
    const nL = 8 + rand() * 82;        // 8-90% lightness
    // Clean target: bright lavender.
    const cH = 268, cS = 70, cL = 78;
    const h = nH * noise + cH * (1 - noise);
    const sat = nS * noise + cS * (1 - noise);
    const l = nL * noise + cL * (1 - noise);
    cells.push({ i, j, color: `hsl(${h.toFixed(1)} ${sat.toFixed(1)}% ${l.toFixed(1)}%)` });
  }
}

const rects = cells.map((c) =>
  `<rect x="${(c.i * CELL).toFixed(2)}" y="${(c.j * CELL).toFixed(2)}" width="${CELL.toFixed(2)}" height="${CELL.toFixed(2)}" fill="${c.color}"/>`
).join('');

const svg = `<svg viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
<rect width="${SIZE}" height="${SIZE}" fill="#1a0d2e"/>
${rects}
</svg>
`;

const outPath = path.join(__dirname, '..', 'public', 'icons', 'nainai.svg');
fs.writeFileSync(outPath, svg);
console.log('wrote', outPath, svg.length, 'bytes');
