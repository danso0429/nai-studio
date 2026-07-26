const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('추가 프롬프트는 상위 뒤·중간 앞의 단일 조합 지점에 배선된다', () => {
  const source = read('frontend/src/models/PromptService.ts');
  const append = source.indexOf("front = front.concat(toPARR(session.extraPrompt || ''))");
  const middle = source.indexOf('let middle: string[] = []', append);
  assert.notEqual(append, -1);
  assert.notEqual(middle, -1);
  assert.ok(append < middle);
  assert.equal((source.match(/session\.extraPrompt \|\| ''/g) || []).length, 1);
});

test('일반·이지 워크플로우 모두 추가 프롬프트를 중간 프롬프트 앞에 둔다', () => {
  const source = read('frontend/src/models/workflows/SDWorkFlow.ts');
  const blocks = ['const SDImageGenUI', 'const SDImageGenEasyUI'];
  for (const name of blocks) {
    const start = source.indexOf(name);
    const end = source.indexOf(']);', start);
    const block = source.slice(start, end);
    const extra = block.indexOf("wfiExtraPromptInput('추가 프롬프트'");
    const middle = block.indexOf('wfiMiddlePlaceholderInput');
    assert.notEqual(extra, -1, name);
    assert.notEqual(middle, -1, name);
    assert.ok(extra < middle, name);
  }
});

test('Session JSON은 추가 프롬프트를 복원하고 빈 값은 생략한다', () => {
  const source = read('frontend/src/models/types.ts');
  assert.match(source, /session\.extraPrompt = json\.extraPrompt \|\| ''/);
  assert.match(source, /extraPrompt: this\.extraPrompt \|\| undefined/);
});

test('접힌 프롬프트는 내용 배지와 영속 key를 유지한다', () => {
  const editor = read('frontend/src/components/PreSetEditor.tsx');
  const area = read('frontend/src/components/PromptEditTextArea.tsx');
  assert.match(editor, /sdstudio-prompt-fold/);
  assert.match(editor, /headerBadge=\{session\.extraPrompt\.trim\(\) \? '작성됨'/);
  assert.match(area, /headerCollapsed && headerBadge/);
  assert.match(area, /!headerCollapsed && textareaDiv/);
});
