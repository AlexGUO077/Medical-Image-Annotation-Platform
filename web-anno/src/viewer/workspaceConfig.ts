import { annotationColors } from '../app/theme/tokens';

export const panelSizes = {
  left: { default: 300, min: 240, max: 420 },
  right: { default: 340, min: 300, max: 480 },
  viewportMin: 640,
};

export const annotationPanelSplit = { defaultShare: 40, minList: 96, minProperties: 160, handle: 12 };

export const objectColors = annotationColors;
export const objectColor = (index: number) => objectColors[Math.max(0, index) % objectColors.length];
export const windowPresets = [
  { label: '肺窗', center: -600, width: 1500 },
  { label: '纵隔窗', center: 40, width: 400 },
  { label: '骨窗', center: 400, width: 1800 },
];
export const toolDefinitions = [
  { id: 'box', label: '矩形', key: '1' },
  { id: 'brush', label: '画笔', key: '2' },
  { id: 'polygon', label: '多边形', key: '3' },
  { id: 'point', label: '点', key: '4' },
] as const;
export const isTextInput = (target: EventTarget | null) => target instanceof HTMLElement &&
  !!target.closest('input,textarea,select,[role="combobox"],[role="slider"],[role="separator"],[contenteditable="true"],[role="dialog"],.workbench-report');
