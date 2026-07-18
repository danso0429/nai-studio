import * as Hangul from 'hangul-js';
import {
  createRef,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import Denque from 'denque';
import {
  FaBook,
  FaBox,
  FaChevronDown,
  FaChevronRight,
  FaDatabase,
  FaExpand,
  FaPaintBrush,
  FaTag,
  FaTimes,
  FaUndo,
} from 'react-icons/fa';
import { FaPerson, FaStar } from 'react-icons/fa6';
import { FixedSizeList as List } from 'react-window';
import getCaretCoordinates from 'textarea-caret';
import { isMobile, backend, promptChunkService } from '../models';
import { highlightPrompt, makeChunkToken, stripDeadChunkTokens } from '../models/PromptService';
import { WordTag, calcGapMatch } from '../models/Tags';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';
import { positionAutocompletePopup } from '../models/viewportPopup';
import { observer } from 'mobx-react-lite';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface PromptEditTextAreaProps {
  value: string;
  className?: string;
  innerRef?: any;
  disabled?: boolean;
  onChange: (value: string) => void;
}

interface HistoryEntry {
  text: string;
  cursorPos: number[];
  compositionBuffer: string[];
}

function isMacPlatform() {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

class Mutex {
  _queue: any[];
  _locked: boolean;
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  _acquire() {
    return new Promise((resolve) => {
      this._queue.push(resolve);
      if (!this._locked) {
        this._dispatchNext();
      }
    });
  }

  _dispatchNext() {
    if (this._queue.length === 0) {
      this._locked = false;
      return;
    }
    this._locked = true;
    const resolve = this._queue.shift();
    resolve();
  }

  async lock() {
    await this._acquire();
  }

  unlock() {
    this._dispatchNext();
  }

  async runExclusive(callback: () => void | Promise<void>) {
    await this.lock();
    try {
      return await callback();
    } finally {
      this.unlock();
    }
  }
}

const mutex = new Mutex();

const MAX_HISTORY_SIZE = 4096; // 1024 * 4096 bytes = 4 MB

// 단어 경계 계산 (콤마/개행이 경계). fullWord=true면 커서 오른쪽도 진행.
// fullWord=false (기본 모드)면 endIdx는 start 그대로 — 커서 왼쪽만 교체/조회.
const getWordBounds = (
  text: string,
  start: number,
  fullWord: boolean,
): [number, number] => {
  let startIdx = start;
  while (startIdx > 0 && !',\n'.includes(text[startIdx - 1])) {
    startIdx--;
  }
  let endIdx = start;
  if (fullWord) {
    while (endIdx < text.length && !',\n'.includes(text[endIdx])) {
      endIdx++;
    }
  }
  return [startIdx, endIdx];
};

// prompt chunk 알약: contenteditable=false span을 토큰 원문 길이의 atomic 덩어리로 caret
// 매핑. DOM textContent(이름, 짧음) 대신 ⟦c:uuid⟧(김) 길이를 써야 curText offset과 정합.
const isChunkEl = (n: any): boolean =>
  !!n && n.nodeType === 1 && n.classList && n.classList.contains('syntax-chunk');
const chunkTokenLen = (n: any): number =>
  makeChunkToken((n.getAttribute && n.getAttribute('data-chunk-id')) || '').length;
// 노드 서브트리의 curText 길이: 알약은 토큰 원문 길이, BR은 1, 그 외 텍스트는 글자수.
// 전체선택(Ctrl+A) 등 caret range가 줄 span을 끝점으로 잡을 때 알약 품은 span을 정확히 환산.
const subtreeTextLen = (node: any): number => {
  if (node.nodeType === 3) return node.textContent.length;
  if (isChunkEl(node)) return chunkTokenLen(node);
  if (node.nodeName === 'BR') return 1;
  let s = 0;
  const kids = node.childNodes;
  for (let k = 0; k < kids.length; k++) s += subtreeTextLen(kids[k]);
  return s;
};
// caret pos 직전에 끝나는 chunk 토큰의 시작 인덱스 (없으면 -1). Backspace 2단 삭제용.
const chunkTokenBefore = (text: string, pos: number): number => {
  if (pos <= 0 || text[pos - 1] !== '⟧') return -1;
  const open = text.lastIndexOf('⟦c:', pos - 1);
  if (open === -1) return -1;
  return /^⟦c:[0-9a-fA-F-]+⟧$/.test(text.substring(open, pos)) ? open : -1;
};
// caret pos에서 시작하는 chunk 토큰의 끝 인덱스 (없으면 -1). Delete 2단 삭제용.
const chunkTokenAfter = (text: string, pos: number): number => {
  if (text[pos] !== '⟦') return -1;
  const close = text.indexOf('⟧', pos);
  if (close === -1) return -1;
  return /^⟦c:[0-9a-fA-F-]+⟧$/.test(text.substring(pos, close + 1)) ? close + 1 : -1;
};

class CursorMemorizeEditor {
  compositionBuffer: string[];
  previousRange: number[] | undefined;
  curText: string;
  domText: string;
  container: HTMLElement;
  editor: HTMLElement;
  clipboard: HTMLElement;
  highlightPrompt: (
    text: string,
    curWord: string,
    updateAutoComplete: boolean,
  ) => string;
  onUpdated: (text: string) => void;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onEnter: () => void;
  onEsc: () => void;
  autocomplete: boolean;
  historyBuf: any;
  redoBuf: any;
  shuffling: boolean;
  lockedPrefixLength: number;
  constructor(
    container: HTMLElement,
    editor: HTMLElement,
    clipboard: HTMLElement,
    highlightPrompt: (
      text: string,
      curWord: string,
      updateAutoComplete: boolean,
    ) => string,
    onUpdated: (text: string) => void,
    historyBuf: any,
    redoBuf: any,
    onUpArrow: () => void,
    onDownArrow: () => void,
    onEnter: () => void,
    onEsc: () => void,
    lockedPrefixLength: number = 0,
  ) {
    this.container = container;
    this.compositionBuffer = [];
    this.previousRange = undefined;
    this.curText = '';
    this.domText = '';
    this.editor = editor;
    this.clipboard = clipboard;
    this.highlightPrompt = highlightPrompt;
    this.onUpdated = onUpdated;
    this.historyBuf = historyBuf;
    this.redoBuf = redoBuf;
    this.autocomplete = false;
    this.onUpArrow = onUpArrow;
    this.onDownArrow = onDownArrow;
    this.onEnter = onEnter;
    this.onEsc = onEsc;
    this.shuffling = false;
    this.lockedPrefixLength = lockedPrefixLength;
  }

  // 프리셋 prefix 보호: caret/선택 영역이 lockedPrefixLength 경계를 넘지 못하게 clamp.
  // 모바일(NativeEditTextArea)의 handleSelect 가드와 동등한 데스크탑 버전.
  // 반환: [clampedStart, clampedEnd] — prefix 안이면 경계값으로 당김.
  clampToLock(start: number, end: number): [number, number] {
    const lp = this.lockedPrefixLength;
    if (!lp) return [start, end];
    return [Math.max(start, lp), Math.max(end, lp)];
  }

  // 클릭 등으로 caret이 prefix 안에 들어가면 경계로 이동. 모바일 handleSelect 대응.
  async enforceCaretLock() {
    const lp = this.lockedPrefixLength;
    if (!lp) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const [start, end] = this.getCaretPosition();
    if (start < lp || end < lp) {
      await this.setCaretPosition([Math.max(start, lp), Math.max(end, lp)]);
    }
  }

  // 클릭 보정: 알약(chunk, contenteditable=false)을 클릭하면 Firefox가 caret을
  // 알약 직후가 아니라 뒤 단어 끝에 두는 경향 → 알약 바로 뒤로 명시 배치.
  // 알약이 아닌 곳(텍스트/단어) 클릭은 기존 enforceCaretLock(prefix lock)만.
  handleClick(e: any) {
    const el = e && e.target && e.target.closest
      ? e.target.closest('.syntax-chunk')
      : null;
    if (el) {
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.setStartAfter(el);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        this.previousRange = this.getCaretPosition();
      }
      return;
    }
    this.enforceCaretLock();
  }

  getCaretPosition() {
    const selection = window.getSelection()!;
    let res = [0, 0];
    const done = [false, false];
    if (selection.rangeCount === 0) return res;
    const range = selection.getRangeAt(0);
    let startContainer = range.startContainer;
    let endContainer = range.endContainer;
    let startOffset = range.startOffset;
    let endOffset = range.endOffset;
    const nodeIterator = document.createNodeIterator(
      this.editor,
      NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      null,
    );
    let currentNode;
    const pairs: [Node, number][] = [
      [startContainer, startOffset],
      [endContainer, endOffset],
    ];
    while ((currentNode = nodeIterator.nextNode())) {
      // 알약 내부 텍스트노드는 알약 span 단위로 카운트하므로 개별 누적에서 제외.
      const insideChunk =
        currentNode.nodeType === 3 && isChunkEl(currentNode.parentNode);
      for (let i = 0; i < pairs.length; i++) {
        const [container, offset] = pairs[i];
        if (currentNode === container) {
          if (container.nodeType === 3) {
            res[i] += offset;
          } else if (isChunkEl(container)) {
            // caret이 알약 경계: offset 0=앞, >=1=뒤 → 토큰 원문 길이만큼.
            if (offset >= 1) res[i] += chunkTokenLen(container);
          } else if ((container as any).tagName !== 'BR') {
            for (let j = 0; j < offset; j++) {
              // 알약을 품은 줄 span도 정확히 환산 (textContent는 알약 이름이라 짧음).
              res[i] += subtreeTextLen(container.childNodes[j]);
            }
          }
          done[i] = true;
        } else {
          if (!done[i]) {
            if (isChunkEl(currentNode)) {
              res[i] += chunkTokenLen(currentNode);
            } else if (currentNode.nodeType === 3 && !insideChunk) {
              res[i] += currentNode.textContent!.length;
            }
            if (currentNode.nodeName === 'BR') {
              res[i] += 1;
            }
          }
        }
      }
    }
    return res;
  }

  async setCaretPosition(pos: number[]) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const selection = window.getSelection()!;
    const range = document.createRange();
    let foundNode = undefined;
    for (let i = 0; i < 2; i++) {
      let offset = 0;
      const nodeIterator = document.createNodeIterator(
        this.editor,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
        null,
      );
      let currentNode;
      while ((currentNode = nodeIterator.nextNode())) {
        if (currentNode.nodeName === 'BR') {
          if (offset === pos[i]) {
            if (i === 0) {
              range.setStart(currentNode, pos[i] - offset);
            } else {
              range.setEnd(currentNode, pos[i] - offset);
              foundNode = currentNode;
            }
            break;
          }
          offset += 1;
        }
        // 알약: 토큰 원문 길이의 atomic 덩어리. caret은 알약 앞/뒤 경계에만.
        if (isChunkEl(currentNode)) {
          const nodeLength = chunkTokenLen(currentNode);
          if (offset + nodeLength >= pos[i]) {
            const after = pos[i] > offset; // 알약 안/뒤면 뒤 경계로
            if (i === 0) {
              if (after) range.setStartAfter(currentNode);
              else range.setStartBefore(currentNode);
            } else {
              if (after) range.setEndAfter(currentNode);
              else range.setEndBefore(currentNode);
              foundNode = currentNode;
            }
            break;
          }
          offset += nodeLength;
          continue;
        }
        if (currentNode.nodeType === 3) {
          // 알약 내부 텍스트노드는 알약 span에서 이미 카운트 → skip.
          if (isChunkEl(currentNode.parentNode)) continue;
          let nodeLength = currentNode.textContent!.length;
          if (offset + nodeLength >= pos[i]) {
            if (i === 0) {
              range.setStart(currentNode, pos[i] - offset);
            } else {
              range.setEnd(currentNode, pos[i] - offset);
              foundNode = currentNode;
            }
            break;
          }
          offset += nodeLength;
        }
      }
    }

    selection.removeAllRanges();
    selection.addRange(range);
    this.previousRange = pos;
    const rect = range.getBoundingClientRect();
    const parentRect = this.container.getBoundingClientRect();
    if (rect.bottom > parentRect.bottom) {
      this.container.scrollTop += rect.bottom - parentRect.bottom;
    }
  }

  updateDOM(text: string, newPos: number, updateAutoComplete: boolean = true) {
    this.domText = text;
    const cur = this.getCurWord(newPos);
    this.editor.innerHTML =
      this.highlightPrompt(text, cur, updateAutoComplete) + '<span></span><br>';
  }

  updateCurText(text: string, push: boolean = true) {
    this.curText = text;
    this.onUpdated(text);
  }

  pushHistory() {
    if (this.historyBuf.length > MAX_HISTORY_SIZE) {
      this.historyBuf.shift();
    }
    let pos = this.getCaretPosition();
    let text = this.curText;
    if (this.compositionBuffer.length > 0) {
      text =
        text.substring(0, pos[0] - 1) +
        Hangul.assemble(this.compositionBuffer) +
        text.substring(pos[0] - 1);
    }
    this.historyBuf.push({
      text,
      cursorPos: this.getCaretPosition(),
      compositionBuffer: this.compositionBuffer,
    });
    this.redoBuf.clear();
  }

  getCurWord(start: number) {
    const curText = this.domText;
    const fullWord = appState.fullWordAutoComplete;
    const [startIdx, endIdx] = getWordBounds(curText, start, fullWord);
    // fullWord=false면 endIdx=start. 두 분기 모두 substring(startIdx, endIdx).
    return curText.substring(startIdx, endIdx).trim();
  }

  setCurWord(word: string) {
    mutex.runExclusive(async () => {
      const [start] = this.getCaretPosition();
      const curText = this.domText;
      const [startIdx, endIdx] = getWordBounds(
        curText,
        start,
        appState.fullWordAutoComplete,
      );
      if (startIdx !== 0 && curText[startIdx - 1] !== '\n') word = ' ' + word;
      this.updateCurText(
        curText.substring(0, startIdx) + word + curText.substring(endIdx),
      );
      this.updateDOM(this.curText, startIdx, false);
      this.compositionBuffer = [];
      await this.setCaretPosition([
        startIdx + word.length,
        startIdx + word.length,
      ]);
    });
  }

  // 커서 위치(pos)에 chunk 토큰 삽입 — 앞/뒤에 구분자(', ') 자동 보장.
  // pos는 버튼 누르기 직전 wrapper가 저장한 caret(데이터 offset). 끝 초과 시 clamp.
  async insertChunkAtCaret(token: string, pos: number) {
    await mutex.runExclusive(async () => {
      this.pushHistory();
      const len = this.curText.length;
      let p = pos;
      if (p > len) p = len;
      if (p < 0) p = 0;
      const before = this.curText.slice(0, p).replace(/[ \t]+$/, '');
      const after = this.curText.slice(p).replace(/^[ \t]+/, '');
      const sep1 = before.trim() === '' ? '' : before.endsWith(',') ? ' ' : ', ';
      const sep2 = after === '' ? '' : after.startsWith(',') ? '' : ', ';
      const newText = before + sep1 + token + sep2 + after;
      const caret = (before + sep1 + token).length;
      this.updateCurText(newText);
      this.updateDOM(newText, caret, false);
      this.compositionBuffer = [];
      await this.setCaretPosition([caret, caret]);
    });
  }

  async handleInput(
    inputChar: string,
    collapsed: boolean,
    pos: number[] | undefined = undefined,
  ) {
    this.pushHistory();
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g;
    // 프리셋 prefix 보호: 삽입/삭제 지점이 prefix 안이면 경계로 당김.
    let [start, end] = this.clampToLock(
      ...(pos ? pos : this.getCaretPosition()) as [number, number],
    );
    // getCaretPosition이 알약(chunk) 경계에서 텍스트 길이를 초과하는 offset을 반환하는
    // 케이스가 있어(caret offset ≤ 길이 불변식 위반) 상한 clamp. 알약 직후 자동 구분자
    // 판정·삽입·커서 정확성 보장. (환산 근본 원인은 getCaretPosition — JOURNAL 백로그)
    const _curLen = this.curText.length;
    if (start > _curLen) start = _curLen;
    if (end > _curLen) end = _curLen;
    this.updateCurText(
      this.curText.substring(0, start) + this.curText.substring(end),
      false,
    );
    let newPos = start;
    if (koreanRegex.test(inputChar)) {
      let txtB = Hangul.assemble(this.compositionBuffer);
      if (this.compositionBuffer.length === 0) {
        newPos++;
      }
      this.compositionBuffer.push(inputChar);
      let txt = Hangul.assemble(this.compositionBuffer);
      if (txt.length === 2) {
        this.updateCurText(
          this.curText.substring(0, start - 1) +
            txt[0] +
            this.curText.substring(start - 1),
        );
        let found;
        for (let i = 0; i < this.compositionBuffer.length; i++) {
          if (Hangul.assemble(this.compositionBuffer.slice(0, i)) === txt[0]) {
            found = i;
            break;
          }
        }
        this.compositionBuffer = this.compositionBuffer.slice(found);
        newPos++;
        txt = txt[1];
        this.updateDOM(
          this.curText.substring(0, start) +
            txt +
            this.curText.substring(start),
          newPos,
        );
      } else {
        if (txtB.length === 0) {
          this.updateDOM(
            this.curText.substring(0, start) +
              txt +
              this.curText.substring(start),
            newPos,
          );
        } else {
          this.updateDOM(
            this.curText.substring(0, start - 1) +
              txt +
              this.curText.substring(start - 1),
            newPos,
          );
        }
      }
    } else {
      if (this.compositionBuffer.length) {
        let txt = Hangul.assemble(this.compositionBuffer);
        this.updateCurText(
          this.curText.substring(0, start - 1) +
            txt +
            inputChar +
            this.curText.substring(start - 1),
        );
        this.compositionBuffer = [];
        newPos++;
        this.updateDOM(this.curText, newPos);
      } else {
        // chunk 알약 경계 자동 구분자: 알약 바로 뒤(또는 앞)에 일반 문자(쉼표·공백
        // 제외)를 입력하면 ', '를 자동 삽입 → 알약 끝 태그와 사용자 글자가 한 태그로
        // 합쳐지는 오염 방지 (예: ⟦…black tail⟧efgh → 펼치면 black tailefgh).
        let ins = inputChar;
        let caretAdvance = 1;
        if (inputChar !== ',' && inputChar !== ' ') {
          if (chunkTokenBefore(this.curText, start) !== -1) {
            ins = ', ' + inputChar; // 알약 바로 뒤 → "⟦token⟧, char"
            caretAdvance = ins.length;
          } else if (chunkTokenAfter(this.curText, start) !== -1) {
            ins = inputChar + ', '; // 알약 바로 앞 → "char, ⟦token⟧"
            caretAdvance = 1;
          }
        }
        this.updateCurText(
          this.curText.substring(0, start) +
            ins +
            this.curText.substring(start),
        );
        newPos = start + caretAdvance;
        this.updateDOM(this.curText, newPos);
      }
    }
    await this.setCaretPosition([newPos, newPos]);
  }

  handleWindowMouseDown(e: any) {
    if (this.compositionBuffer.length) this.flushCompositon(this.previousRange);
  }

  flushCompositon(prev: number[]) {
    if (!prev) return false;
    const [start, end] = prev;
    if (this.compositionBuffer.length) {
      let txt = Hangul.assemble(this.compositionBuffer);
      this.updateCurText(
        this.curText.substring(0, start - 1) +
          txt +
          this.curText.substring(start - 1),
      );
      this.compositionBuffer = [];
      return true;
    }
    return false;
  }

  async handleKeyDown(e: any) {
    await mutex.runExclusive(async () => {
      const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g;
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0);
      let [start, end] = this.getCaretPosition();
      const collapsed = range.collapsed;
      // ── 프리셋 prefix 보호 (데스크탑) ──
      // 선택이 prefix를 걸치면 [lp, end]로 clamp → 삭제/잘라내기/복사가 prefix 외만 대상.
      // caret(선택 없음)이 prefix 안이면 경계로 밀고 입력/삭제 무시. 네비/복사/붙여넣기는 통과.
      const lp = this.lockedPrefixLength;
      if (lp) {
        const ctrlKey = e.metaKey || e.ctrlKey;
        const isNav =
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          ((e.key === 'a' || e.key === 'A') && ctrlKey);
        const isCopy = (e.key === 'c' || e.key === 'C') && ctrlKey;
        const isPaste = (e.key === 'v' || e.key === 'V') && ctrlKey;
        // 선택 범위를 prefix 밖으로 clamp (Delete/Backspace/cut이 이 start,end 사용)
        if (!collapsed) {
          start = Math.max(start, lp);
          end = Math.max(end, lp);
        }
        // 복사: prefix 걸친 선택이어도 prefix 외 구간만 클립보드에 (native 복사 가로채기).
        // 선택이 완전히 prefix 안이면 clamp 후 start>=end라 빈 복사 — prefix 절대 안 나감.
        if (isCopy) {
          e.preventDefault();
          if (start < end) {
            await navigator.clipboard.writeText(
              this.curText.substring(start, end),
            );
          }
          this.flushCompositon(this.previousRange);
          return;
        }
        // caret이 prefix 안 → 경계로 이동 + 입력/삭제 무시
        if (collapsed && start < lp && !isNav && !isCopy && !isPaste) {
          e.preventDefault();
          await this.setCaretPosition([lp, lp]);
          return;
        }
        // 경계 직후 Backspace로 prefix 마지막 글자 지우기 차단
        if (e.key === 'Backspace' && collapsed && start <= lp) {
          e.preventDefault();
          return;
        }
      }
      if (koreanRegex.test(e.key || '')) {
        e.preventDefault();
        this.shuffling = true;
        this.editor.blur();
        this.shuffling = false;
        await this.handleInput(e.key || '', collapsed, [start, end]);
        return;
      }
      if (this.autocomplete && !e.shiftKey) {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.onUpArrow();
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.onDownArrow();
          return;
        }
      }
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        (e.key === 'a' && (e.metaKey || e.ctrlKey))
      ) {
        this.flushCompositon(this.previousRange);
        return;
      }
      if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
        this.flushCompositon(this.previousRange);
        return;
      }
      if (e.key === 'x' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.pushHistory();
        await navigator.clipboard.writeText(this.curText.substring(start, end));
        this.updateCurText(
          this.curText.substring(0, start) + this.curText.substring(end),
        );
        this.updateDOM(this.curText, start);
        await this.setCaretPosition([start, start]);
        return;
      }
      if ((e.key === 'z' || e.key === 'Z') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          if (this.redoBuf.length > 0) {
            const entry = this.redoBuf.pop()!;
            this.compositionBuffer = [];
            this.historyBuf.push(entry);
            this.updateCurText(entry.text, false);
            this.updateDOM(this.curText, entry.cursorPos, false);
            await this.setCaretPosition(entry.cursorPos);
          }
        } else {
          if (this.historyBuf.length > 0) {
            const entry = this.historyBuf.pop()!;
            this.compositionBuffer = [];
            this.redoBuf.push(entry);
            this.updateCurText(entry.text, false);
            this.updateDOM(this.curText, entry.cursorPos, false);
            await this.setCaretPosition(entry.cursorPos);
          }
        }
        return;
      }
      if (e.key === 'y' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (this.redoBuf.length > 0) {
          const entry = this.redoBuf.pop()!;
          this.compositionBuffer = [];
          this.historyBuf.push(entry);
          this.updateCurText(entry.text, false);
          this.updateDOM(this.curText, entry.cursorPos, false);
          await this.setCaretPosition(entry.cursorPos);
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.autocomplete) {
          this.onEnter();
          return;
        }
        let cursor = start;
        this.pushHistory();
        if (!range.collapsed) {
          this.updateCurText(
            this.curText.substring(0, start) + this.curText.substring(end),
            false,
          );
        } else {
          if (this.flushCompositon(this.previousRange)) {
            cursor++;
          }
        }
        this.updateCurText(
          this.curText.substring(0, cursor) +
            '\n' +
            this.curText.substring(cursor),
        );
        this.updateDOM(this.curText, start + 1, false);
        await this.setCaretPosition([start + 1, start + 1]);
        return;
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        let newPos = start;
        if (range.collapsed) {
          // chunk 알약: 첫 Delete = 알약 선택(강조). 두 번째는 collapsed=false라 아래
          // 선택 삭제 분기로 흘러 토큰 통째 제거.
          const te = chunkTokenAfter(this.curText, start);
          if (te !== -1) {
            await this.setCaretPosition([start, te]);
            return;
          }
          if (start !== this.curText.length) {
            this.pushHistory();
            this.flushCompositon(this.previousRange);
            this.updateCurText(
              this.curText.substring(0, start) +
                this.curText.substring(start + 1),
            );
            this.updateDOM(this.curText, newPos);
          }
        } else {
          this.pushHistory();
          if (this.compositionBuffer.length) {
            this.compositionBuffer = [];
          }
          this.updateCurText(
            this.curText.substring(0, start) + this.curText.substring(end),
          );
          this.updateDOM(this.curText, newPos);
        }
        await this.setCaretPosition([newPos, newPos]);
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        let newPos = start;
        if (range.collapsed) {
          // chunk 알약: 첫 Backspace = 알약 선택(강조). 두 번째는 collapsed=false라 아래
          // 선택 삭제 분기로 흘러 토큰 통째 제거. prefix 안 토큰은 lock 보호라 선택 X.
          if (!e.shiftKey && !e.metaKey) {
            const ts = chunkTokenBefore(this.curText, start);
            if (ts !== -1 && ts >= this.lockedPrefixLength) {
              await this.setCaretPosition([ts, start]);
              return;
            }
          }
          let delAmount = 1;
          const massDel = e.shiftKey || e.metaKey;
          if (massDel) {
            let i = start - 2;
            const blanks = ' \t\n\u200B';
            if (!blanks.includes(this.curText[start - 1])) {
              while (i >= 0 && !blanks.includes(this.curText[i])) {
                i--;
                delAmount++;
              }
            }
          }
          if (start !== 0) {
            this.pushHistory();
            if (this.compositionBuffer.length) {
              if (!massDel) {
                this.compositionBuffer.pop();
                const txt = Hangul.assemble(this.compositionBuffer);
                if (txt === '') {
                  newPos--;
                  this.updateDOM(this.curText, newPos);
                } else {
                  this.updateDOM(
                    this.curText.substring(0, start - 1) +
                      txt +
                      this.curText.substring(start - 1),
                    newPos,
                  );
                }
              } else {
                newPos -= delAmount;
                this.compositionBuffer = [];
                this.updateCurText(
                  this.curText.substring(0, start - delAmount) +
                    this.curText.substring(start - 1),
                );
                this.updateDOM(this.curText, newPos);
              }
            } else {
              newPos -= delAmount;
              this.updateCurText(
                this.curText.substring(0, start - delAmount) +
                  this.curText.substring(start),
              );
              this.updateDOM(this.curText, newPos);
            }
          }
        } else {
          this.pushHistory();
          if (this.compositionBuffer.length) {
            this.compositionBuffer = [];
          }
          this.updateCurText(
            this.curText.substring(0, start) + this.curText.substring(end),
          );
          this.updateDOM(this.curText, newPos);
        }
        await this.setCaretPosition([newPos, newPos]);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.autocomplete) {
          this.onEsc();
        } else {
          this.flushCompositon(this.previousRange);
        }
        return;
      }
    });
  }

  async handleBeforeInput(e: any) {
    if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') return;
    e.preventDefault();
    await mutex.runExclusive(async () => {
      // 우클릭/모바일 선택메뉴 "잘라내기" = beforeinput(deleteByCut). 클립보드 복사는 native
      // cut 이벤트가 이미 처리하므로 여기선 선택 삭제만 한다(없으면 복사만 되고 선택이 안
      // 지워지는 버그 — Ctrl+X는 keydown에서 처리되지만 메뉴 잘라내기는 keydown이 없음).
      if (e.inputType === 'deleteByCut') {
        let [start, end] = this.getCaretPosition();
        const lp = this.lockedPrefixLength || 0;
        if (lp) {
          // prefix 보호: 삭제 범위를 잠긴 prefix 밖으로 clamp(Ctrl+X와 동일).
          start = Math.max(start, lp);
          end = Math.max(end, lp);
        }
        if (start === end) return;
        this.pushHistory();
        this.updateCurText(
          this.curText.substring(0, start) + this.curText.substring(end),
        );
        this.updateDOM(this.curText, start);
        await this.setCaretPosition([start, start]);
        return;
      }
      const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g;
      if (koreanRegex.test(e.data || '')) return;
      if (!e.data) return;
      await this.handleInput(e.data || '', false);
    });
  }

  async handleCompositionUpdate(e: any) {
    e.preventDefault();
    await mutex.runExclusive(async () => {
      if (!e.data) return;
      const selection = window.getSelection()!;
      const range = selection.getRangeAt(0);
      const [start, end] = this.getCaretPosition();
      const collapsed = range.collapsed;
      this.shuffling = true;
      // preventScroll: iOS는 focus 시 element(화면 좌상단 clipboard)를 보이게 페이지를
      // 스크롤해 한글 조합마다 출렁임 → 스크롤 억제. 데스크탑 무해.
      this.clipboard.focus({ preventScroll: true });
      this.shuffling = false;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await this.handleInput(e.data || '', collapsed, [start, end]);
    });
  }

  async handlePaste(e: any) {
    e.preventDefault();
    // Firefox는 paste 이벤트 dispatch가 끝나면 clipboardData를 무효화함.
    // mutex.runExclusive의 await(microtask)를 지나기 전, 동기 시점에 미리 읽어둠.
    // Chrome은 await 이후에도 읽히지만 Firefox는 빈 문자열이 되어 paste가 무시됨.
    const text = e.clipboardData.getData('text');
    await mutex.runExclusive(async () => {
      this.pushHistory();
      const selection = window.getSelection()!;
      // 프리셋 prefix 보호: 붙여넣기 지점이 prefix 안이면 경계로 당김.
      const [start, end] = this.clampToLock(...this.getCaretPosition() as [number, number]);
      let cursor = start;
      if (this.flushCompositon(this.previousRange)) {
        cursor++;
      }
      // chunk 알약 경계 자동 구분자 — 입력(handleInput 552-565)과 동일 정책.
      // 알약 바로 뒤에 붙여넣으면 앞에 ', ', 알약 바로 앞이면 뒤에 ', '를 넣어
      // 알약 끝 태그와 붙여넣은 텍스트가 한 태그로 합쳐지는 오염 방지.
      // 붙여넣는 텍스트가 이미 구분자(','/' ')로 시작/끝나면 중복 추가 안 함.
      let pasteText = text;
      if (
        pasteText &&
        !pasteText.startsWith(',') &&
        !pasteText.startsWith(' ') &&
        chunkTokenBefore(this.curText, cursor) !== -1
      ) {
        pasteText = ', ' + pasteText;
      }
      if (
        pasteText &&
        !pasteText.endsWith(',') &&
        !pasteText.endsWith(' ') &&
        chunkTokenAfter(this.curText, end) !== -1
      ) {
        pasteText = pasteText + ', ';
      }
      this.updateCurText(
        this.curText.substring(0, cursor) + pasteText + this.curText.substring(end),
      );
      this.updateDOM(this.curText, cursor + pasteText.length, false);
      await this.setCaretPosition([
        cursor + pasteText.length,
        cursor + pasteText.length,
      ]);
    });
  }
}

