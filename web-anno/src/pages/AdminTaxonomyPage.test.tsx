import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminTaxonomyPage } from './AdminTaxonomyPage';

const session = { token: 'synthetic-token', role: 'admin' as const, quals: {} };

afterEach(() => vi.unstubAllGlobals());

describe('AdminTaxonomyPage', () => {
  it('loads the four-level tree and displays disease sign definitions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tree: [{
        id: 'root', parent_id: null, level: 1, name: '呼吸', synonyms: [], icd: null,
        children: [{
          id: 'part', parent_id: 'root', level: 2, name: '合成部位', synonyms: [], icd: null,
          children: [{
            id: 'disease', parent_id: 'part', level: 3, name: '合成疾病', synonyms: ['合成别名'], icd: null,
            sign_tags: [{ id: 'sign', name: '合成征象', system_code: 'resp', definition: '仅用于合成验证' }],
            children: [{ id: 'subtype', parent_id: 'disease', level: 4, name: '合成分型', synonyms: [], icd: null, children: [] }],
          }],
        }],
      }],
      sign_tags: [{ id: 'sign', name: '合成征象', system_code: 'resp', definition: '仅用于合成验证' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    render(<AdminTaxonomyPage session={session} />);

    expect(await screen.findByText('合成分型')).toBeInTheDocument();
    expect(screen.getByText('合成疾病 可用征象')).toBeInTheDocument();
    expect(screen.getByText('合成别名')).toBeInTheDocument();
    expect(screen.getByText('仅用于合成验证')).toBeInTheDocument();
  });

  it('shows the service error without inventing fallback taxonomy data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: '认证信息无效' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));

    render(<AdminTaxonomyPage session={session} />);

    expect(await screen.findByText('无法加载标签数据')).toBeInTheDocument();
    expect(screen.getByText('认证信息无效')).toBeInTheDocument();
    expect(screen.queryByText('合成疾病')).not.toBeInTheDocument();
  });
});
