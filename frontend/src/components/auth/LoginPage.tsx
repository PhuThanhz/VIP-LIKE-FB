import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Tabs, Tag, Avatar, Tooltip, message, Space } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  ThunderboltFilled,
  CrownOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import { getMachineHwid } from '../../utils/tauriBridge';

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
}

interface LoginPageProps {
  onLoginSuccess: (user: CurrentUser) => void;
  dbConnected?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, dbConnected = true }) => {
  const [activeTab, setActiveTab] = useState<'login' | 'quick' | 'license'>('login');
  const [loading, setLoading] = useState(false);
  const [hwid, setHwid] = useState('');
  const [form] = Form.useForm();
  const [licenseForm] = Form.useForm();

  useEffect(() => {
    getMachineHwid().then((id) => setHwid(id || 'HWID-MAC-RADIANT-2026'));
  }, []);

  // Xử lý đăng nhập form
  const handleLoginSubmit = async (values: any) => {
    setLoading(true);
    try {
      const res = await api.post('/auth/login', {
        username: values.username.trim(),
        password: values.password.trim(),
      });

      const data = res.data?.data || res.data;
      if (data?.token && (data?.user || data?.username)) {
        const userObj: CurrentUser = data.user || {
          id: data.id || Date.now(),
          username: data.username || values.username.trim(),
          email: data.email || `${values.username.trim()}@viplike.vn`,
          fullName: data.fullName || values.username.trim(),
          role: data.role || 'ADMIN',
        };
        const token = data.token;
        localStorage.setItem('viplike_token', token);
        localStorage.setItem('viplike_user', JSON.stringify(userObj));
        message.success(`🎉 Chào mừng ${userObj.fullName} đã đăng nhập thành công!`);
        onLoginSuccess(userObj);
      } else {
        message.error(res.data?.error || 'Đăng nhập không thành công');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Tài khoản hoặc mật khẩu không chính xác!');
    } finally {
      setLoading(false);
    }
  };

  // Đăng nhập nhanh 1-Click (Gửi thông tin thật lên backend để nhận JWT token chuẩn)
  const handleQuickLogin = async (accountType: 'thanhan' | 'admin' | 'phu') => {
    setLoading(true);
    const username = accountType === 'thanhan' ? 'thanhan' : accountType === 'admin' ? 'admin' : 'huynhthanhphu';
    try {
      const res = await api.post('/auth/login', {
        username,
        password: '123',
      });
      const data = res.data?.data || res.data;
      if (data?.token) {
        const userObj: CurrentUser = data.user || {
          id: data.id || Date.now(),
          username: data.username || username,
          email: data.email || `${username}@viplike.vn`,
          fullName: data.fullName || username,
          role: data.role || 'ADMIN',
        };
        localStorage.setItem('viplike_token', data.token);
        localStorage.setItem('viplike_user', JSON.stringify(userObj));
        message.success(`🎉 Đã đăng nhập xác thực JWT thành công: ${userObj.fullName}`);
        onLoginSuccess(userObj);
      } else {
        message.error(res.data?.error || 'Đăng nhập nhanh thất bại');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Không kết nối được server xác thực');
    } finally {
      setLoading(false);
    }
  };

  // Kích hoạt key bản quyền
  const handleActivateLicense = async (values: any) => {
    setLoading(true);
    try {
      const res = await api.post('/api/license/activate', {
        licenseKey: values.licenseKey.trim(),
        hardwareHwid: hwid,
      });
      if (res.data?.success) {
        message.success('🎉 Kích hoạt Bản Quyền VIPLIKE thành công!');
        await handleQuickLogin('thanhan');
      } else {
        message.error(res.data?.error || 'Mã key không hợp lệ hoặc đã hết hạn.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Kích hoạt key bản quyền thất bại.');
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
            bordered
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
              onChange={(key) => setActiveTab(key as any)}
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
                      initialValues={{ username: 'thanhan', password: '' }}
                      className="pt-2 space-y-2"
                    >
                      <Form.Item
                        name="username"
                        label={<span className="text-xs font-semibold">Tên Đăng Nhập hoặc Nick Mẹ</span>}
                        rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}
                      >
                        <Input
                          prefix={<UserOutlined className="text-slate-400 mr-1" />}
                          placeholder="Ví dụ: thanhan hoặc admin"
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
                          placeholder="Nhập mật khẩu (Mặc định: 123)"
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

                      <div className="pt-2 text-center">
                        <button
                          type="button"
                          onClick={() => setActiveTab('quick')}
                          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium underline cursor-pointer"
                        >
                          Hoặc sử dụng Đăng Nhập Nhanh 1-Chạm (Khuyên Dùng) &rarr;
                        </button>
                      </div>
                    </Form>
                  ),
                },
                {
                  key: 'quick',
                  label: <span className="font-semibold px-2">⚡ 1-Chạm Nhanh</span>,
                  children: (
                    <div className="pt-2 space-y-3">
                      <p className="text-xs text-slate-400 text-center">
                        Chọn tài khoản có sẵn trong hệ thống để vào ngay bảng điều khiển:
                      </p>

                      <Button
                        block
                        size="large"
                        onClick={() => handleQuickLogin('thanhan')}
                        className="h-auto py-3 px-4 rounded-2xl flex items-center justify-between border transition-all text-left bg-cyan-950/40 border-cyan-700/60 hover:bg-cyan-900/60 hover:border-cyan-500"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            size={36}
                            className="bg-cyan-600 font-bold shrink-0"
                            icon={<CrownOutlined />}
                          />
                          <div>
                            <div className="font-bold text-xs text-cyan-300">
                              Thành An (Nick Mẹ)
                            </div>
                            <div className="text-[11px] text-slate-400">UID: 100023403136194 • 512 Fanpage</div>
                          </div>
                        </div>
                        <Tag color="cyan" className="rounded-full px-2 text-[10px] font-mono border-0">
                          Chính
                        </Tag>
                      </Button>

                      <Button
                        block
                        size="large"
                        onClick={() => handleQuickLogin('admin')}
                        className="h-auto py-3 px-4 rounded-2xl flex items-center justify-between border transition-all text-left bg-blue-950/40 border-blue-700/60 hover:bg-blue-900/60 hover:border-blue-500"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            size={36}
                            className="bg-blue-600 font-bold shrink-0"
                            icon={<CheckCircleOutlined />}
                          />
                          <div>
                            <div className="font-bold text-xs text-blue-300">
                              Quản Trị Viên VIPLIKE
                            </div>
                            <div className="text-[11px] text-slate-400">Toàn quyền cấu hình & Bản quyền</div>
                          </div>
                        </div>
                        <Tag color="blue" className="rounded-full px-2 text-[10px] font-mono border-0">
                          Admin
                        </Tag>
                      </Button>

                      <Button
                        block
                        size="large"
                        onClick={() => handleQuickLogin('phu')}
                        className="h-auto py-3 px-4 rounded-2xl flex items-center justify-between border transition-all text-left bg-purple-950/40 border-purple-700/60 hover:bg-purple-900/60 hover:border-purple-500"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar
                            size={36}
                            className="bg-purple-600 font-bold shrink-0"
                            icon={<RocketOutlined />}
                          />
                          <div>
                            <div className="font-bold text-xs text-purple-300">
                              Huỳnh Thạnh Phú
                            </div>
                            <div className="text-[11px] text-slate-400">UID: 100008447847970 • 25 Fanpage</div>
                          </div>
                        </div>
                        <Tag color="purple" className="rounded-full px-2 text-[10px] font-mono border-0">
                          Nick Phụ
                        </Tag>
                      </Button>
                    </div>
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
