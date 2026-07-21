import { action, observable, runInAction } from 'mobx';
import { v4 as uuidv4 } from 'uuid';
import { DebouncedJsonStore } from './DebouncedJsonStore';
import {
  backend,
  globalCharacterPresetService,
  globalPresetService,
  imageService,
  sessionService,
  workFlowService,
} from '.';
import { dataUriToBase64 } from './ImageService';
import {
  CharacterPreset,
  ICharacterPreset,
  IReferenceItem,
  IScene,
  IVibeItem,
  ReferenceItem,
  Session,
  VibeItem,
} from './types';

const FILE = 'project_templates.json';
const IMAGE_DIR = 'project_template_images';
const DEFAULT_WORKFLOW_TYPE = 'SDImageGenEasy';

export interface IProjectTemplateEntry {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  preset: any | null;
  characterPresets: ICharacterPreset[];
  vibes: IVibeItem[];
  characterReferences: IReferenceItem[];
  scenes: IScene[];
  folderLocal?: boolean;
  badgeColor?: string;
}

interface IProjectTemplateStore {
  version: 1;
  templates: IProjectTemplateEntry[];
}

export interface ITemplateInstantiation {
  presetInstance?: any;
  presets: { type: string; name: string }[];
  characterPresetNames: string[];
  vibePaths: string[];
  referencePaths: string[];
}

export function blankTemplatePreset(name: string): any {
  return {
    type: DEFAULT_WORKFLOW_TYPE,
    name,
    frontPrompt: '',
    backPrompt: '',
    uc: '',
  };
}

function imageExtension(base64: string): string {
  const clean = base64.includes(',') ? base64.split(',')[1] : base64;
  if (clean.startsWith('UklGR')) return 'webp';
  if (clean.startsWith('/9j/')) return 'jpg';
  return 'png';
}

export class ProjectTemplateService extends DebouncedJsonStore {
  @observable accessor templates: IProjectTemplateEntry[] = [];

  protected getFileName(): string {
    return FILE;
  }

  protected buildStore(): IProjectTemplateStore {
    return { version: 1, templates: this.templates };
  }

  protected applyParsed(raw: any): void {
    this.templates = Array.isArray(raw?.templates)
      ? raw.templates
          .filter(
            (entry: any) =>
              entry && typeof entry.id === 'string' && typeof entry.name === 'string',
          )
          .map((entry: any) => ({
            ...entry,
            preset:
              entry.preset ??
              (Array.isArray(entry.presets) ? entry.presets[0] ?? null : null),
            characterPresets: Array.isArray(entry.characterPresets)
              ? entry.characterPresets
              : [],
            vibes: Array.isArray(entry.vibes) ? entry.vibes : [],
            characterReferences: Array.isArray(entry.characterReferences)
              ? entry.characterReferences
              : [],
            scenes: Array.isArray(entry.scenes) ? entry.scenes : [],
            folderLocal: entry.folderLocal === true || undefined,
            badgeColor:
              typeof entry.badgeColor === 'string' ? entry.badgeColor : undefined,
          }))
      : [];
  }

  protected resetState(): void {
    this.templates = [];
  }

  list(): IProjectTemplateEntry[] {
    return this.templates.slice();
  }

  listGlobal(): IProjectTemplateEntry[] {
    return this.templates.filter((entry) => !entry.folderLocal);
  }

  get(id: string): IProjectTemplateEntry | undefined {
    return this.templates.find((entry) => entry.id === id);
  }

  getByName(name: string): IProjectTemplateEntry | undefined {
    return this.templates.find((entry) => entry.name === name);
  }

  isEmpty(entry: IProjectTemplateEntry): boolean {
    return (
      !entry.preset &&
      entry.characterPresets.length === 0 &&
      entry.vibes.length === 0 &&
      entry.characterReferences.length === 0 &&
      entry.scenes.length === 0
    );
  }

