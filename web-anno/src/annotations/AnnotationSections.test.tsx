import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AnnotationSections } from './AnnotationSections';

let resized: (entries: { contentRect: { height: number } }[]) => void;
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: typeof resized) { resized = callback; }
    observe() {}
    disconnect() {}
  });
});
afterEach(() => vi.unstubAllGlobals());
const resizeContainer = (height: number) => act(() => resized([{ contentRect: { height } }]));

it('drags within bounds, preserves field edits and supports keyboard adjustment and reset', () => {
  const frameShortcut = vi.fn();
  render(<div onKeyDown={frameShortcut}><AnnotationSections list={<p>对象列表</p>} properties={<input aria-label="未保存属性" defaultValue="合成内容" />} /></div>);
  resizeContainer(612);
  const divider = screen.getByRole('separator', { name: '调整对象列表与属性区高度' });
  const field = screen.getByLabelText('未保存属性');
  fireEvent.change(field, { target: { value: '编辑后的合成内容' } });
  divider.setPointerCapture = vi.fn();
  fireEvent.pointerDown(divider, { button: 0, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(divider, { clientY: 420, pointerId: 1 });
  expect(divider).toHaveAttribute('aria-valuenow', '60');
  fireEvent.pointerMove(divider, { clientY: 2000, pointerId: 1 });
  expect(divider).toHaveAttribute('aria-valuenow', divider.getAttribute('aria-valuemax'));
  fireEvent.pointerUp(divider, { pointerId: 1 });
  fireEvent.keyDown(divider, { key: 'ArrowUp' });
  expect(divider).toHaveAttribute('aria-valuenow', '69');
  expect(frameShortcut).not.toHaveBeenCalled();
  expect(field).toHaveValue('编辑后的合成内容');
  fireEvent.doubleClick(divider);
  expect(divider).toHaveAttribute('aria-valuenow', '40');
  fireEvent.keyDown(divider, { key: 'ArrowDown' });
  fireEvent.keyDown(divider, { key: 'Home' });
  expect(divider).toHaveAttribute('aria-valuenow', '40');
});

it('retains the split through hidden and smaller panels and allows resizing the empty property area', () => {
  render(<AnnotationSections list={<p>对象列表</p>} properties={<p>选择对象查看与编辑属性</p>} />);
  resizeContainer(612);
  const divider = screen.getByRole('separator');
  fireEvent.keyDown(divider, { key: 'ArrowDown' });
  expect(divider).toHaveAttribute('aria-valuenow', '44');
  resizeContainer(0);
  expect(divider).toHaveAttribute('aria-valuenow', '44');
  resizeContainer(212);
  expect(divider).toHaveAttribute('aria-valuenow', divider.getAttribute('aria-valuemin'));
  resizeContainer(612);
  expect(divider).toHaveAttribute('aria-valuenow', '44');
  expect(screen.getByText('选择对象查看与编辑属性')).toBeInTheDocument();
});
