import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Tabs, Avatar, message } from 'antd';
import { UserOutlined, LockOutlined, ThunderboltFilled, CrownOutlined, KeyOutlined } from '@ant-design/icons';
import api from '../../config/axios';
import { getMachineHwid } from '../../utils/tauriBridge';
import { CurrentUser, parseAuthResponse, saveSession } from '../../auth/session';

interface LoginPageProps {
  onLoginSuccess: (user: CurrentUser) => void;
}

type LoginTab = 'login' | 'license';

// Dùng chung key để lỗi mới thay thế lỗi cũ, không chồng thông báo khi bấm nhiều lần
const AUTH_MESSAGE_KEY = 'auth-message';

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [activeTab, setActiveTab] = useState<LoginTab>('login');
  const [loading, setLoading] = useState(false);
  const [hwid, setHwid] = useState('');
  const [form] = Form.useForm();
  const [licenseForm] = Form.useForm();

  useEffect(() => {
    getMachineHwid().then(setHwid);
  }, []);

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
        message.success(`🎉 Chào mừng ${session.user.fullName} đã đăng nhập thành công!`);
        onLoginSuccess(session.user);
      } else {
        message.error({ content: res.data?.error || 'Đăng nhập không thành công', key: AUTH_MESSAGE_KEY });
      }
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || err.message || 'Tài khoản hoặc mật khẩu không chính xác!', key: AUTH_MESSAGE_KEY });
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
        message.success('🎉 Kích hoạt Bản Quyền thành công! Vui lòng đăng nhập để tiếp tục.');
        licenseForm.resetFields();
        setActiveTab('login');
      } else {
        message.error({ content: res.data?.error || 'Mã key không hợp lệ hoặc đã hết hạn.', key: AUTH_MESSAGE_KEY });
      }
    } catch (err: any) {
      message.error({ content: err.response?.data?.error || 'Kích hoạt key bản quyền thất bại.', key: AUTH_MESSAGE_KEY });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="px-6 py-4 flex items-center justify-between border-b bg-slate-900/60 border-slate-800/80 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20 text-white font-bold">
            <ThunderboltFilled className="text-lg" />
          </div>
          <div>
            <div className="font-extrabold text-sm tracking-wider uppercase bg-gradient-to-r from-cyan-500 to-blue-600 bg-clip-text text-transparent">
              VIPLIKE RADIANT
            </div>
            <div className="text-[10px] text-slate-400">Hệ Thống Tăng Tương Tác & Săn Bài Meta</div>
          </div>
        </div>

      </header>

      {/* Center Auth Card */}
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Card
            variant="outlined"
            className="shadow-2xl rounded-3xl !bg-slate-900/90 !border-slate-800 shadow-cyan-950/20"
          >
            {/* Header Badge & Brand */}
            <div className="text-center pb-4">
              <Avatar
                size={56}
                icon={<CrownOutlined />}
                className="bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25 mb-3"
              />
              <h1 className="text-xl font-black tracking-tight mb-1 text-white">
                ĐĂNG NHẬP HỆ THỐNG
              </h1>
              <p className="text-xs text-slate-400">
                Vui lòng xác thực tài khoản để truy cập dàn Fanpage & Công cụ Buff
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
                  label: <span className="font-semibold px-2">Đăng Nhập</span>,
                  children: (
                    <Form
                      form={form}
                      layout="vertical"
                      onFinish={handleLoginSubmit}
                      className="pt-2 space-y-2"
                    >
                      <Form.Item
                        name="username"
                        label={<span className="text-xs font-semibold">Tên Đăng Nhập hoặc Email</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}
                      >
                        <Input
                          prefix={<UserOutlined className="text-slate-400 mr-1" />}
                          placeholder="Tên đăng nhập hoặc email"
                          size="large"
                          className="rounded-xl text-sm"
                        />
                      </Form.Item>

                      <Form.Item
                        name="password"
                        label={<span className="text-xs font-semibold">Mật Khẩu</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập mật khẩu tài khoản' }]}
                      >
                        <Input.Password
                          prefix={<LockOutlined className="text-slate-400 mr-1" />}
                          placeholder="Nhập mật khẩu"
                          size="large"
                          className="rounded-xl text-sm"
                        />
                      </Form.Item>

                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={loading}
                        block
                        size="large"
                        className="h-11 rounded-xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-blue-500 font-bold border-0 shadow-lg shadow-cyan-500/25 mt-2"
                      >
                        🚀 ĐĂNG NHẬP NGAY
                      </Button>

                    </Form>
                  ),
                },
                {
                  key: 'license',
                  label: <span className="font-semibold px-2">🔑 Bản Quyền</span>,
                  children: (
                    <Form
                      form={licenseForm}
                      layout="vertical"
                      onFinish={handleActivateLicense}
                      className="pt-2 space-y-2"
                    >
                      <div className="p-3 rounded-2xl border text-xs space-y-1 bg-slate-950/80 border-slate-800">
                        <div className="text-slate-400 font-medium">Mã Thiết Bị Máy Tính (HWID):</div>
                        <div className="font-mono text-cyan-300 font-bold text-xs truncate">
                          {hwid || 'Đang nhận diện HWID...'}
                        </div>
                      </div>

                      <Form.Item
                        name="licenseKey"
                        label={<span className="text-xs font-semibold">Mã Key Kích Hoạt SaaS</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập key bản quyền' }]}
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
                        KÍCH HOẠT &amp; TRUY CẬP
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
        VIPLIKE RADIANT v2.0 • Bản Quyền Thuộc Về Hệ Sinh Thái VIPLIKE SaaS • Bảo Vệ Bằng Mã Hóa HWID
      </footer>
    </div>
  );
};

export default LoginPage;