const PromptAutoComplete = ({
  tags,
  curWord,
  clientX,
  clientY,
  selectedTag,
  onSelectTag,
  inline = false,
  fieldBoxRef,
}: {
  tags: WordTag[];
  curWord: string;
  clientX: number;
  clientY: number;
  selectedTag: number;
  onSelectTag: (idx: number) => void;
  inline?: boolean;
  fieldBoxRef?: { current: HTMLElement | null };
}) => {
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  // 모바일: 입력창 박스(테두리) rect — 그 칸 바로 아래에 팝오버를 붙이기 위함.
  const [boxRect, setBoxRect] = useState<{
    left: number;
    bottom: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = fieldBoxRef?.current;
    if (el && tags.length > 0) {
      const r = el.getBoundingClientRect();
      setBoxRect({ left: r.left, bottom: r.bottom, width: r.width });
    }
  }, [tags, fieldBoxRef]);
  const [matchMasks, setMatchMasks] = useState<any[][]>([]);
  const listRef = createRef<any>();
  const categoryIcon = (category: number) => {
    if (category === 0) return <FaTag />;
    if (category === 1) return <FaPaintBrush />;
    if (category === 3) return <FaBook />;
    if (category === 4) return <FaPerson />;
    if (category === 5) return <FaDatabase />;
    return <FaBox />;
  };
  useEffect(() => {
    setPosX(clientX);
    const reposition = () => {
      const vv = window.visualViewport;
      setPosY(positionAutocompletePopup(clientY, 200, 22, {
        top: vv?.offsetTop ?? 0,
        height: vv?.height ?? window.innerHeight,
      }));
    };
    reposition();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', reposition);
    vv?.addEventListener('scroll', reposition);
    return () => {
      vv?.removeEventListener('resize', reposition);
      vv?.removeEventListener('scroll', reposition);
    };
  }, [clientX, clientY]);
  useEffect(() => {
    setMatchMasks(tags.map((tag) => calcGapMatch(curWord, tag.word).path));
  }, [tags, curWord]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollToItem(selectedTag, 'smart');
  }, [listRef, selectedTag]);
  const processWord = (word: string, mask: number[]) => {
    const sections = [];
    let currentSection = { text: '', bold: false };

    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      const isBold = mask && mask.includes(i);

      if (isBold !== currentSection.bold) {
        if (currentSection.text) {
          sections.push(currentSection);
        }
        currentSection = { text: char, bold: isBold };
      } else {
        currentSection.text += char;
      }
    }

    if (currentSection.text) {
      sections.push(currentSection);
    }

    return sections;
  };

  const formatCount = (count: number) => {
    if (count > 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count;
  };

  const renderRow = ({ index, style }: { index: number; style: any }) => {
    return (
      <div
        className={
          'hover:brightness-95 active:brightness-90 cursor-pointer ' +
          (index === selectedTag
            ? 'flex items-center p-1 bg-gray-200'
            : 'flex bg-white items-center p-1')
        }
        style={style}
        key={index}
        onMouseDown={() => onSelectTag(index)}
      >
        <span className="text-gray-600 mr-1 flex-none">
          {tags[index].word.startsWith('<') ? (
            <FaStar></FaStar>
          ) : (
            categoryIcon(tags[index].category)
          )}
        </span>
        <div className="flex-1 truncate h-full">
          {matchMasks.length
            ? processWord(tags[index].word, matchMasks[index]).map(
                (section, idx2) => (
                  <span key={idx2} className={section.bold ? 'font-bold' : ''}>
                    {section.text}
                  </span>
                ),
              )
            : tags[index].word}
          {tags[index].redirect.trim() !== 'null' && (
            <span className="text-gray-400">→{tags[index].redirect}</span>
          )}
        </div>
        {!tags[index].word.startsWith('<') && (
          <div className="flex-none text-right">
            {formatCount(tags[index].freq)}
          </div>
        )}
      </div>
    );
  };
  // inline: 부모 컨테이너 (fullScreen split) 안에 채워서 표시. 위치 계산 없음.
  // popover: fixed positioning. 모바일은 텍스트 위에 띄움 (clientY - 222), 공간 부족 시 8px clamp.
  if (inline) {
    if (tags.length === 0) return null;
    return (
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full h-full overflow-y-auto bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-500 rounded-lg"
      >
        {tags.map((_, idx) => (
          <div
            key={idx}
            className={
              'hover:brightness-95 active:brightness-90 cursor-pointer ' +
              (idx === selectedTag
                ? 'flex items-center p-1 bg-gray-200 dark:bg-slate-500'
                : 'flex items-center p-1')
            }
            onMouseDown={() => onSelectTag(idx)}
          >
            <span className="text-gray-600 dark:text-gray-300 mr-1 flex-none">
              {tags[idx].word.startsWith('<') ? (
                <FaStar />
              ) : (
                categoryIcon(tags[idx].category)
              )}
            </span>
            <span className="flex-1 truncate text-sm text-default">
              {matchMasks[idx]
                ? processWord(tags[idx].word, matchMasks[idx]).map((sec, i) => (
                    <span key={i} className={sec.bold ? 'font-bold' : ''}>
                      {sec.text}
                    </span>
                  ))
                : tags[idx].word}
            </span>
            {tags[idx].freq > 0 && (
              <div className="flex-none text-right text-xs text-gray-500 dark:text-gray-400 ml-2">
                {formatCount(tags[idx].freq)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // 위치 결정(모바일):
  //  - 세로: 커서(타이핑 줄) 바로 아래에 밀착(clientY + 24). iOS가 포커스된 입력창을 화면
  //    상단으로 스크롤하므로 커서는 항상 상단부 → 아래로 붙여도 키보드에 안 가림. (박스 맨
  //    아래로 붙이면 박스가 세로로 길 때 커서와 떨어져 어색 → 커서 밀착이 표준 자동완성 느낌.)
  //  - 가로: 입력창 박스(상위/하위/네거·씬 프롬프트칸)의 left/width에 맞춰 그 칸과 정렬(있을 때).
  //  - 데스크탑: 캐럿 아래(caret-follow) 유지.
  let popoverTop: number;
  let popoverLeft: number | string;
  let popoverWidth: number | string;
  let popoverMaxWidth: string | undefined;
  if (isMobile) {
    popoverTop = clientY + 24;
    if (boxRect) {
      popoverLeft = boxRect.left;
      popoverWidth = boxRect.width;
      popoverMaxWidth = undefined;
    } else {
      popoverLeft = '5vw';
      popoverWidth = '90vw';
      popoverMaxWidth = '400px';
    }
  } else {
    popoverTop = posY;
    popoverLeft = posX;
    popoverWidth = '90vw';
    popoverMaxWidth = '400px';
  }
  return (
    <div
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
      className="fixed bg-white border border-gray-300 rounded-lg shadow-lg z-30 text-gray-900"
      style={{
        display:
          tags.length > 0 && (clientX !== 0 || clientY !== 0)
            ? 'block'
            : 'none',
        width: popoverWidth,
        maxWidth: popoverMaxWidth,
        height: '200px',
        left: popoverLeft,
        top: popoverTop,
      }}
    >
      <List
        ref={listRef}
        className="always-show-scroll"
        height={200}
        itemCount={tags.length}
        itemSize={31}
        /*
        // @ts-ignore */
        overscanRowCount={16}
      >
        {renderRow}
      </List>
    </div>
  );
};

interface PromptEditTextAreaProps {
  value: string;
  whiteBg?: boolean;
  innerRef?: any;
  disabled?: boolean;
  lineHighlight?: boolean;
  onChange: (value: string) => void;
  lockedPrefix?: string;
  lockedBgClass?: string;
  chunkInsert?: boolean; // true면 우상단에 +chunk 버튼 표시 (상위/하위/네거티브 칸용)
  chunkLabel?: string; // +chunk 버튼 title에 넣을 칸 이름 (예: "상위 프롬프트")
  searchEnabled?: boolean; // true면 appState.promptSearchQuery로 태그/알약 하이라이트(찾기)
  // headerLabel 지정 시: 입력창 위 absolute 버튼 대신 *라벨 줄*(헤더 행)에 라벨+버튼을 둔다
  // (긴 프롬프트 세로 스크롤과 버튼 겹침 해소). 부모는 자기 라벨을 제거하고 이 prop으로 넘김.
  headerLabel?: string;
  headerFull?: boolean; // true면 헤더+textarea를 flex-col h-full로(부모가 고정높이 flex-1일 때)
  headerCollapsed?: boolean;
  headerBadge?: string;
  onHeaderToggle?: () => void;
}

function useLatest(value: any) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

function trimByBraces(str: string) {
  // (숫자)::tag:: 형식의 가중치 접두어/접미어 제거
  str = str.replace(/^-?\d+(?:\.\d+)?::/, '');
  str = str.replace(/::$/, '');
  // {[]} 괄호 및 artist: 접두어 제거
  str = str.replace(/^[{\[]*(artist:)?/, '');
  str = str.replace(/[}\]]*$/, '');
  return str;
}

function replaceMiddleWord(str: string, newWord: string) {
  // 가중치 접두어/접미어 보존: (숫자)::내용::
  const wpMatch = str.match(/^(-?\d+(?:\.\d+)?::)/);
  const weightPrefix = wpMatch ? wpMatch[1] : '';
  const hasSuffix = weightPrefix && str.endsWith('::');
  const inner = hasSuffix
    ? str.substring(weightPrefix.length, str.length - 2)
    : str.substring(weightPrefix.length);
  // 괄호 보존: {[내용]}
  const leftMatch = inner.match(/^[{\[]*(artist:)?/);
  const trimmedLeft = leftMatch ? leftMatch[0] : '';
  const rightMatch = inner.match(/[}\]]*$/);
  const trimmedRight = rightMatch ? rightMatch[0] : '';
  return weightPrefix + trimmedLeft + newWord + trimmedRight + (hasSuffix ? '::' : '');
}

interface EditTextAreaProps {
  value: string;
  disabled?: boolean;
  lockedPrefixLength?: number;
  highlight: (
    text: string,
    curWord: string,
    updateAutoComplete: boolean,
  ) => string;
  onUpdated: (text: string) => void;
  history: Denque<HistoryEntry>;
  redo: Denque<HistoryEntry>;
  onUpArrow: () => void;
  onDownArrow: () => void;
  onEnter: () => void;
  onEsc: () => void;
  onFocus: () => void;
  closeAutoComplete: () => void;
}

interface EditTextAreaRef {
  refreshHighlight: () => void;
  onCloseAutoComplete: () => void;
  onOpenAutoComplete: () => void;
  setCurWord: (word: string) => void;
  getCaretCoords(): Promise<number[]>;
  undo(): void;
  getCaret: () => number | null;
  insertChunkAtCaret: (token: string, pos: number) => void;
  focusEditor?: () => void;
}

const EmulatedEditTextArea = observer(
  forwardRef<EditTextAreaRef, any>(
    (
      {
        value,
        disabled,
        lockedPrefixLength,
        highlight,
        onUpdated,
        history,
        redo,
        onUpArrow,
        onDownArrow,
        onEnter,
        onEsc,
        closeAutoComplete,
        onFocus,
      }: EditTextAreaProps,
      ref: any,
    ) => {
      const editorRef = useRef<any>(null);
      const containerRef = useRef<any>(null);
      const clipboardRef = useRef<any>(null);
      const editorModelRef = useRef<any>(null);
      // chunk 알약 호버 미리보기 — fixed 박스로 칸 overflow/stacking 탈출(데스크탑만).
      const [hoverChunk, setHoverChunk] = useState<
        { content: string; x: number; y: number } | null
      >(null);

      useEffect(() => {
        if (!editorRef.current) return;
        const editor = new CursorMemorizeEditor(
          containerRef.current,
          editorRef.current,
          clipboardRef.current,
          highlight,
          onUpdated,
          history,
          redo,
          onUpArrow,
          onDownArrow,
          onEnter,
          onEsc,
          lockedPrefixLength || 0,
        );
        editorModelRef.current = editor;
        editor.updateCurText(value);
        editor.updateDOM(value, 0, false);
        const handleKeyDown = (e: any) => editor.handleKeyDown(e);
        editorRef.current.addEventListener('keydown', handleKeyDown);
        const handleBeforeInput = (e: any) => editor.handleBeforeInput(e);
        editorRef.current.addEventListener('beforeinput', handleBeforeInput);
        const handleCompositionUpdate = (e: any) =>
          editor.handleCompositionUpdate(e);
        if (!isMacPlatform()) {
          editorRef.current.addEventListener(
            'compositionupdate',
            handleCompositionUpdate,
          );
        }
        const handlePaste = (e: any) => editor.handlePaste(e);
        editorRef.current.addEventListener('paste', handlePaste);
        // 프리셋 prefix 보호: 클릭으로 caret이 prefix 안에 들어가면 경계로 이동.
        const handleClickLock = (e: any) => editor.handleClick(e);
        editorRef.current.addEventListener('click', handleClickLock);
        // 포커스 시 상위로 알림(모바일: 탭하면 자동 확대). NativeEditTextArea에만 있던 배선이
        // 실제 엔진(Emulated)엔 없어 auto-확대가 죽어 있던 것 — 여기서 연결.
        const handleFocus = () => onFocus && onFocus();
        editorRef.current.addEventListener('focus', handleFocus);
        const handleWindowMouseDown = (e: any) => {
          closeAutoComplete();
          editor.handleWindowMouseDown(e);
        };
        window.addEventListener('mousedown', handleWindowMouseDown);
        return () => {
          window.removeEventListener('mousedown', handleWindowMouseDown);
          if (editorRef.current === null) return;
          editorRef.current.removeEventListener('keydown', handleKeyDown);
          editorRef.current.removeEventListener(
            'beforeinput',
            handleBeforeInput,
          );
          if (!isMacPlatform()) {
            editorRef.current.removeEventListener(
              'compositionupdate',
              handleCompositionUpdate,
            );
          }
          editorRef.current.removeEventListener('paste', handlePaste);
          editorRef.current.removeEventListener('click', handleClickLock);
          editorRef.current.removeEventListener('focus', handleFocus);
        };
      }, []);

      useImperativeHandle(ref, () => ({
        refreshHighlight: () => {
          const m = editorModelRef.current;
          if (m) m.updateDOM(m.curText, 0, false);
        },
        focusEditor: () => {
          editorRef.current?.focus();
        },
        onCloseAutoComplete: () => {
          editorModelRef.current.autocomplete = false;
        },
        onOpenAutoComplete: () => {
          editorModelRef.current.autocomplete = true;
        },
        setCurWord: (word: string) => {
          editorModelRef.current.setCurWord(word);
        },
        getCaretCoords: async () => {
          let selection = window.getSelection()!;
          if (selection.rangeCount === 0) return;
          let range = selection.getRangeAt(0);
          let rect = range.getBoundingClientRect();
          if (rect.right === 0 && rect.top === 0) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            selection = window.getSelection()!;
            range = selection.getRangeAt(0);
            rect = range.getBoundingClientRect();
          }
          return [rect.right, rect.top];
        },
        undo() {
          editorModelRef.current.handleKeyDown({ key: 'z', metaKey: true });
        },
        getCaret: () => {
          const m = editorModelRef.current;
          if (!m) return null;
          const [s] = m.getCaretPosition();
          return Math.min(s, (m.curText || '').length); // over 환산 clamp
        },
        insertChunkAtCaret: (token: string, pos: number) => {
          editorModelRef.current?.insertChunkAtCaret(token, pos);
        },
      }));

      useEffect(() => {
        if (!editorRef.current) return;
        if (value !== editorModelRef.current.curText) {
          editorModelRef.current.updateCurText(value, false);
          editorModelRef.current.updateDOM(value, 0, false);
        }
      }, [value]);

      // 프리셋 적용/해제로 prefix 길이가 바뀌면 에디터(once 생성)에 반영.
      useEffect(() => {
        if (editorModelRef.current) {
          editorModelRef.current.lockedPrefixLength = lockedPrefixLength || 0;
        }
      }, [lockedPrefixLength]);

      return (
        <>
          <div
            ref={containerRef}
            className="overflow-auto h-full"
            onMouseOver={(e) => {
              if (isMobile) return;
              const el = (e.target as HTMLElement)?.closest?.(
                '.syntax-chunk[data-chunk-content]',
              ) as HTMLElement | null;
              if (el) {
                const r = el.getBoundingClientRect();
                setHoverChunk({
                  content: el.getAttribute('data-chunk-content') || '',
                  x: r.left,
                  y: r.bottom,
                });
              }
            }}
            onMouseOut={(e) => {
              if ((e.target as HTMLElement)?.closest?.('.syntax-chunk')) {
                setHoverChunk(null);
              }
            }}
          >
            <div
              className={
                'w-full min-h-full focus:outline-0 whitespace-pre-wrap align-middle'
              }
              ref={editorRef}
              contentEditable={disabled ? 'false' : 'true'}
            ></div>
          </div>
          <textarea
            className="absolute top-0 left-0 opacity-0 w-0 h-0"
            disabled={disabled}
            ref={clipboardRef}
            value=""
            onChange={(e) => {
              e.target.value = '';
            }}
          ></textarea>
          {hoverChunk && !isMobile && (
            <div
              style={{
                position: 'fixed',
                left: hoverChunk.x,
                top: hoverChunk.y + 4,
                zIndex: 9999,
                maxWidth: 360,
                maxHeight: '50vh',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 11,
                lineHeight: 1.45,
                padding: '5px 8px',
                borderRadius: 6,
                background: 'rgba(28,28,32,0.96)',
                color: '#e8e8ea',
                boxShadow: '0 3px 12px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
              }}
            >
              {hoverChunk.content}
            </div>
          )}
        </>
      );
    },
  ),
);

const NativeEditTextArea = observer(
  forwardRef(
    (
      {
        value,
        disabled,
        lockedPrefixLength,
        highlight,
        onUpdated,
        history,
        redo,
        onUpArrow,
        onDownArrow,
        onEnter,
        onEsc,
        closeAutoComplete,
        onFocus,
      }: EditTextAreaProps,
      ref,
    ) => {
      const textareaRef = useRef<any>(null);
      const highlightRef = useRef<any>(null);
      const containerRef = useRef<any>(null);
      const isAutoComplete = useRef(false);
      const lockedPrefix = lockedPrefixLength ? value.slice(0, lockedPrefixLength) : '';

      const getCurWord = () => {
        const start = textareaRef.current.selectionStart;
        const curText = textareaRef.current.value;
        const [startIdx, endIdx] = getWordBounds(
          curText,
          start,
          appState.fullWordAutoComplete,
        );
        return curText.substring(startIdx, endIdx).trim();
      };

      const renderText = () => {
        const text = textareaRef.current.value;
        highlightRef.current.innerHTML =
          highlight(text, getCurWord(), true) + '<span></span><br>';
      };

      const pushHistory = () => {
        const text = textareaRef.current.value;
        const start = textareaRef.current.selectionStart;
        const end = textareaRef.current.selectionEnd;
        if (history.length > MAX_HISTORY_SIZE) {
          history.shift();
        }
        history.push({ text, cursorPos: [start, end], compositionBuffer: [] });
        redo.clear();
      };

      const doUndo = () => {
        if (history.length > 1) {
          const prev = history.pop()!;
          redo.push(prev);
          const entry = history.peekBack()!;
          textareaRef.current.value = entry.text;
          onUpdated(entry.text);
          if (!isMobile) {
            textareaRef.current.selectionStart = entry.cursorPos[0];
            textareaRef.current.selectionEnd = entry.cursorPos[1];
          }
          const text = textareaRef.current.value;
          highlightRef.current.innerHTML =
            highlight(text, getCurWord(), false) + '<span></span><br>';
        }
      };

      const doRedo = () => {
        if (redo.length > 0) {
          const entry = redo.pop()!;
          history.push(entry);
          textareaRef.current.value = entry.text;
          onUpdated(entry.text);
          textareaRef.current.selectionStart = entry.cursorPos[0];
          textareaRef.current.selectionEnd = entry.cursorPos[1];
          renderText();
        }
      };

      useEffect(() => {
        if (!textareaRef.current || !highlightRef.current) return;
        const handleInput = () => {
          let text = textareaRef.current.value;
          if (lockedPrefixLength && !text.startsWith(lockedPrefix)) {
            textareaRef.current.value = lockedPrefix + text.slice(
              Math.max(0, text.length - (value.length - lockedPrefixLength))
            );
            text = textareaRef.current.value;
            const pos = lockedPrefixLength;
            textareaRef.current.selectionStart = pos;
            textareaRef.current.selectionEnd = pos;
          }
          renderText();
          pushHistory();
          onUpdated(text);
        };

        const handleSelect = () => {
          if (!lockedPrefixLength) return;
          const start = textareaRef.current.selectionStart;
          const end = textareaRef.current.selectionEnd;
          // 선택 시작이 prefix 안이면 경계로 당김 → 전체선택(Ctrl+A) 포함 모든 선택이
          // prefix 외만 대상. native 복사/잘라내기/삭제가 prefix를 못 건드림.
          if (start < lockedPrefixLength) {
            textareaRef.current.selectionStart = lockedPrefixLength;
            if (end < lockedPrefixLength) {
              textareaRef.current.selectionEnd = lockedPrefixLength;
            }
          }
        };

        textareaRef.current.addEventListener('input', handleInput);
        textareaRef.current.addEventListener('select', handleSelect);
        textareaRef.current.addEventListener('click', handleSelect);
        textareaRef.current.addEventListener('focus', onFocus);

        // 초기 렌더링 (자동완성 트리거 없이 하이라이트만)
        {
          const text = textareaRef.current.value;
          highlightRef.current.innerHTML =
            highlight(text, getCurWord(), false) + '<span></span><br>';
          pushHistory();
          onUpdated(text);
        }

        const handleWindowMouseDown = (e: any) => {
          closeAutoComplete();
        };
        window.addEventListener('mousedown', handleWindowMouseDown);
        return () => {
          window.removeEventListener('mousedown', handleWindowMouseDown);
          if (!textareaRef.current) return;
          textareaRef.current.removeEventListener('input', handleInput);
          textareaRef.current.removeEventListener('select', handleSelect);
          textareaRef.current.removeEventListener('click', handleSelect);
          textareaRef.current.removeEventListener('focus', onFocus);
        };
      }, []);

      useImperativeHandle(ref, () => ({
        refreshHighlight: () => renderText(),
        onCloseAutoComplete: () => {
          isAutoComplete.current = false;
        },
        onOpenAutoComplete: () => {
          isAutoComplete.current = true;
        },
        setCurWord: (word: string) => {
          const start = textareaRef.current.selectionStart;
          const curText = textareaRef.current.value;
          const [startIdx, endIdx] = getWordBounds(
            curText,
            start,
            appState.fullWordAutoComplete,
          );
          if (startIdx !== 0 && curText[startIdx - 1] !== '\n')
            word = ' ' + word;
          const newText =
            curText.substring(0, startIdx) + word + curText.substring(endIdx);
          textareaRef.current.value = newText;
          onUpdated(newText);
          textareaRef.current.selectionEnd = startIdx + word.length;
          highlightRef.current.innerHTML =
            highlight(newText, '', false) + '<span></span><br>';
          pushHistory();
        },
        getCaretCoords: async () => {
          const caret = getCaretCoordinates(
            textareaRef.current!,
            textareaRef.current!.selectionEnd,
          );
          const rect = textareaRef.current!.getBoundingClientRect();
          return [caret.left + rect.left, caret.top + rect.top];
        },
        undo() {
          doUndo();
        },
      }));

      useEffect(() => {
        if (!textareaRef.current || !highlightRef.current) return;
        // 외부 value 변경(chunk 삽입/정리 등)을 uncontrolled textarea에 반영.
        // 직접 타이핑은 textarea가 이미 최신이라 같은 값이면 skip(무해).
        if (textareaRef.current.value !== value) {
          textareaRef.current.value = value;
        }
        const text = textareaRef.current.value;
        highlightRef.current.innerHTML =
          highlight(text, getCurWord(), false) + '<span></span><br>';
        pushHistory();
      }, [value]);

      return (
        <div className="w-full h-full overflow-auto">
          <div ref={containerRef} className="native-text-area-container">
            <div
              ref={highlightRef}
              className="native-text-area-highlight select-none"
            ></div>
            <textarea
              ref={textareaRef}
              className="native-text-area-input native-text-area-highlight"
              defaultValue={value}
              disabled={disabled}
              onKeyDown={(e: any) => {
                if (e.key === 'ArrowUp') {
                  if (isAutoComplete.current) {
                    e.preventDefault();
                  }
                  onUpArrow();
                } else if (e.key === 'ArrowDown') {
                  if (isAutoComplete.current) {
                    e.preventDefault();
                  }
                  onDownArrow();
                } else if (e.key === 'Enter') {
                  if (isAutoComplete.current) e.preventDefault();
                  onEnter();
                } else if (e.key === 'Escape') onEsc();
                else if (
                  (e.key === 'z' || e.key === 'Z') &&
                  (e.metaKey || e.ctrlKey)
                ) {
                  e.preventDefault();
                  if (e.shiftKey) doRedo();
                  else doUndo();
                } else if (e.key === 'y' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  doRedo();
                }
              }}
            ></textarea>
          </div>
        </div>
      );
    },
  ),
);

// chunk 삽입 시트 — +chunk 버튼 클릭 시 chunk 목록(폴더별, 이름 클릭=삽입).
// 관리(추가/수정)는 사전세팅 줄의 chunk 관리 버튼에서. 여기선 고르기만.
const ChunkInsertSheet = observer(
  ({
    onPick,
    onClose,
    chunkLabel,
  }: {
    onPick: (id: string) => void;
    onClose: () => void;
    chunkLabel?: string;
  }) => {
    const chunks = promptChunkService.list();
    const folders = promptChunkService
      .listFolders()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    const uncategorized = chunks.filter((c) => !c.category);

    const chip = (c: any) => (
      <button
        key={c.id}
        className="inline-flex items-center pl-2 pr-2 py-0.5 rounded border text-sm text-gray-900 dark:text-slate-100 hover:opacity-70 max-w-full truncate"
        style={{ backgroundColor: c.color + '33', borderColor: c.color }}
        onClick={() => onPick(c.id)}
        title={c.content}
      >
        {c.name}
      </button>
    );

    return (
      <ModalOverlay isOpen={true} onClose={onClose} title={chunkLabel ? `${chunkLabel}에 chunk 삽입` : 'chunk 삽입'} width="max-w-lg">
        {chunks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400 text-sm">
            저장된 chunk가 없어요. 사전세팅 줄의 chunk 관리에서 먼저 추가해 주세요.
          </div>
        ) : (
          <div className="flex flex-col gap-3 max-h-[55vh] overflow-y-auto text-default">
            {folders.map((f) => {
              const inFolder = chunks.filter((c) => c.category === f.id);
              if (inFolder.length === 0) return null;
              return (
                <div key={f.id} className="flex flex-col gap-1">
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-300">
                    {f.name}
                  </div>
                  <div className="flex flex-wrap gap-1.5">{inFolder.map(chip)}</div>
                </div>
              );
            })}
            {uncategorized.length > 0 && (
              <div className="flex flex-col gap-1">
                {folders.some(
                  (f) => chunks.filter((c) => c.category === f.id).length > 0,
                ) && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    미분류
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {uncategorized.map(chip)}
                </div>
              </div>
            )}
          </div>
        )}
      </ModalOverlay>
    );
  },
);

const PromptEditTextArea = observer(
  ({
    value,
    onChange,
    disabled,
    whiteBg,
    lineHighlight,
    innerRef,
    lockedPrefix,
    lockedBgClass,
    chunkInsert,
    chunkLabel,
    searchEnabled,
    headerLabel,
    headerFull,
    headerCollapsed,
    headerBadge,
    onHeaderToggle,
  }: PromptEditTextAreaProps) => {
    const { curSession } = appState;
    const editorRef = useRef<EditTextAreaRef | null>(null);
    // 입력창 박스(테두리) DOM — 모바일 자동완성을 이 칸 바로 아래에 붙이기 위해 측정.
    // innerRef prop(PieceEditor 등이 사용)과 병합해 한 요소에 둘 다 설정.
    const fieldBoxRef = useRef<HTMLDivElement | null>(null);
    const setFieldBoxRef = useCallback(
      (el: HTMLDivElement | null) => {
        fieldBoxRef.current = el;
        if (typeof innerRef === 'function') innerRef(el);
        else if (innerRef) innerRef.current = el;
      },
      [innerRef],
    );
    // +chunk 버튼 누르기 직전(mousedown, 포커스 잃기 전)에 저장한 caret. chunk를 그
    // 위치에 삽입하기 위함 — 버튼 click 시점엔 칸 포커스가 풀려 caret을 알 수 없음.
    const savedChunkCaretRef = useRef<number | null>(null);
    const historyRef = useRef<Denque<HistoryEntry>>(new Denque<HistoryEntry>());
    const redoRef = useRef<Denque<HistoryEntry>>(new Denque<HistoryEntry>());
    const [tags, setTags] = useState<any[]>([]);
    const [selectedTag, setSelectedTag] = useState<number>(0);
    const [curWord, setCurWord] = useState<string>('');
    const [clientX, setClientX] = useState(0);
    const [clientY, setClientY] = useState(0);
    const tagsRef = useLatest(tags);
    const [id, setId] = useState(0);
    const cntRef = useRef(0);
    const selectedTagRef = useLatest(selectedTag);
    const curWordRef = useLatest(curWord);
    const valueRef = useLatest(value);
    const onChangeRef = useLatest(onChange);
    const [fullScreen, setFullScreen] = useState(false);
    const [chunkSheetOpen, setChunkSheetOpen] = useState(false);
    // 모바일 확대 시 키보드 위 가시영역(visualViewport)에 박스를 맞추기 위한 rect.
    const [vvRect, setVvRect] = useState<{ top: number; height: number } | null>(
      null,
    );

    // chunk 삽입 (단계 2 — 현재 값 끝에 토큰 추가). caret 위치 정밀 삽입은 단계 3.
    const insertChunkToken = (token: string) => {
      const cur = valueRef.current || '';
      const ed = editorRef.current;
      if (ed && ed.insertChunkAtCaret) {
        // 저장한 caret 위치에 삽입(앞/뒤 구분자 자동). 없으면 끝.
        const pos = savedChunkCaretRef.current ?? cur.length;
        savedChunkCaretRef.current = null;
        ed.insertChunkAtCaret(token, pos);
      } else {
        // fallback (에디터 ref 없음): 끝에 삽입 + 앞 구분자 정리.
        const base = cur.replace(/[ \t]+$/, '');
        const sep = base.trim() === '' ? '' : base.endsWith(',') ? ' ' : ', ';
        onChangeRef.current(base + sep + token);
      }
    };

    // chunk 라이브러리에서 chunk 삭제 시(+ 이 칸이 처음 뜰 때) 죽은 토큰 자동 정리.
    // 토큰은 PromptEditTextArea에서만 삽입되므로, 보이는 칸은 즉시 / 다른 칸·프로젝트는
    // 열릴 때 정리된다. (세션 순회·migrate 불필요, chunk 로드 타이밍 문제 회피)
    useEffect(() => {
      const onChunkChange = () => {
        const cur = valueRef.current || '';
        if (cur.indexOf('⟦c:') === -1) return;
        const stripped = stripDeadChunkTokens(cur);
        if (stripped !== cur) {
          onChangeRef.current(stripped); // 죽은 토큰 제거 → value 변경 → 재렌더
        } else {
          editorRef.current?.refreshHighlight(); // 살아있는 chunk 표시 갱신(로드/수정)
        }
      };
      onChunkChange(); // 마운트 시 1회 (이 칸 열릴 때 lazy 정리)
      promptChunkService.addEventListener('changed', onChunkChange);
      promptChunkService.addEventListener('loaded', onChunkChange); // 비동기 로드 완료 시
      return () => {
        promptChunkService.removeEventListener('changed', onChunkChange);
        promptChunkService.removeEventListener('loaded', onChunkChange);
      };
    }, []);

    // 찾기 검색어 변경 시 하이라이트 갱신 (searchEnabled 칸만). deps 배열이 렌더 중
    // 평가되며 appState.promptSearchQuery를 읽어 observer가 변경을 추적 → 재렌더 → refresh.
    useEffect(() => {
      if (searchEnabled) editorRef.current?.refreshHighlight();
    }, [searchEnabled, appState.promptSearchQuery]);

    // 모바일도 데스크탑 엔진(EmulatedEditTextArea, contentEditable) 사용 — chunk 알약
    // 원자화/커서/2단삭제 위해. 본인 결정(완전 교체, 2026-05-31). NativeEditTextArea는
    // 롤백용 보존. iOS 입력 안정성(한글 IME/소프트키보드 blur/focus)은 L3 최우선 검증.
    const useNativeEditor = false; // iOS 회귀 시 true로 즉시 롤백
    const EditTextAreaImpl =
      useNativeEditor && isMobile ? NativeEditTextArea : EmulatedEditTextArea;

    const prefixSep = ', ';
    const fullPrefix = lockedPrefix ? lockedPrefix + prefixSep : '';
    const displayValue = lockedPrefix ? fullPrefix + value : value;
    const lockedPrefixRef = useLatest(fullPrefix);

    const closeAutoComplete = () => {
      setTags([]);
      setSelectedTag(0);
      editorRef.current!.onCloseAutoComplete();
      setId((id) => id + 1);
    };

    const onUpArrow = () => {
      if (tagsRef.current.length === 0) return;
      setSelectedTag(
        (selectedTagRef.current - 1 + tagsRef.current.length) %
          tagsRef.current.length,
      );
    };
    const onDownArrow = () => {
      if (tagsRef.current.length === 0) return;
      setSelectedTag((selectedTagRef.current + 1) % tagsRef.current.length);
    };
    const onEsc = () => {
      closeAutoComplete();
    };
    const onUpdated = (text: string) => {
      const fp = lockedPrefixRef.current;
      if (fp) {
        if (text.startsWith(fp)) {
          onChange(text.slice(fp.length));
        } else {
          onChange(value);
        }
      } else {
        onChange(text);
      }
    };
    const highlight = (
      text: string,
      word: string,
      updateAutoComplete: boolean,
    ) => {
      if (updateAutoComplete) {
        if (word === '') {
          closeAutoComplete();
        } else {
          const action = word.startsWith('<')
            ? backend.searchPieces.bind(backend)
            : backend.searchTags.bind(backend);
          cntRef.current++;
          const myId = cntRef.current;
          action(trimByBraces(word)).then(async (tags: any[]) => {
            if (myId !== cntRef.current) return;
            if (tags.length > 0) {
              const [x, y] = await editorRef.current!.getCaretCoords();
              setClientX(x);
              setClientY(y);
              setSelectedTag(0);
              setCurWord(word);
              setTags(tags);
              editorRef.current!.onOpenAutoComplete();
            } else {
              closeAutoComplete();
            }
          });
        }
      }
      // 찾기(검색) — searchEnabled 칸(상위/하위/네거티브)에서만 검색어로 태그/알약 강조.
      const sq = searchEnabled ? appState.promptSearchQuery : '';
      const fp = lockedPrefixRef.current;
      if (fp && text.startsWith(fp)) {
        const bgClass = lockedBgClass || 'bg-sky-500/20 dark:bg-sky-500/30';
        const prefixHtml = `<span class="${bgClass} rounded px-0.5" style="-webkit-text-stroke:0.4px currentColor;text-shadow:0 0 2px currentColor">${escapeHtml(fp.slice(0, -prefixSep.length))}</span>${escapeHtml(prefixSep)}`;
        const rest = text.slice(fp.length);
        return prefixHtml + highlightPrompt(curSession!, rest, lineHighlight ?? false, sq);
      }
      return highlightPrompt(curSession!, text, lineHighlight ?? false, sq);
    };
    const onEnter = () => {
      if (tagsRef.current.length === 0) return;
      const tag = tagsRef.current[selectedTagRef.current];
      const tagWord =
        tag.redirect.trim() !== 'null' ? tag.redirect.trim() : tag.word;
      const newWord = replaceMiddleWord(curWordRef.current, tagWord);
      editorRef.current!.setCurWord(newWord);
      closeAutoComplete();
    };

    const onSelectTag = (idx: number) => {
      if (tagsRef.current.length === 0) return;
      const tag = tagsRef.current[idx];
      const tagWord =
        tag.redirect.trim() !== 'null' ? tag.redirect.trim() : tag.word;
      const newWord = replaceMiddleWord(curWordRef.current, tagWord);
      editorRef.current!.setCurWord(newWord);
      closeAutoComplete();
    };

    const onFoucs = () => {
      // 모바일: 탭 → 자동 확대. 확대 전환은 에디터를 remount시켜 iOS 키보드가 내려가므로,
      // flushSync로 동기 렌더 후 *같은 탭 제스처 안에서* 새 에디터에 즉시 재포커스 → 키보드 유지.
      // (!fullScreen 가드: 이 핸들러는 mount 시점 fullScreen을 캡처 — 첫(false) 에디터만 전환,
      //  전환 후 mount된 새 에디터의 핸들러는 fullScreen=true를 캡처해 재진입 skip.)
      if (isMobile && !fullScreen) {
        flushSync(() => setFullScreen(true));
        editorRef.current?.focusEditor?.();
      }
    };

    const flagRef = useRef(false);
    const handleClick = (event: any) => {
      flagRef.current = true;
    };

    useEffect(() => {
      const handleWindowClick = () => {
        if (flagRef.current) {
          flagRef.current = false;
          return;
        }
        if (isMobile) {
          setFullScreen(false);
        }
      };

      window.addEventListener('click', handleWindowClick);
      return () => {
        window.removeEventListener('click', handleWindowClick);
      };
    }, []);

    // 모바일 확대 시: visualViewport(키보드 뺀 가시영역)를 추적해 확대 박스를 그 안에 맞춤.
    // 키보드가 오르내리며 resize/scroll 발화 → 박스 top/height를 재계산.
    useEffect(() => {
      const vv = window.visualViewport;
      if (!isMobile || !fullScreen || !vv) {
        setVvRect(null);
        return;
      }
      const update = () => setVvRect({ top: vv.offsetTop, height: vv.height });
      update();
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
      return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      };
    }, [isMobile, fullScreen]);

    let bgColor = whiteBg
      ? 'bg-gray-100 dark:bg-slate-700'
      : 'bg-gray-200 dark:bg-slate-700';
    if (fullScreen) bgColor = 'bg-white dark:bg-slate-600 shadow-lg';

    const splitMode = fullScreen && tags.length > 0;
    // +chunk / 확대(fullScreen일 땐 닫기 X) 버튼. headerLabel이면 라벨 줄(헤더)에서, 아니면
    // 입력창 위 absolute에서 렌더. fullScreen 오버레이에선 항상 absolute(닫기 X).
    const buttonsRow = (
      <>
        {chunkInsert && !disabled && (
          <button
            onMouseDown={(e) => {
              // 포커스(커서) 잃기 직전에 현재 caret 저장 — chunk를 그 위치에 삽입.
              e.preventDefault();
              savedChunkCaretRef.current = editorRef.current?.getCaret?.() ?? null;
            }}
            onClick={() => setChunkSheetOpen(true)}
            className="text-gray-500 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300 opacity-50 text-xs font-bold"
            title={chunkLabel ? `${chunkLabel}에 chunk 삽입` : 'chunk 삽입'}
          >
            +chunk
          </button>
        )}
        <button
          onClick={() => {
            // 헤더(라벨 줄)의 버튼은 textarea 밖이라 handleClick(flagRef 세팅)을 안 타서,
            // window click 핸들러가 모바일에서 fullScreen을 즉시 닫아버림(확대 안 먹힘) →
            // flagRef를 직접 세팅해 그 close를 가드. (absolute 위치에선 handleClick이 처리)
            flagRef.current = true;
            if (!disabled) setFullScreen(!fullScreen);
          }}
          className="text-gray-500 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300 opacity-50"
        >
          {!fullScreen ? <FaExpand></FaExpand> : <FaTimes></FaTimes>}
        </button>
      </>
    );
    const textareaInner = (
      <>
        {(fullScreen || !headerLabel) && (
          <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5 mr-1 mt-1">
            {buttonsRow}
          </div>
        )}
        {chunkSheetOpen && (
          <ChunkInsertSheet
            chunkLabel={chunkLabel}
            onPick={(id) => {
              insertChunkToken(makeChunkToken(id));
              setChunkSheetOpen(false);
            }}
            onClose={() => setChunkSheetOpen(false)}
          />
        )}
        <EditTextAreaImpl
          ref={editorRef}
          value={displayValue}
          disabled={disabled}
          lockedPrefixLength={fullPrefix.length || undefined}
          highlight={highlight}
          onUpdated={onUpdated}
          history={historyRef.current}
          redo={redoRef.current}
          onUpArrow={onUpArrow}
          onDownArrow={onDownArrow}
          onEnter={onEnter}
          onEsc={onEsc}
          closeAutoComplete={closeAutoComplete}
          onFocus={onFoucs}
        />
        {isMobile && fullScreen && (
          <div className="absolute right-0 bottom-0 z-10 p-1 active:brightness-90">
            <FaUndo
              size={20}
              className="opacity-50 mr-1 mb-1"
              onClick={() => {
                editorRef.current!.undo();
              }}
            />
          </div>
        )}
      </>
    );

    if (fullScreen) {
      return (
        <>
          <div
            className="prompt-full-container"
            // 모바일: CSS 고정 위치(top 20vh/24rem) 대신 키보드 위 가시영역에 맞춤
            // (자동완성 목록 하단이 키보드에 안 가리게). 데스크탑은 CSS 유지.
            style={
              isMobile && vvRect
                ? {
                    top: vvRect.top + 6,
                    left: '3vw',
                    width: '94vw',
                    height: vvRect.height - 12,
                    maxHeight: 'none',
                  }
                : undefined
            }
          >
            <div
              ref={innerRef}
              onClick={handleClick}
              spellCheck={false}
              onDragStart={(event) => event.preventDefault()}
              className={
                bgColor +
                ' p-2 overflow-hidden rounded-lg relative ' +
                (splitMode ? 'prompt-half' : 'w-full h-full')
              }
            >
              {textareaInner}
            </div>
            {splitMode && (
              <div className="prompt-half">
                <PromptAutoComplete
                  key={id}
                  inline
                  curWord={curWord}
                  tags={tags}
                  clientX={clientX}
                  clientY={clientY}
                  selectedTag={selectedTag}
                  onSelectTag={onSelectTag}
                />
              </div>
            )}
          </div>
          <div
            className="fixed bg-black opacity-15 w-screen h-screen top-0 left-0 z-20"
            onClick={() => {
              setFullScreen(false);
            }}
          ></div>
        </>
      );
    }

    // textarea 컨테이너. headerFull이면 헤더 아래 남은 높이를 채우게 flex-1, 아니면 기존 h-full.
    const textareaDiv = (
      <div
        ref={setFieldBoxRef}
        onClick={handleClick}
        spellCheck={false}
        onDragStart={(event) => event.preventDefault()}
        className={
          bgColor +
          (headerLabel && headerFull
            ? ' overflow-hidden flex-1 min-h-0 relative rounded-md'
            : ' overflow-hidden h-full relative rounded-md')
        }
      >
        {textareaInner}
      </div>
    );
    return (
      <>
        {headerLabel != null ? (
          // 라벨 줄(헤더)에 라벨 + 버튼 — 입력창 위 absolute 버튼 제거(긴 프롬프트 스크롤 겹침 해소).
          <div className={'flex flex-col' + (headerFull && !headerCollapsed ? ' h-full min-h-0' : '')}>
            <div className="flex items-center justify-between gap-2 pt-2 pb-1 gray-label flex-none">
              <button
                type="button"
                className={'truncate min-w-0 flex items-center text-left' + (onHeaderToggle ? ' cursor-pointer' : '')}
                onClick={onHeaderToggle}
              >
                {onHeaderToggle && (
                  <span className="inline-block mr-1 text-faint flex-none">
                    {headerCollapsed ? <FaChevronRight size={9} /> : <FaChevronDown size={9} />}
                  </span>
                )}
                <span className="truncate">{headerLabel}</span>
                {headerCollapsed && headerBadge && (
                  <span className="ml-1.5 text-xs text-sky-500 dark:text-sky-400 flex-none">
                    {headerBadge}
                  </span>
                )}
              </button>
              {!headerCollapsed && (
                <div className="flex items-center gap-1.5 flex-none">{buttonsRow}</div>
              )}
            </div>
            {!headerCollapsed && textareaDiv}
          </div>
        ) : (
          textareaDiv
        )}
        {!headerCollapsed && (
          <PromptAutoComplete
            key={id}
            curWord={curWord}
            tags={tags}
            clientX={clientX}
            clientY={clientY}
            selectedTag={selectedTag}
            onSelectTag={onSelectTag}
            fieldBoxRef={fieldBoxRef}
          />
        )}
      </>
    );
  },
);

export default PromptEditTextArea;
