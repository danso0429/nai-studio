import {
  backend,
  isMobile,
  promptService,
  globalPieceService,
  promptChunkService,
  toggleGroupService,
} from '.';
import {
  InpaintScene,
  PARR,
  PromptGroupNode,
  PromptNode,
  PromptPiece,
  PromptRandomNode,
  Scene,
  Session,
} from './types';

function cleanPARR(parr: PARR): PARR {
  return parr.map((p) => p.trim());
}

// ─── prompt chunk 토큰 ───
// chunk를 프롬프트 문자열 안에 id 기반 토큰으로 박음. 쉼표/개행 없어 toPARR 한 단어로 유지.
// 화면엔 알약(이름+color)으로 렌더(highlightPrompt), 생성 시 content로 펼침(expandChunkTokens).
// 형식: ⟦c:<uuid>⟧ — 사용자가 실수로 칠 일 없는 특수 괄호.
const CHUNK_TOKEN_RE = /⟦c:([0-9a-fA-F-]+)⟧/g;

export function makeChunkToken(id: string): string {
  return `⟦c:${id}⟧`;
}

// 문자열의 chunk 토큰을 각 chunk content로 치환. 삭제된 chunk 토큰은 제거(빈 문자열).
export function expandChunkTokens(text: string): string {
  if (!text || text.indexOf('⟦c:') === -1) return text;
  return text.replace(CHUNK_TOKEN_RE, (_m, id) => {
    const chunk = promptChunkService.get(id);
    return chunk ? chunk.content : '';
  });
}

// 죽은 chunk 토큰(현재 라이브러리에 없는 id)을 제거 + 인접 쉼표/공백 정리.
// chunk 삭제 시 프롬프트에서 그 알약을 진짜 없애는 용도. 살아있는 토큰은 보존.
// 변화 없으면 원본 문자열 그대로 반환(===로 no-op 판정 가능).
export function stripDeadChunkTokens(text: string): string {
  if (!text || text.indexOf('⟦c:') === -1) return text;
  let changed = false;
  // 토큰 + 바로 앞 쉼표/공백을 함께 매칭 → 죽은 것만 통째 제거.
  let out = text.replace(/[ \t]*,?[ \t]*⟦c:([0-9a-fA-F-]+)⟧/g, (m, id) => {
    if (promptChunkService.get(id)) return m; // 살아있음 — 보존
    changed = true;
    return '';
  });
  if (!changed) return text;
  // 토큰이 줄/문장 맨 앞이었던 경우 남는 선두 쉼표 정리.
  out = out.replace(/^[ \t]*,[ \t]*/, '').replace(/\n[ \t]*,[ \t]*/g, '\n');
  return out;
}

// 모든 chunk 토큰 제거(살아있든 죽었든) + 인접 쉼표 정리. 일괄복사 시 chunk를 빼고
// 사용자가 쓴 텍스트만 대상에 복사하는 용도(본인 결정: "chunk 제외, 내가 쓴 텍스트만").
export function stripAllChunkTokens(text: string): string {
  if (!text || text.indexOf('⟦c:') === -1) return text;
  const out = text.replace(/[ \t]*,?[ \t]*⟦c:[0-9a-fA-F-]+⟧/g, '');
  return out.replace(/^[ \t]*,[ \t]*/, '').replace(/\n[ \t]*,[ \t]*/g, '\n');
}

/**
 * ##주석## 블록 제거.
 * - 여러 줄, 콤마 포함 가능 (non-greedy)
 * - 짝이 맞지 않는 단일 `##` 는 리터럴로 유지
 * - API 송신 직전에만 제거. 저장 데이터는 원문 유지.
 */
