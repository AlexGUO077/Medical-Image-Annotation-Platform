import { Button, Checkbox, InputNumber, Modal, Popover, Select, Slider, Tooltip } from 'antd';
import { useState } from 'react';
import type { DrawingTool } from '../annotations/drawing';
import type { FrameWindow, Series } from './api';
import { ViewerIcon, type IconName } from './ViewerIcon';
import { toolDefinitions, windowPresets } from './workspaceConfig';

export function ToolButton({ label, icon, shortcut, active = false, disabled = false, onClick }: { label: string; icon: IconName; shortcut?: string; active?: boolean; disabled?: boolean; onClick(): void }) {
  return <Tooltip title={`${label}${shortcut ? ` · ${shortcut}` : ''}`}><Button className="viewer-tool" type={active ? 'primary' : 'text'} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick} icon={<ViewerIcon name={icon} />}><span>{label}</span></Button></Tooltip>;
}

export function ViewerToolbar(p: {
  tool: DrawingTool; windowDrag: boolean; onTool(tool: DrawingTool): void; onWindowDrag(): void;
  editable?: boolean; drawing?: boolean; disabled?: boolean; calibrated: boolean;
  window: FrameWindow | null; modality: string; onWindow(value: FrameWindow): void;
  diameter?: number; onDiameter?(value: number): void; erase?: boolean; onErase?(value: boolean): void; freehand?: boolean; onFreehand?(value: boolean): void;
  canUndo?: boolean; canRedo?: boolean; onUndo?(): void; onRedo?(): void;
  opacity?: number; onOpacity?(value: number): void;
}) {
  const [help, setHelp] = useState(false);
  const [center, setCenter] = useState<number | null>(p.window?.center ?? null), [width, setWidth] = useState<number | null>(p.window?.width ?? null);
  return <><div className="viewer-toolbar" role="toolbar" aria-label="影像工具栏">
    {p.drawing && <div className="viewer-tool-group" aria-label="标注工具">{toolDefinitions.map(t => <ToolButton key={t.id} label={t.label} icon={t.id} shortcut={t.key} active={!p.windowDrag && p.tool === t.id} disabled={p.disabled || !p.editable || (t.id === 'brush' && !p.calibrated)} onClick={() => p.onTool(t.id)} />)}</div>}
    <div className="viewer-tool-group" aria-label="阅片工具">
      <ToolButton label={p.drawing ? '选择 / 调整' : '选择只读对象'} icon="select" active={!p.windowDrag && p.tool === 'select'} disabled={p.disabled} onClick={() => p.onTool('select')} />
      <ToolButton label="拖拽调窗" icon="window" shortcut="W" active={p.windowDrag} disabled={p.disabled} onClick={p.onWindowDrag} />
      <ToolButton label="平移" icon="pan" shortcut="P" active={!p.windowDrag && p.tool === 'pan'} disabled={p.disabled} onClick={() => p.onTool('pan')} />
      <ToolButton label="缩放" icon="zoom" shortcut="Z" active={!p.windowDrag && p.tool === 'zoom'} disabled={p.disabled} onClick={() => p.onTool('zoom')} />
      <ToolButton label="测量" icon="measure" shortcut="M" active={!p.windowDrag && p.tool === 'measure'} disabled={p.disabled || !p.calibrated} onClick={() => p.onTool('measure')} />
    </div>
    <div className="viewer-tool-group" aria-label="显示设置">
      <Popover trigger="click" placement="bottom" title="窗宽 / 窗位" onOpenChange={open => { if (open) { setCenter(p.window?.center ?? null); setWidth(p.window?.width ?? null); } }} content={<div className="window-settings"><label>窗位 WL<InputNumber aria-label="窗位" value={center} onChange={setCenter} /></label><label>窗宽 WW<InputNumber aria-label="窗宽" value={width} min={1} onChange={setWidth} /></label><Button disabled={p.disabled || center === null || width === null || width <= 0} onClick={() => { if (center !== null && width !== null) p.onWindow({ center, width }); }}>应用窗设置</Button>{p.modality === 'CT' && <div className="window-presets">{windowPresets.map(preset => <Button key={preset.label} disabled={p.disabled} onClick={() => { p.onWindow({ center: preset.center, width: preset.width }); setCenter(preset.center); setWidth(preset.width); }}>{preset.label}</Button>)}</div>}</div>}><Button aria-label="窗设置" title="窗宽 / 窗位与预设" className="viewer-tool" type="text" disabled={p.disabled} icon={<ViewerIcon name="settings" />}>窗设置</Button></Popover>
      {p.onOpacity && <Popover trigger="click" title="标注透明度" content={<Slider aria-label="标注透明度" min={15} max={100} value={p.opacity ?? 100} onChange={p.onOpacity} style={{ width: 170 }} />}><Button aria-label="标注显示设置" title="标注透明度" type="text" className="viewer-tool" icon={<ViewerIcon name="eye" />}>显示</Button></Popover>}
    </div>
    {p.drawing && <div className="viewer-tool-group"><ToolButton label="撤销" icon="undo" shortcut="⌘ / Ctrl + Z" disabled={!p.editable || !p.canUndo || p.disabled} onClick={() => p.onUndo?.()} /><ToolButton label="重做" icon="redo" shortcut="⌘ / Ctrl + Shift + Z" disabled={!p.editable || !p.canRedo || p.disabled} onClick={() => p.onRedo?.()} /></div>}
    <Tooltip title="快捷键帮助"><Button type="text" aria-label="快捷键帮助" icon={<ViewerIcon name="help" />} onClick={() => setHelp(true)} /></Tooltip>
  </div>
  {p.drawing && p.tool === 'brush' && <div className="viewer-tool-options"><label>画笔直径（mm）<InputNumber aria-label="画笔直径" min={0.1} value={p.diameter} disabled={!p.editable} onChange={value => { if (value && Number.isFinite(value)) p.onDiameter?.(value); }} /></label><Checkbox disabled={!p.editable} checked={p.erase} onChange={e => p.onErase?.(e.target.checked)}>橡皮擦</Checkbox><span>拖动绘制当前帧掩膜</span></div>}
  {p.drawing && p.tool === 'polygon' && <div className="viewer-tool-options"><Checkbox disabled={!p.editable} checked={p.freehand} onChange={e => p.onFreehand?.(e.target.checked)}>自由手绘</Checkbox><span>双击 / Enter 完成 · Backspace 撤末点 · Esc 取消</span></div>}
  <Modal title="快捷键与鼠标操作" open={help} onCancel={() => setHelp(false)} footer={<Button onClick={() => setHelp(false)}>知道了</Button>}><dl className="shortcut-list">
    {p.drawing && <><dt>1 / 2 / 3 / 4</dt><dd>矩形 / 画笔 / 多边形 / 点</dd><dt>Ctrl / ⌘ + Z</dt><dd>撤销；加 Shift 重做</dd><dt>Ctrl / ⌘ + S</dt><dd>保存标注</dd><dt>Delete / Backspace</dt><dd>删除选中对象（多边形绘制时 Backspace 撤末点）</dd><dt>[ / ]</dt><dd>调整画笔直径</dd></>}
    <dt>W / P / Z / M</dt><dd>窗宽窗位 / 平移 / 缩放 / 测量</dd><dt>滚轮 / ↑ ↓</dt><dd>翻层</dd><dt>中键 / 空格 + 左键</dt><dd>平移</dd><dt>右键拖动</dt><dd>缩放</dd><dt>R</dt><dd>重置视图</dd><dt>Esc</dt><dd>取消绘制 / 退出专注</dd>
  </dl><p>编辑文本时不触发工具快捷键；只读状态不能修改标注。</p></Modal></>;
}

