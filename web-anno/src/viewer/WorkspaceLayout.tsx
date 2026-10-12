import { Button, Dropdown, Popover, Tooltip } from 'antd';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ViewerIcon } from './ViewerIcon';
import { panelSizes } from './workspaceConfig';
import type { Workbench } from './api';
import { SYSTEM_OPTIONS } from '../cases/types';

const preferenceKey = 'miap.workspace.widths';
type Widths = { left: number; right: number };
const bounded = (side: keyof Widths, value: number) => Math.min(panelSizes[side].max, Math.max(panelSizes[side].min, value));
function initialWidths(): Widths {
  try {
    const value = JSON.parse(localStorage.getItem(preferenceKey) ?? '{}');
    return { left: Number.isFinite(value.left) ? bounded('left', value.left) : panelSizes.left.default, right: Number.isFinite(value.right) ? bounded('right', value.right) : panelSizes.right.default };
  } catch { return { left: panelSizes.left.default, right: panelSizes.right.default }; }
}

export function CaseDetails({ data, children }: { data: Workbench; children?: ReactNode }) {
  return <Popover trigger="click" placement="bottomLeft" title="脱敏病例信息" content={<div className="case-detail-popover"><dl>
    <dt>病例编号</dt><dd>{data.case.case_no}</dd><dt>年龄段 / 性别</dt><dd>{data.case.age_band || '未填写'} / {data.case.sex || '未填写'}</dd>
    <dt>系统</dt><dd>{SYSTEM_OPTIONS.find(item => item.value === data.case.system_code)?.label ?? data.case.system_code}</dd>
    <dt>确诊方式</dt><dd>{data.case.confirm_method}</dd><dt>临床信息</dt><dd>{data.case.clinical_text || '暂无临床信息'}</dd>
  </dl>{children}</div>}><Button className="case-detail-trigger" icon={<ViewerIcon name="info" />} aria-label="查看病例详情">{data.case.case_no}</Button></Popover>;
}

export function WorkspaceLayout({ identity, actions, toolbar, left, right, children, focus, onFocus, rightTitle = '标注对象', leftTitle = '病例与报告' }: {
  identity?: ReactNode; actions?: ReactNode; toolbar?: ReactNode;
  left: ReactNode; right: ReactNode; children: ReactNode; focus: boolean; onFocus(value: boolean): void; rightTitle?: string; leftTitle?: string;
}) {
  const [widths, setWidths] = useState(initialWidths);
  const [leftOpen, setLeftOpen] = useState(true), [rightOpen, setRightOpen] = useState(true);
  const [available, setAvailable] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ side: keyof Widths; x: number; width: number }>();
  useEffect(() => {
    if (!root.current || !globalThis.ResizeObserver) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  // On smaller desktops keep the viewport usable. The hidden panel retains its state.
  const autoCollapseLeft = available > 0 && available < panelSizes.viewportMin + widths.left + widths.right + 16;
  const showLeft = !focus && leftOpen && !(autoCollapseLeft && rightOpen);
  const showRight = !focus && rightOpen;
  const saveWidths = (next: Widths) => {
    setWidths(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify({ left: next.left, right: next.right })); } catch { /* Layout works without storage. */ }
  };
  const resize = (side: keyof Widths, value: number) => {
    const other = side === 'left' ? (showRight ? widths.right : 36) : (showLeft ? widths.left : 36);
    const max = available ? Math.max(panelSizes[side].min, available - other - panelSizes.viewportMin - 16) : panelSizes[side].max;
    saveWidths({ ...widths, [side]: bounded(side, Math.min(value, max)) });
  };
  const expand = (side: keyof Widths) => {
    onFocus(false);
    if (side === 'left') { setLeftOpen(true); if (autoCollapseLeft) setRightOpen(false); }
    else setRightOpen(true);
  };
  const divider = (side: keyof Widths) => <div className="workspace-divider" role="separator" tabIndex={0} aria-label={`调整${side === 'left' ? '左' : '右'}侧栏宽度`} aria-orientation="vertical" aria-valuemin={panelSizes[side].min} aria-valuemax={panelSizes[side].max} aria-valuenow={widths[side]}
    onDoubleClick={() => saveWidths({ ...widths, [side]: panelSizes[side].default })}
    onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (e.key === 'Home') saveWidths({ ...widths, [side]: panelSizes[side].default }); else resize(side, widths[side] + (e.key === 'ArrowRight' ? 16 : -16) * (side === 'right' ? -1 : 1)); } }}
    onPointerDown={e => { drag.current = { side, x: e.clientX, width: widths[side] }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={e => { if (drag.current?.side === side) resize(side, drag.current.width + (e.clientX - drag.current.x) * (side === 'right' ? -1 : 1)); }}
    onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }} />;
  return <><header className="workbench-heading"><div className="workbench-identity">{identity}</div><div className="workspace-tools">{toolbar}<div className="workspace-view-options"><Dropdown trigger={['click']} menu={{ items: [{ key: 'standard', label: '标准三栏' }, { key: 'left', label: '隐藏左栏' }, { key: 'right', label: '隐藏右栏' }, { key: 'focus', label: '影像专注模式' }], onClick: ({ key }) => { onFocus(key === 'focus'); setLeftOpen(key !== 'left'); setRightOpen(key !== 'right'); } }}><Button type="text" aria-label="视图布局" title="视图布局" icon={<ViewerIcon name="layout" />} /></Dropdown><Button type="text" aria-label={focus ? '退出专注模式' : '影像专注模式'} title={focus ? '退出专注模式 · Esc' : '影像专注模式'} aria-pressed={focus} icon={<ViewerIcon name="focus" />} onClick={() => onFocus(!focus)} /></div></div><div className="workbench-header-actions">{actions}</div></header>
  <div className={`workspace-layout${focus ? ' is-focused' : ''}`} ref={root} style={{ '--left-width': `${showLeft ? widths.left : 36}px`, '--right-width': `${showRight ? widths.right : 36}px` } as CSSProperties}>
    <aside className={`workspace-panel${showLeft ? '' : ' is-collapsed'}`} aria-label={leftTitle}>
      <div className="workspace-panel-heading"><span>{showLeft ? leftTitle : ''}</span><Tooltip title={showLeft ? '收起左侧栏' : '展开左侧栏'}><Button type="text" aria-label={showLeft ? '收起左侧栏' : '展开左侧栏'} icon={<ViewerIcon name={showLeft ? 'left' : 'right'} />} onClick={() => showLeft ? setLeftOpen(false) : expand('left')} /></Tooltip></div>
      <div className="workspace-panel-body" hidden={!showLeft}>{left}</div>
    </aside>
    {showLeft ? divider('left') : <div />}
    <main className="workbench-center">{children}</main>
    {showRight ? divider('right') : <div />}
    <aside className={`workspace-panel${showRight ? '' : ' is-collapsed'}`} aria-label={rightTitle}>
      <div className="workspace-panel-heading"><Tooltip title={showRight ? '收起右侧栏' : '展开右侧栏'}><Button type="text" aria-label={showRight ? '收起右侧栏' : '展开右侧栏'} icon={<ViewerIcon name={showRight ? 'right' : 'left'} />} onClick={() => showRight ? setRightOpen(false) : expand('right')} /></Tooltip><span>{showRight ? rightTitle : ''}</span></div>
      <div className="workspace-panel-body" hidden={!showRight}>{right}</div>
    </aside>
    {available > 0 && available < 1232 && <span className="workspace-size-hint">建议将浏览器窗口扩大至 1280px 以上</span>}
  </div></>;
}
