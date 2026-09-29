import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { requiredEnv } from '../../config/environment';

export interface FrameTarget {
  case_id: string;
  series_uid: string;
  frame_index: number;
  window: { center: number; width: number } | null;
}

export interface FrameSession {
  user_id: string;
  access_token: string;
}

interface FrameClaims extends FrameTarget {
  sub: string;
  purpose: 'frame';
  session_digest: string;
  iat: number;
  exp: number;
}

const issuer = 'medical-image-annotation-platform';
const audience = 'frame-render';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validTarget(value: FrameTarget): boolean {
  return typeof value.case_id === 'string' && uuid.test(value.case_id) &&
    typeof value.series_uid === 'string' && value.series_uid.length <= 64 &&
    /^(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))+$/.test(value.series_uid) &&
    Number.isSafeInteger(value.frame_index) && value.frame_index >= 0 &&
    (value.window === null || (typeof value.window === 'object' && value.window !== null &&
      Number.isFinite(value.window.center) && Number.isFinite(value.window.width) && value.window.width > 0));
}

function validSession(session: FrameSession): boolean {
  return typeof session.user_id === 'string' && uuid.test(session.user_id) &&
    typeof session.access_token === 'string' && session.access_token.length > 0;
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Internal primitive only. Callers must authenticate the current bearer, check live
// account/assignment/resource permissions, and rate-limit before issuing or serving.
@Injectable()
export class FrameTicketService {
  private readonly jwt: JwtService;

  constructor() {
    const secret = requiredEnv('FRAME_TOKEN_SECRET');
    if (Buffer.byteLength(secret) < 32 || secret === requiredEnv('JWT_SECRET')) {
      throw new Error('FRAME_TOKEN_SECRET must be independent and at least 32 bytes');
    }
    this.jwt = new JwtService({ secret });
  }

  issue(session: FrameSession, target: FrameTarget): { url: string; expires_in: 300 } {
    if (!validSession(session) || !validTarget(target)) throw new BadRequestException('帧票据参数无效');
    // Copy only bound fields; do not spread arbitrary input into JWT claims.
    const token = this.jwt.sign({
      purpose: 'frame', session_digest: digest(session.access_token),
      case_id: target.case_id, series_uid: target.series_uid, frame_index: target.frame_index,
      window: target.window === null ? null : { center: target.window.center, width: target.window.width },
    }, { algorithm: 'HS256', issuer, audience, subject: session.user_id, expiresIn: 300 });
    return { url: `/api/frames/${token}`, expires_in: 300 };
  }

  verify(token: string, session: FrameSession): FrameTarget {
    try {
      const claims = this.jwt.verify<FrameClaims>(token, { algorithms: ['HS256'], issuer, audience });
      if (!validSession(session) || claims.purpose !== 'frame' || claims.sub !== session.user_id ||
          claims.session_digest !== digest(session.access_token) || !validTarget(claims) ||
          !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
          claims.exp - claims.iat !== 300 || claims.iat > Math.floor(Date.now() / 1000)) {
        throw new Error('Invalid frame binding');
      }
      return { case_id: claims.case_id, series_uid: claims.series_uid,
        frame_index: claims.frame_index, window: claims.window };
    } catch {
      throw new ForbiddenException('帧票据无效或已过期');
    }
  }
}
