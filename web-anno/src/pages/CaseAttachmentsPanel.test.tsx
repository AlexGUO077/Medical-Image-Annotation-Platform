import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { caseEditApi } from '../cases/detail-api';
import { CaseAttachmentsPanel } from './CaseAttachmentsPanel';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const session = { token: 'token', role: 'admin' as const, quals: {} };
function stubUrl() { vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:safe'); static revokeObjectURL = vi.fn(); }); }
describe('attachment review UI', () => {
  it('requires preview load, explicit review and type before formal confirmation', async () => {
    stubUrl();
    vi.spyOn(caseEditApi, 'upload').mockResolvedValue('upload-1');
    vi.spyOn(caseEditApi, 'progress').mockResolvedValue({ status: 'pending_confirmation', next_part_index: 1, part_count: 1, page_count: 1, failure_code: null });
    vi.spyOn(caseEditApi, 'preview').mockResolvedValue({ blob: new Blob(['safe'], { type: 'image/png' }), page_count: 1 });
    const confirm = vi.spyOn(caseEditApi, 'confirm').mockResolvedValue({}); const refresh = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<CaseAttachmentsPanel id="case-1" session={session} items={[]} editable onConfirmed={refresh} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['pdf'], 'private-name.pdf', { type: 'application/pdf' })] } });
    const button = await screen.findByRole('button', { name: '确认附件入库' }); expect(button).toBeDisabled();
    expect(screen.queryByText('private-name.pdf')).not.toBeInTheDocument();
    const image = await screen.findByAltText('附件第 1 页水印预览'); fireEvent.load(image);
    const checkbox = screen.getByRole('checkbox'); await waitFor(() => expect(checkbox).toBeEnabled());
    fireEvent.click(checkbox); fireEvent.click(button);
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('token', 'case-1', 'upload-1', '检查报告'));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it('never enables confirmation after failed conversion', async () => {
    vi.spyOn(caseEditApi, 'upload').mockResolvedValue('upload-1');
    vi.spyOn(caseEditApi, 'progress').mockResolvedValue({ status: 'failed', next_part_index: 1, part_count: 1, page_count: 0, failure_code: 'ATTACHMENT_PROCESSING_FAILED' });
    const preview = vi.spyOn(caseEditApi, 'preview');
    const { container } = render(<CaseAttachmentsPanel id="case-1" session={session} items={[]} editable onConfirmed={vi.fn()} />);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(['png'], 'private.png', { type: 'image/png' })] } });
    await screen.findByText(/附件安全处理失败/);
    expect(screen.queryByRole('button', { name: '确认附件入库' })).not.toBeInTheDocument();
    expect(preview).not.toHaveBeenCalled();
  });
});
