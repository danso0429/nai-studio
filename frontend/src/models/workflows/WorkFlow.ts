import { makeAutoObservable, runInAction } from 'mobx';
import {
  CharacterPrompt,
  GenericScene,
  ModelBackend,
  PromptNode,
  ReferenceItem,
  SDAbstractJob,
  Session,
  VibeItem,
} from '../types';

export type WFBackendType = 'image' | 'none';

export interface WorkFlowDef {
  type: string;
  title: string;
  presetVars: WFVar[];
  sharedVars: WFVar[];
  metaVars: WFVar[];
  backendType: WFBackendType;
  editor: WFIElement;
  emoji?: string;
  innerEditor?: WFIElement;
  hasMask?: boolean;
  i2i: boolean;
  handler: WFHandler;
  createPrompt?: WFCreatePrompt;
  createCharacterPrompts?: WFCreateCharacterPrompts;
  createPreset?: WFCreatePreset;
}

// 조합 단위 negative 지원: 각 조합의 prompt(PromptNode)에 더해 그 조합에서 선택된
// piece들의 uc를 합친 extraUc도 함께 받음. extraUc는 base_caption negative에 append.
// 2026-05-13.
export type WFHandler = (
  session: Session,
  scene: GenericScene,
  prompt: PromptNode,
  characterPrompts: PromptNode[],
  preset: any,
  shared: any,
  samples: number,
  meta?: any,
  onComplete?: (img: string) => void,
  nodelay?: boolean,
  extraUc?: string,
  sceneGroup?: { sceneJobTotal: number; sceneJobStartIndex: number },
) => void | Promise<void>;

