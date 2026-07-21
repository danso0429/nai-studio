import { observable, runInAction } from 'mobx';
import { DebouncedJsonStore } from './DebouncedJsonStore';
import {
  globalCharacterPresetService,
  projectTemplateService,
  sessionService,
  trashService,
} from '.';
import { getAppState } from './appStateRef';
import { genericSceneFromJSON, Session } from './types';
import {
  BatchCreateItem,
  resolveBatchName,
} from './batchCreatePlan';

export type TemplateProtectArea = 'characterPresets' | 'scenes';

export interface IFolderTemplateEntry {
  templateId: string;
}

export interface ITemplateApplicationRecord {
  inherited: boolean;
  presets: { type: string; name: string }[];
  characterPresetNames: string[];
  vibePaths: string[];
  referencePaths: string[];
  protectAreas?: TemplateProtectArea[];
}

interface ITemplateStore {
  version: 1;
  folderTemplates: Record<string, IFolderTemplateEntry>;
  templateApplications: Record<
    string,
    Record<string, ITemplateApplicationRecord>
  >;
}

export class TemplateService extends DebouncedJsonStore {
  @observable accessor folderTemplates: Record<string, IFolderTemplateEntry> = {};
  @observable accessor templateApplications: Record<
    string,
    Record<string, ITemplateApplicationRecord>
  > = {};

  protected getFileName(): string {
    return 'templates.json';
  }

  protected buildStore(): ITemplateStore {
    return {
      version: 1,
      folderTemplates: this.folderTemplates,
      templateApplications: this.templateApplications,
    };
  }

  protected applyParsed(raw: any): void {
    const folders: Record<string, IFolderTemplateEntry> = {};
    if (raw?.folderTemplates && typeof raw.folderTemplates === 'object') {
      for (const [folder, value] of Object.entries(raw.folderTemplates)) {
        const templateId = (value as any)?.templateId;
        if (folder && typeof templateId === 'string') {
          folders[folder] = { templateId };
        }
      }
    }
    this.folderTemplates = folders;
    this.templateApplications = this.sanitizeApplications(
      raw?.templateApplications,
    );
  }

