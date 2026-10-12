import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { data } from '../../../test/fixtures/synthetic/viewer-interactions';
import { SeriesNavigation } from './ViewerToolbar';

it('moves down toward later frames without triggering the workspace shortcut twice', () => {
  const parentKey = vi.fn();
  function Harness() {
    const [frame, setFrame] = useState(0);
    return <div onKeyDown={parentKey}><SeriesNavigation series={data.series} selected={data.series[0]} frame={frame} onFrame={setFrame} onSeries={() => {}} annotatedFrames={[{ frame: 1, color: '#22D3EE', number: 1 }, { frame: 1, color: '#FACC15', number: 2 }]} /></div>;
  }
  render(<Harness />);
  const slider = screen.getByRole('slider', { name: '切片导航' });
  expect(screen.getByRole('button', { name: '上一帧' })).toBeDisabled();
  fireEvent.keyDown(slider, { key: 'ArrowDown', keyCode: 40 });
  expect(slider).toHaveAttribute('aria-valuenow', '1');
  expect(parentKey).not.toHaveBeenCalled();
  fireEvent.keyDown(slider, { key: 'End', keyCode: 35 });
  expect(slider).toHaveAttribute('aria-valuenow', '2');
  expect(screen.getByRole('button', { name: '下一帧' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '跳至第 2 帧：对象 1、2' }));
  expect(slider).toHaveAttribute('aria-valuetext', '第 2 / 3 帧');
  fireEvent.keyDown(slider, { key: 'PageUp', keyCode: 33 });
  expect(slider).toHaveAttribute('aria-valuenow', '0');
});

it('blocks disabled navigation and omits the rail for a single-frame series', () => {
  const onFrame = vi.fn();
  const props = { series: data.series, selected: data.series[0], frame: 1, onFrame, onSeries: vi.fn(), annotatedFrames: [{ frame: 0, color: '#22D3EE', number: 1 }] };
  const view = render(<SeriesNavigation {...props} disabled />);
  fireEvent.click(screen.getByRole('button', { name: '下一帧' }));
  fireEvent.click(screen.getByRole('button', { name: '跳至第 1 帧：对象 1' }));
  fireEvent.keyDown(screen.getByRole('slider', { name: '切片导航' }), { key: 'ArrowDown', keyCode: 40 });
  expect(onFrame).not.toHaveBeenCalled();
  view.rerender(<SeriesNavigation {...props} selected={{ ...data.series[0], frame_count: 1 }} frame={0} />);
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '影像序列' })).toBeInTheDocument();
});