function stripPromptComments(str: string): string {
  return str.replace(/##[\s\S]*?##/g, '');
}

export function toPARR(str: string) {
  // chunk 토큰을 content로 펼친 뒤 파싱 (생성·전송 경로). highlightPrompt는 toPARR을
  // 안 쓰므로 화면 알약 렌더엔 영향 없음.
  return cleanPARR(
    expandChunkTokens(stripPromptComments(str)).replace('\n', ',').split(','),
  ).filter((x) => x !== '');
}

/**
 * 프롬프트 문자열에 포함된 `<group.name>` 조각 참조를 전개하고 주석을 제거한
 * 최종 문자열 반환. UC(네거티브 프롬프트)처럼 toPARR/parseWord 파이프라인을
 * 직접 거치지 않는 필드에 사용.
 *
 * 조각 참조가 잘못됐거나 사이클이 있으면 예외 발생 — 긍정 프롬프트와 동일한 동작.
 */
// 중첩 조각(조각 안에서 다른 조각 참조) 안전장치. (SDStudio 4.13 019868c)
// - 순환(A→…→A)은 경로 기반 visited로 차단(무한 재귀 방지)
// - 아래 두 값은 순환이 아닌 병적 케이스(깊은 사슬/조합 폭발)에 대한 보수적 상한. 정상 사용은 보통 몇 단계뿐.
const MAX_PIECE_DEPTH = 50; // 조각 중첩 최대 깊이(사슬 길이)
const MAX_PIECE_EXPANSIONS = 10000; // 한 단어 확장에서 펼친 총 조각 수(조합 폭발 방지)

export function expandPieces(
  text: string,
  session: Session | undefined,
  scene: Scene | InpaintScene | undefined,
): string {
  if (!text) return '';
  const tokens = toPARR(text); // 내부에서 stripPromptComments 처리됨
  if (tokens.length === 0) return '';
  const node: PromptNode = {
    type: 'group',
    children: tokens.map((w) => promptService.parseWord(w, session, scene)),
  };
  return lowerPromptNode(node);
}

export class PromptService extends EventTarget {
  constructor() {
    super();
  }

  tryExpandPiece(
    p: string,
    session: Session,
    scene: InpaintScene | Scene | undefined = undefined,
  ) {
    const errorInfo =
      'project:' +
      (session?.name ?? '') +
      ', scene:' +
      (scene?.name ?? '') +
      '[' +
      (scene?.type === 'inpaint' ? 'inpaint' : '') +
      ']';
    if (p.charAt(0) === '<' && p.charAt(p.length - 1) === '>') {
      p = p.substring(1, p.length - 1);
      const parts = p.split('.');
      if (parts.length !== 2) {
        throw new Error(
          '올바르지 않은 조각 문법 "' + p + '" (' + errorInfo + ')',
        );
      }
      const localLib = session.library.get(parts[0]);
      const globalLib = globalPieceService.library.get(parts[0]);
      // 로컬 우선, 로컬에 조각이 없으면 전역 폴백
      const piece = localLib?.pieces.find((x) => x.name === parts[1])
        ?? globalLib?.pieces.find((x) => x.name === parts[1]);
      if (!localLib && !globalLib) {
        throw new Error(
          '존재하지 않는 조각 모음 "' + p + '" (' + errorInfo + ')',
        );
      }
      if (!piece) {
        throw new Error('존재하지 않는 조각 "' + p + '" (' + errorInfo + ')');
      }
      return piece.prompt;
    }
    throw new Error('조각이 아닙니다 "' + p + '" (' + errorInfo + ')');
  }

  findMissingPieces(session: Session, scene: Scene | InpaintScene): { library: string; piece: string }[] {
    const missing: { library: string; piece: string }[] = [];
    const seen = new Set<string>();
    const pieceRegex = /<([^<>]+\.[^<>]+)>/g;

    // 씬의 모든 슬롯 프롬프트에서 <lib.piece> 패턴 수집
    const prompts: string[] = [];
    if (scene.type === 'scene') {
      for (const slot of (scene as Scene).slots) {
        for (const piece of slot) {
          if (piece.prompt) prompts.push(piece.prompt);
        }
      }
    }
    if ('preset' in scene && scene.preset?.prompt) {
      prompts.push(scene.preset.prompt);
    }

    for (const text of prompts) {
      let match;
      // Models L: max iter guard — pieceRegex global flag stale / lastIndex 미진행 시 무한 loop.
      // 1만 회는 정상 prompt scenario 훨씬 넘는 안전 cap.
      let iters = 0;
      while ((match = pieceRegex.exec(text)) !== null) {
        if (++iters > 10000) { console.warn('[checkMissingPieces] regex iter cap hit'); break; }
        const inner = match[1];
        const parts = inner.split('.');
        if (parts.length !== 2) continue;
        const key = parts[0] + '.' + parts[1];
        if (seen.has(key)) continue;
        seen.add(key);

        const localLib = session.library.get(parts[0]);
        const globalLib = globalPieceService.library.get(parts[0]);
        const piece = localLib?.pieces.find((x) => x.name === parts[1])
          ?? globalLib?.pieces.find((x) => x.name === parts[1]);
        if (!localLib && !globalLib) {
          missing.push({ library: parts[0], piece: parts[1] });
        } else if (!piece) {
          missing.push({ library: parts[0], piece: parts[1] });
        }
      }
    }
    return missing;
  }

  isGlobal(p: string, session: Session): boolean {
    if (p.charAt(0) !== '<' || p.charAt(p.length - 1) !== '>') {
      return false;
    }
    const inner = p.substring(1, p.length - 1);
    const parts = inner.split('.');
    if (parts.length !== 2) return false;
    const localLib = session.library.get(parts[0]);
    // 로컬 라이브러리에 해당 조각이 있으면 로컬 → global 아님
    if (localLib?.pieces.find((x) => x.name === parts[1])) return false;
    // 전역에 해당 조각이 있으면 global
    const globalLib = globalPieceService.library.get(parts[0]);
    return !!globalLib?.pieces.find((x) => x.name === parts[1]);
  }

  isMulti(p: string, session: Session) {
    if (p.charAt(0) !== '<' || p.charAt(p.length - 1) !== '>') {
      return false;
    }
    p = p.substring(1, p.length - 1);
    const parts = p.split('.');
    if (parts.length !== 2) {
      return false;
    }
    const localLib = session.library.get(parts[0]);
    const globalLib = globalPieceService.library.get(parts[0]);
    const piece = localLib?.pieces.find((x) => x.name === parts[1])
      ?? globalLib?.pieces.find((x) => x.name === parts[1]);
    return piece?.multi ?? false;
  }

  parseWord(
    word: string,
    session: Session | undefined = undefined,
    scene: InpaintScene | Scene | undefined = undefined,
    visited: { [key: string]: boolean } | undefined = undefined,
    depth: number = 0,
    counter: { count: number } | undefined = undefined,
  ): PromptNode {
    if (!visited) {
      visited = {};
    }
    if (!counter) {
      counter = { count: 0 };
    }
    if (word.charAt(0) === '<' && word.charAt(word.length - 1) === '>') {
      const res: PromptGroupNode = {
        type: 'group',
        children: [],
      };
      // 순환 차단: 현재 확장 경로(조상)에 이미 있는 조각이면 무한 재귀 → 차단.
      // visited는 진입 시 표시하고 종료 시 해제(백트래킹)하므로, 순환이 아닌
      // 형제/재사용 위치에서 같은 조각을 다시 쓰는 것은 허용된다. (SDStudio 4.13 019868c)
      if (visited[word]) {
        throw new Error('순환 조각 참조 감지: ' + word);
      }
      // 보수적 상한: 깊은 사슬 / 조합 폭발로부터 보호
      if (depth >= MAX_PIECE_DEPTH) {
        throw new Error(
          `조각 중첩이 너무 깊습니다 (최대 ${MAX_PIECE_DEPTH}단계): ${word}`,
        );
      }
      if (++counter.count > MAX_PIECE_EXPANSIONS) {
        throw new Error(
          `조각 확장이 너무 많습니다 (순환·과도한 중첩 의심): ${word}`,
        );
      }
      visited[word] = true;
      try {
        if (this.isMulti(word, session)) {
          const expanded = this.tryExpandPiece(word, session, scene);
          const lines = expanded.split('\n');
          const randNode: PromptRandomNode = {
            type: 'random',
            options: [],
          };
          for (const line of lines) {
            const parr = toPARR(line);
            const newNode: PromptGroupNode = {
              type: 'group',
              children: [],
            };
            for (const p of parr) {
              newNode.children.push(
                this.parseWord(p, session, scene, visited, depth + 1, counter),
              );
            }
            randNode.options.push(newNode);
          }
          res.children.push(randNode);
        } else {
          let newp = toPARR(this.tryExpandPiece(word, session, scene));
          for (const p of newp) {
            res.children.push(
              this.parseWord(p, session, scene, visited, depth + 1, counter),
            );
          }
        }
      } finally {
        // 백트래킹: 이 조각을 떠나면 경로에서 제거해 재사용을 허용
        delete visited[word];
      }
      return res;
    } else {
      return {
        type: 'text',
        text: word,
      };
    }
  }

  showPromptTooltip(piece: string, e: any) {
    try {
      let txt = '';
      if (piece !== '|') {
        const expanded = this.tryExpandPiece(piece, window.curSession!);
        if (this.isMulti(piece, window.curSession!)) {
          txt =
            '이 중 한 줄 랜덤 선택:\n' +
            expanded.split('\n').slice(0, 32).join('\n');
        } else {
          txt = expanded;
        }
      } else {
        txt =
          '프롬프트를 교차합니다.\n예시:\n상위 프롬프트: 1girl, |, 캐릭터 \n중위 프롬프트: 그림체, |, 포즈\n이렇게 세팅되어 있으면 1girl, 캐릭터, 그림체, 포즈 순으로 교차됩니다.';
      }
      this.dispatchEvent(
        new CustomEvent('prompt-tooltip', {
          detail: { text: txt, x: e.clientX, y: e.clientY },
        }),
      );
    } catch (e: any) {
      console.error(e);
    }
  }

  clearPromptTooltip() {
    this.dispatchEvent(
      new CustomEvent('prompt-tooltip', { detail: { text: '' } }),
    );
  }
}

/**
 * Generic DFS traversal for prompt combinations
 * @param session Current session
 * @param scene Current scene
 * @param collectFn Function to collect data from each slot piece
 * @param processFn Function to process completed combinations
 * @returns Result from the processFn
 */
async function dfsPrompts<T, R>(
  session: Session,
  scene: Scene,
  collectFn: (piece: PromptPiece | null) => T,
  processFn: (combinations: T[]) => Promise<R>,
): Promise<R[]> {
  const combinations: T[] = [];
  const results: R[] = [];

  const traverse = async () => {
    if (combinations.length === scene.slots.length) {
      results.push(await processFn([...combinations]));
      return;
    }

    const level = combinations.length;
    let hasEnabled = false;

    for (const piece of scene.slots[level]) {
      if (piece.enabled === undefined || piece.enabled) {
        hasEnabled = true;
        combinations.push(collectFn(piece));
        await traverse();
        combinations.pop();
      }
    }

    // If specified by returning null/undefined from collectFn, handle empty slots
    if (!hasEnabled && collectFn(null) !== undefined) {
      combinations.push(collectFn(null));
      await traverse();
      combinations.pop();
    }
  };

  await traverse();
  return results;
}

export const createSDPrompts = async (
  session: Session,
  preset: any,
  shared: any,
  scene: Scene,
) => {
  // 토글 그룹 OFF 태그 — 그룹 정의는 씬 이름 키로 전역 공유(toggleGroupService),
  // on/off는 씬별(scene.toggleGroupStates). 명시적 OFF(false)인 그룹의 태그만 제거 대상.
  // scene 레벨이라 조합마다 동일 → 조합 루프 밖에서 1회 계산해 클로저로 공유.
  const sharedToggleGroups = toggleGroupService.list(scene.name);
  const toggleStates = scene.toggleGroupStates ?? {};
  const disabledToggleTags = new Set(
    sharedToggleGroups
      .filter((g) => toggleStates[g.id] === false)
      .flatMap((g) => g.tags)
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0),
  );
  // collectFn이 piece 전체 객체를 수집 (prompt + uc). processFn에서 prompt 합치고
  // uc는 별도로 모아 { prompt: PromptNode, uc: string } 형태로 반환.
  return await dfsPrompts(
    session,
    scene,
    (piece) => piece,
    async (pieceComb: any[]) => {
      const promptComb = pieceComb.map((p) => p?.prompt);
      let front = toPARR(preset.frontPrompt);
      if (shared.type === 'SDImageGenEasy') {
        front = front.concat(toPARR(shared.characterPrompt));
        const newFront = [];
        const rest = [];
        const regex = /^\d+(boy|girl|other)s?$/;
        for (const word of front) {
          if (
            regex.test(word) ||
            word === 'multiple girls' ||
            word === 'multiple boys' ||
            word === 'multiple others'
          ) {
            newFront.push(word);
          } else {
            const tag = await backend.lookupTag(word);
            if (tag && tag.category === 4) {
              newFront.push(word);
            } else {
              rest.push(word);
            }
          }
        }
        front = newFront.concat(rest);
      }

      // 프로젝트 귀속 추가 프롬프트는 상위(이지 모드 재배열 포함) 뒤,
      // 중간(씬 전용) 앞에 삽입한다.
      front = front.concat(toPARR(session.extraPrompt || ''));

      let middle: string[] = [];
      for (const comb of promptComb) {
        middle = middle.concat(toPARR(comb ?? ''));
      }

      let left = 0,
        right = 0;
      let cur: string[] = [];
      let currentInsert = 0;

      while (left < front.length && right < middle.length) {
        if (currentInsert === 0) {
          if (front[left] === '|') {
            currentInsert = 1;
            left++;
            continue;
          }
          cur.push(front[left]);
          left++;
        } else {
          if (middle[right] === '|') {
            currentInsert = 0;
            right++;
            continue;
          }
          cur.push(middle[right]);
          right++;
        }
      }
      while (left < front.length) {
        if (front[left] !== '|') cur.push(front[left]);
        left++;
      }
      while (right < middle.length) {
        if (middle[right] !== '|') cur.push(middle[right]);
        right++;
      }

      if (shared.type === 'SDImageGenEasy') {
        cur = cur.concat(toPARR(shared.backgroundPrompt));
      }
      cur = cur.concat(toPARR(preset.backPrompt));

      // 씬 토글 그룹 — OFF 그룹의 태그를 최종 조합 태그 배열에서 제거 (위에서 1회
      // 계산한 disabledToggleTags 사용). piece 원본은 안 건드리고 생성 시점에만 뺌.
      // 매칭은 trim+소문자 exact (weight 없는 단순 태그 기준).
      if (disabledToggleTags.size > 0) {
        cur = cur.filter((w) => !disabledToggleTags.has(w.trim().toLowerCase()));
      }

      const newNode: PromptNode = {
        type: 'group',
        children: [],
      };
      for (const word of cur) {
        newNode.children.push(promptService.parseWord(word, session, scene));
      }
      // 조합 단위 uc — 선택된 piece들의 uc를 ', '로 합침 (빈 값은 skip)
      const ucParts = pieceComb
        .map((p) => (p && typeof p.uc === 'string' ? p.uc.trim() : ''))
        .filter((s) => s.length > 0);
      return { prompt: newNode, uc: ucParts.join(', ') };
    },
  );
};

