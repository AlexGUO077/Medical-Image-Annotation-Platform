export type AccountRole = 'admin' | 'member';
export type Qualification = 'annotate' | 'review';
export type Qualifications = Record<string, Qualification[]>;

export interface AuthUser {
  id: string;
  username: string;
  password_hash: string;
  real_name: string;
  role: AccountRole;
  quals: Qualifications;
  status: 'active' | 'disabled';
  expire_at: string;
  must_change_password: boolean;
  mfa_secret_encrypted: string | null;
  updated_at: Date;
}

export type TokenPurpose = 'access' | 'password_change' | 'mfa_setup' | 'mfa_verify' | 'mfa_enroll';

export interface AuthClaims {
  sub: string;
  purpose: TokenPurpose;
  role: AccountRole;
  quals: Qualifications;
  account_updated_at: number;
  mfa_secret_encrypted?: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  ip?: string;
  user?: AuthUser;
  auth?: AuthClaims;
}
