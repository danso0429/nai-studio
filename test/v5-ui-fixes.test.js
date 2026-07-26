'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('cycling mode exposes preset-wide selection without changing scene selection', () => {
  const editor = source('frontend/src/components/CharacterPresetEditor.tsx');
  assert.match(editor, /프리셋 선택 \(\{selectedPresets\.size\}\/\{presets\.length\}\)/);
  assert.match(editor, /new Set\(allSelected \? \[\] : presets\.map/);
  assert.match(editor, /const targets = filteredScenes\.map/);
});

test('expanded prompt follows the configured input background token', () => {
  const prompt = source('frontend/src/components/PromptEditTextArea.tsx');
  assert.match(prompt, /if \(fullScreen\) bgColor = 'bg-\[var\(--c-input-bg\)\] shadow-lg'/);
  assert.doesNotMatch(prompt, /if \(fullScreen\) bgColor = 'bg-white dark:bg-slate-600 shadow-lg'/);
});

test('mobile prompt expansion requires direct editor pointer intent and exposes a large close target', () => {
  const prompt = source('frontend/src/components/PromptEditTextArea.tsx');
  assert.match(prompt, /directEditorPointerRef/);
  assert.match(prompt, /!fullScreen && directEditorPointer/);
  assert.match(prompt, /onPointerDownCapture=\{markDirectEditorPointer\}/);
  assert.match(prompt, /vvRect\.height \* 0\.72/);
  assert.match(prompt, /w-11 h-11/);
  assert.match(prompt, /aria-label=\{fullScreen \? '프롬프트 편집 닫기'/);
});

test('scene editor defaults to focused prompt inputs with a non-destructive legacy switch', () => {
  const scene = source('frontend/src/components/SceneEditor.tsx');
  const preset = source('frontend/src/components/PreSetEditor.tsx');
  const config = source('frontend/src/main/config.ts');
  assert.match(scene, /simplified=\{!appState\.legacySceneEditor\}/);
  assert.match(scene, /씬 전용 네거티브 프롬프트/);
  assert.match(preset, /!legacyWorkflow && workflowType !== 'SDImageGen'/);
  assert.match(preset, /\{legacyWorkflow && <StackFixed/);
  assert.match(config, /legacySceneEditor\?: boolean/);
  assert.match(config, /legacyWorkflowMode\?: boolean/);
});

test('non-obvious editors expose reusable contextual help', () => {
  const help = source('frontend/src/components/HelpIcon.tsx');
  const preset = source('frontend/src/components/PreSetEditor.tsx');
  const pieces = source('frontend/src/components/PieceEditor.tsx');
  const templates = source('frontend/src/components/TemplateManagerModal.tsx');
  assert.match(help, /FaQuestionCircle/);
  assert.match(preset, /PROMPT_SYNTAX_HELP/);
  assert.match(pieces, /랜덤으로 골라/);
  assert.match(templates, /<HelpIcon/);
});

test('scene rename rebuilds the keyed map instead of moving the card to the end', () => {
  const sessions = source('frontend/src/models/SessionService.ts');
  assert.match(sessions, /for \(const \[key, value\] of map\)/);
  assert.match(sessions, /key === oldName \? newName : key/);
  assert.doesNotMatch(sessions, /map\.delete\(oldName\);\s*map\.set\(newName, scene\)/);
});