  protected resetState(): void {
    this.folderTemplates = {};
    this.templateApplications = {};
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded && !this.loadError) await this.load();
  }

  private sanitizeApplications(
    raw: any,
  ): Record<string, Record<string, ITemplateApplicationRecord>> {
    const output: Record<
      string,
      Record<string, ITemplateApplicationRecord>
    > = {};
    if (!raw || typeof raw !== 'object') return output;
    for (const [project, byTemplate] of Object.entries(raw)) {
      if (!project || !byTemplate || typeof byTemplate !== 'object') continue;
      const records: Record<string, ITemplateApplicationRecord> = {};
      for (const [templateId, value] of Object.entries(byTemplate as any)) {
        const record = value as any;
        if (!templateId || !record || typeof record !== 'object') continue;
        const strings = (input: unknown): string[] =>
          Array.isArray(input)
            ? input.filter((item): item is string => typeof item === 'string')
            : [];
        const protectAreas = strings(record.protectAreas).filter(
          (area): area is TemplateProtectArea =>
            area === 'characterPresets' || area === 'scenes',
        );
        records[templateId] = {
          inherited: record.inherited === true,
          presets: Array.isArray(record.presets)
            ? record.presets.filter(
                (item: any) =>
                  item &&
                  typeof item.type === 'string' &&
                  typeof item.name === 'string',
              )
            : [],
          characterPresetNames: strings(record.characterPresetNames),
          vibePaths: strings(record.vibePaths),
          referencePaths: strings(record.referencePaths),
          ...(protectAreas.length ? { protectAreas } : {}),
        };
      }
      if (Object.keys(records).length) output[project] = records;
    }
    return output;
  }

  getFolderTemplate(folder: string): IFolderTemplateEntry | undefined {
    return this.folderTemplates[folder];
  }

  async resolveFolderTemplate(
    folder: string | null,
  ): Promise<(IFolderTemplateEntry & { folder: string }) | undefined> {
    if (!this.loaded) await this.load();
    if (!projectTemplateService.loaded) await projectTemplateService.load();
    let current = folder;
    while (current) {
      const selected = this.folderTemplates[current];
      if (selected && projectTemplateService.get(selected.templateId)) {
        return { ...selected, folder: current };
      }
      const slash = current.lastIndexOf('/');
      current = slash >= 0 ? current.slice(0, slash) : null;
    }
    return undefined;
  }

  setFolderTemplate(folder: string, templateId: string): void {
    if (!projectTemplateService.get(templateId)) {
      throw new Error('템플릿을 찾을 수 없습니다.');
    }
    this.folderTemplates = {
      ...this.folderTemplates,
      [folder]: { templateId },
    };
    this.scheduleSave();
  }

  clearFolderTemplate(folder: string): void {
    if (!this.folderTemplates[folder]) return;
    const next = { ...this.folderTemplates };
    delete next[folder];
    this.folderTemplates = next;
    this.scheduleSave();
  }

  clearFolderTemplatesByTemplateId(templateId: string): void {
    const next = Object.fromEntries(
      Object.entries(this.folderTemplates).filter(
        ([, value]) => value.templateId !== templateId,
      ),
    );
    if (Object.keys(next).length === Object.keys(this.folderTemplates).length) return;
    this.folderTemplates = next;
    this.scheduleSave();
  }

  renameFolder(oldPath: string, newPath: string): void {
    const prefix = oldPath + '/';
    const next: Record<string, IFolderTemplateEntry> = {};
    for (const [folder, value] of Object.entries(this.folderTemplates)) {
      const key =
        folder === oldPath
          ? newPath
          : folder.startsWith(prefix)
            ? newPath + folder.slice(oldPath.length)
            : folder;
      next[key] = value;
    }
    this.folderTemplates = next;
    this.scheduleSave();
  }

  removeFolder(folder: string): void {
    const prefix = folder + '/';
    const next = Object.fromEntries(
      Object.entries(this.folderTemplates).filter(
        ([key]) => key !== folder && !key.startsWith(prefix),
      ),
    );
    this.folderTemplates = next;
    this.scheduleSave();
  }

  getApplication(
    project: string,
    templateId: string,
  ): ITemplateApplicationRecord | undefined {
    return this.templateApplications[project]?.[templateId];
  }

  getInheritedApplication(
    project: string,
  ): (ITemplateApplicationRecord & { templateId: string }) | undefined {
    for (const [templateId, record] of Object.entries(
      this.templateApplications[project] || {},
    )) {
      if (record.inherited) return { ...record, templateId };
    }
    return undefined;
  }

  recordApplication(
    project: string,
    templateId: string,
    record: ITemplateApplicationRecord,
  ): void {
    this.templateApplications = {
      ...this.templateApplications,
      [project]: {
        ...(this.templateApplications[project] || {}),
        [templateId]: record,
      },
    };
    this.scheduleSave();
  }

  breakInheritance(project: string): void {
    const current = this.templateApplications[project];
    if (!current) return;
    this.templateApplications = {
      ...this.templateApplications,
      [project]: Object.fromEntries(
        Object.entries(current).map(([id, record]) => [
          id,
          { ...record, inherited: false },
        ]),
      ),
    };
    this.scheduleSave();
  }

  listInheritedChildren(templateId: string): string[] {
    return Object.entries(this.templateApplications)
      .filter(([, records]) => records[templateId]?.inherited)
      .map(([project]) => project);
  }

  renameProject(oldName: string, newName: string): void {
    const current = this.templateApplications[oldName];
    if (!current) return;
    const next = { ...this.templateApplications, [newName]: current };
    delete next[oldName];
    this.templateApplications = next;
    this.scheduleSave();
  }

  removeProject(name: string): void {
    if (!this.templateApplications[name]) return;
    const next = { ...this.templateApplications };
    delete next[name];
    this.templateApplications = next;
    this.scheduleSave();
  }

  clearApplicationsByTemplateId(templateId: string): void {
    const next: typeof this.templateApplications = {};
    for (const [project, records] of Object.entries(this.templateApplications)) {
      const filtered = { ...records };
      delete filtered[templateId];
      if (Object.keys(filtered).length) next[project] = filtered;
    }
    this.templateApplications = next;
    this.scheduleSave();
  }

  async applyProjectTemplate(
    session: Session,
    templateId: string,
    options: {
      inherited?: boolean;
      protectAreas?: TemplateProtectArea[];
      replaceExisting?: boolean;
    } = {},
  ) {
    const previous = this.getApplication(session.name, templateId);
    const protectedSet = new Set(options.protectAreas || previous?.protectAreas || []);
    if (options.replaceExisting && previous) {
      projectTemplateService.removeRecordedInstances(session, previous, {
        presets: true,
        characters: !protectedSet.has('characterPresets'),
        vibes: true,
        references: true,
      });
    }
    const result = await projectTemplateService.instantiateIntoSession(
      session,
      templateId,
      { skipCharacterPresets: protectedSet.has('characterPresets') },
    );
    this.recordApplication(session.name, templateId, {
      inherited: options.inherited === true,
      presets: result.presets,
      characterPresetNames: result.characterPresetNames,
      vibePaths: result.vibePaths,
      referencePaths: result.referencePaths,
      ...(protectedSet.size ? { protectAreas: [...protectedSet] } : {}),
    });
    return result;
  }

  async createProject(
    name: string,
    folder: string | null,
    templateId?: string | null,
    options?: {
      inherited?: boolean;
      batchAxes?: {
        charPresetId?: string;
        sceneTemplateName?: string;
      };
    },
  ): Promise<Session> {
    await sessionService.add(name);
    if (folder) await sessionService.moveToFolder(name, folder);
    const session = await sessionService.get(name);
    if (!session) throw new Error('프로젝트를 불러올 수 없습니다.');
    const inherited = templateId
      ? undefined
      : await this.resolveFolderTemplate(folder);
    const resolvedTemplateId = templateId || inherited?.templateId;
    if (resolvedTemplateId) {
      const batch = options?.batchAxes;
      const result = await this.applyProjectTemplate(session, resolvedTemplateId, {
        inherited:
          options?.inherited ?? Boolean(inherited && !templateId),
        protectAreas: batch ? ['characterPresets', 'scenes'] : undefined,
      });
      if (result.presetInstance) {
        session.selectedWorkflow = {
          workflowType: result.presetInstance.type,
          presetName: result.presetInstance.name,
        };
      }
      const template = projectTemplateService.get(resolvedTemplateId);
      if (!batch && template?.scenes.length) {
        session.scenes.clear();
        for (const source of template.scenes) {
          const scene = genericSceneFromJSON(JSON.parse(JSON.stringify(source)));
          if (scene) session.addScene(scene);
        }
      }
      if (batch?.sceneTemplateName) {
        const source = await sessionService.get(batch.sceneTemplateName);
        if (!source || sessionService.getHiddenProjectRole(batch.sceneTemplateName) !== 'scene-template') {
          throw new Error(`씬 템플릿을 찾을 수 없습니다: ${batch.sceneTemplateName}`);
        }
        session.scenes.clear();
        for (const sourceScene of source.getScenes('scene')) {
          const scene = genericSceneFromJSON(sourceScene.toJSON());
          if (!scene) continue;
          scene.imageMap = [];
          scene.mains = [];
          session.addScene(scene);
        }
      }
      if (batch?.charPresetId) {
        const character = await globalCharacterPresetService.instantiateIntoSession(
          session,
          batch.charPresetId,
        );
        const workflowType =
          session.selectedWorkflow?.workflowType || 'SDImageGenEasy';
        getAppState().applyCharacterPresetToSession(
          session,
          workflowType,
          character,
          workflowType === 'SDImageGenEasy' ? 'easy' : 'character',
        );
      }
    }
    return session;
  }

  async batchCreateFromTemplate(plan: {
    templateId: string;
    folder: string;
    items: BatchCreateItem[];
    onProgress?: (done: number, total: number, current: string) => void;
    shouldCancel?: () => boolean;
  }): Promise<{
    created: string[];
    failed: { name: string; error: string }[];
    cancelled: boolean;
  }> {
    const created: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const taken = new Set(sessionService.list());
    let cancelled = false;
    let done = 0;
    for (const item of plan.items) {
      if (plan.shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const name = resolveBatchName(item.name, taken);
      plan.onProgress?.(done, plan.items.length, name);
      try {
        const target = item.subfolder
          ? [plan.folder, item.subfolder].filter(Boolean).join('/')
          : plan.folder;
        if (target && !sessionService.folderList.includes(target)) {
          await sessionService.createFolder(target);
        }
        await this.createProject(name, target || null, plan.templateId, {
          inherited: true,
          batchAxes: {
            charPresetId: item.charPresetId,
            sceneTemplateName: item.sceneTemplateName,
          },
        });
        created.push(name);
      } catch (error: any) {
        failed.push({ name, error: error?.message || String(error) });
      }
      done += 1;
      plan.onProgress?.(done, plan.items.length, name);
    }
    return { created, failed, cancelled };
  }

  async pickForCreate(): Promise<string | null | undefined> {
    await projectTemplateService.load();
    const templates = projectTemplateService.listGlobal();
    if (!templates.length) return null;
    const value = await getAppState().pushDialogAsync({
      type: 'select',
      text: '어떤 구성으로 시작할까요?',
      items: [
        { text: '빈 프로젝트', value: '/blank' },
        ...templates.map((template) => ({
          text: `템플릿: ${template.name}`,
          value: template.id,
        })),
      ],
    });
    if (!value) return undefined;
    return value === '/blank' ? null : value;
  }

  listSceneTemplates(): string[] {
    return sessionService.listByRole('scene-template');
  }

  async designateSceneTemplate(name: string): Promise<void> {
    await sessionService.setHiddenProjectRole(name, 'scene-template');
  }

  async createSceneTemplateFrom(session: Session, name: string): Promise<Session> {
    if (!name.trim()) throw new Error('이름을 입력해 주세요.');
    if (sessionService.list().includes(name)) {
      throw new Error('같은 이름의 프로젝트가 있습니다.');
    }
    const json = await sessionService.exportSessionShallow(session);
    await sessionService.importSessionShallow(json, name);
    await this.designateSceneTemplate(name);
    return (await sessionService.get(name))!;
  }

  async createEmptySceneTemplate(name: string): Promise<Session> {
    if (sessionService.list().includes(name)) {
      throw new Error('같은 이름의 프로젝트가 있습니다.');
    }
    await sessionService.add(name);
    await this.designateSceneTemplate(name);
    return (await sessionService.get(name))!;
  }

  async exportSceneTemplateFile(name: string): Promise<string> {
    const session = await sessionService.get(name);
    if (!session || sessionService.getHiddenProjectRole(name) !== 'scene-template') {
      throw new Error('씬 템플릿을 찾을 수 없습니다.');
    }
    return JSON.stringify({
      version: 1,
      type: 'sdstudio-scene-template',
      name,
      session: await sessionService.exportSessionShallow(session),
    });
  }

  async importSceneTemplateFile(text: string): Promise<string> {
    const data = JSON.parse(text);
    if (data?.type !== 'sdstudio-scene-template' || !data.session) {
      throw new Error('올바른 씬 템플릿 파일이 아닙니다.');
    }
    const base = String(data.name || '가져온 씬 템플릿')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .trim() || '가져온 씬 템플릿';
    let name = base;
    let index = 2;
    while (sessionService.list().includes(name)) name = `${base} (${index++})`;
    await sessionService.importSessionShallow(data.session, name);
    await this.designateSceneTemplate(name);
    return name;
  }

  async importSceneTemplate(
    target: Session,
    templateName: string,
    policy: 'number' | 'overwrite' | 'skip',
  ): Promise<string[]> {
    const source = await sessionService.get(templateName);
    if (!source || sessionService.getHiddenProjectRole(templateName) !== 'scene-template') {
      throw new Error('씬 템플릿을 찾을 수 없습니다.');
    }
    const imported: string[] = [];
    for (const sourceScene of source.getScenes('scene')) {
      const scene = genericSceneFromJSON(sourceScene.toJSON());
      if (!scene) continue;
      scene.imageMap = [];
      scene.mains = [];
      (scene as any).game = undefined;
      (scene as any).round = undefined;
      if (target.hasScene('scene', scene.name)) {
        if (policy === 'skip') continue;
        if (policy === 'overwrite') {
          const old = target.getScene('scene', scene.name);
          if (old) await trashService.moveSceneToTrash(target, old);
        } else {
          const base = scene.name;
          let index = 1;
          while (target.hasScene('scene', `${base}_${index}`)) index += 1;
          scene.name = `${base}_${index}`;
        }
      }
      target.addScene(scene);
      imported.push(scene.name);
    }
    return imported;
  }

  async promptForSceneTemplateImport(target: Session): Promise<string[]> {
    const appState = getAppState();
    const names = this.listSceneTemplates().filter((name) => name !== target.name);
    if (!names.length) {
      appState.pushMessage('가져올 씬 템플릿이 없습니다.');
      return [];
    }
    const templateName = await appState.pushDialogAsync({
      type: 'select',
      text: '가져올 씬 템플릿',
      items: names.map((name) => ({ text: name, value: name })),
    });
    if (!templateName) return [];
    const source = await sessionService.get(templateName);
    const conflicts = source
      ? source.getScenes('scene').filter((scene) => target.hasScene('scene', scene.name))
      : [];
    let policy: 'number' | 'overwrite' | 'skip' = 'number';
    if (conflicts.length) {
      const selected = await appState.pushDialogAsync({
        type: 'select',
        text: `이름이 겹치는 씬 ${conflicts.length}개`,
        items: [
          { text: '번호를 붙여 추가', value: 'number' },
          { text: '기존 씬을 휴지통으로 보내고 덮어쓰기', value: 'overwrite' },
          { text: '겹치는 씬 건너뛰기', value: 'skip' },
        ],
      });
      if (!selected) return [];
      policy = selected as typeof policy;
    }
    const imported = await this.importSceneTemplate(target, templateName, policy);
    runInAction(() => appState.pushMessage(`씬 ${imported.length}개를 가져왔습니다.`));
    return imported;
  }
}
