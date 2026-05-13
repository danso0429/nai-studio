#!/usr/bin/env node
// project JSON의 scene.imageMap / scene.mains / inpaint.imageMap을 디스크 실제 상태와 동기화.
// 디스크에 없는 파일명 엔트리는 제거. 디스크에 추가된 파일은 건들지 않음 (앱이 다음 refresh로 흡수).
//
// 사용: node reconcile_image_map.js [--dry-run] [--no-backup]

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const OUTS_DIR = path.join(DATA_DIR, 'outs');
const INPAINTS_DIR = path.join(DATA_DIR, 'inpaints');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const NO_BACKUP = args.includes('--no-backup');

function listProjectFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listProjectFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json') && !entry.name.includes('.bak')) {
      out.push(full);
    }
  }
  return out;
}

function pngsInDir(dir) {
  try {
    return new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.png')));
  } catch (e) {
    if (e.code === 'ENOENT') return new Set();
    throw e;
  }
}

function reconcileScene(scene, sessionName, kind) {
  const baseDir = kind === 'scene' ? OUTS_DIR : INPAINTS_DIR;
  const dir = path.join(baseDir, sessionName, scene.name);
  const fileSet = pngsInDir(dir);

  let imageMapRemoved = 0;
  let mainsRemoved = 0;

  if (Array.isArray(scene.imageMap)) {
    const before = scene.imageMap.length;
    scene.imageMap = scene.imageMap.filter((x) => fileSet.has(x));
    imageMapRemoved = before - scene.imageMap.length;
  }
  if (kind === 'scene' && Array.isArray(scene.mains)) {
    const before = scene.mains.length;
    scene.mains = scene.mains.filter((x) => fileSet.has(x));
    mainsRemoved = before - scene.mains.length;
  }
  return { imageMapRemoved, mainsRemoved, diskCount: fileSet.size };
}

function run() {
  const files = listProjectFiles(PROJECTS_DIR);
  console.log(`scanning ${files.length} project file(s) (dry=${DRY})`);

  let projectsChanged = 0;
  let totalImageMapRemoved = 0;
  let totalMainsRemoved = 0;
  let totalScenes = 0;
  let totalInpaints = 0;

  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    const sessionName = data.name;
    if (!sessionName) {
      console.warn(`  ! ${path.relative(__dirname, file)} — no .name field, skipped`);
      continue;
    }

    let projectImageMapRemoved = 0;
    let projectMainsRemoved = 0;

    const scenes = data.scenes || {};
    for (const [name, scene] of Object.entries(scenes)) {
      totalScenes++;
      const r = reconcileScene(scene, sessionName, 'scene');
      projectImageMapRemoved += r.imageMapRemoved;
      projectMainsRemoved += r.mainsRemoved;
    }
    const inpaints = data.inpaints || {};
    for (const [name, scene] of Object.entries(inpaints)) {
      totalInpaints++;
      const r = reconcileScene(scene, sessionName, 'inpaint');
      projectImageMapRemoved += r.imageMapRemoved;
    }

    if (projectImageMapRemoved > 0 || projectMainsRemoved > 0) {
      projectsChanged++;
      totalImageMapRemoved += projectImageMapRemoved;
      totalMainsRemoved += projectMainsRemoved;
      const rel = path.relative(__dirname, file);
      console.log(`  - ${rel}: imageMap -${projectImageMapRemoved}, mains -${projectMainsRemoved}`);
      if (!DRY) {
        if (!NO_BACKUP) {
          fs.writeFileSync(`${file}.bak-reconcile-${ts}`, raw);
        }
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
      }
    }
  }

  console.log('---');
  console.log(`scenes scanned: ${totalScenes}, inpaints scanned: ${totalInpaints}`);
  console.log(`projects changed: ${projectsChanged}`);
  console.log(`imageMap entries removed: ${totalImageMapRemoved}`);
  console.log(`mains entries removed: ${totalMainsRemoved}`);
  if (DRY) console.log('(dry run — no files written)');
}

run();