// WFCreatePrompt 반환: 각 조합의 prompt + 그 조합의 piece들이 가진 uc 합.
export type WFCreatePromptResult = { prompt: PromptNode; uc: string };
export type WFCreatePrompt = (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => WFCreatePromptResult[] | Promise<WFCreatePromptResult[]>;

export type WFCreateCharacterPrompts = (
  session: Session,
  scene: GenericScene,
  preset: any,
  shared: any,
) => PromptNode[][] | Promise<PromptNode[][]>;

export type WFCreatePreset = (
  job: SDAbstractJob<string>,
  image?: string,
  mask?: string,
) => any;

export interface WFAbstractVar {
  name: string;
}

export interface WFStringVar extends WFAbstractVar {
  type: 'string';
  default: string;
}

export interface WFBackendVar extends WFAbstractVar {
  type: 'backend';
  default: ModelBackend;
}

export interface WFIntVar extends WFAbstractVar {
  type: 'int';
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface WFNullIntVar extends WFAbstractVar {
  type: 'nullInt';
}

export interface WFVibeSetVar extends WFAbstractVar {
  type: 'vibeSet';
}

export interface WFSamplingVar extends WFAbstractVar {
  type: 'sampling';
  default: string;
}

export interface WFNoiseScheduleVar extends WFAbstractVar {
  type: 'noiseSchedule';
  default: string;
}

export interface WFBoolVar extends WFAbstractVar {
  type: 'bool';
  default: boolean;
}

export interface WFPromptVar extends WFAbstractVar {
  type: 'prompt';
  default: string;
}

export interface WFImageVar extends WFAbstractVar {
  type: 'image';
}

export interface WFMaskVar extends WFAbstractVar {
  type: 'mask';
  imageRef: string;
}

export interface WFSelectItem {
  label: string;
  value: string;
}

export interface WFSelectVar extends WFAbstractVar {
  type: 'select';
  options: WFSelectItem[];
  default: string;
}

export interface WFCharacterPromptsVar extends WFAbstractVar {
  type: 'characterPrompts';
  default: CharacterPrompt[];
}

export interface WFCharacterReferenceVar extends WFAbstractVar {
  type: 'characterReferences';
}

export type WFVar =
  | WFIntVar
  | WFVibeSetVar
  | WFSamplingVar
  | WFNoiseScheduleVar
  | WFBoolVar
  | WFPromptVar
  | WFImageVar
  | WFMaskVar
  | WFBackendVar
  | WFNullIntVar
  | WFStringVar
  | WFSelectVar
  | WFCharacterPromptsVar
  | WFCharacterReferenceVar;

export type WFFieldType = 'preset' | 'shared' | 'meta';

export type WFIFlex = 'flex-1' | 'flex-2' | 'flex-none';

export interface WFIAbstract {}

export interface WFIPresetSelect extends WFIAbstract {
  type: 'presetSelect';
}

export interface WFIProfilePresetSelect extends WFIAbstract {
  type: 'profilePresetSelect';
}

export interface WFIStack extends WFIAbstract {
  type: 'stack';
  inputs: WFIElement[];
}

export interface WFIInlineInput extends WFIAbstract {
  type: 'inline';
  label: string;
  field: string;
  fieldType: WFFieldType;
  flex: WFIFlex;
  menuPlacement?: 'top' | 'bottom';
}

export interface WFIGroup extends WFIAbstract {
  type: 'group';
  label: string;
  inputs: WFIElement[];
}

export interface WFIIfIn extends WFIAbstract {
  type: 'ifIn';
  field: string;
  fieldType: WFFieldType;
  values: string[];
  element: WFIElement;
}

export interface WFISceneOnly extends WFIAbstract {
  type: 'sceneOnly';
  element: WFIElement;
}

export interface WFIMiddlePlaceholderInput extends WFIAbstract {
  type: 'middlePlaceholder';
  label: string;
}

export interface WFIExtraPromptInput extends WFIAbstract {
  type: 'extraPrompt';
  label: string;
}

export interface WFIShowImage extends WFIAbstract {
  type: 'showImage';
  field: string;
  fieldType: WFFieldType;
}

export interface WFIPush extends WFIAbstract {
  type: 'push';
  direction: 'top' | 'bottom' | 'left' | 'right';
}

export type WFIElement =
  | WFIProfilePresetSelect
  | WFIPresetSelect
  | WFIStack
  | WFIInlineInput
  | WFIGroup
  | WFIMiddlePlaceholderInput
  | WFIExtraPromptInput
  | WFIPush
  | WFIIfIn
  | WFISceneOnly
  | WFIShowImage;

function createDefaultValue(varObj: WFVar) {
  switch (varObj.type) {
    case 'int':
      return varObj.default;
    case 'vibeSet':
      return [];
    case 'sampling':
      return varObj.default;
    case 'noiseSchedule':
      return varObj.default;
    case 'bool':
      return varObj.default;
    case 'prompt':
      return varObj.default;
    case 'image':
      return '';
    case 'mask':
      return '';
    case 'backend':
      return varObj.default;
    case 'nullInt':
      return null;
    case 'string':
      return varObj.default;
    case 'select':
      return varObj.default;
    case 'characterPrompts':
      return varObj.default;
    case 'characterReferences':
      return [];
    default:
      throw new Error('Unknown type');
  }
}

function createMobxObject(vars: WFVar[]) {
  const obj: any = {};
  vars.forEach((varObj) => {
    obj[varObj.name] = createDefaultValue(varObj);
  });
  return makeAutoObservable(obj);
}

function materializeWFObj(type: string, vars: WFVar[]) {
  const obj = createMobxObject(vars);
  obj['type'] = type;
  const params: { [key: string]: WFVar } = {};
  for (const varObj of vars) {
    params[varObj.name] = varObj;
  }

  obj.fromJSON = (json: any) => {
    // N keys × observable mutation = N reaction. runInAction batch로 1 reaction.
    runInAction(() => {
      Object.keys(params).forEach((key) => {
        if (params[key].type === 'vibeSet') {
          obj[key] = (json[key] || [])
            .filter((x: any) => x && x.path)
            .map((x: any) => VibeItem.fromJSON(x));
        } else if (params[key].type === 'characterReferences') {
          obj[key] = (json[key] || [])
            .filter((x: any) => x && x.path)
            .map((x: any) => ReferenceItem.fromJSON(x));
        } else {
          obj[key] = json[key];
        }
      });
    });
  };

  obj.toJSON = () => {
    const json: any = {};
    json['type'] = type;
    Object.keys(params).forEach((key) => {
      if (params[key].type === 'vibeSet') {
        json[key] = obj[key].map((x: VibeItem) => x.toJSON());
      } else if (params[key].type === 'characterReferences') {
        json[key] = obj[key].map((x: ReferenceItem) => x.toJSON());
      } else {
        json[key] = obj[key];
      }
    });
    return json;
  };

  return obj;
}

export class WFVarBuilder {
  private vars: WFVar[] = [];

  clone() {
    const newBuilder = new WFVarBuilder();
    newBuilder.vars = this.vars.slice();
    return newBuilder;
  }

  addIntVar(
    name: string,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
  ): this {
    this.vars.push({
      type: 'int',
      name,
      min,
      max,
      step,
      default: defaultValue,
    });
    return this;
  }

  addNullIntVar(name: string): this {
    this.vars.push({
      type: 'nullInt',
      name,
    });
    return this;
  }

  addVibeSetVar(name: string): this {
    this.vars.push({
      type: 'vibeSet',
      name,
    });
    return this;
  }

  addSamplingVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'sampling',
      name,
      default: defaultValue,
    });
    return this;
  }

  addNoiseScheduleVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'noiseSchedule',
      name,
      default: defaultValue,
    });
    return this;
  }

  addBoolVar(name: string, defaultValue: boolean): this {
    this.vars.push({
      type: 'bool',
      name,
      default: defaultValue,
    });
    return this;
  }

  addPromptVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'prompt',
      name,
      default: defaultValue,
    });
    return this;
  }

  addImageVar(name: string): this {
    this.vars.push({
      type: 'image',
      name,
    });
    return this;
  }

  addMaskVar(name: string, imageRef: string): this {
    this.vars.push({
      type: 'mask',
      name,
      imageRef,
    });
    return this;
  }

  addBackendVar(name: string, defaultValue: ModelBackend): this {
    this.vars.push({
      type: 'backend',
      name,
      default: defaultValue,
    });
    return this;
  }

  addStringVar(name: string, defaultValue: string): this {
    this.vars.push({
      type: 'string',
      name,
      default: defaultValue,
    });
    return this;
  }

  addSelectVar(
    name: string,
    options: WFSelectItem[],
    defaultValue: string,
  ): this {
    this.vars.push({
      type: 'select',
      name,
      options,
      default: defaultValue,
    });
    return this;
  }

  addCharacterPromptsVar(name: string, defaultValue: CharacterPrompt[]): this {
    this.vars.push({
      type: 'characterPrompts',
      name,
      default: defaultValue,
    });
    return this;
  }
  
  addCharacterReferenceVar(name: string): this {
    this.vars.push({
      type: 'characterReferences',
      name,
    });
    return this;
  }

  build(): WFVar[] {
    return this.vars;
  }
}