export const createSDCharacterPrompts = async (
  session: Session,
  preset: any,
  shared: any,
  scene: Scene,
) => {
  // 씬 전용 캐릭터 프롬프트가 활성화된 경우 씬 전용 + shared 병합
  const useSceneCP = scene.useSceneCharacterPrompts &&
    scene.sceneCharacterPrompts &&
    scene.sceneCharacterPrompts.length > 0;
  const sharedCPs = shared.characterPrompts || [];
  const characterPrompts = useSceneCP
    ? [...(scene.sceneCharacterPrompts || []), ...sharedCPs]
    : [...(preset.characterPrompts || []), ...sharedCPs];
  if (!characterPrompts || characterPrompts.length === 0) return [];

  return await dfsPrompts(
    session,
    scene,
    (piece) => piece?.characterPrompts || [],
    async (promptComb) => {
      const characterPromptsResult: PromptNode[] = [];

      for (let i = 0; i < characterPrompts.length; i++) {
        const characterPrompt = characterPrompts[i];
        const front = toPARR(characterPrompt.prompt);

        // Collect all character prompts from the selected pieces
        let middle: string[] = [];
        for (const comb of promptComb) {
          middle = middle.concat(toPARR(comb[i] ?? ''));
        }

        // Merge prompts with | separator
        let left = 0,
          right = 0;
        let cur: string[] = [];
        let currentInsert = 0;

        while (left < front.length && right < middle.length) {
          if (currentInsert === 0) {
            if (front[left] === '|') {
              currentInsert = 1;
              left++;
              continue;
            }
            cur.push(front[left]);
            left++;
          } else {
            if (middle[right] === '|') {
              currentInsert = 0;
              right++;
              continue;
            }
            cur.push(middle[right]);
            right++;
          }
        }
        while (left < front.length) {
          if (front[left] !== '|') cur.push(front[left]);
          left++;
        }
        while (right < middle.length) {
          if (middle[right] !== '|') cur.push(middle[right]);
          right++;
        }

        const newNode: PromptNode = {
          type: 'group',
          children: [],
        };
        for (const word of cur) {
          newNode.children.push(promptService.parseWord(word, session, scene));
        }
        characterPromptsResult.push(newNode);
      }
      return characterPromptsResult;
    },
  );
};