  private uniqueName(name: string, ignoredId?: string): string {
    const base = name.trim() || '새 템플릿';
    const used = (candidate: string) =>
      this.templates.some(
        (entry) => entry.id !== ignoredId && entry.name === candidate,
      );
    if (!used(base)) return base;
    let index = 2;
    while (used(`${base} (${index})`)) index += 1;
    return `${base} (${index})`;
  }

  private touch(entry: IProjectTemplateEntry): void {
    entry.updatedAt = Date.now();
    this.templates = [...this.templates];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
  }

  @action
  create(name: string, folderLocal = false): IProjectTemplateEntry {
    const now = Date.now();
    const entry: IProjectTemplateEntry = {
      id: uuidv4(),
      name: this.uniqueName(name),
      createdAt: now,
      updatedAt: now,
      preset: null,
      characterPresets: [],
      vibes: [],
      characterReferences: [],
      scenes: [],
      ...(folderLocal ? { folderLocal: true } : {}),
    };
    this.templates = [...this.templates, entry];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
    return entry;
  }

  @action
  rename(id: string, name: string): void {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('이름을 입력해 주세요.');
    if (this.getByName(trimmed)?.id !== id && this.getByName(trimmed)) {
      throw new Error('같은 이름의 템플릿이 있습니다.');
    }
    entry.name = trimmed;
    this.touch(entry);
  }

  @action
  setBadgeColor(id: string, color?: string): void {
    const entry = this.get(id);
    if (!entry) return;
    entry.badgeColor = color || undefined;
    this.templates = [...this.templates];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
  }

  getImagePath(token: string): string {
    return `${IMAGE_DIR}/${token.split('/').pop()!}`;
  }

  async fetchImageData(token: string): Promise<string | null> {
    if (!token) return null;
    try {
      const path = this.getImagePath(token);
      return (await backend.existFile(path)) ? await backend.readDataFile(path) : null;
    } catch {
      return null;
    }
  }

  async storeImage(base64OrDataUri: string): Promise<string> {
    const base64 = base64OrDataUri.includes(',')
      ? base64OrDataUri.split(',')[1]
      : base64OrDataUri;
    const token = `${uuidv4()}.${imageExtension(base64)}`;
    await backend.writeDataFile(`${IMAGE_DIR}/${token}`, base64);
    return token;
  }

  private async copyImage(token: string): Promise<string> {
    const data = await this.fetchImageData(token);
    return data ? this.storeImage(data) : token;
  }

  private imageTokens(entry: IProjectTemplateEntry): string[] {
    const tokens: string[] = [];
    if (entry.preset?.profile) tokens.push(entry.preset.profile);
    for (const character of entry.characterPresets) {
      for (const vibe of character.vibes || []) if (vibe.path) tokens.push(vibe.path);
      for (const ref of character.characterReferences || []) if (ref.path) tokens.push(ref.path);
      if (character.representativeImage) tokens.push(character.representativeImage);
    }
    for (const vibe of entry.vibes) if (vibe.path) tokens.push(vibe.path);
    for (const ref of entry.characterReferences) if (ref.path) tokens.push(ref.path);
    return [...new Set(tokens)];
  }

  private async cloneContent(source: IProjectTemplateEntry) {
    const clone = JSON.parse(JSON.stringify(source)) as IProjectTemplateEntry;
    if (clone.preset?.profile) clone.preset.profile = await this.copyImage(clone.preset.profile);
    for (const character of clone.characterPresets) {
      for (const vibe of character.vibes || []) vibe.path = await this.copyImage(vibe.path);
      for (const ref of character.characterReferences || []) ref.path = await this.copyImage(ref.path);
      if (character.representativeImage) {
        character.representativeImage = await this.copyImage(character.representativeImage);
      }
    }
    for (const vibe of clone.vibes) vibe.path = await this.copyImage(vibe.path);
    for (const ref of clone.characterReferences) ref.path = await this.copyImage(ref.path);
    return clone;
  }

