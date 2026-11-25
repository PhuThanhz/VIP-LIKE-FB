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

/** Account modal for signed-in users: profile, key activation, (admin) create new account. */
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
        message.success(`Account @${values.username} created successfully!`);
        createUserForm.resetFields();
      } else {
        message.error(res.data?.error || 'Failed to create account.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Error creating account.');
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
        message.success('VIPLIKE license activated successfully!');
        licenseForm.resetFields();
        onClose();
      } else {
        message.error(res.data?.error || 'Invalid or expired key.');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Invalid or expired key.');
    } finally {
      setLoading(false);
    }
  };

  const hwidBox = (
    <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-left text-xs space-y-1">
      <div className="text-slate-400">Machine ID (HWID):</div>
      <div className="font-mono text-cyan-300 truncate">{hwid || 'Detecting HWID...'}</div>
    </div>
  );

  const tabs = [
    {
      key: 'profile',
      label: 'Account',
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
            {admin ? 'ADMINISTRATOR' : 'TOOL RENTER'}
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
            Log Out
          </Button>
        </div>
      ),
    },
    {
      key: 'license',
      label: 'Activate Key',
      children: (
        <Form form={licenseForm} layout="vertical" onFinish={handleActivateLicense} className="pt-2">
          <div className="mb-3">{hwidBox}</div>
          <Form.Item
            name="licenseKey"
            label={<span className="text-slate-300">Your License Key</span>}
            rules={[{ required: true, message: 'Please enter a License Key' }]}
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
            Activate License Now
          </Button>
        </Form>
      ),
    },
    ...(admin
      ? [
          {
            key: 'create-user',
            label: 'Create Account',
            children: (
              <Form form={createUserForm} layout="vertical" onFinish={handleCreateUser} className="pt-2">
                <Form.Item
                  name="username"
                  label={<span className="text-slate-300">Username</span>}
                  rules={[{ required: true, message: 'Please enter a username' }]}
                >
                  <Input size="large" prefix={<UserOutlined className="text-slate-500" />} placeholder="VD: user123" className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item
                  name="email"
                  label={<span className="text-slate-300">Email</span>}
                  rules={[{ type: 'email', message: 'Invalid email' }]}
                >
                  <Input size="large" prefix={<MailOutlined className="text-slate-500" />} placeholder="email@example.com" className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item name="fullName" label={<span className="text-slate-300">Full Name</span>}>
                  <Input size="large" prefix={<IdcardOutlined className="text-slate-500" />} placeholder="Full name..." className={INPUT_CLASS} />
                </Form.Item>
                <Form.Item
                  name="password"
                  label={<span className="text-slate-300">Password</span>}
                  rules={[{ required: true, min: 8, message: 'Password must be at least 8 characters' }]}
                >
                  <Input.Password size="large" prefix={<LockOutlined className="text-slate-500" />} placeholder="Password for the new account..." className={INPUT_CLASS} />
                </Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  block
                  size="large"
                  loading={loading}
                  className="bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold rounded-xl mt-2 h-11"
                >
                  Create Account
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