const mouth = ['<', '>', '(', ')', '{', '}'];
const eyes = [':', ';'];
const expressions = mouth.flatMap((m) => eyes.map((e) => e + m));
expressions.push('><');

function trimUntouch(word: string) {
  let leftTrimPos = 0;
  while (leftTrimPos < word.length && isWhitespace(word[leftTrimPos])) {
    leftTrimPos++;
  }
  let rightTrimPos = word.length - 1;
  while (rightTrimPos >= 0 && isWhitespace(word[rightTrimPos])) {
    rightTrimPos--;
  }
  if (leftTrimPos > rightTrimPos) {
    return undefined;
  }
  return [leftTrimPos, rightTrimPos];
}

function parenCheck(str: string): [boolean, number] {
  str = str
    .split(',')
    .map((x) => {
      const trimmed = trimUntouch(x);
      if (trimmed) {
        const [leftTirmPos, rightTrimPos] = trimmed;
        const y = x.substring(leftTirmPos, rightTrimPos + 1);
        if (expressions.includes(y)) {
          return (
            x.substring(0, leftTirmPos) +
            'xx' +
            x.substring(rightTrimPos + 1, x.length)
          );
        }
        return x;
      } else {
        return x;
      }
    })
    .join(',');
  const stack = [];
  const parens = ['(', ')', '[', ']', '{', '}', '<', '>'];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    const parenIdx = parens.indexOf(c);
    if (parenIdx >= 0) {
      if (parenIdx % 2 === 0) {
        stack.push([c, i]);
      } else {
        if (stack.length === 0) {
          return [false, i];
        }
        const last = stack.pop()!;
        if (parenIdx - 1 !== parens.indexOf(last[0] as string)) {
          return [false, last[1] as number];
        }
      }
    }
  }
  if (stack.length > 0) {
    return [false, stack.pop()![1] as number];
  }
  return [true, -1];
}

