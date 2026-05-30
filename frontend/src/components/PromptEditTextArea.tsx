import * as Hangul from 'hangul-js';
import {
  createRef,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import Denque from 'denque';
import {
  FaBook,
  FaBox,
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
import { highlightPrompt, makeChunkToken } from '../models/PromptService';
import { WordTag, calcGapMatch } from '../models/Tags';
import { appState } from '../models/AppService';
import ModalOverlay from './ModalOverlay';
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
      for (let i = 0; i < pairs.length; i++) {
        const [container, offset] = pairs[i];
        if (currentNode === container) {
          if (container.nodeType === 3) {
            res[i] += offset;
          } else if ((container as any).tagName !== 'BR') {
            for (let j = 0; j < offset; j++) {
              const child = container.childNodes[j];
              res[i] += (child as any).textContent.length;
              if ((child as any).tagName === 'BR') res[i]++;
            }
          }
          done[i] = true;
        } else {
          if (!done[i]) {
            if (currentNode.nodeType === 3) {
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
        if (currentNode.nodeType === 3) {
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

  async handleInput(
    inputChar: string,
    collapsed: boolean,
    pos: number[] | undefined = undefined,
  ) {
    this.pushHistory();
    const koreanRegex = /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/g;
    // 프리셋 prefix 보호: 삽입/삭제 지점이 prefix 안이면 경계로 당김.
    const [start, end] = this.clampToLock(
      ...(pos ? pos : this.getCaretPosition()) as [number, number],
    );
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
        this.updateCurText(
          this.curText.substring(0, start) +
            inputChar +
            this.curText.substring(start),
        );
        newPos++;
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
      this.clipboard.focus();
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
      this.updateCurText(
        this.curText.substring(0, cursor) + text + this.curText.substring(end),
      );
      this.updateDOM(this.curText, cursor + text.length, false);
      await this.setCaretPosition([cursor + text.length, cursor + text.length]);
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
}: {
  tags: WordTag[];
  curWord: string;
  clientX: number;
  clientY: number;
  selectedTag: number;
  onSelectTag: (idx: number) => void;
  inline?: boolean;
}) => {
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
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
    setPosY(clientY + 22);
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

  const popoverTop = isMobile ? Math.max(8, clientY - 222) : posY;
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
        width: '90vw',
        maxWidth: '400px',
        height: '200px',
        left: isMobile ? '5vw' : posX,
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
  onCloseAutoComplete: () => void;
  onOpenAutoComplete: () => void;
  setCurWord: (word: string) => void;
  getCaretCoords(): Promise<number[]>;
  undo(): void;
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
      }: EditTextAreaProps,
      ref: any,
    ) => {
      const editorRef = useRef<any>(null);
      const containerRef = useRef<any>(null);
      const clipboardRef = useRef<any>(null);
      const editorModelRef = useRef<any>(null);

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
        const handleClickLock = () => editor.enforceCaretLock();
        editorRef.current.addEventListener('click', handleClickLock);
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
        };
      }, []);

      useImperativeHandle(ref, () => ({
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
          <div ref={containerRef} className="overflow-auto h-full">
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
  }: {
    onPick: (id: string) => void;
    onClose: () => void;
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
      <ModalOverlay isOpen={true} onClose={onClose} title="chunk 삽입" width="max-w-lg">
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
  }: PromptEditTextAreaProps) => {
    const { curSession } = appState;
    const editorRef = useRef<EditTextAreaRef | null>(null);
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

    // chunk 삽입 (단계 2 — 현재 값 끝에 토큰 추가). caret 위치 정밀 삽입은 단계 3.
    const insertChunkToken = (token: string) => {
      const cur = valueRef.current || '';
      const sep = cur.trim() === '' ? '' : cur.trim().endsWith(',') ? ' ' : ', ';
      onChangeRef.current(cur + sep + token);
    };
    const EditTextAreaImpl = isMobile
      ? NativeEditTextArea
      : EmulatedEditTextArea;

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
      const fp = lockedPrefixRef.current;
      if (fp && text.startsWith(fp)) {
        const bgClass = lockedBgClass || 'bg-sky-500/20 dark:bg-sky-500/30';
        const prefixHtml = `<span class="${bgClass} rounded px-0.5" style="-webkit-text-stroke:0.4px currentColor;text-shadow:0 0 2px currentColor">${escapeHtml(fp.slice(0, -prefixSep.length))}</span>${escapeHtml(prefixSep)}`;
        const rest = text.slice(fp.length);
        return prefixHtml + highlightPrompt(curSession!, rest, lineHighlight ?? false);
      }
      return highlightPrompt(curSession!, text, lineHighlight ?? false);
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
      if (isMobile) {
        setFullScreen(true);
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

    let bgColor = whiteBg
      ? 'bg-gray-100 dark:bg-slate-700'
      : 'bg-gray-200 dark:bg-slate-700';
    if (fullScreen) bgColor = 'bg-white dark:bg-slate-600 shadow-lg';

    const splitMode = fullScreen && tags.length > 0;
    const textareaInner = (
      <>
        <div className="absolute right-0 top-0 z-10 flex items-center gap-1.5 mr-1 mt-1">
          {chunkInsert && !disabled && (
            <button
              onClick={() => setChunkSheetOpen(true)}
              className="text-gray-500 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300 opacity-50 text-xs font-bold"
              title="chunk 삽입"
            >
              +chunk
            </button>
          )}
          <button
            onClick={() => {
              if (!disabled) setFullScreen(!fullScreen);
            }}
            className="text-gray-500 hover:text-gray-600 dark:text-slate-400 dark:hover:text-slate-300 opacity-50"
          >
            {!fullScreen ? <FaExpand></FaExpand> : <FaTimes></FaTimes>}
          </button>
        </div>
        {chunkSheetOpen && (
          <ChunkInsertSheet
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
          <div className="prompt-full-container">
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

    return (
      <>
        <div
          ref={innerRef}
          onClick={handleClick}
          spellCheck={false}
          onDragStart={(event) => event.preventDefault()}
          className={bgColor + ' overflow-hidden h-full relative rounded-md'}
        >
          {textareaInner}
        </div>
        <PromptAutoComplete
          key={id}
          curWord={curWord}
          tags={tags}
          clientX={clientX}
          clientY={clientY}
          selectedTag={selectedTag}
          onSelectTag={onSelectTag}
        />
      </>
    );
  },
);

export default PromptEditTextArea;
