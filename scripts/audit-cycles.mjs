#!/usr/bin/env node

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(rootDir, 'frontend/src');
const require = createRequire(import.meta.url);
const ts = require(path.join(rootDir, 'frontend/node_modules/typescript'));

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function normalizeModule(value) {
  return value.split(path.sep).join('/').replace(/^\.\//, '');
}

function walkSources(dir = sourceDir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...walkSources(absolute));
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      result.push(absolute);
    }
  }
  return result.sort();
}

function resolveRelativeImport(from, specifier, modules) {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ];
  return candidates.find((candidate) => modules.has(candidate));
}

function staticSpecifiers(source, filename) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const result = [];
  for (const statement of parsed.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier
      && ts.isStringLiteral(statement.moduleSpecifier)) {
      result.push(statement.moduleSpecifier.text);
    }
  }
  return result;
}

export function buildRuntimeGraph(sourceFiles) {
  const modules = new Set(sourceFiles.keys());
  const graph = {};
  for (const [filename, source] of [...sourceFiles.entries()].sort()) {
    const output = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
      fileName: filename,
    }).outputText;
    graph[filename] = sortedUnique(
      staticSpecifiers(output, filename)
        .map((specifier) => resolveRelativeImport(filename, specifier, modules))
        .filter(Boolean),
    );
  }
  return graph;
}

export function stronglyConnectedComponents(graph) {
  const nodes = sortedUnique([
    ...Object.keys(graph),
    ...Object.values(graph).flat(),
  ]);
  let cursor = 0;
  const indices = new Map();
  const lowlinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const visit = (node) => {
    indices.set(node, cursor);
    lowlinks.set(node, cursor++);
    stack.push(node);
    onStack.add(node);
    for (const next of graph[node] || []) {
      if (!indices.has(next)) {
        visit(next);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(next)));
      }
    }
    if (lowlinks.get(node) !== indices.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    components.push(component.sort());
  };

  for (const node of nodes) if (!indices.has(node)) visit(node);
  return components
    .filter((members) => members.length > 1 || (graph[members[0]] || []).includes(members[0]))
    .sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
}

export function summarizeGraph(graph) {
  const components = stronglyConnectedComponents(graph).map((members) => {
    const memberSet = new Set(members);
    const edges = members.flatMap((from) => (graph[from] || [])
      .filter((to) => memberSet.has(to))
      .map((to) => ({ from, to })))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
    return { members, edges };
  });
  const mutualPairs = [];
  for (const component of components) {
    const memberSet = new Set(component.members);
    for (const from of component.members) {
      for (const to of graph[from] || []) {
        if (from < to && memberSet.has(to) && (graph[to] || []).includes(from)) {
          mutualPairs.push([from, to]);
        }
      }
    }
  }
  return {
    sccSizes: components.map(({ members }) => members.length),
    internalEdges: components.reduce((sum, component) => sum + component.edges.length, 0),
    directPairs: mutualPairs.length,
    mutualPairs,
    components,
  };
}

function loadMadge() {
  try {
    return require(require.resolve('madge', { paths: [rootDir] }));
  } catch {
    // The project historically invokes madge through npx. Reuse that installed
    // package without spawning npx twice or depending on its cycle exit status.
    const npxRoot = path.join(os.homedir(), '.npm/_npx');
    if (fs.existsSync(npxRoot)) {
      for (const entry of fs.readdirSync(npxRoot).sort().reverse()) {
        const candidate = path.join(npxRoot, entry, 'node_modules/madge');
        if (fs.existsSync(path.join(candidate, 'package.json'))) return require(candidate);
      }
    }
    throw new Error('madge package not found; run `npx madge --version` once first');
  }
}

export async function analyzeRepository() {
  const sources = new Map(walkSources().map((absolute) => [
    normalizeModule(path.relative(sourceDir, absolute)),
    fs.readFileSync(absolute, 'utf8'),
  ]));
  const madgeResult = await loadMadge()(sourceDir, { fileExtensions: ['ts', 'tsx'] });
  const rawGraph = madgeResult.obj();
  const rawPaths = madgeResult.circular();
  const raw = summarizeGraph(rawGraph);
  const runtime = summarizeGraph(buildRuntimeGraph(sources));
  return {
    schemaVersion: 1,
    sourceModules: sources.size,
    rawPaths: rawPaths.length,
    rawSccSizes: raw.sccSizes,
    runtimeSccSizes: runtime.sccSizes,
    runtimeInternalEdges: runtime.internalEdges,
    runtimeDirectPairs: runtime.directPairs,
    rawComponents: raw.components,
    runtimeComponents: runtime.components,
    runtimeMutualPairs: runtime.mutualPairs,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await analyzeRepository();
  const output = process.argv.includes('--summary') ? {
    schemaVersion: report.schemaVersion,
    sourceModules: report.sourceModules,
    rawPaths: report.rawPaths,
    rawSccSizes: report.rawSccSizes,
    runtimeSccSizes: report.runtimeSccSizes,
    runtimeInternalEdges: report.runtimeInternalEdges,
    runtimeDirectPairs: report.runtimeDirectPairs,
    runtimeSccMembers: report.runtimeComponents.map(({ members }) => members),
    runtimeMutualPairs: report.runtimeMutualPairs,
  } : report;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}
