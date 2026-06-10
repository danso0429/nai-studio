import { observable, action } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { DebouncedJsonStore } from './DebouncedJsonStore';

const PROMPT_CHUNKS_FILE = 'prompt_chunks.json';

// chunk = 이름 붙인 순수 태그 묶음 (NovelAI prompt chunk). 조각(<lib.piece>)과 별개 —
// 펼침/랜덤 없이 content가 그대로 프롬프트에 들어감. 전역 저장(프로젝트 무관).
export interface IPromptChunk {
  id: string;
  name: string;
  content: string; // 태그 문자열 (그대로 삽입)
  category: string | null; // 폴더 id (null = 미분류)
  color: string; // hex, 기본 연회색. 알약 테두리/배경.
  createdAt: number;
  updatedAt: number;
}

export interface IPromptChunkFolder {
  id: string;
  name: string;
  color: string;
}

export interface IPromptChunkStore {
  version: 1;
  chunks: IPromptChunk[];
  folders: IPromptChunkFolder[];
}

export const DEFAULT_CHUNK_COLOR = '#d4d4d8'; // 연회색 (zinc-300)

export class PromptChunkService extends DebouncedJsonStore {
  @observable accessor chunks: IPromptChunk[] = [];
  @observable accessor folders: IPromptChunkFolder[] = [];

  protected getFileName(): string {
    return PROMPT_CHUNKS_FILE;
  }

  protected saveErrorLabel(): string {
    return 'prompt chunks';
  }

  protected buildStore(): IPromptChunkStore {
    return { version: 1, chunks: this.chunks, folders: this.folders };
  }

  protected applyParsed(json: any): void {
    const j = json as IPromptChunkStore;
    this.chunks = Array.isArray(j?.chunks)
      ? j.chunks.filter(
          (c) =>
            c &&
            typeof c.id === 'string' &&
            typeof c.name === 'string' &&
            typeof c.content === 'string',
        )
      : [];
    this.folders = Array.isArray(j?.folders)
      ? j.folders.filter(
          (f) => f && typeof f.id === 'string' && typeof f.name === 'string',
        )
      : [];
  }

  protected resetState(): void {
    this.chunks = [];
    this.folders = [];
  }

  // ─── chunk ───
  list(): IPromptChunk[] {
    return this.chunks.slice();
  }

  get(id: string): IPromptChunk | undefined {
    return this.chunks.find((c) => c.id === id);
  }

  getByName(name: string): IPromptChunk | undefined {
    return this.chunks.find((c) => c.name === name);
  }

  private resolveNameCollision(name: string, ignoreId?: string): string {
    const conflict = (n: string) =>
      this.chunks.some((c) => c.name === n && c.id !== ignoreId);
    if (!conflict(name)) return name;
    let i = 1;
    while (conflict(`${name} (${i})`)) i++;
    return `${name} (${i})`;
  }

  @action
  add(
    name: string,
    content: string,
    category: string | null = null,
    color: string = DEFAULT_CHUNK_COLOR,
  ): IPromptChunk {
    name = name.trim();
    if (!name) throw new Error('이름을 입력해 주세요');
    const entry: IPromptChunk = {
      id: uuidv4(),
      name: this.resolveNameCollision(name),
      content,
      category,
      color: color || DEFAULT_CHUNK_COLOR,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.chunks = [...this.chunks, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  update(
    id: string,
    fields: { name?: string; content?: string; category?: string | null; color?: string },
  ): void {
    const entry = this.get(id);
    if (!entry) throw new Error('chunk를 찾을 수 없습니다');
    if (fields.name !== undefined) {
      const nm = fields.name.trim();
      if (!nm) throw new Error('이름을 입력해 주세요');
      entry.name = this.resolveNameCollision(nm, id);
    }
    if (fields.content !== undefined) entry.content = fields.content;
    if (fields.category !== undefined) entry.category = fields.category;
    if (fields.color !== undefined) entry.color = fields.color || DEFAULT_CHUNK_COLOR;
    entry.updatedAt = Date.now();
    this.chunks = [...this.chunks];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  @action
  remove(id: string): void {
    if (!this.get(id)) return;
    this.chunks = this.chunks.filter((c) => c.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // ─── 폴더 ───
  listFolders(): IPromptChunkFolder[] {
    return this.folders.slice();
  }

  getFolder(id: string): IPromptChunkFolder | undefined {
    return this.folders.find((f) => f.id === id);
  }

  @action
  addFolder(name: string, color: string = DEFAULT_CHUNK_COLOR): IPromptChunkFolder {
    name = name.trim();
    if (!name) throw new Error('이름을 입력해 주세요');
    const entry: IPromptChunkFolder = {
      id: uuidv4(),
      name,
      color: color || DEFAULT_CHUNK_COLOR,
    };
    this.folders = [...this.folders, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
    return entry;
  }

  @action
  updateFolder(id: string, fields: { name?: string; color?: string }): void {
    const entry = this.getFolder(id);
    if (!entry) throw new Error('폴더를 찾을 수 없습니다');
    if (fields.name !== undefined) {
      const nm = fields.name.trim();
      if (!nm) throw new Error('이름을 입력해 주세요');
      entry.name = nm;
    }
    if (fields.color !== undefined) entry.color = fields.color || DEFAULT_CHUNK_COLOR;
    this.folders = [...this.folders];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // 폴더 삭제 시 그 안 chunk는 미분류(category=null)로 이동 (chunk 보존).
  @action
  removeFolder(id: string): void {
    if (!this.getFolder(id)) return;
    this.folders = this.folders.filter((f) => f.id !== id);
    for (const c of this.chunks) {
      if (c.category === id) c.category = null;
    }
    this.chunks = [...this.chunks];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }

  // 전체 삭제 (chunk + 폴더).
  @action
  clearAll(): void {
    this.chunks = [];
    this.folders = [];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed', {}));
  }
}
