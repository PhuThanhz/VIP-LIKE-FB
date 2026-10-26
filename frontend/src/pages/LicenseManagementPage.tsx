import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Input,
  Form,
  Table,
  Tag,
  Modal,
  Select,
  InputNumber,
  Alert,
  Space,
  Typography,
  Tooltip,
  Divider,
  Popconfirm,
  Progress,
  message,
  Row,
  Col,
  Statistic,
} from 'antd';
import {
  KeyOutlined,
  CopyOutlined,
  SafetyCertificateOutlined,
  LockOutlined,
  UnlockOutlined,
  UserOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  LaptopOutlined,
  CrownOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import api from '../config/axios';

const { Title, Text, Paragraph } = Typography;

interface LicenseInfo {
  licenseKey: string;
  customerName: string;
  packageType: string;
  maxVias: number;
  expiresAt: string;
  daysRemaining: number;
  isExpired: boolean;
  status: string;
}

interface AdminLicenseItem {
  id: number;
  licenseKey: string;
  customerName: string;
  customerContact?: string;
  hardwareHwid?: string | null;
  packageType: string;
  maxVias: number;
  status: string;
  activatedAt?: string | null;
  expiresAt: string;
  notes?: string;
  createdAt: string;
}

export const LicenseManagementPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [currentLicense, setCurrentLicense] = useState<LicenseInfo | null>(null);
  const [adminLicenses, setAdminLicenses] = useState<AdminLicenseItem[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [licenseInput, setLicenseInput] = useState('');
  const [createForm] = Form.useForm();

  // Tạo Hardware ID giả lập trình duyệt / máy khách
  const [hardwareHwid] = useState(() => {
    const saved = localStorage.getItem('viplike_hwid');
    if (saved) return saved;
    const newHwid = `MAC-${Math.random().toString(36).substring(2, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    localStorage.setItem('viplike_hwid', newHwid);
    return newHwid;
  });

  // Tải trạng thái bản quyền hiện tại
  const fetchLicenseStatus = async () => {
    try {
      setLoading(true);
      const res = await api.get('/api/license/status');
      if (res.data?.success && res.data?.license) {
        setCurrentLicense(res.data.license);
      } else {
        setCurrentLicense(null);
      }
    } catch (err: any) {
      console.warn('Lỗi lấy trạng thái license:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // Tải danh sách khách thuê (dành cho Admin)
  const fetchAdminLicenses = async () => {
    try {
      const res = await api.get('/api/license/admin/list');
      if (res.data?.success) {
        setAdminLicenses(res.data.licenses || []);
      }
    } catch (err: any) {
      console.warn('Lỗi lấy danh sách licenses admin:', err.message);
    }
  };

  useEffect(() => {
    fetchLicenseStatus();
    fetchAdminLicenses();
  }, []);

  // Kích hoạt License Key trên máy này
  const handleActivate = async () => {
    if (!licenseInput.trim()) {
      message.warning('Vui lòng nhập Mã License Key để kích hoạt');
      return;
    }
    try {
      setActivating(true);
      const res = await api.post('/api/license/activate', {
        licenseKey: licenseInput.trim(),
        hardwareHwid,
      });
      if (res.data?.success) {
        message.success('🎉 Kích hoạt Bản Quyền VIPLIKE RADIANT thành công!');
        setLicenseInput('');
        fetchLicenseStatus();
        fetchAdminLicenses();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Kích hoạt thất bại. Kiểm tra lại mã key.');
    } finally {
      setActivating(false);
    }
  };

  // Admin tạo key mới cho khách thuê
  const handleCreateLicense = async (values: any) => {
    try {
      const res = await api.post('/api/license/admin/create', values);
      if (res.data?.success) {
        message.success(`Đã tạo License Key thành công cho: ${values.customerName}`);
        setIsCreateModalOpen(false);
        createForm.resetFields();
        fetchAdminLicenses();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Lỗi khi tạo License Key');
    }
  };

  // Admin gia hạn thêm 30 ngày
  const handleExtendDays = async (id: number) => {
    try {
      const res = await api.post('/api/license/admin/update-status', {
        id,
        status: 'ACTIVE',
        addDays: 30,
      });
      if (res.data?.success) {
        message.success('Đã gia hạn thêm +30 ngày cho khách thuê!');
        fetchAdminLicenses();
        fetchLicenseStatus();
      }
    } catch (err: any) {
      message.error('Gia hạn thất bại');
    }
  };

  // Admin Khóa / Mở Khóa key
  const handleToggleLock = async (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'LOCKED' ? 'ACTIVE' : 'LOCKED';
    try {
      const res = await api.post('/api/license/admin/update-status', {
        id,
        status: nextStatus,
      });
      if (res.data?.success) {
        message.info(nextStatus === 'LOCKED' ? 'Đã KHÓA mã thuê này!' : 'Đã MỞ KHÓA thành công!');
        fetchAdminLicenses();
        fetchLicenseStatus();
      }
    } catch (err: any) {
      message.error('Lỗi cập nhật trạng thái');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    message.success(`Đã sao chép ${label}!`);
  };

  const adminColumns = [
    {
      title: 'Khách Thuê / Bên Thuê',
      key: 'customer',
      render: (_: any, record: AdminLicenseItem) => (
        <div>
          <Text strong className="text-white block text-sm">
            {record.customerName}
          </Text>
          {record.customerContact && (
            <Text className="text-xs text-slate-400">Liên hệ: {record.customerContact}</Text>
          )}
          {record.notes && (
            <Text className="text-[11px] text-slate-500 block italic">Note: {record.notes}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'Mã License Key (Gửi cho khách)',
      key: 'licenseKey',
      render: (_: any, record: AdminLicenseItem) => (
        <div className="flex items-center gap-2">
          <Tag color="cyan" className="font-mono text-xs px-2 py-0.5 m-0 border-cyan-800">
            {record.licenseKey}
          </Tag>
          <Tooltip title="Sao chép Key gửi cho khách">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(record.licenseKey, 'Mã License Key')}
              className="text-cyan-400 hover:text-cyan-300"
            />
          </Tooltip>
        </div>
      ),
    },
    {
      title: 'Gói & Giới Hạn',
      key: 'package',
      render: (_: any, record: AdminLicenseItem) => {
        const pkgMap: Record<string, { label: string; color: string }> = {
          TRIAL_3DAYS: { label: 'Dùng thử 3 ngày', color: 'orange' },
          '1_MONTH': { label: '1 Tháng', color: 'blue' },
          '3_MONTHS': { label: '3 Tháng', color: 'purple' },
          '6_MONTHS': { label: '6 Tháng', color: 'magenta' },
          '1_YEAR': { label: '1 Năm', color: 'gold' },
          LIFETIME: { label: 'Vĩnh Viễn', color: 'success' },
        };
        const p = pkgMap[record.packageType] || { label: record.packageType, color: 'default' };
        return (
          <div>
            <Tag color={p.color}>{p.label}</Tag>
            <div className="text-xs text-slate-400 mt-1">
              Max: <span className="text-white font-medium">{record.maxVias} Via</span>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Hạn Sử Dụng',
      key: 'expiresAt',
      render: (_: any, record: AdminLicenseItem) => {
        const expireDate = new Date(record.expiresAt);
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
        const isExpired = expireDate < now;

        return (
          <div>
            <div className={`text-xs font-semibold ${isExpired ? 'text-rose-400' : 'text-emerald-400'}`}>
              {isExpired ? 'ĐÃ HẾT HẠN' : `Còn ${daysLeft} ngày`}
            </div>
            <div className="text-[11px] text-slate-500">{expireDate.toLocaleDateString('vi-VN')}</div>
          </div>
        );
      },
    },
    {
      title: 'Mã Máy Khách (HWID)',
      key: 'hardwareHwid',
      render: (_: any, record: AdminLicenseItem) => (
        record.hardwareHwid ? (
          <Tooltip title={`Khóa chặt vào máy: ${record.hardwareHwid}`}>
            <Tag color="geekblue" className="font-mono text-[11px]">
              🔒 {record.hardwareHwid.substring(0, 14)}...
            </Tag>
          </Tooltip>
        ) : (
          <Tag color="default" className="text-[11px]">
            Chưa kích hoạt vào máy
          </Tag>
        )
      ),
    },
    {
      title: 'Trạng Thái',
      key: 'status',
      render: (_: any, record: AdminLicenseItem) => {
        if (record.status === 'LOCKED') return <Tag color="error">ĐÃ KHÓA</Tag>;
        const isExpired = new Date(record.expiresAt) < new Date();
        if (isExpired) return <Tag color="warning">HẾT HẠN</Tag>;
        return <Tag color="success">HOẠT ĐỘNG</Tag>;
      },
    },
    {
      title: 'Thao Tác Admin',
      key: 'action',
      render: (_: any, record: AdminLicenseItem) => (
        <Space size="small">
          <Tooltip title="Gia hạn thêm +30 ngày cho khách">
            <Button
              size="small"
              className="bg-emerald-950/60 text-emerald-400 border-emerald-800 hover:bg-emerald-900"
              icon={<ClockCircleOutlined />}
              onClick={() => handleExtendDays(record.id)}
            >
              +30 ngày
            </Button>
          </Tooltip>
          <Tooltip title={record.status === 'LOCKED' ? 'Mở khóa cho khách dùng tiếp' : 'Khóa key nếu khách chưa đóng tiền'}>
            <Button
              size="small"
              danger={record.status !== 'LOCKED'}
              type={record.status === 'LOCKED' ? 'primary' : 'default'}
              icon={record.status === 'LOCKED' ? <UnlockOutlined /> : <LockOutlined />}
              onClick={() => handleToggleLock(record.id, record.status)}
            >
              {record.status === 'LOCKED' ? 'Mở Khóa' : 'Khóa Key'}
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gradient-to-r from-slate-900 via-[#0d1527] to-slate-900 p-5 rounded-2xl border border-slate-800/80 shadow-xl">
        <div>
          <div className="flex items-center gap-2 text-cyan-400 font-semibold text-xs tracking-wider uppercase mb-1">
            <CrownOutlined /> Mô Hình Cho Thuê Phần Mềm (Tauri SaaS Licensing)
          </div>
          <Title level={3} className="!text-white !m-0">
            Quản Lý Bản Quyền & Hệ Thống Cho Thuê Tool
          </Title>
          <Text className="text-slate-400 text-sm">
            Đóng gói bằng Tauri (Rust) + React JS. Khóa theo mã máy phần cứng (HWID), cấp key theo tháng và tự động ngắt khi hết hạn.
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="large"
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 font-medium shadow-lg shadow-cyan-500/20"
          >
            Cấp Mã Thuê Mới Cho Khách
          </Button>
          <Button
            icon={<ReloadOutlined />}
            size="large"
            onClick={() => {
              fetchLicenseStatus();
              fetchAdminLicenses();
            }}
            className="border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white"
          >
            Làm Mới
          </Button>
        </div>
      </div>

      {/* THẺ TRẠNG THÁI BẢN QUYỀN MÁY NÀY */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card
            className="bg-[#0b1325]/90 border-slate-800 shadow-xl rounded-2xl h-full"
            title={
              <div className="flex items-center gap-2 text-white">
                <SafetyCertificateOutlined className="text-emerald-400 text-lg" />
                <span>Trạng Thái Bản Quyền Trên Thiết Bị Này</span>
              </div>
            }
          >
            {currentLicense ? (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                  <div>
                    <div className="flex items-center gap-2">
                      <Tag color="success" className="px-2 py-0.5 font-semibold">
                        {currentLicense.status === 'ACTIVE' ? 'ĐÃ KÍCH HOẠT HỢP LỆ' : currentLicense.status}
                      </Tag>
                      <Tag color="cyan">{currentLicense.packageType}</Tag>
                    </div>
                    <Title level={4} className="!text-white !mt-2 !mb-0">
                      {currentLicense.customerName}
                    </Title>
                    <Text className="text-xs text-slate-400">
                      Mã Key: <span className="font-mono text-cyan-300">{currentLicense.licenseKey}</span>
                    </Text>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Thời Hạn Thuê</div>
                    <div className="text-2xl font-bold text-emerald-400 mt-1">
                      {currentLicense.daysRemaining} <span className="text-sm font-normal text-slate-300">ngày</span>
                    </div>
                    <Text className="text-[11px] text-slate-400">
                      Hết hạn: {new Date(currentLicense.expiresAt).toLocaleDateString('vi-VN')}
                    </Text>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                    <Text className="text-slate-400 text-xs block">Giới Hạn Nick</Text>
                    <Text className="text-white font-bold text-base">{currentLicense.maxVias} Via</Text>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                    <Text className="text-slate-400 text-xs block">Mã Máy Tính (HWID)</Text>
                    <Text className="text-cyan-300 font-mono text-xs block truncate">{hardwareHwid}</Text>
                  </div>
                  <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                    <Text className="text-slate-400 text-xs block">Chống Gian Lận</Text>
                    <Text className="text-emerald-400 font-medium text-xs">🔒 Khóa 1 Máy / 1 Key</Text>
                  </div>
                </div>
              </div>
            ) : (
              <Alert
                message="Chưa có bản quyền hoạt động"
                description="Thiết bị này chưa kích hoạt mã bản quyền hoặc key đã hết hạn. Hãy nhập mã key bạn được cấp để mở khóa toàn bộ tính năng nuôi và tương tác."
                type="warning"
                showIcon
                className="bg-amber-950/20 border-amber-900/50 text-slate-300"
              />
            )}
          </Card>
        </Col>

        {/* Ô KÍCH HOẠT KEY CHO MÁY KHÁCH */}
        <Col xs={24} lg={9}>
          <Card
            className="bg-[#0b1325]/90 border-slate-800 shadow-xl rounded-2xl h-full flex flex-col justify-between"
            title={
              <div className="flex items-center gap-2 text-white">
                <KeyOutlined className="text-cyan-400 text-lg" />
                <span>Kích Hoạt / Nhập Mã Bản Quyền Mới</span>
              </div>
            }
          >
            <div className="space-y-4">
              <div>
                <Text className="text-slate-300 text-xs block mb-1 font-medium">Mã Thiết Bị Máy Tính Này (HWID):</Text>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={hardwareHwid}
                    className="bg-slate-900 border-slate-700 text-cyan-300 font-mono text-xs"
                  />
                  <Tooltip title="Sao chép mã máy gửi cho Admin cấp key">
                    <Button
                      icon={<CopyOutlined />}
                      onClick={() => copyToClipboard(hardwareHwid, 'Mã Thiết Bị (HWID)')}
                      className="border-slate-700 bg-slate-800 text-slate-300"
                    />
                  </Tooltip>
                </div>
              </div>

              <div>
                <Text className="text-slate-300 text-xs block mb-1 font-medium">Nhập Mã License Key Bạn Được Cấp:</Text>
                <Input
                  size="large"
                  placeholder="VD: VIP-PRO-2026-TRIAL-8888"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  className="bg-slate-900 border-slate-700 text-white font-mono placeholder:text-slate-600"
                  prefix={<KeyOutlined className="text-cyan-400 mr-1" />}
                />
              </div>

              <Button
                type="primary"
                size="large"
                block
                loading={activating}
                onClick={handleActivate}
                className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-semibold shadow-lg shadow-emerald-500/20"
              >
                Kích Hoạt Bản Quyền Ngay
              </Button>
            </div>
          </Card>
        </Col>
      </Row>

      {/* DANH SÁCH KHÁCH THUÊ DÀNH CHO ADMIN */}
      <Card
        className="bg-[#0b1325]/90 border-slate-800 shadow-xl rounded-2xl"
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-white">
              <UserOutlined className="text-cyan-400 text-lg" />
              <span>Sổ Quản Lý Các Bên Đang Thuê Tool ({adminLicenses.length} Khách)</span>
            </div>
            <Tag color="blue" className="text-xs">
              Chỉ Admin Nhìn Thấy
            </Tag>
          </div>
        }
      >
        <Table
          dataSource={adminLicenses}
          columns={adminColumns}
          rowKey="id"
          pagination={{ pageSize: 6 }}
          className="ant-table-dark-custom"
          scroll={{ x: 1000 }}
        />
      </Card>

      {/* MODAL CẤP MÃ THUÊ MỚI CHO KHÁCH */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-white text-base">
            <CrownOutlined className="text-amber-400" />
            <span>Cấp Mã Key Cho Thuê Mới Cho Khách Hàng</span>
          </div>
        }
        open={isCreateModalOpen}
        onCancel={() => setIsCreateModalOpen(false)}
        footer={null}
        destroyOnClose
        className="dark-modal"
      >
        <Form
          form={createForm}
          layout="vertical"
          onFinish={handleCreateLicense}
          initialValues={{
            packageType: '1_MONTH',
            days: 30,
            maxVias: 50,
          }}
          className="pt-2"
        >
          <Form.Item
            name="customerName"
            label={<span className="text-slate-300">Tên Khách Hàng / Bên Thuê</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên khách thuê' }]}
          >
            <Input placeholder="VD: Anh Dũng Media - Team Marketing 01" className="bg-slate-900 border-slate-700 text-white" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="customerContact"
                label={<span className="text-slate-300">Số Điện Thoại / Zalo / Telegram</span>}
              >
                <Input placeholder="VD: 0909123456" className="bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="packageType"
                label={<span className="text-slate-300">Gói Thuê</span>}
              >
                <Select
                  className="bg-slate-900 border-slate-700 text-white"
                  options={[
                    { label: 'Dùng thử 3 ngày', value: 'TRIAL_3DAYS' },
                    { label: 'Gói 1 Tháng (30 ngày)', value: '1_MONTH' },
                    { label: 'Gói 3 Tháng (90 ngày)', value: '3_MONTHS' },
                    { label: 'Gói 6 Tháng (180 ngày)', value: '6_MONTHS' },
                    { label: 'Gói 1 Năm (365 ngày)', value: '1_YEAR' },
                    { label: 'Vĩnh Viễn (Lifetime)', value: 'LIFETIME' },
                  ]}
                  onChange={(val) => {
                    const daysMap: Record<string, number> = {
                      TRIAL_3DAYS: 3,
                      '1_MONTH': 30,
                      '3_MONTHS': 90,
                      '6_MONTHS': 180,
                      '1_YEAR': 365,
                      LIFETIME: 3650,
                    };
                    createForm.setFieldsValue({ days: daysMap[val] || 30 });
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="days"
                label={<span className="text-slate-300">Số Ngày Thuê</span>}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={3650} className="w-full bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="maxVias"
                label={<span className="text-slate-300">Giới Hạn Số Lượng Via</span>}
                rules={[{ required: true }]}
              >
                <InputNumber min={5} max={10000} className="w-full bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="notes"
            label={<span className="text-slate-300">Ghi Chú Đơn Hàng</span>}
          >
            <Input.TextArea
              rows={2}
              placeholder="VD: Khách đã chuyển khoản 500k, gói thuê tháng 11"
              className="bg-slate-900 border-slate-700 text-white"
            />
          </Form.Item>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setIsCreateModalOpen(false)} className="border-slate-700 text-slate-300">
              Hủy
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              className="bg-gradient-to-r from-cyan-500 to-blue-600 font-semibold"
            >
              Tạo Key & Lưu Vào Hệ Thống
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default LicenseManagementPage;
