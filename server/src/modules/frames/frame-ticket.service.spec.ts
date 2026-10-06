import { JwtService } from '@nestjs/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameTicketService, type FrameTarget } from './frame-ticket.service';

const secret = 'synthetic-frame-secret-'.repeat(3);
const session = { user_id: '00000000-0000-4000-8000-000000000001', access_token: 'synthetic-access-session' };
const target: FrameTarget = { case_id: '00000000-0000-4000-8000-000000000002',
  series_uid: '2.25.12345', frame_index: 3, window: { center: -600, width: 1500 } };
const jwt = new JwtService({ secret });
const extract = (url: string) => url.slice('/api/frames/'.length);

beforeEach(() => {
  vi.stubEnv('FRAME_TOKEN_SECRET', secret);
  vi.stubEnv('JWT_SECRET', 'synthetic-login-secret-'.repeat(3));
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('internal frame tickets', () => {
  it('binds the frame and window for exactly 300 seconds without embedding the bearer', () => {
    const service = new FrameTicketService();
    const ticket = service.issue(session, target); const token = extract(ticket.url);
    expect(ticket.expires_in).toBe(300);
    expect(service.verify(token, session)).toEqual(target);
    const claims = jwt.decode(token);
    expect(claims.exp - claims.iat).toBe(300);
    expect(JSON.stringify(claims)).not.toContain(session.access_token);
    vi.advanceTimersByTime(299_000); expect(service.verify(token, session)).toEqual(target);
    vi.advanceTimersByTime(1_000); expect(() => service.verify(token, session)).toThrow('帧票据无效或已过期');
  });

  it('supports an explicit default window and ignores injected claims when issuing', () => {
    const service = new FrameTicketService();
    const value = { ...target, window: null, exp: 9999999999, sub: 'other', purpose: 'access' };
    const token = extract(service.issue(session, value).url);
    expect(service.verify(token, session)).toEqual({ ...target, window: null });
    expect(jwt.decode(token).purpose).toBe('frame');
  });

  it('binds library access and published version in the signed ticket',()=>{
    const service=new FrameTicketService(),library={...target,access_mode:'library' as const,expected_version:3};
    const token=extract(service.issue(session,library).url);expect(service.verify(token,session)).toEqual(library);
    for(const change of [{expected_version:4},{access_mode:undefined}]){
      const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...jwt.decode(token),...change})).toString('base64url');expect(()=>service.verify(parts.join('.'),session)).toThrow();
    }
    for(const change of [{expected_version:undefined},{expected_version:-1},{expected_version:1.5},{access_mode:undefined}])expect(()=>service.issue(session,{...library,...change} as FrameTarget)).toThrow();
  });

  it('rejects reuse by another user or login bearer', () => {
    const service = new FrameTicketService(); const token = extract(service.issue(session, target).url);
    expect(() => service.verify(token, { ...session, user_id: target.case_id })).toThrow('帧票据无效或已过期');
    expect(() => service.verify(token, { ...session, access_token: 'another-login' })).toThrow('帧票据无效或已过期');
  });

  it.each(['case_id', 'series_uid', 'frame_index', 'window'] as const)('rejects unsigned edits to %s', field => {
    const service = new FrameTicketService(); const parts = extract(service.issue(session, target).url).split('.');
    const claims = jwt.decode(parts.join('.'));
    claims[field] = field === 'frame_index' ? 4 : field === 'window' ? { center: 0, width: 1 } : 'other';
    parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
    expect(() => service.verify(parts.join('.'), session)).toThrow('帧票据无效或已过期');
  });

  it.each([
    { purpose: 'access' }, { aud: 'web-anno' }, { iss: 'other' },
    { exp: undefined }, { iat: undefined }, { exp: 9999999999 },
    { frame_index: -1 }, { window: { center: 1, width: 0 } }, { series_uid: '../file' },
  ])('rejects invalid signed claims %j', change => {
    const service = new FrameTicketService(); const claims = jwt.decode(extract(service.issue(session, target).url));
    const payload = JSON.parse(JSON.stringify({ ...claims, ...change }));
    const token = jwt.sign(payload, { noTimestamp: !Object.hasOwn(payload, 'iat') });
    expect(() => service.verify(token, session)).toThrow('帧票据无效或已过期');
  });

  it('rejects other keys and algorithms, including a login-key signature', () => {
    const service = new FrameTicketService(); const claims = jwt.decode(extract(service.issue(session, target).url));
    for (const token of [jwt.sign(claims, { algorithm: 'HS384' }),
      new JwtService({ secret: process.env.JWT_SECRET }).sign(claims), 'malformed']) {
      expect(() => service.verify(token, session)).toThrow('帧票据无效或已过期');
    }
  });

  it.each([{ frame_index: -1 }, { frame_index: 1.5 }, { case_id: '../case' },
    { series_uid: '1.02.3' }, { series_uid: '1.'.repeat(40) }, { window: undefined },
    { window: { center: NaN, width: 1 } }, { window: { center: 1, width: Infinity } },
  ])('rejects invalid issue parameters %j', change => {
    expect(() => new FrameTicketService().issue(session, { ...target, ...change } as FrameTarget)).toThrow('帧票据参数无效');
  });

  it.each(['', 'short', 'synthetic-login-secret-'.repeat(3)])('rejects missing, weak or reused frame keys', key => {
    vi.stubEnv('FRAME_TOKEN_SECRET', key);
    expect(() => new FrameTicketService()).toThrow(/FRAME_TOKEN_SECRET/);
  });
});
