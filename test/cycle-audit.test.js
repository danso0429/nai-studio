'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const scriptUrl = pathToFileURL(path.resolve(__dirname, '../scripts/audit-cycles.mjs')).href;

test('runtime cycle graph removes type-only and dynamic imports but detects static cycles', async () => {
  const { buildRuntimeGraph, summarizeGraph } = await import(scriptUrl);
  const sources = new Map([
    ['a.ts', "import type { B } from './b'; import('./dynamic'); export const a = 1 as B;"],
    ['b.ts', "import { c } from './c'; export type B = number; export const b = c;"],
    ['c.ts', "import { b } from './b'; export const c = b;"],
    ['dynamic.ts', "import { a } from './a'; export const dynamic = a;"],
  ]);
  const graph = buildRuntimeGraph(sources);
  assert.deepEqual(graph['a.ts'], []);
  assert.deepEqual(graph['dynamic.ts'], ['a.ts']);
  assert.deepEqual(summarizeGraph(graph).sccSizes, [2]);
  assert.equal(summarizeGraph(graph).internalEdges, 2);
  assert.equal(summarizeGraph(graph).directPairs, 1);
});

test('cycle audit reuses the madge package without spawning npx per graph', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/audit-cycles.mjs'), 'utf8');
  assert.match(source, /function loadMadge/);
  assert.match(source, /madgeResult\.circular\(\)/);
  assert.doesNotMatch(source, /spawnSync/);
});

test('repository runtime-static graph remains acyclic', async () => {
  const { analyzeRepository } = await import(scriptUrl);
  const report = await analyzeRepository();
  assert.deepEqual(report.runtimeSccSizes, []);
  assert.equal(report.runtimeInternalEdges, 0);
  assert.equal(report.runtimeDirectPairs, 0);
});