export class WFWorkFlow {
  def: WorkFlowDef;
  constructor(def: WorkFlowDef) {
    this.def = def;
  }

  getType() {
    return this.def.type;
  }

  getTitle() {
    return this.def.title;
  }

  buildShared() {
    return materializeWFObj(this.def.type, this.def.sharedVars);
  }

  buildMeta() {
    return materializeWFObj(this.def.type, this.def.metaVars);
  }

  buildPreset() {
    let newVars = this.def.presetVars.concat([
      { type: 'string', name: 'name', default: '' },
      { type: 'string', name: 'profile', default: '' },
    ]);
    if (this.def.backendType === 'none') {
      return materializeWFObj(this.def.type, newVars);
    } else {
      newVars = newVars.concat([
        { type: 'backend', name: 'backend', default: { type: 'NAI' } },
      ]);
      return materializeWFObj(this.def.type, newVars);
    }
  }

  presetFromJSON(json: any) {
    const preset = this.buildPreset();
    preset.fromJSON(json);
    return preset;
  }

  sharedFromJSON(json: any) {
    const shared = this.buildShared();
    shared.fromJSON(json);
    return shared;
  }

  metaFromJSON(json: any) {
    const meta = this.buildMeta();
    meta.fromJSON(json);
    return meta;
  }
}

