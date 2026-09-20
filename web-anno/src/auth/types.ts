export type AccountRole = 'admin' | 'member';
export type Qualifications = Record<string, Array<'annotate' | 'review'>>;

export interface AuthResponse {
  token: string;
  role: AccountRole;
  quals: Qualifications;
  must_change_password: boolean;
  next: 'authenticated' | 'change_password' | 'setup_2fa' | 'verify_2fa';
}

export interface Session {
  token: string;
  role: AccountRole;
  quals: Qualifications;
}
