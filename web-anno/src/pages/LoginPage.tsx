import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { authApi } from '../auth/api';
import type { AuthResponse, Session } from '../auth/types';

interface LoginPageProps {
  onAuthenticated(session: Session): void;
}

type Step = 'credentials' | 'password' | 'mfa_setup' | 'mfa_verify';

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [step, setStep] = useState<Step>('credentials');
  const [challengeToken, setChallengeToken] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function advance(response: AuthResponse) {
    setChallengeToken(response.token);
    if (response.next === 'authenticated') {
      onAuthenticated({ token: response.token, role: response.role, quals: response.quals });
    } else if (response.next === 'change_password') {
      setStep('password');
    } else if (response.next === 'verify_2fa') {
      setStep('mfa_verify');
    } else {
      await beginMfaSetup(response.token);
    }
  }

  async function beginMfaSetup(token: string) {
    const setup = await authApi.setupMfa(token);
    setSetupToken(setup.token);
    setQrCode(setup.qr_code_data_url);
    setManualKey(setup.manual_key);
    setStep('mfa_setup');
  }

  async function run(action: () => Promise<void>) {
    setLoading(true);
    setError('');
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '请求失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <Card className="login-card" variant="outlined">
        <Typography.Title level={1}>医学影像标注平台</Typography.Title>
        <Typography.Paragraph type="secondary">
          请输入管理员分配的账号。平台不提供公开注册。
        </Typography.Paragraph>
        {error && <Alert type="error" showIcon message={error} />}

        {step === 'credentials' && (
          <Form layout="vertical" onFinish={(values: { username: string; password: string }) =>
            void run(async () => advance(await authApi.login(values.username, values.password)))}>
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>登录</Button>
          </Form>
        )}

        {step === 'password' && (
          <Form layout="vertical" onFinish={(values: { current: string; next: string; confirm: string }) => void run(async () => {
            if (values.next !== values.confirm) throw new Error('两次输入的新密码不一致');
            await advance(await authApi.changePassword(challengeToken, values.current, values.next));
          })}>
            <Alert type="info" showIcon message="首次登录必须修改初始密码" />
            <Form.Item label="当前密码" name="current" rules={[{ required: true }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Form.Item label="新密码" name="next" extra="至少 12 位，并同时包含字母和数字" rules={[{ required: true }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Form.Item label="确认新密码" name="confirm" rules={[{ required: true }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
            <Button block type="primary" htmlType="submit" loading={loading}>修改密码并继续</Button>
          </Form>
        )}

        {step === 'mfa_setup' && (
          <Space direction="vertical" size="middle" className="login-full-width">
            <Alert type="info" showIcon message="使用 Microsoft Authenticator 扫描二维码，然后输入 6 位动态码" />
            <img className="mfa-qr" src={qrCode} alt="Microsoft Authenticator 绑定二维码" />
            <Typography.Text copyable={{ text: manualKey }}>无法扫码时使用密钥：{manualKey}</Typography.Text>
            <MfaCodeForm loading={loading} label="完成绑定" onSubmit={(code) =>
              run(async () => advance(await authApi.verifyMfa(setupToken, code)))} />
          </Space>
        )}

        {step === 'mfa_verify' && (
          <Space direction="vertical" size="middle" className="login-full-width">
            <Alert type="info" showIcon message="请输入 Microsoft Authenticator 中的 6 位动态码" />
            <MfaCodeForm loading={loading} label="验证并登录" onSubmit={(code) =>
              run(async () => advance(await authApi.verifyMfa(challengeToken, code)))} />
          </Space>
        )}
      </Card>
    </main>
  );
}

function MfaCodeForm({ loading, label, onSubmit }: {
  loading: boolean;
  label: string;
  onSubmit(code: string): Promise<void>;
}) {
  return (
    <Form layout="vertical" onFinish={(values: { code: string }) => void onSubmit(values.code)}>
      <Form.Item label="动态验证码" name="code" rules={[
        { required: true, message: '请输入动态验证码' },
        { pattern: /^\d{6}$/, message: '动态验证码应为 6 位数字' },
      ]}>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
      </Form.Item>
      <Button block type="primary" htmlType="submit" loading={loading}>{label}</Button>
    </Form>
  );
}
