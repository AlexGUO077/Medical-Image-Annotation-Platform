import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesManualApi } from '../cases/manual-api';
import { ManualEntryPanel } from './ManualEntryPanel';

// AntD form behavior tests share a file-level budget for slower CI runners.
vi.setConfig({ testTimeout: 20_000 });

const session = { token: 'admin-token', role: 'admin' as const, quals: {} };

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('ManualEntryPanel', () => {
  it('does not display the selected key image filename or locally preview its raw bytes', async () => {
    const { container } = render(<MemoryRouter><ManualEntryPanel session={session} /></MemoryRouter>);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(['image'], 'patient-name.png', { type: 'image/png' })] } });

    expect(await screen.findByText(/已选择 1 张影像/)).toBeInTheDocument();
    expect(screen.queryByText('patient-name.png')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('only enables formal confirmation after server preview and explicit review', async () => {
    const prepare = vi.spyOn(casesManualApi, 'prepare').mockResolvedValue({
      draft_id: 'draft-id', masked_report: '某', masked_count: 1,
      image_redaction_count: 2, expires_at: '2026-09-25T00:00:00Z',
    });
    vi.spyOn(casesManualApi, 'preview').mockResolvedValue(new Blob(['safe'], { type: 'image/png' }));
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = vi.fn(() => 'blob:safe');
      static revokeObjectURL = vi.fn();
    });
    const { container } = render(<MemoryRouter><ManualEntryPanel session={session} /></MemoryRouter>);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '手工录入数据来源' }));
    await screen.findByRole('option', { name: '合成数据' });
    fireEvent.click(document.querySelector('.ant-select-item-option')!);
    fireEvent.change(screen.getByRole('textbox', { name: '报告文本' }), { target: { value: '患者：张三' } });
    fireEvent.change(container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['image'], 'patient-name.png', { type: 'image/png' })] },
    });
    await screen.findByText(/已选择 1 张影像/);
    const submit = screen.getByRole('button', { name: '安全处理并查看脱敏结果' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(prepare).toHaveBeenCalledOnce();
    expect(await screen.findByText(/报告遮蔽 1 处；关键影像遮盖 2 处/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认并创建病例' })).toBeDisabled();
    expect(screen.queryByText('患者：张三')).not.toBeInTheDocument();
  });
});
