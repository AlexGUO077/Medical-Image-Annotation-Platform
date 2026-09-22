import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CaseImportPage } from './CaseImportPage';

const session = { token: 'admin-token', role: 'admin' as const, quals: {} };

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
});
