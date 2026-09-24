import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { casesImportApi } from '../cases/api';
import { CaseImportPage } from './CaseImportPage';

const session = { token: 'admin-token', role: 'admin' as const, quals: {} };

afterEach(() => vi.restoreAllMocks());

describe('CaseImportPage', () => {
  it('shows the approved batch workflow and keeps the unresolved manual workflow explicit', () => {
    render(<CaseImportPage session={session} />);

    expect(screen.getByRole('heading', { name: '病例录入' })).toBeInTheDocument();
    expect(screen.getByText(/仅接受 D-31 已批准的数据来源/)).toBeInTheDocument();
    expect(screen.getByText(/有效至项目验收/)).toBeInTheDocument();
    expect(screen.getByText(/浏览器不会解压或预览原始 DICOM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '手工简版录入' }));
    expect(screen.getByText(/需按 D-16 确认后实现/)).toBeInTheDocument();
  });

  it('does not render the selected ZIP filename', async () => {
    const { container } = render(<CaseImportPage session={session} />);
    const input = container.querySelector('input[type="file"]');
    const file = new File(['zip'], 'patient-name-and-id.zip', { type: 'application/zip' });

    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    expect(await screen.findByText(/不显示或上传原文件名/)).toBeInTheDocument();
    expect(screen.queryByText('patient-name-and-id.zip')).not.toBeInTheDocument();
  });

  it('shows measured file upload progress separately from server processing', async () => {
    const create = vi.spyOn(casesImportApi, 'create').mockImplementation((_token, _source, _file, onProgress) => {
      onProgress?.({ loaded: 2, total: 10 });
      return new Promise(() => {});
    });
    const { container } = render(<CaseImportPage session={session} />);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '数据来源' }));
    await screen.findByRole('option', { name: '合成数据' });
    const option = document.querySelector('.ant-select-item-option');
    expect(option).not.toBeNull();
    fireEvent.click(option!);
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input!, {
      target: { files: [new File(['zip'], 'sensitive.zip', { type: 'application/zip' })] },
    });
    await screen.findByText(/已选择 1 个 ZIP 文件/);
    const submit = screen.getByRole('button', { name: '开始安全导入' });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    expect(create).toHaveBeenCalledOnce();
    expect(await screen.findByText(/文件上传/)).toHaveTextContent('2 / 10 字节');
    expect(screen.queryByText('服务端处理进度')).not.toBeInTheDocument();
    expect(screen.queryByText('sensitive.zip')).not.toBeInTheDocument();
  });
});
