import React, { useState, useEffect } from 'react';
import {
  Modal,
  Tabs,
  Form,
  Input,
  Button,
  message,
  Typography,
  Tag,
  Avatar,
  Space,
  Divider,
} from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  KeyOutlined,
  CrownOutlined,
  LogoutOutlined,
  CheckCircleOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import api, { springApi } from '../../config/axios';
import { getMachineHwid, isTauri } from '../../utils/tauriBridge';

const { Title, Text } = Typography;

export interface CurrentUser {
  id: number;
  username: string;
  email: string;
  fullName: string;
  role: string;
}

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: CurrentUser | null;
  onUserChange: (user: CurrentUser | null) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  currentUser,
  onUserChange,
}) => {
  const [activeTab, setActiveTab] = useState('login');
  const [loading, setLoading] = useState(false);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
  const [licenseForm] = Form.useForm();
  const [hwid, setHwid] = useState('');

  useEffect(() => {
    getMachineHwid().then(setHwid);
  }, []);

  // Xử lý Đăng Nhập
  const handleLogin = async (values: any) => {
    try {
      setLoading(true);
      let res;
      try {
        // Ưu tiên gọi Java Spring Boot (:8080)
        res = await springApi.post('/auth/login', values);
      } catch (springErr) {
        // Fallback sang Node.js (:3100) nếu Spring Boot chưa khởi động
        res = await api.post('/auth/login', values);
      }

      const data = res.data?.data || res.data;
      if (data?.token) {
        localStorage.setItem('viplike_token', data.token);
        const userObj: CurrentUser = {
          id: data.id,
          username: data.username,
          email: data.email,
          fullName: data.fullName || data.username,
          role: data.role || 'ADMIN',
        };
        localStorage.setItem('viplike_user', JSON.stringify(userObj));
        onUserChange(userObj);
        message.success(`🎉 Đăng nhập thành công! Xin chào ${userObj.fullName}`);
        loginForm.resetFields();
        onClose();
      } else {
        message.error(res.data?.error || 'Đăng nhập thất bại.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Sai tài khoản hoặc mật khẩu.');
    } finally {
      setLoading(false);
    }
  };

  // Xử lý Đăng Ký
  const handleRegister = async (values: any) => {
    try {
      setLoading(true);
      let res;
      try {
        res = await springApi.post('/auth/register', values);
      } catch (springErr) {
        res = await api.post('/auth/register', values);
      }

      const data = res.data?.data || res.data;
      if (data?.token) {
        localStorage.setItem('viplike_token', data.token);
        const userObj: CurrentUser = {
          id: data.id,
          username: data.username,
          email: data.email,
          fullName: data.fullName || data.username,
          role: data.role || 'USER',
        };
        localStorage.setItem('viplike_user', JSON.stringify(userObj));
        onUserChange(userObj);
        message.success('🎉 Đăng ký tài khoản thành công!');
        registerForm.resetFields();
        onClose();
      } else {
        message.error(res.data?.error || 'Đăng ký thất bại.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Lỗi đăng ký tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  // Xử lý Kích hoạt Bản Quyền
  const handleActivateLicense = async (values: any) => {
    try {
      setLoading(true);
      const res = await api.post('/license/activate', {
        licenseKey: values.licenseKey.trim(),
        hardwareHwid: hwid,
      });

      if (res.data?.success) {
        message.success('🎉 Kích hoạt Bản Quyền VIPLIKE thành công!');
        licenseForm.resetFields();
        onClose();
        window.location.reload();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Mã key không hợp lệ hoặc đã hết hạn.');
    } finally {
      setLoading(false);
    }
  };

  // Xử lý Đăng Xuất
  const handleLogout = () => {
    localStorage.removeItem('viplike_token');
    localStorage.removeItem('viplike_user');
    onUserChange(null);
    message.info('Đã đăng xuất khỏi hệ thống');
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      width={460}
      className="dark-modal"
    >
      {currentUser ? (
        <div className="py-4 text-center space-y-4">
          <Avatar
            size={72}
            icon={<UserOutlined />}
            className="bg-gradient-to-tr from-cyan-500 to-blue-600 shadow-xl shadow-cyan-500/20"
          />
          <div>
            <Title level={4} className="!text-white !m-0">
              {currentUser.fullName}
            </Title>
            <Text className="text-slate-400 text-xs block mt-0.5">@{currentUser.username}</Text>
            <Text className="text-slate-500 text-xs block">{currentUser.email}</Text>
          </div>

          <div className="flex items-center justify-center gap-2">
            <Tag color={currentUser.role === 'ADMIN' ? 'gold' : 'blue'} className="px-2 py-0.5">
              {currentUser.role === 'ADMIN' ? '👑 QUẢN TRỊ VIÊN' : 'BÊN THUÊ TOOL'}
            </Tag>
            {isTauri() ? (
              <Tag color="cyan">🦀 Tauri Native</Tag>
            ) : (
              <Tag color="geekblue">🌐 Web Client</Tag>
            )}
          </div>

          <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-left text-xs space-y-1">
            <div className="text-slate-400">Mã Thiết Bị (HWID):</div>
            <div className="font-mono text-cyan-300 truncate">{hwid}</div>
          </div>

          <Divider className="border-slate-800 my-3" />

          <Button
            danger
            block
            size="large"
            icon={<LogoutOutlined />}
            onClick={handleLogout}
            className="rounded-xl font-medium"
          >
            Đăng Xuất Tài Khoản
          </Button>
        </div>
      ) : (
        <div>
          <div className="text-center mb-5">
            <Avatar
              size={48}
              icon={<CrownOutlined />}
              className="bg-gradient-to-tr from-amber-500 to-yellow-600 mb-2 shadow-lg shadow-amber-500/20"
            />
            <Title level={4} className="!text-white !m-0">
              VIPLIKE RADIANT SaaS
            </Title>
            <Text className="text-slate-400 text-xs">
              Hệ thống bảo mật đa tầng &amp; Mã hoá chuẩn Enterprise
            </Text>
          </div>

          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            centered
            items={[
              {
                key: 'login',
                label: 'Đăng Nhập',
                children: (
                  <Form form={loginForm} layout="vertical" onFinish={handleLogin} className="pt-2">
                    <Form.Item
                      name="username"
                      label={<span className="text-slate-300">Tên Đăng Nhập hoặc Email</span>}
                      rules={[{ required: true, message: 'Vui lòng nhập tên đăng nhập' }]}
                    >
                      <Input
                        size="large"
                        prefix={<UserOutlined className="text-slate-500" />}
                        placeholder="admin hoặc email..."
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Form.Item
                      name="password"
                      label={<span className="text-slate-300">Mật Khẩu</span>}
                      rules={[{ required: true, message: 'Vui lòng nhập mật khẩu' }]}
                    >
                      <Input.Password
                        size="large"
                        prefix={<LockOutlined className="text-slate-500" />}
                        placeholder="Mật khẩu của bạn..."
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Button
                      type="primary"
                      htmlType="submit"
                      block
                      size="large"
                      loading={loading}
                      className="bg-gradient-to-r from-cyan-500 to-blue-600 font-semibold rounded-xl mt-2 h-11"
                    >
                      Đăng Nhập Ngay
                    </Button>
                  </Form>
                ),
              },
              {
                key: 'register',
                label: 'Đăng Ký',
                children: (
                  <Form form={registerForm} layout="vertical" onFinish={handleRegister} className="pt-2">
                    <Form.Item
                      name="username"
                      label={<span className="text-slate-300">Tên Đăng Nhập</span>}
                      rules={[{ required: true, message: 'Vui lòng nhập username' }]}
                    >
                      <Input
                        size="large"
                        prefix={<UserOutlined className="text-slate-500" />}
                        placeholder="VD: user123"
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Form.Item
                      name="email"
                      label={<span className="text-slate-300">Email</span>}
                      rules={[
                        { required: true, message: 'Vui lòng nhập email' },
                        { type: 'email', message: 'Email không hợp lệ' },
                      ]}
                    >
                      <Input
                        size="large"
                        prefix={<MailOutlined className="text-slate-500" />}
                        placeholder="email@example.com"
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Form.Item
                      name="fullName"
                      label={<span className="text-slate-300">Họ và Tên</span>}
                    >
                      <Input
                        size="large"
                        prefix={<IdcardOutlined className="text-slate-500" />}
                        placeholder="Họ và tên của bạn..."
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Form.Item
                      name="password"
                      label={<span className="text-slate-300">Mật Khẩu</span>}
                      rules={[{ required: true, min: 6, message: 'Mật khẩu tối thiểu 6 ký tự' }]}
                    >
                      <Input.Password
                        size="large"
                        prefix={<LockOutlined className="text-slate-500" />}
                        placeholder="Mật khẩu bảo mật..."
                        className="bg-slate-900 border-slate-700 text-white rounded-xl"
                      />
                    </Form.Item>

                    <Button
                      type="primary"
                      htmlType="submit"
                      block
                      size="large"
                      loading={loading}
                      className="bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold rounded-xl mt-2 h-11"
                    >
                      Đăng Ký Tài Khoản
                    </Button>
                  </Form>
                ),
              },
              {
                key: 'license',
                label: 'Kích Hoạt Key',
                children: (
                  <Form form={licenseForm} layout="vertical" onFinish={handleActivateLicense} className="pt-2">
                    <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 text-xs mb-3 space-y-1">
                      <div className="text-slate-400">Mã Thiết Bị Máy Tính (HWID):</div>
                      <div className="font-mono text-cyan-300 truncate">{hwid}</div>
                    </div>

                    <Form.Item
                      name="licenseKey"
                      label={<span className="text-slate-300">Mã License Key Bạn Được Cấp</span>}
                      rules={[{ required: true, message: 'Vui lòng nhập License Key' }]}
                    >
                      <Input
                        size="large"
                        prefix={<KeyOutlined className="text-amber-400" />}
                        placeholder="VD: VIP-PRO-2026-TRIAL-8888"
                        className="bg-slate-900 border-slate-700 text-white font-mono rounded-xl uppercase"
                      />
                    </Form.Item>

                    <Button
                      type="primary"
                      htmlType="submit"
                      block
                      size="large"
                      loading={loading}
                      className="bg-gradient-to-r from-amber-500 to-yellow-600 font-semibold rounded-xl mt-2 h-11 text-black font-bold"
                    >
                      Kích Hoạt Bản Quyền Ngay
                    </Button>
                  </Form>
                ),
              },
            ]}
          />
        </div>
      )}
    </Modal>
  );
};

export default AuthModal;
