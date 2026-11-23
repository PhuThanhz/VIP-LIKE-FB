import React, { useState, useEffect } from 'react';
import { Modal, Tabs, Form, Input, Button, message, Typography, Tag, Avatar, Divider } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  KeyOutlined,
  LogoutOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import api from '../../config/axios';
import { getMachineHwid } from '../../utils/tauriBridge';
import { CurrentUser, isAdmin } from '../../auth/session';

const { Title, Text } = Typography;

export type AuthModalTab = 'profile' | 'license' | 'create-user';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  currentUser: CurrentUser;
  onLogout: () => void;
  initialTab?: AuthModalTab;
}

const INPUT_CLASS = 'bg-slate-900 border-slate-700 text-white rounded-xl';

/** Modal tài khoản cho người đã đăng nhập: hồ sơ, kích hoạt key, (admin) tạo tài khoản mới. */
export const AuthModal: React.FC<AuthModalProps> = ({
  open,
  onClose,
  currentUser,
  onLogout,
  initialTab = 'profile',
}) => {
  const admin = isAdmin(currentUser);
  const [activeTab, setActiveTab] = useState<AuthModalTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [createUserForm] = Form.useForm();
  const [licenseForm] = Form.useForm();
  const [hwid, setHwid] = useState('');

  useEffect(() => {
    getMachineHwid().then(setHwid);
  }, []);

  const handleCreateUser = async (values: any) => {
    try {
      setLoading(true);
      const res = await api.post('/auth/register', values);
      if (res.data?.success) {
        message.success(`Đã tạo tài khoản @${values.username} thành công!`);
        createUserForm.resetFields();
      } else {
        message.error(res.data?.error || 'Tạo tài khoản thất bại.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Lỗi tạo tài khoản.');
    } finally {
      setLoading(false);
    }
  };

  const handleActivateLicense = async (values: { licenseKey: string }) => {
    try {
      setLoading(true);
      const res = await api.post('/license/activate', {
        licenseKey: values.licenseKey.trim(),
        hardwareHwid: hwid,
      });
      if (res.data?.success) {
        message.success('Kích hoạt Bản Quyền VIPLIKE thành công!');
        licenseForm.resetFields();
        onClose();
      } else {
        message.error(res.data?.error || 'Mã key không hợp lệ hoặc đã hết hạn.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Mã key không hợp lệ hoặc đã hết hạn.');
    } finally {
      setLoading(false);
    }
  };

  const hwidBox = (
    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-left text-xs space-y-1">
      <div className="text-slate-400">Mã Thiết Bị Máy Tính (HWID):</div>
      <div className="font-mono text-cyan-300 truncate">{hwid || 'Đang nhận diện HWID...'}</div>
    </div>
  );

  const tabs = [
    {
      key: 'profile',
      label: 'Tài Khoản',
      children: (
        <div className="py-2 text-center space-y-4">
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

          <Tag color={admin ? 'gold' : 'blue'} className="px-2 py-0.5 font-semibold">
            {admin ? 'QUẢN TRỊ VIÊN' : 'BÊN THUÊ TOOL'}
          </Tag>

          {hwidBox}

          <Divider className="border-slate-800 my-3" />

          <Button
            danger
            block
            size="large"
            icon={<LogoutOutlined />}
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="rounded-xl font-medium"
          >
            Đăng Xuất Tài Khoản
          </Button>
        </div>
      ),
    },
    {
      key: 'license',
      label: 'Kích Hoạt Key',
      children: (
        <Form form={licenseForm} layout="vertical" onFinish={handleActivateLicense} className="pt-2">
          <div className="mb-3">{hwidBox}</div>
          <Form.Item
            name="licenseKey"
            label={<span className="text-slate-300">Mã License Key Bạn Được Cấp</span>}
            rules={[{ required: true, message: 'Vui lòng nhập License Key' }]}
          >
            <Input
              size="large"
              prefix={<KeyOutlined className="text-amber-400" />}
              placeholder="VIPLIKE-XXXX-XXXX-XXXX"
              className={`${INPUT_CLASS} font-mono uppercase`}
            />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            block
            size="large"
            loading={loading}
            className="bg-gradient-to-r from-amber-500 to-yellow-600 rounded-xl mt-2 h-11 text-black font-bold"
          >
            Kích Hoạt Bản Quyền Ngay
          </Button>
        </Form>
      ),
    },
    ...(admin
      ? [
          {
            key: 'create-user',
            label: 'Tạo Tài Khoản',
            children: (
              <Form form={createUserForm} layout="vertical" onFinish={handleCreateUser} className="pt-2">
                <Form.Item
                  name="username"
                  label={<span className="text-slate-300">Tên Đăng Nhập</span>}
                  rules={[{ required: true, message: 'Vui lòng nhập username' }]}
                >
                  <Input size="large" prefix={<UserOutlined className="text-slate-500" />} placeholder="VD: user123" className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item
                  name="email"
                  label={<span className="text-slate-300">Email</span>}
                  rules={[{ type: 'email', message: 'Email không hợp lệ' }]}
                >
                  <Input size="large" prefix={<MailOutlined className="text-slate-500" />} placeholder="email@example.com" className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item name="fullName" label={<span className="text-slate-300">Họ và Tên</span>}>
                  <Input size="large" prefix={<IdcardOutlined className="text-slate-500" />} placeholder="Họ và tên..." className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={<span className="text-slate-300">Mật Khẩu</span>}
                  rules={[{ required: true, min: 8, message: 'Mật khẩu tối thiểu 8 ký tự' }]}
                >
                  <Input.Password size="large" prefix={<LockOutlined className="text-slate-500" />} placeholder="Mật khẩu cho tài khoản mới..." className={INPUT_CLASS} />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  size="large"
                  loading={loading}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold rounded-xl mt-2 h-11"
                >
                  Tạo Tài Khoản
                </Button>
              </Form>
            ),
          },
        ]
      : []),
  ];

  return (
    <Modal open={open} onCancel={onClose} footer={null} destroyOnHidden centered width={460} className="dark-modal">
      <Tabs activeKey={activeTab} onChange={(key) => setActiveTab(key as AuthModalTab)} centered items={tabs} />
    </Modal>
  );
};

export default AuthModal;