const nbsp = String.fromCharCode(160);
const isWhitespace = (c: string) => {
  return c === ' ' || nbsp === c;
};

export const highlightPrompt = (
  session: Session,
  text: string,
  lineHighlight: boolean = false,
  searchQuery: string = '',
) => {
  const searchLower = searchQuery.trim().toLowerCase();
  const escapeHtmlText = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapeJsInAttr = (s: string): string =>
    s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  // 주석 범위 수집 (원본 text 기준 절대 오프셋)
  const commentRanges: Array<[number, number]> = [];
  const commentRegex = /##[\s\S]*?##/g;
  let commentMatch: RegExpExecArray | null;
  while ((commentMatch = commentRegex.exec(text)) !== null) {
    commentRanges.push([
      commentMatch.index,
      commentMatch.index + commentMatch[0].length,
    ]);
  }
  const overlapsComment = (wordStart: number, wordEnd: number): boolean =>
    commentRanges.some(([s, e]) => s < wordEnd && e > wordStart);

  // ── 가중치 하이라이트용: 각 문자 위치의 bracket depth 계산 ──
  // {}: +1 depth, []: -1 depth per pair
  const weightDepth = new Int8Array(text.length); // 양수=강조, 음수=약화
  {
    let curly = 0;  // {} depth
    let square = 0; // [] depth
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '{') curly++;
      else if (c === '}') curly = Math.max(0, curly - 1);
      else if (c === '[') square++;
      else if (c === ']') square = Math.max(0, square - 1);
      weightDepth[i] = curly - square;
    }
  }
  // (number)::tag:: 패턴의 범위와 가중치
  const explicitWeightRanges: Array<{ start: number; end: number; weight: number }> = [];
  const ewRegex = /(-?\d+(?:\.\d+)?)::[\s\S]*?::/g;
  let ewMatch: RegExpExecArray | null;
  while ((ewMatch = ewRegex.exec(text)) !== null) {
    explicitWeightRanges.push({
      start: ewMatch.index,
      end: ewMatch.index + ewMatch[0].length,
      weight: parseFloat(ewMatch[1]),
    });
  }
  /** 해당 offset 범위의 가중치 상태 반환: 'emphasis' | 'deemphasis' | 'negative' | null */
  const getWeightClass = (wordStart: number, wordEnd: number): string | null => {
    // 주석 영역 내부면 가중치 무시
    if (overlapsComment(wordStart, wordEnd)) return null;
    // (number)::tag:: 명시적 가중치 우선 (overlap 판정 — 앞뒤 공백 포함 가능)
    for (const ew of explicitWeightRanges) {
      if (ew.start < wordEnd && ew.end > wordStart) {
        if (ew.weight < 0) return 'syntax-weight-negative';
        if (ew.weight < 1) return 'syntax-weight-deemphasis';
        if (ew.weight > 1) return 'syntax-weight-emphasis';
        return null; // weight === 1
      }
    }
    // bracket depth 기반 (단어 첫 비공백 문자 위치)
    let samplePos = wordStart;
    for (let i = wordStart; i < wordEnd; i++) {
      const c = text[i];
      if (c !== ' ' && c !== '{' && c !== '}' && c !== '[' && c !== ']') {
        samplePos = i;
        break;
      }
    }
    if (samplePos < text.length) {
      const depth = weightDepth[samplePos];
      if (depth > 0) return 'syntax-weight-emphasis';
      if (depth < 0) return 'syntax-weight-deemphasis';
    }
    return null;
  };

  // 괄호 검사는 주석 영역을 공백으로 대체한 텍스트에서 수행
  // (주석 내부 괄호가 오류로 집계되지 않도록)
  const parenCheckText = commentRanges.length === 0
    ? text
    : text.split('').map((c, i) =>
        commentRanges.some(([s, e]) => i >= s && i < e) ? ' ' : c,
      ).join('');
  let [parenFine, lastPos] = parenCheck(parenCheckText);
  let offset = 0;
  const words = text
    .split('\n')
    .map((x) => {
      const word = x
        .split(/([,])/)
        .map((word: string) => {
          if (word === '\n') {
            return word;
          }
          if (word === ',') {
            // 콤마가 주석 영역 내부면 주석 스타일
            const isInComment = overlapsComment(offset, offset + 1);
            if (isInComment) {
              return '<span class="syntax-comment">,</span>';
            }
            // 콤마가 가중치 영역 내부면 가중치 배경 적용
            const commaWeight = getWeightClass(offset, offset + 1);
            if (commaWeight) {
              return `<span class="${commaWeight}">,</span>`;
            }
            return word;
          }
          // 단어가 주석 영역과 겹치면 주석 부분만 정확히 주석 스타일 적용
          const wordStart = offset;
          const wordEnd = offset + word.length;
          if (overlapsComment(wordStart, wordEnd)) {
            let result = '';
            let i = 0;
            while (i < word.length) {
              const absPos = wordStart + i;
              const inComment = commentRanges.some(([s, e]) => absPos >= s && absPos < e);
              let j = i + 1;
              while (j < word.length) {
                const nextInComment = commentRanges.some(([s, e]) => (wordStart + j) >= s && (wordStart + j) < e);
                if (nextInComment !== inComment) break;
                j++;
              }
              const segment = word.slice(i, j)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
              if (inComment) {
                result += `<span class="syntax-comment">${segment}</span>`;
              } else {
                result += segment;
              }
              i = j;
            }
            offset += word.length + 1;
            return result;
          }
          const classNames = [];
          let leftTrimPos = 0;
          while (leftTrimPos < word.length && isWhitespace(word[leftTrimPos])) {
            leftTrimPos++;
          }
          let rightTrimPos = word.length - 1;
          while (rightTrimPos >= 0 && isWhitespace(word[rightTrimPos])) {
            rightTrimPos--;
          }
          if (leftTrimPos > rightTrimPos) {
            let res = ``;
            res += ' '.repeat(word.length) + '';
            offset += word.length + 1;
            return res;
          }
          if (
            !parenFine &&
            offset <= lastPos &&
            lastPos < offset + word.length
          ) {
            const originalWordLength = word.length;
            const left = escapeHtmlText(word.substring(0, lastPos - offset));
            const mid = escapeHtmlText(word[lastPos - offset]);
            const right = escapeHtmlText(word.substring(lastPos - offset + 1, word.length));
            word = `${left}<span class="syntax-error">${mid}</span>${right}`;
            let res = `<span class="syntax-word">`;
            res += word + '</span>';
            offset += originalWordLength + 1;
            return res;
          }
          let js = '';
          let pword = word.substring(leftTrimPos, rightTrimPos + 1);
          if (pword === '|') {
            classNames.push('syntax-split');
            if (!isMobile)
              js =
                'onmousemove="window.promptService.showPromptTooltip(\'' +
                escapeJsInAttr(pword) +
                '\', event)" onmouseout="window.promptService.clearPromptTooltip()"';
          }
          // 가중치 하이라이트 (배경색만, 폰트 변경 없음)
          const wClass = getWeightClass(wordStart + leftTrimPos, wordStart + rightTrimPos + 1);
          if (wClass) {
            classNames.push(wClass);
          }
          if (pword.startsWith('[') && pword.endsWith(']')) {
            classNames.push('syntax-weak');
          }
          if (pword.startsWith('{') && pword.endsWith('}')) {
            classNames.push('syntax-strong');
          }
          // 찾기(검색) 매칭 — 태그(단어) 텍스트에 검색어가 포함되면 형광 강조.
          if (searchLower && pword.toLowerCase().includes(searchLower)) {
            classNames.push('syntax-search-hit');
          }

          // chunk 토큰 ⟦c:uuid⟧ → 알약(이름 + color). 토큰 앞뒤에 문자가 붙어 한 word가
          // 되어도(예: ⟦c:id⟧tall, hair⟦c:id⟧) 토큰만 알약, 사이/앞뒤 텍스트는 그대로 유지.
          // word 단위 split이 쉼표만 분리해 토큰+문자가 한 단어가 되는 케이스 cover.
          if (word.indexOf('⟦c:') !== -1) {
            const tokenRe = /⟦c:([0-9a-fA-F-]+)⟧/g;
            let m: RegExpExecArray | null;
            let last = 0;
            let chunkOut = '';
            let matched = false;
            while ((m = tokenRe.exec(word)) !== null) {
              matched = true;
              chunkOut += escapeHtmlText(word.substring(last, m.index));
              const chunk = promptChunkService.get(m[1]);
              if (!chunk) {
                // 삭제된 chunk — 회색 "삭제됨" 알약.
                chunkOut += `<span class="syntax-chunk syntax-chunk-deleted" contenteditable="false" data-chunk-id="${escapeJsInAttr(m[1])}">(삭제된 chunk)</span>`;
              } else {
                // 찾기 매칭 — chunk 내용/이름에 검색어가 있으면 알약 자체를 강조.
                const chunkHit =
                  !!searchLower &&
                  (chunk.content.toLowerCase().includes(searchLower) ||
                    chunk.name.toLowerCase().includes(searchLower));
                chunkOut += `<span class="syntax-chunk${chunkHit ? ' syntax-search-hit' : ''}" contenteditable="false" data-chunk-id="${escapeJsInAttr(chunk.id)}" data-chunk-content="${escapeJsInAttr(chunk.content)}" style="background-color:${chunk.color}33;border-color:${chunk.color}">${escapeHtmlText(chunk.name)}</span>`;
              }
              last = m.index + m[0].length;
            }
            if (matched) {
              chunkOut += escapeHtmlText(word.substring(last));
              offset += word.length + 1;
              return chunkOut;
            }
          }

          if (pword.startsWith('<') && pword.endsWith('>')) {
            try {
              promptService.tryExpandPiece(pword, session);
              const isGlobal = promptService.isGlobal(pword, session);
              if (promptService.isMulti(pword, session))
                classNames.push(isGlobal ? 'syntax-global-multi-wildcard' : 'syntax-multi-wildcard');
              else
                classNames.push(isGlobal ? 'syntax-global-wildcard' : 'syntax-wildcard');

              js =
                'onmousemove="window.promptService.showPromptTooltip(\'' +
                escapeJsInAttr(pword) +
                '\', event)" onmouseout="window.promptService.clearPromptTooltip()"';
            } catch (e: any) {
              classNames.push('syntax-error');
            }
          }
          pword = escapeHtmlText(pword);
          const leading = word.substring(0, leftTrimPos);
          const trailing = word.substring(rightTrimPos + 1, word.length);
          // 가중치 범위 내 공백은 하이라이트에 포함 (연속된 시각 피드백)
          const leadingInWeight = wClass && leftTrimPos > 0 && getWeightClass(wordStart, wordStart + leftTrimPos) !== null;
          let res: string;
          if (classNames.length === 0) {
            res = `${leading}${pword}${trailing}`;
          } else if (leadingInWeight) {
            res = `<span ${js} class="${classNames.join(' ')}">${leading}${pword}</span>${trailing}`;
          } else {
            res = `${leading}<span ${js} class="${classNames.join(' ')}">${pword}</span>${trailing}`;
          }
          offset += word.length + 1;
          return res;
        })
        .join('');
      return '<span class="syntax-line">' + word + '</span>';
    })
    .join('\n');
  return `${words}`;
};

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function reformat(text: string) {
  return toPARR(text).join(', ');
}

export function lowerPromptNode(node: PromptNode): string {
  if (node.type === 'text') {
    return node.text;
  }
  if (node.type === 'random') {
    return lowerPromptNode(pickRandom(node.options));
  }
  return reformat(node.children.map(lowerPromptNode).join(','));
}

export const defaultFPrompt = `1girl, {artist:ixy}`;
export const defaultBPrompt = `{best quality, amazing quality, very aesthetic, highres, incredibly absurdres}`;
export const defaultUC = `worst quality, bad quality, displeasing, very displeasing, lowres, bad anatomy, bad perspective, bad proportions, bad aspect ratio, bad face, long face, bad teeth, bad neck, long neck, bad arm, bad hands, bad ass, bad leg, bad feet, bad reflection, bad shadow, bad link, bad source, wrong hand, wrong feet, missing limb, missing eye, missing tooth, missing ear, missing finger, extra faces, extra eyes, extra eyebrows, extra mouth, extra tongue, extra teeth, extra ears, extra breasts, extra arms, extra hands, extra legs, extra digits, fewer digits, cropped head, cropped torso, cropped shoulders, cropped arms, cropped legs, mutation, deformed, disfigured, unfinished, chromatic aberration, text, error, jpeg artifacts, watermark, scan, scan artifacts`;