  @action
  async duplicate(id: string): Promise<IProjectTemplateEntry> {
    const source = this.get(id);
    if (!source) throw new Error('템플릿을 찾을 수 없습니다.');
    const clone = await this.cloneContent(source);
    clone.id = uuidv4();
    clone.name = this.uniqueName(source.name);
    clone.createdAt = Date.now();
    clone.updatedAt = clone.createdAt;
    this.templates = [...this.templates, clone];
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
    return clone;
  }

  @action
  async overwriteFromTemplate(targetId: string, sourceId: string): Promise<void> {
    const target = this.get(targetId);
    const source = this.get(sourceId);
    if (!target || !source) throw new Error('템플릿을 찾을 수 없습니다.');
    const previousTokens = this.imageTokens(target);
    const clone = await this.cloneContent(source);
    target.preset = clone.preset;
    target.characterPresets = clone.characterPresets;
    target.vibes = clone.vibes;
    target.characterReferences = clone.characterReferences;
    target.scenes = clone.scenes;
    this.touch(target);
    const currentTokens = new Set(this.imageTokens(target));
    for (const token of previousTokens) {
      if (currentTokens.has(token)) continue;
      try {
        await backend.deleteFile(this.getImagePath(token));
      } catch {}
    }
  }

  @action
  async delete(id: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    for (const token of this.imageTokens(entry)) {
      try {
        await backend.deleteFile(this.getImagePath(token));
      } catch {}
    }
    this.templates = this.templates.filter((candidate) => candidate.id !== id);
    this.scheduleSave();
    this.dispatchEvent(new CustomEvent('changed'));
    const { templateService } = await import('.');
    await templateService.ensureLoaded();
    templateService.clearFolderTemplatesByTemplateId(id);
    templateService.clearApplicationsByTemplateId(id);
  }

  @action
  patchPreset(id: string, patch: Record<string, any>): void {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    entry.preset = { ...(entry.preset ?? blankTemplatePreset(entry.name)), ...patch };
    this.touch(entry);
  }

  async importGlobalPreset(id: string, globalId: string): Promise<void> {
    const source = globalPresetService.get(globalId);
    if (!source) throw new Error('글로벌 프리셋을 찾을 수 없습니다.');
    const json = JSON.parse(JSON.stringify(source.preset));
    json.type = source.workflowType;
    delete json.name;
    delete json.profile;
    this.patchPreset(id, json);
  }

  importSessionPreset(id: string, preset: any): void {
    const json = preset.toJSON();
    delete json.name;
    delete json.profile;
    this.patchPreset(id, json);
  }

  private uniqueCharacterName(entry: IProjectTemplateEntry, name: string): string {
    const used = new Set(entry.characterPresets.map((preset) => preset.name));
    if (!used.has(name)) return name;
    let index = 2;
    while (used.has(`${name} (${index})`)) index += 1;
    return `${name} (${index})`;
  }

  async importGlobalCharacterPreset(id: string, globalId: string): Promise<void> {
    const entry = this.get(id);
    const source = globalCharacterPresetService.get(globalId);
    if (!entry || !source) throw new Error('캐릭터 프리셋을 찾을 수 없습니다.');
    const json: ICharacterPreset = JSON.parse(JSON.stringify(source.preset));
    for (const vibe of json.vibes || []) {
      const data = await globalCharacterPresetService.fetchImageData(vibe.path);
      if (data) vibe.path = await this.storeImage(data);
    }
    for (const ref of json.characterReferences || []) {
      const data = await globalCharacterPresetService.fetchImageData(ref.path);
      if (data) ref.path = await this.storeImage(data);
    }
    if (json.representativeImage) {
      const data = await globalCharacterPresetService.fetchImageData(json.representativeImage);
      if (data) json.representativeImage = await this.storeImage(data);
    }
    json.name = this.uniqueCharacterName(entry, source.name);
    entry.characterPresets = [...entry.characterPresets, json];
    this.touch(entry);
  }