export function SeriesNavigation({ series, selected, frame, window, disabled = false, onSeries, onFrame, annotatedFrames = [] }: {
  series: Series[]; selected: Series; frame: number; window: FrameWindow | null; disabled?: boolean; onSeries(id: string): void; onFrame(frame: number): void; annotatedFrames?: { frame: number; color: string; number: number }[];
}) {
  const marks: Record<number, { label: React.ReactNode }> = {};
  for (const item of annotatedFrames) {
    if (item.frame < 0 || item.frame >= selected.frame_count || marks[item.frame]) continue;
    marks[item.frame] = {label: <span className="annotated-frame-marks">{annotatedFrames.filter(a => a.frame === item.frame).map(a => <span key={a.number} className="annotated-frame-mark" style={{background: a.color}} title={`对象 ${a.number} · 第 ${a.frame + 1} 帧`} />)}</span>};
  }
  return <div className="series-navigation"><Select aria-label="影像序列" disabled={disabled} value={selected.id} options={series.map((s, i) => ({ value: s.id, label: `序列 ${i + 1} · ${s.modality} · ${s.frame_count} 帧` }))} onChange={onSeries} />
    <span className="viewport-window-values">WL {window?.center ?? '默认'} / WW {window?.width ?? '默认'}</span>
    {selected.frame_count > 1 && <div className="frame-navigation"><Button type="text" aria-label="上一帧" icon={<ViewerIcon name="left" />} disabled={disabled || frame === 0} onClick={() => onFrame(frame - 1)} /><span>第 {frame + 1} / {selected.frame_count} 帧</span><Button type="text" aria-label="下一帧" icon={<ViewerIcon name="right" />} disabled={disabled || frame >= selected.frame_count - 1} onClick={() => onFrame(frame + 1)} /><Slider aria-label="切片导航" min={0} max={selected.frame_count - 1} value={frame} disabled={disabled} tooltip={{ formatter: value => `第 ${(value ?? 0) + 1} 帧` }} onChange={onFrame} marks={marks} /></div>}
    {selected.frame_count === 1 && <span>单帧影像</span>}
  </div>;
}