export function wfiPresetSelect(): WFIPresetSelect {
  return { type: 'presetSelect' };
}

export function wfiProfilePresetSelect(): WFIProfilePresetSelect {
  return { type: 'profilePresetSelect' };
}

export function wfiStack(inputs: WFIElement[]): WFIStack {
  return { type: 'stack', inputs };
}

export function wfiInlineInput(
  label: string,
  field: string,
  fieldType: WFFieldType,
  flex: WFIFlex,
  menuPlacment?: 'top' | 'bottom',
): WFIInlineInput {
  return {
    type: 'inline',
    label,
    field,
    fieldType,
    flex,
    menuPlacement: menuPlacment,
  };
}

export function wfiGroup(label: string, inputs: WFIElement[]): WFIGroup {
  return { type: 'group', label, inputs };
}

export function wfiMiddlePlaceholderInput(
  label: string,
): WFIMiddlePlaceholderInput {
  return { type: 'middlePlaceholder', label };
}

export function wfiExtraPromptInput(label: string): WFIExtraPromptInput {
  return { type: 'extraPrompt', label };
}

export function wfiPush(
  direction: 'top' | 'bottom' | 'left' | 'right',
): WFIPush {
  return { type: 'push', direction };
}

export function wfiIfIn(
  field: string,
  fieldType: WFFieldType,
  values: string[],
  element: WFIElement,
): WFIIfIn {
  return { type: 'ifIn', field, fieldType, values, element };
}

export function wfiSceneOnly(element: WFIElement): WFISceneOnly {
  return { type: 'sceneOnly', element };
}

export function wfiShowImage(
  field: string,
  fieldType: WFFieldType,
): WFIShowImage {
  return { type: 'showImage', field, fieldType };
}

export class WFDefBuilder {
  private workflowDef: WorkFlowDef;

  constructor(type: string) {
    this.workflowDef = {
      type,
      presetVars: [],
      sharedVars: [],
      metaVars: [],
      backendType: 'none',
      editor: null as any,
      innerEditor: null as any,
      i2i: false,
      title: '',
      handler: () => {},
    };
  }

  setTitle(title: string): this {
    this.workflowDef.title = title;
    return this;
  }

  setPresetVars(presetVars: WFVar[]): this {
    this.workflowDef.presetVars = presetVars;
    return this;
  }

  setSharedVars(sharedVars: WFVar[]): this {
    this.workflowDef.sharedVars = sharedVars;
    return this;
  }

  setMetaVars(metaVars: WFVar[]): this {
    this.workflowDef.metaVars = metaVars;
    return this;
  }

  setBackendType(backendType: WFBackendType): this {
    this.workflowDef.backendType = backendType;
    return this;
  }

  setEditor(editor: WFIElement): this {
    this.workflowDef.editor = editor;
    return this;
  }

  setInnerEditor(innerEditor: WFIElement): this {
    this.workflowDef.innerEditor = innerEditor;
    return this;
  }

  setI2I(i2i: boolean): this {
    this.workflowDef.i2i = i2i;
    return this;
  }

  setHandler(handler: WFHandler): this {
    this.workflowDef.handler = handler;
    return this;
  }

  setCreatePrompt(createPrompt: WFCreatePrompt): this {
    this.workflowDef.createPrompt = createPrompt;
    return this;
  }

  setCreateCharacterPrompts(
    createCharacterPrompts: WFCreateCharacterPrompts,
  ): this {
    this.workflowDef.createCharacterPrompts = createCharacterPrompts;
    return this;
  }

  setCreatePreset(createPreset: WFCreatePreset): this {
    this.workflowDef.createPreset = createPreset;
    return this;
  }

  setHasMask(hasMask: boolean): this {
    this.workflowDef.hasMask = hasMask;
    return this;
  }

  setEmoji(emoji: string): this {
    this.workflowDef.emoji = emoji;
    return this;
  }

  build(): WorkFlowDef {
    return this.workflowDef;
  }
}
