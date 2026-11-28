import React, { useState, useEffect, useMemo } from 'react';
import {
  Card,
  Button,
  Input,
  Form,
  Table,
  Tag,
  Modal,
  Popconfirm,
  Select,
  InputNumber,
  Alert,
  Space,
  Typography,
  Tooltip,
  message,
  Row,
  Col,
  Segmented,
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
  CrownOutlined,
} from '@ant-design/icons';
import api from '../config/axios';
import { getMachineHwid } from '../utils/tauriBridge';
import { isAdmin, useCurrentUser } from '../auth/session';

const { Title, Text } = Typography;


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

const DAY_MS = 1000 * 60 * 60 * 24;
const EXPIRING_SOON_DAYS = 7;

const getDaysLeft = (expiresAt: string) => Math.ceil((new Date(expiresAt).getTime() - Date.now()) / DAY_MS);

/** Color by urgency: expired → red, expiring soon → yellow, plenty left → green */
const daysLeftColor = (daysLeft: number) =>
  daysLeft <= 0 ? 'text-rose-400' : daysLeft <= EXPIRING_SOON_DAYS ? 'text-amber-400' : 'text-emerald-400';

export const LicenseManagementPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [currentLicense, setCurrentLicense] = useState<LicenseInfo | null>(null);
  const [adminLicenses, setAdminLicenses] = useState<AdminLicenseItem[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [activating, setActivating] = useState(false);
  const [licenseInput, setLicenseInput] = useState('');
  const [createForm] = Form.useForm();

  const [hardwareHwid, setHardwareHwid] = useState<string>('Đang đọc mã máy...');
  const [activeLicenseTab, setActiveLicenseTab] = useState<'CLIENT' | 'ADMIN'>('CLIENT');
  const admin = isAdmin(useCurrentUser());
  const [adminSearch, setAdminSearch] = useState('');
  const isLicenseActive = Boolean(currentLicense && !currentLicense.isExpired && currentLicense.status === 'ACTIVE');

  useEffect(() => {
    getMachineHwid().then((hwid) => {
      setHardwareHwid(hwid);
    });
  }, []);

  // Load the current license status
  const fetchLicenseStatus = async () => {
    try {
      setLoading(true);
      const res = await api.get('/license/status');
      if (res.data?.success && res.data?.license) {
        setCurrentLicense(res.data.license);
      } else {
        setCurrentLicense(null);
      }
    } catch (err: any) {
      console.warn('Failed to read license status:', err.message);
    } finally {
      setLoading(false);
    }
  };


  // Load the renter list (only Admins may call this API)
  const fetchAdminLicenses = async () => {
    if (!admin) return;
    try {
      const res = await api.get('/license/admin/list');
      if (res.data?.success) {
        setAdminLicenses(res.data.licenses || []);
      }
    } catch (err: any) {
      console.warn('Failed to load admin license list:', err.message);
    }
  };

  const refreshAll = () => {
    fetchLicenseStatus();
    fetchAdminLicenses();
  };

  useEffect(() => {
    refreshAll();
  }, [admin]);

  // Activate a License Key on this machine
  const handleActivate = async () => {
    if (!licenseInput.trim()) {
      message.warning('Vui lòng nhập License Key để kích hoạt');
      return;
    }
    try {
      setActivating(true);
      const res = await api.post('/license/activate', {
        licenseKey: licenseInput.trim(),
        hardwareHwid,
      });
      if (res.data?.success) {
        message.success('🎉 Đã kích hoạt bản quyền VIP LIKE!');
        setLicenseInput('');
        refreshAll();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Kích hoạt thất bại. Kiểm tra lại key.');
    } finally {
      setActivating(false);
    }
  };

  // Admin creates a new key for a renter
  const handleCreateLicense = async (values: any) => {
    try {
      const res = await api.post('/license/admin/create', values);
      if (res.data?.success) {
        setIsCreateModalOpen(false);
        createForm.resetFields();
        const newKey: string | undefined = res.data.license?.licenseKey;
        Modal.success({
          title: `Đã tạo key cho ${values.customerName}`,
          content: newKey ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-400">Gửi key này cho khách để kích hoạt:</div>
              <Text copyable={{ text: newKey }} className="font-mono text-cyan-300">
                {newKey}
              </Text>
            </div>
          ) : undefined,
        });
        fetchAdminLicenses();
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || 'Lỗi tạo License Key');
    }
  };

  // Admin updates status / extends a key
  const updateLicenseStatus = async (
    payload: { id: number; status: string; addDays?: number },
    successMsg: string,
    errorMsg: string
  ) => {
    try {
      const res = await api.post('/license/admin/update-status', payload);
      if (res.data?.success) {
        message.success(successMsg);
        refreshAll();
      } else {
        message.error(res.data?.error || errorMsg);
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || errorMsg);
    }
  };

  const handleExtendDays = (id: number) =>
    updateLicenseStatus({ id, status: 'ACTIVE', addDays: 30 }, 'Đã gia hạn thêm 30 ngày!', 'Gia hạn thất bại');

  const handleToggleLock = (id: number, currentStatus: string) => {
    const nextStatus = currentStatus === 'LOCKED' ? 'ACTIVE' : 'LOCKED';
    return updateLicenseStatus(
      { id, status: nextStatus },
      nextStatus === 'LOCKED' ? 'Key thuê này đã bị KHÓA!' : 'Đã MỞ KHÓA!',
      'Lỗi cập nhật trạng thái'
    );
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`Đã sao chép ${label}!`);
    } catch {
      message.error('Không sao chép được; vui lòng bôi đen và sao chép thủ công.');
    }
  };

  const filteredAdminLicenses = useMemo(() => {
    const q = adminSearch.trim().toLowerCase();
    if (!q) return adminLicenses;
    return adminLicenses.filter((l) =>
      [l.customerName, l.customerContact, l.licenseKey, l.hardwareHwid, l.notes]
        .some((v) => v?.toLowerCase().includes(q))
    );
  }, [adminLicenses, adminSearch]);

  const adminColumns = [
    {
      title: 'Khách / Người thuê',
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
            <Text className="text-[11px] text-slate-500 block italic">Ghi chú: {record.notes}</Text>
          )}
        </div>
      ),
    },
    {
      title: 'License Key (gửi cho khách)',
      key: 'licenseKey',
      render: (_: any, record: AdminLicenseItem) => (
        <div className="flex items-center gap-2">
          <Tag color="cyan" className="font-mono text-xs px-2 py-0.5 m-0 border-cyan-800">
            {record.licenseKey}
          </Tag>
          <Tooltip title="Sao chép key để gửi cho khách">
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(record.licenseKey, 'License Key')}
              className="text-cyan-400 hover:text-cyan-300"
            />
          </Tooltip>
        </div>
      ),
    },
    {
      title: 'Gói & Giới hạn',
      key: 'package',
      render: (_: any, record: AdminLicenseItem) => {
        const pkgMap: Record<string, { label: string; color: string }> = {
          TRIAL_3DAYS: { label: '3-day trial', color: 'orange' },
          '1_MONTH': { label: '1 tháng', color: 'blue' },
          '3_MONTHS': { label: '3 tháng', color: 'purple' },
          '6_MONTHS': { label: '6 tháng', color: 'magenta' },
          '1_YEAR': { label: '1 năm', color: 'gold' },
          LIFETIME: { label: 'Vĩnh viễn', color: 'success' },
        };
        const p = pkgMap[record.packageType] || { label: record.packageType, color: 'default' };
        return (
          <div>
            <Tag color={p.color}>{p.label}</Tag>
            <div className="text-xs text-slate-400 mt-1">
              Tối đa: <span className="text-white font-medium">{record.maxVias} Via</span>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Hạn dùng',
      key: 'expiresAt',
      sorter: (a: AdminLicenseItem, b: AdminLicenseItem) =>
        new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime(),
      render: (_: any, record: AdminLicenseItem) => {
        const daysLeft = getDaysLeft(record.expiresAt);
        return (
          <div>
            <div className={`text-xs font-semibold ${daysLeftColor(daysLeft)}`}>
              {daysLeft <= 0 ? 'EXPIRED' : `Còn ${daysLeft} ngày`}
            </div>
            <div className="text-[11px] text-slate-500">{new Date(record.expiresAt).toLocaleDateString('vi-VN')}</div>
          </div>
        );
      },
    },
    {
      title: 'Mã máy của khách (HWID)',
      key: 'hardwareHwid',
      render: (_: any, record: AdminLicenseItem) => (
        record.hardwareHwid ? (
          <Tooltip title={`${record.hardwareHwid} (bấm để sao chép)`}>
            <Tag
              color="geekblue"
              className="font-mono text-[11px] cursor-pointer"
              onClick={() => copyToClipboard(record.hardwareHwid!, 'Mã máy (HWID)')}
            >
              🔒 {record.hardwareHwid.length > 14 ? `${record.hardwareHwid.substring(0, 14)}…` : record.hardwareHwid}
            </Tag>
          </Tooltip>
        ) : (
          <Tag color="default" className="text-[11px]">
            Chưa kích hoạt trên máy nào
          </Tag>
        )
      ),
    },
    {
      title: 'Trạng thái',
      key: 'status',
      filters: [
        { text: 'Đang hoạt động', value: 'ACTIVE' },
        { text: 'Hết hạn', value: 'EXPIRED' },
        { text: 'Đã khóa', value: 'LOCKED' },
      ],
      onFilter: (value: any, record: AdminLicenseItem) => {
        if (record.status === 'LOCKED') return value === 'LOCKED';
        return getDaysLeft(record.expiresAt) <= 0 ? value === 'EXPIRED' : value === 'ACTIVE';
      },
      render: (_: any, record: AdminLicenseItem) => {
        if (record.status === 'LOCKED') return <Tag color="error">ĐÃ KHÓA</Tag>;
        const isExpired = new Date(record.expiresAt) < new Date();
        if (isExpired) return <Tag color="warning">HẾT HẠN</Tag>;
        return <Tag color="success">HOẠT ĐỘNG</Tag>;
      },
    },
    {
      title: 'Thao tác admin',
      key: 'action',
      render: (_: any, record: AdminLicenseItem) => (
        <Space size="small">
          <Tooltip title="Gia hạn cho khách thêm 30 ngày">
            <Button
              size="small"
              className="bg-emerald-950/60 text-emerald-400 border-emerald-800 hover:bg-emerald-900"
              icon={<ClockCircleOutlined />}
              onClick={() => handleExtendDays(record.id)}
            >
              +30 ngày
            </Button>
          </Tooltip>
          {record.status === 'LOCKED' ? (
            <Button
              size="small"
              type="primary"
              icon={<UnlockOutlined />}
              onClick={() => handleToggleLock(record.id, record.status)}
            >
              Mở khóa
            </Button>
          ) : (
            <Popconfirm
              title={`Khóa key của ${record.customerName}?`}
              description="Khách sẽ không dùng được tool cho tới khi được mở khóa."
              okText="Khóa"
              okButtonProps={{ danger: true }}
              cancelText="Hủy"
              onConfirm={() => handleToggleLock(record.id, record.status)}
            >
              <Button size="small" danger icon={<LockOutlined />}>
                Khóa key
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-12">
      {/* TOOLBAR: the page title is already in the Header, so only keep tab switching + actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {admin ? (
          <Segmented
            value={activeLicenseTab}
            onChange={(val) => setActiveLicenseTab(val as 'CLIENT' | 'ADMIN')}
            options={[
              {
                label: (
                  <div className="flex items-center gap-2 px-2 py-0.5 font-semibold">
                    <SafetyCertificateOutlined className="text-emerald-400" />
                    <span>Máy này</span>
                  </div>
                ),
                value: 'CLIENT',
              },
              {
                label: (
                  <div className="flex items-center gap-2 px-2 py-0.5 font-semibold">
                    <CrownOutlined className="text-amber-400" />
                    <span>Người thuê ({adminLicenses.length})</span>
                  </div>
                ),
                value: 'ADMIN',
              },
            ]}
            className="bg-slate-900 border border-slate-800 text-slate-300 p-1 rounded-xl self-start"
          />
        ) : (
          <div />
        )}

        <div className="flex items-center gap-2">
          {admin && activeLicenseTab === 'ADMIN' && (
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 font-medium shadow-lg shadow-cyan-500/20"
            >
              Cấp key mới
            </Button>
          )}
          <Button
            icon={<ReloadOutlined />}
            loading={loading}
            onClick={refreshAll}
            className="border-slate-700 bg-slate-800/80 text-slate-300 hover:text-white"
          >
            Làm mới
          </Button>
        </div>
      </div>

      {/* TAB 1: ACTIVATION & LICENSE FOR THIS DEVICE */}
      {activeLicenseTab === 'CLIENT' && (
        <div className="space-y-5">
          {/* 3-step guide: only needed when the machine has no license */}
          {!isLicenseActive && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-950 border border-slate-800 shadow-lg flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-400 font-black text-sm flex items-center justify-center border border-cyan-500/30 shrink-0">1</div>
                <div>
                  <div className="font-bold text-slate-200">1. Lấy mã máy (HWID)</div>
                  <div className="text-[11px] text-slate-400">Bấm biểu tượng sao chép ở HWID bên dưới để gửi cho bên cung cấp tool</div>
                </div>
              </div>
              <div className="hidden md:block text-slate-600 font-bold text-base">➔</div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 font-black text-sm flex items-center justify-center border border-purple-500/30 shrink-0">2</div>
                <div>
                  <div className="font-bold text-slate-200">2. Nhận License Key</div>
                  <div className="text-[11px] text-slate-400">Bên cung cấp tool gửi lại license key theo gói thuê của bạn</div>
                </div>
              </div>
              <div className="hidden md:block text-slate-600 font-bold text-base">➔</div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 font-black text-sm flex items-center justify-center border border-emerald-500/30 shrink-0">3</div>
                <div>
                  <div className="font-bold text-slate-200">3. Dán key & Kích hoạt</div>
                  <div className="text-[11px] text-slate-400">Bấm "Kích hoạt bản quyền ngay" để mở mọi tính năng</div>
                </div>
              </div>
            </div>
          )}

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={15}>
              <Card
                className="bg-card/90 border-slate-800 shadow-xl rounded-2xl h-full"
                title={
                  <div className="flex items-center gap-2 text-white">
                    <SafetyCertificateOutlined className="text-emerald-400 text-lg" />
                    <span>Trạng thái bản quyền trên máy này</span>
                  </div>
                }
              >
                {currentLicense ? (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                      <div>
                        <div className="flex items-center gap-2">
                          <Tag color={isLicenseActive ? 'success' : 'error'} className="px-2 py-0.5 font-semibold">
                            {isLicenseActive ? 'HỢP LỆ & ĐÃ KÍCH HOẠT' : currentLicense.isExpired ? 'EXPIRED' : currentLicense.status}
                          </Tag>
                          <Tag color="cyan">{currentLicense.packageType}</Tag>
                        </div>
                        <Title level={4} className="!text-white !mt-2 !mb-0">
                          {currentLicense.customerName}
                        </Title>
                        <Text className="text-xs text-slate-400">
                          Key: <span className="font-mono text-cyan-300">{currentLicense.licenseKey}</span>
                        </Text>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Thời hạn thuê</div>
                        <div className={`text-2xl font-bold mt-1 ${daysLeftColor(currentLicense.daysRemaining)}`}>
                          {currentLicense.daysRemaining} <span className="text-sm font-normal text-slate-300">ngày</span>
                        </div>
                        <Text className="text-[11px] text-slate-400">
                          Hết hạn: {new Date(currentLicense.expiresAt).toLocaleDateString('vi-VN')}
                        </Text>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                        <Text className="text-slate-400 text-xs block">Giới hạn tài khoản</Text>
                        <Text className="text-white font-bold text-base">{currentLicense.maxVias} Via</Text>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                        <Text className="text-slate-400 text-xs block">Mã máy (HWID)</Text>
                        <Text className="text-cyan-300 font-mono text-xs block truncate">{hardwareHwid}</Text>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-800/80">
                        <Text className="text-slate-400 text-xs block">Chống gian lận</Text>
                        <Text className="text-emerald-400 font-medium text-xs">🔒 Khóa 1 máy / 1 key</Text>
                      </div>
                    </div>
                  </div>
                ) : (
                  <Alert
                    message="Chưa có bản quyền"
                    description="Máy này chưa kích hoạt bản quyền hoặc key đã hết hạn. Nhập key bạn được cấp để mở mọi tính năng nuôi và tương tác."
                    type="warning"
                    showIcon
                    className="bg-amber-950/20 border-amber-900/50 text-slate-300"
                  />
                )}
              </Card>
            </Col>

            {/* KEY ACTIVATION BOX FOR CLIENT MACHINES */}
            <Col xs={24} lg={9}>
              <Card
                className="bg-card/90 border-slate-800 shadow-xl rounded-2xl h-full flex flex-col justify-between"
                title={
                  <div className="flex items-center gap-2 text-white">
                    <KeyOutlined className="text-cyan-400 text-lg" />
                    <span>Kích hoạt / Nhập License Key mới</span>
                  </div>
                }
              >
                <div className="space-y-4">
                  <div>
                    <Text className="text-slate-300 text-xs block mb-1 font-medium">Mã máy này (HWID):</Text>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        value={hardwareHwid}
                        className="bg-slate-900 border-slate-700 text-cyan-300 font-mono text-xs"
                      />
                      <Tooltip title="Sao chép mã máy gửi Admin để lấy key">
                        <Button
                          icon={<CopyOutlined />}
                          onClick={() => copyToClipboard(hardwareHwid, 'Mã máy (HWID)')}
                          className="border-slate-700 bg-slate-800 text-slate-300"
                        />
                      </Tooltip>
                    </div>
                  </div>

                  <div>
                    <Text className="text-slate-300 text-xs block mb-1 font-medium">Nhập License Key bạn được cấp:</Text>
                    <Input
                      size="large"
                      placeholder="VIPLIKE-XXXX-XXXX-XXXX"
                      value={licenseInput}
                      onChange={(e) => setLicenseInput(e.target.value)}
                      onPressEnter={handleActivate}
                      allowClear
                      className="bg-slate-900 border-slate-700 text-white font-mono placeholder:text-slate-600"
                      prefix={<KeyOutlined className="text-cyan-400 mr-1" />}
                    />
                  </div>

                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={activating}
                    disabled={!licenseInput.trim()}
                    onClick={handleActivate}
                    className="bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 font-semibold shadow-lg shadow-emerald-500/20"
                  >
                    Kích hoạt bản quyền ngay
                  </Button>
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      )}

      {/* TAB 2: RENTER MANAGEMENT FOR ADMINS */}
      {admin && activeLicenseTab === 'ADMIN' && (
        <Card
          className="bg-card/90 border-slate-800 shadow-xl rounded-2xl"
          title={
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-2 text-white">
                <UserOutlined className="text-cyan-400 text-lg" />
                <span>Sổ người thuê tool ({adminLicenses.length} khách)</span>
              </div>
              <Input.Search
                allowClear
                placeholder="Tìm tên khách, key, HWID..."
                value={adminSearch}
                onChange={(e) => setAdminSearch(e.target.value)}
                className="max-w-xs"
              />
            </div>
          }
        >
          <Table
            dataSource={filteredAdminLicenses}
            columns={adminColumns}
            rowKey="id"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            locale={{ emptyText: adminSearch ? 'Không tìm thấy người thuê phù hợp' : 'Chưa có người thuê nào' }}
            className="ant-table-dark-custom"
            scroll={{ x: 1000 }}
          />
        </Card>
      )}

      {/* MODAL: ISSUE A NEW RENTAL KEY */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-white text-base">
            <CrownOutlined className="text-amber-400" />
            <span>Cấp key thuê mới cho khách</span>
          </div>
        }
        open={isCreateModalOpen}
        onCancel={() => setIsCreateModalOpen(false)}
        footer={null}
        destroyOnHidden
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
            label={<span className="text-slate-300">Tên khách / người thuê</span>}
            rules={[{ required: true, message: 'Vui lòng nhập tên người thuê' }]}
          >
            <Input placeholder="e.g. Anh Dũng Media - Marketing Team 01" className="bg-slate-900 border-slate-700 text-white" />
          </Form.Item>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="customerContact"
                label={<span className="text-slate-300">SĐT / Zalo / Telegram</span>}
              >
                <Input placeholder="VD: 0909123456" className="bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="packageType"
                label={<span className="text-slate-300">Gói thuê</span>}
              >
                <Select
                  className="bg-slate-900 border-slate-700 text-white"
                  options={[
                    { label: '3-day trial', value: 'TRIAL_3DAYS' },
                    { label: 'Gói 1 tháng (30 ngày)', value: '1_MONTH' },
                    { label: 'Gói 3 tháng (90 ngày)', value: '3_MONTHS' },
                    { label: 'Gói 6 tháng (180 ngày)', value: '6_MONTHS' },
                    { label: 'Gói 1 năm (365 ngày)', value: '1_YEAR' },
                    { label: 'Vĩnh viễn', value: 'LIFETIME' },
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
                label={<span className="text-slate-300">Số ngày thuê</span>}
                rules={[{ required: true }]}
              >
                <InputNumber min={1} max={3650} className="w-full bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="maxVias"
                label={<span className="text-slate-300">Giới hạn Via</span>}
                rules={[{ required: true }]}
              >
                <InputNumber min={5} max={10000} className="w-full bg-slate-900 border-slate-700 text-white" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            name="notes"
            label={<span className="text-slate-300">Ghi chú đơn</span>}
          >
            <Input.TextArea
              rows={2}
              placeholder="VD: Khách đã chuyển 500k, gói tháng 11"
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
              Tạo key & Lưu
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default LicenseManagementPage;
