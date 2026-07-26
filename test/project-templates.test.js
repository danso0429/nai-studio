'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) =>
  fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('project templates keep independent images and recorded replacement surfaces', () => {
  const project = read('frontend/src/models/ProjectTemplateService.ts');
  const inheritance = read('frontend/src/models/TemplateService.ts');
  assert.match(project, /const IMAGE_DIR = 'project_template_images'/);
  assert.match(project, /async cloneContent/);
  assert.match(project, /instantiateIntoSession/);
  assert.match(project, /removeRecordedInstances/);
  assert.match(inheritance, /templateApplications/);
  assert.match(inheritance, /protectAreas/);
  assert.match(inheritance, /replaceExisting/);
});

test('folder defaults resolve through ancestors and survive folder/project renames', () => {
  const inheritance = read('frontend/src/models/TemplateService.ts');
  const sessions = read('frontend/src/models/SessionService.ts');
  assert.match(inheritance, /while \(current\)/);
  assert.match(inheritance, /current\.lastIndexOf\('\/'\)/);
  assert.match(sessions, /templateService\.renameFolder\(oldPath, newPath\)/);
  assert.match(sessions, /templateService\.renameFolder\(folderPath, newPath\)/);
  assert.match(sessions, /templateService\.renameProject\(oldName, newName\)/);
  assert.match(sessions, /templateService\.removeProject\(name\)/);
});

test('scene templates are hidden project roles with shallow file transfer', () => {
  const templates = read('frontend/src/models/TemplateService.ts');
  const manager = read('frontend/src/components/TemplateManagerModal.tsx');
  assert.match(templates, /setHiddenProjectRole\(name, 'scene-template'\)/);
  assert.match(templates, /type: 'sdstudio-scene-template'/);
  assert.match(templates, /exportSessionShallow/);
  assert.match(templates, /moveSceneToTrash/);
  assert.match(manager, /프로젝트 템플릿/);
  assert.match(manager, /씬 템플릿/);
});

test('new project entry points consume explicit or inherited templates', () => {
  const selector = read('frontend/src/components/SessionSelect.tsx');
  const drawer = read('frontend/src/components/ProjectDrawer.tsx');
  assert.match(selector, /templateService\.pickForCreate\(\)/);
  assert.match(selector, /templateService\.createProject/);
  assert.match(drawer, /manageFolderTemplate/);
  assert.match(drawer, /templateService\.createProject/);
  assert.match(drawer, /폴더 전용 템플릿 새로 만들기/);
});

test('inheritance is visible, breakable, and explicitly propagated', () => {
  const drawer = read('frontend/src/components/ProjectDrawer.tsx');
  const manager = read('frontend/src/components/TemplateManagerModal.tsx');
  const app = read('frontend/src/models/AppService.ts');
  assert.match(drawer, /♚/);
  assert.match(drawer, /♟/);
  assert.match(manager, /listInheritedChildren/);
  assert.match(manager, /상속 자식에 재적용/);
  assert.match(manager, /replaceExisting: true/);
  assert.match(app, /__break_inheritance__/);
  assert.match(app, /templateService\.breakInheritance\(name\)/);
});

test('template lifecycle preserves pending state and releases replaced image ownership', () => {
  const project = read('frontend/src/models/ProjectTemplateService.ts');
  const inheritance = read('frontend/src/models/TemplateService.ts');
  assert.match(inheritance, /if \(!this\.projectTemplateService\.loaded\) await this\.projectTemplateService\.load\(\)/);
  assert.match(inheritance, /if \(sourceScenes\.length > 0\) session\.scenes\.clear\(\)/);
  assert.match(project, /const previousTokens = this\.imageTokens\(target\)/);
  assert.match(project, /const retainedTokens = new Set\(this\.imageTokens\(entry\)\)/);
  assert.match(project, /throw new Error\(`템플릿 이미지 복사에 실패했습니다:/);
  assert.match(project, /createdTokens\.map\(\(token\) => this\.backend\.deleteFile/);
  assert.doesNotMatch(project, /return data \? this\.storeImage\(data\) : token/);
  assert.ok((project.match(/await this\.backend\.deleteFile\(this\.getImagePath\(token\)\)/g) ?? []).length >= 3);
});
