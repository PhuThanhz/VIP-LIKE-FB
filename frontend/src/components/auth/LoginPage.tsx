import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Tabs, Avatar, message } from 'antd';
import { UserOutlined, LockOutlined, ThunderboltFilled, KeyOutlined } from '@ant-design/icons';
import api from '../../config/axios';
import { getMachineHwid } from '../../utils/tauriBridge';
import { CurrentUser, parseAuthResponse, saveSession } from '../../auth/session';

interface LoginPageProps {
  onLoginSuccess: (user: CurrentUser) => void;
}

type LoginTab = 'login' | 'license';

// Shared key so a new error replaces the old one instead of stacking on repeated clicks
const AUTH_MESSAGE_KEY = 'auth-message';
const LAST_USERNAME_KEY = 'viplike_last_username';
const DEFAULT_LOCKOUT_SEC = 60;

/** Backend returns 429 with "retry after N seconds" in the error message */
const parseLockoutSeconds = (errorText?: string): number => {
  const match = errorText?.match(/(\d+)\s*(?:giây|seconds?)/i);
  return match ? Number(match[1]) : DEFAULT_LOCKOUT_SEC;
};

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<LoginTab>('login');
  const [loading, setLoading] = useState(false);
  const [hwid, setHwid] = useState('');
  const [lockoutSec, setLockoutSec] = useState(0);
  // If the username is remembered, put the cursor straight into the password field
  const [lastUsername] = useState(() => localStorage.getItem(LAST_USERNAME_KEY) || '');
  const [form] = Form.useForm();
  const [licenseForm] = Form.useForm();

  useEffect(() => {
    getMachineHwid().then(setHwid);
  }, []);

  // Countdown for the temporary login lockout
  useEffect(() => {
    if (lockoutSec <= 0) return;
    const timer = setTimeout(() => setLockoutSec((sec) => sec - 1), 1000);
    return () => clearTimeout(timer);
  }, [lockoutSec]);

  const handleLoginSubmit = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', {
        username: values.username.trim(),
        password: values.password,
      });
      const session = parseAuthResponse(res.data);
      if (session) {
        saveSession(session.token, session.user);
        localStorage.setItem(LAST_USERNAME_KEY, values.username.trim());
        message.success(`Welcome ${session.user.fullName}, you are now signed in!`);
        onLoginSuccess(session.user);
      } else {
        message.error({ content: res.data?.error || 'Sign-in failed', key: AUTH_MESSAGE_KEY });
      }
    } catch (err: any) {
      const errorText: string | undefined = err.response?.data?.error;
      if (err.response?.status === 429) {
        setLockoutSec(parseLockoutSeconds(errorText));
      }
      message.error({ content: errorText || err.message || 'Incorrect username or password!', key: AUTH_MESSAGE_KEY });
    } finally {
      setLoading(false);
    }
  };

  const handleActivateLicense = async (values: { licenseKey: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/license/activate', {
        licenseKey: values.licenseKey.trim(),
        hardwareHwid: hwid,
      });
      if (res.data?.success) {
        message.success('License activated! Please sign in to continue.');
        licenseForm.resetFields();
        setActiveTab('login');
      } else {
        message.error({ content: res.data?.error || 'Invalid or expired key.', key: AUTH_MESSAGE_KEY });
      }
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || 'License key activation failed.', key: AUTH_MESSAGE_KEY });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="px-6 py-4 flex items-center justify-between border-b bg-slate-900/60 border-slate-800/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt="VIP LIKE RADIANT" className="w-9 h-9 rounded-xl shadow-md border border-slate-800 object-cover shrink-0" />
          <div>
            <div className="font-extrabold text-sm tracking-wider uppercase text-slate-100 flex items-center gap-1.5">
              <span>VIP LIKE</span>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                RADIANT
              </span>
            </div>
            <div className="text-[10px] text-slate-400">Meta Engagement &amp; Post Hunting System</div>
          </div>
        </div>

      </header>

      {/* Center Auth Card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card
            variant="outlined"
            className="shadow-2xl rounded-3xl !bg-slate-900/90 !border-slate-800 shadow-slate-950/40"
          >
            {/* Header Badge & Brand */}
            <div className="text-center pb-4 pt-2">
              <div className="flex justify-center mb-3">
                <img src="/logo.png" alt="VIP LIKE RADIANT" className="w-16 h-16 rounded-2xl shadow-2xl border border-slate-800 object-cover" />
              </div>
              <h1 className="text-xl font-bold tracking-tight mb-1 text-white">
                SYSTEM SIGN IN
              </h1>
              <p className="text-xs text-slate-400">
                Please verify your account to access your Fanpages &amp; Buff tools
              </p>
            </div>

            {/* Ant Design Tabs */}
            <Tabs
              activeKey={activeTab}
              onChange={(key) => setActiveTab(key as LoginTab)}
              centered
              className="custom-auth-tabs"
              items={[
                {
                  key: 'login',
                  label: <span className="font-semibold px-2">Sign In</span>,
                  children: (
                    <Form
                      form={form}
                      layout="vertical"
                      onFinish={handleLoginSubmit}
                      initialValues={{ username: lastUsername }}
                      className="pt-2 space-y-2"
                    >
                      <Form.Item
                        name="username"
                        label={<span className="text-xs font-semibold">Username or Email</span>}
                        rules={[{ required: true, message: 'Please enter your username' }]}
                      >
                        <Input
                          prefix={<UserOutlined className="text-slate-400 mr-1" />}
                          placeholder="Username or email"
                          autoComplete="username"
                          autoFocus={!lastUsername}
                          size="large"
                          className="rounded-xl text-sm"
                        />
                      </Form.Item>

                      <Form.Item
                        name="password"
                        label={<span className="text-xs font-semibold">Password</span>}
                        rules={[{ required: true, message: 'Please enter your password' }]}
                      >
                        <Input.Password
                          prefix={<LockOutlined className="text-slate-400 mr-1" />}
                          placeholder="Enter password"
                          autoComplete="current-password"
                          autoFocus={Boolean(lastUsername)}
                          size="large"
                          className="rounded-xl text-sm"
                        />
                      </Form.Item>

                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        disabled={lockoutSec > 0}
                        block
                        size="large"
                        className="h-11 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 font-bold border-0 shadow-lg shadow-cyan-500/20 mt-2"
                      >
                        {lockoutSec > 0 ? `Try again in ${lockoutSec} seconds` : 'SIGN IN NOW'}
                      </Button>

                    </Form>
                  ),
                },
                {
                  key: 'license',
                  label: <span className="font-semibold px-2">License</span>,
                  children: (
                    <Form
                      form={licenseForm}
                      layout="vertical"
                      onFinish={handleActivateLicense}
                      className="pt-2 space-y-2"
                    >
                      <div className="p-3 rounded-2xl border text-xs space-y-1 bg-slate-950/80 border-slate-800">
                        <div className="text-slate-400 font-medium">Machine ID (HWID):</div>
                        <div className="font-mono text-cyan-300 font-bold text-xs truncate">
                          {hwid || 'Detecting HWID...'}
                        </div>
                      </div>

                      <Form.Item
                        name="licenseKey"
                        label={<span className="text-xs font-semibold">SaaS Activation Key</span>}
                        rules={[{ required: true, message: 'Please enter your license key' }]}
                      >
                        <Input
                          prefix={<KeyOutlined className="text-slate-400 mr-1" />}
                          placeholder="VIPLIKE-XXXX-XXXX-XXXX"
                          size="large"
                          className="rounded-xl font-mono text-xs uppercase"
                        />
                      </Form.Item>

                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        block
                        size="large"
                        className="h-11 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 font-bold border-0 shadow-lg shadow-amber-500/25"
                      >
                        ACTIVATE &amp; ENTER
                      </Button>
                    </Form>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-3 px-6 text-center text-xs text-slate-400 border-t border-slate-800/60">
        VIP LIKE • Made by <span className="text-slate-200 font-medium">thanhphu</span>
      </footer>
    </div>
  );
};

export default LoginPage;
