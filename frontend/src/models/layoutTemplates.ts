import type { UiLayoutSlots } from '../main/config';

export interface LayoutTemplateMeta {
  id: 'classic' | 'compact' | 'sidebar';
  name: string;
  description: string;
  bottomBar: 'bottom' | 'none';
  sessionSelectTop: boolean;
  generationControl: 'docked' | 'floating';
  mobileAllowed: boolean;
  projectSidebar: boolean;
}

export interface ResolvedLayout extends LayoutTemplateMeta {
  presetSide: 'left' | 'right';
  historySide: 'left' | 'right';
  projectSide: 'left' | 'right';
}

export const layoutTemplates: LayoutTemplateMeta[] = [
  {
    id: 'classic',
    name: '클래식',
    description: '기존 하단 프로젝트·생성 컨트롤 배치를 유지해요.',
    bottomBar: 'bottom',
    sessionSelectTop: false,
    generationControl: 'docked',
    mobileAllowed: true,
    projectSidebar: false,
  },
  {
    id: 'compact',
    name: '컴팩트',
    description: '하단 바를 없애고 프로젝트 도구는 상단, 생성 컨트롤은 플로팅 카드로 옮겨요.',
    bottomBar: 'none',
    sessionSelectTop: true,
    generationControl: 'floating',
    mobileAllowed: false,
    projectSidebar: false,
  },
  {
    id: 'sidebar',
    name: '프로젝트 사이드바',
    description: '프로젝트 도구를 세로 바로 옮기고 생성 컨트롤을 플로팅으로 표시해요.',
    bottomBar: 'none',
    sessionSelectTop: false,
    generationControl: 'floating',
    mobileAllowed: false,
    projectSidebar: true,
  },
];

export function resolveLayout(
  id: string | undefined,
  isMobile: boolean,
  slots?: UiLayoutSlots,
): ResolvedLayout {
  const classic = layoutTemplates[0];
  const selected = layoutTemplates.find((template) => template.id === id);
  const template = !selected || (isMobile && !selected.mobileAllowed) ? classic : selected;
  return {
    ...template,
    presetSide: !isMobile && slots?.presetSide === 'right' ? 'right' : 'left',
    historySide: !isMobile && slots?.historySide === 'left' ? 'left' : 'right',
    projectSide: !isMobile && slots?.projectSide === 'right' ? 'right' : 'left',
    generationControl:
      template.bottomBar === 'none'
        ? 'floating'
        : !isMobile && (slots?.genControl === 'floating' || slots?.genControl === 'docked')
          ? slots.genControl
          : template.generationControl,
  };
}