  async importSessionCharacterPreset(
    id: string,
    session: Session,
    preset: CharacterPreset,
  ): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    const json = preset.toJSON();
    for (const vibe of json.vibes || []) {
      const data = await backend.readDataFile(imageService.getVibeImagePath(session, vibe.path));
      if (data) vibe.path = await this.storeImage(data);
    }
    for (const ref of json.characterReferences || []) {
      const data = await backend.readDataFile(imageService.getReferenceImagePath(session, ref.path));
      if (data) ref.path = await this.storeImage(data);
    }
    if (json.representativeImage) {
      const data = await backend.readDataFile(
        imageService.getVibeImagePath(session, json.representativeImage),
      );
      if (data) json.representativeImage = await this.storeImage(data);
    }
    json.name = this.uniqueCharacterName(entry, json.name);
    entry.characterPresets = [...entry.characterPresets, json];
    this.touch(entry);
  }

  @action
  putCharacterPreset(id: string, json: ICharacterPreset, index?: number): void {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    const next = [...entry.characterPresets];
    if (index === undefined) {
      json.name = this.uniqueCharacterName(entry, json.name || '이름없음');
      next.push(json);
    } else {
      next[index] = json;
    }
    entry.characterPresets = next;
    this.touch(entry);
  }

  @action
  async removeCharacterPreset(id: string, index: number): Promise<void> {
    const entry = this.get(id);
    if (!entry) return;
    const removed = entry.characterPresets[index];
    if (!removed) return;
    entry.characterPresets = entry.characterPresets.filter((_, current) => current !== index);
    this.touch(entry);
    const retainedTokens = new Set(this.imageTokens(entry));
    const removedTokens = this.imageTokens({
      ...entry,
      preset: null,
      characterPresets: [removed],
      vibes: [],
      characterReferences: [],
      scenes: [],
    });
    for (const token of removedTokens) {
      if (retainedTokens.has(token)) continue;
      try {
        await backend.deleteFile(this.getImagePath(token));
      } catch {}
    }
  }

  async importScenesFromProject(id: string, projectName: string): Promise<number> {
    const entry = this.get(id);
    const session = await sessionService.get(projectName);
    if (!entry || !session) throw new Error('프로젝트를 불러올 수 없습니다.');
    entry.scenes = session.getScenes('scene').map((scene) => {
      const json: any = JSON.parse(JSON.stringify(scene.toJSON()));
      json.imageMap = [];
      json.mains = [];
      json.game = undefined;
      json.round = undefined;
      return json;
    });
    this.touch(entry);
    return entry.scenes.length;
  }

  @action
  removeScene(id: string, index: number): void {
    const entry = this.get(id);
    if (!entry) return;
    entry.scenes = entry.scenes.filter((_, current) => current !== index);
    this.touch(entry);
  }

  async addVibe(id: string, base64: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    entry.vibes = [...entry.vibes, { path: await this.storeImage(base64), info: 1, strength: 0.6 }];
    this.touch(entry);
  }

  async addCharacterReference(id: string, base64: string): Promise<void> {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    entry.characterReferences = [
      ...entry.characterReferences,
      {
        path: await this.storeImage(base64),
        info: 1,
        strength: 0.6,
        fidelity: 1,
        referenceType: 'character',
        enabled: true,
      },
    ];
    this.touch(entry);
  }

  @action
  updateVibe(id: string, index: number, patch: Partial<IVibeItem>): void {
    const entry = this.get(id);
    if (!entry?.vibes[index]) return;
    entry.vibes = entry.vibes.map((item, current) => current === index ? { ...item, ...patch } : item);
    this.touch(entry);
  }

  @action
  updateCharacterReference(
    id: string,
    index: number,
    patch: Partial<IReferenceItem>,
  ): void {
    const entry = this.get(id);
    if (!entry?.characterReferences[index]) return;
    entry.characterReferences = entry.characterReferences.map((item, current) =>
      current === index ? { ...item, ...patch } : item,
    );
    this.touch(entry);
  }

  async instantiateIntoSession(
    session: Session,
    id: string,
    options: { skipCharacterPresets?: boolean } = {},
  ): Promise<ITemplateInstantiation> {
    const entry = this.get(id);
    if (!entry) throw new Error('템플릿을 찾을 수 없습니다.');
    const result: ITemplateInstantiation = {
      presets: [],
      characterPresetNames: [],
      vibePaths: [],
      referencePaths: [],
    };
    if (entry.preset) {
      const json = JSON.parse(JSON.stringify(entry.preset));
      if (json.profile) {
        const data = await this.fetchImageData(json.profile);
        json.profile = data
          ? await imageService.storeVibeImage(session, dataUriToBase64(data))
          : undefined;
      }
      const preset = workFlowService.presetFromJSON(json);
      if (preset) {
        session.addPreset(preset);
        result.presetInstance = preset;
        result.presets.push({ type: preset.type, name: preset.name });
      }
    }
    if (!options.skipCharacterPresets) {
      for (const source of entry.characterPresets) {
        const json: ICharacterPreset = JSON.parse(JSON.stringify(source));
        for (const vibe of json.vibes || []) {
          const data = await this.fetchImageData(vibe.path);
          if (data) vibe.path = await imageService.storeVibeImage(session, dataUriToBase64(data));
        }
        for (const ref of json.characterReferences || []) {
          const data = await this.fetchImageData(ref.path);
          if (data) ref.path = await imageService.storeReferenceImage(session, dataUriToBase64(data));
        }
        const preset = CharacterPreset.fromJSON(json);
        while (session.hasCharacterPreset(preset.name)) preset.name += ' (템플릿)';
        session.addCharacterPreset(preset);
        result.characterPresetNames.push(preset.name);
      }
    }
    const type = entry.preset?.type ?? DEFAULT_WORKFLOW_TYPE;
    if (entry.vibes.length || entry.characterReferences.length) {
      let shared = session.presetShareds.get(type);
      if (!shared) {
        shared = workFlowService.buildShared(type);
        session.presetShareds.set(type, shared);
      }
      const vibes: VibeItem[] = [];
      for (const source of entry.vibes) {
        const data = await this.fetchImageData(source.path);
        const path = data
          ? await imageService.storeVibeImage(session, dataUriToBase64(data))
          : source.path;
        vibes.push(VibeItem.fromJSON({ ...source, path }));
        result.vibePaths.push(path);
      }
      const refs: ReferenceItem[] = [];
      for (const source of entry.characterReferences) {
        const data = await this.fetchImageData(source.path);
        const path = data
          ? await imageService.storeReferenceImage(session, dataUriToBase64(data))
          : source.path;
        refs.push(ReferenceItem.fromJSON({ ...source, path }));
        result.referencePaths.push(path);
      }
      runInAction(() => {
        shared.vibes = [...(shared.vibes || []), ...vibes];
        shared.characterReferences = [
          ...(shared.characterReferences || []),
          ...refs,
        ];
      });
    }
    return result;
  }

  removeRecordedInstances(
    session: Session,
    record: Partial<ITemplateInstantiation>,
    remove: { presets: boolean; characters: boolean; vibes: boolean; references: boolean },
  ): void {
    if (remove.presets) {
      for (const preset of record.presets || []) session.removePreset(preset.type, preset.name);
    }
    if (remove.characters) {
      for (const name of record.characterPresetNames || []) session.removeCharacterPreset(name);
    }
    const vibePaths = new Set(record.vibePaths || []);
    const referencePaths = new Set(record.referencePaths || []);
    for (const shared of session.presetShareds.values()) {
      if (remove.vibes) shared.vibes = (shared.vibes || []).filter((item: any) => !vibePaths.has(item.path));
      if (remove.references) {
        shared.characterReferences = (shared.characterReferences || []).filter(
          (item: any) => !referencePaths.has(item.path),
        );
      }
    }
  }
}
