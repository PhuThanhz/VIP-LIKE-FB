import React, { useState, useEffect, useCallback } from 'react';
import { Alert, Input, Button, Switch, ConfigProvider, Select, Tag, Table, Spin, message, Tooltip } from 'antd';
import {
  BellOutlined,
  AlertOutlined,
  CheckCircleOutlined,
  StopOutlined,
  AimOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  ReloadOutlined,
  ControlOutlined,
  HistoryOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { isAdmin, useCurrentUser } from '../auth/session';
import api from '../config/axios';

export interface SystemSettingsPageProps {
  systemSettings: any;
  setSystemSettings: React.Dispatch<React.SetStateAction<any>>;
  savingSettings: boolean;
  onSaveSettings: () => void;
  testingTelegram: boolean;
  onTestTelegram: () => void;
  bmOverview?: any;
  onEmergencyStop?: () => void;
  onResumeSystem?: () => void;
}

/** Khối cài đặt: tiêu đề + mô tả ngắn, nội dung bên dưới */
const Section: React.FC<{ title: string; description?: string; extra?: React.ReactNode; children: React.ReactNode }> = ({
  title,
  description,
  extra,
  children,
}) => (
  <section className="app-surface rounded-2xl">
    <div className="px-5 pt-5 pb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-base font-semibold text-slate-100 m-0">{title}</h3>
        {description && <p className="text-xs text-slate-400 m-0 mt-1">{description}</p>}
      </div>
      {extra}
    </div>
    {children}
  </section>
);

/** Một dòng bật/tắt trong danh sách (ngăn cách bằng đường kẻ) */
const ToggleRow: React.FC<{
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ title, description, checked, disabled, onChange }) => (
  <label
    className={`flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80 ${
      disabled ? 'opacity-50' : 'cursor-pointer hover:bg-slate-800/20'
    }`}
  >
    <span className="min-w-0">
      <span className="block text-sm text-slate-200">{title}</span>
      {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
    </span>
    <Switch checked={checked} disabled={disabled} onChange={onChange} />
  </label>
);

export const SystemSettingsPage: React.FC<SystemSettingsPageProps> = React.memo(({
  systemSettings,
  setSystemSettings,
  savingSettings,
  onSaveSettings,
  testingTelegram,
  onTestTelegram,
  bmOverview,
  onResumeSystem,
}) => {
  // Backend chỉ cho ADMIN lưu cấu hình (403 với tài khoản khác) nên khoá form để tránh sửa rồi lưu thất bại
  const canEdit = isAdmin(useCurrentUser());
  const set = (patch: Record<string, unknown>) => setSystemSettings((prev: any) => ({ ...prev, ...patch }));

  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [sendingScenario, setSendingScenario] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const res = await api.get('/api/telegram/history?limit=30');
      if (res.data?.success && Array.isArray(res.data.notifications)) {
        setHistoryLogs(res.data.notifications);
      }
    } catch {}
    finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleTestScenario = async (scenario: string, label: string) => {
    setSendingScenario(scenario);
    try {
      const res = await api.post('/api/telegram/test-scenario', { scenario });
      if (res.data?.success) {
        message.success(`Đã gửi mô phỏng "${label}" về Telegram & lưu vào MySQL Database!`);
        fetchHistory();
      } else {
        message.error(res.data?.error || 'Không gửi được mô phỏng');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Lỗi gửi mô phỏng');
    } finally {
      setSendingScenario(null);
    }
  };

  const telegramConnected = Boolean(
    bmOverview?.system?.telegramConfigured ||
    (systemSettings?.telegramChatId && (systemSettings?.telegramBotToken || systemSettings?.telegramBotTokenMasked || systemSettings?.botInfo))
  );
  const hasTelegramInput = Boolean(
    (systemSettings?.telegramBotToken || systemSettings?.telegramBotTokenMasked || systemSettings?.botInfo) && systemSettings?.telegramChatId
  );

  return (
    <ConfigProvider componentDisabled={!canEdit}>
      <div className="space-y-5 max-w-[880px] mx-auto pb-6">
        {!canEdit && (
          <Alert
            type="info"
            showIcon
            message="Chỉ tài khoản quản trị được thay đổi cấu hình. Bạn đang xem ở chế độ chỉ đọc."
            className="rounded-xl"
          />
        )}

        {/* Chỉ hiện khi hệ thống đang dừng khẩn cấp; nút Dừng khẩn cấp đã có ở thanh trạng thái phía trên */}
        {bmOverview?.system?.isEmergencyStopped && (
          <Alert
            type="error"
            showIcon
            className="rounded-xl"
            message="Hệ thống đang dừng khẩn cấp"
            description={bmOverview?.system?.emergencyReason || 'Hàng đợi và các tác vụ chạy ngầm đang tạm dừng.'}
            action={
              onResumeSystem && (
                <ConfigProvider componentDisabled={false}>
                  <Button size="small" onClick={onResumeSystem}>
                    Khôi phục
                  </Button>
                </ConfigProvider>
              )
            }
          />
        )}

        {/* Telegram */}
        <Section
          title="Telegram"
          description="Nhận thông báo về điện thoại qua bot Telegram."
          extra={
            <span
              className={`inline-flex items-center gap-1.5 text-xs shrink-0 ${
                telegramConnected ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${telegramConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {telegramConnected ? 'Đã kết nối' : 'Chưa kết nối'}
            </span>
          }
        >
          <div className="px-5 pb-5 space-y-4">
            {/* Thẻ hiển thị Bot đang hoạt động */}
            {systemSettings?.botInfo && (
              <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center text-xl shrink-0">
                    🤖
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                      <span>{systemSettings.botInfo.firstName}</span>
                      <span className="text-blue-400 font-mono text-[11px]">@{systemSettings.botInfo.username}</span>
                      <Tag color="cyan" className="text-[10px] rounded px-1.5 py-0 border-0">ĐANG HOẠT ĐỘNG</Tag>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                      Gửi cảnh báo và báo cáo về Chat ID: <strong className="font-mono text-slate-200">{systemSettings.telegramChatId || 'Chưa đặt'}</strong>
                    </div>
                  </div>
                </div>
                <a
                  href={`https://t.me/${systemSettings.botInfo.username}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 font-semibold px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 shrink-0"
                >
                  Mở Bot ↗
                </a>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Bot token</label>
                <Input.Password
                  autoComplete="off"
                  placeholder={
                    systemSettings.telegramBotTokenMasked
                      ? `${systemSettings.telegramBotTokenMasked} · nhập để đổi`
                      : '7891234567:AAH...'
                  }
                  value={systemSettings.telegramBotToken}
                  onChange={(e) => set({ telegramBotToken: e.target.value })}
                  className="font-mono text-xs h-10"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Chat ID</label>
                <Input
                  placeholder="123456789 hoặc -100123456789"
                  value={systemSettings.telegramChatId}
                  onChange={(e) => set({ telegramChatId: e.target.value })}
                  className="font-mono text-xs h-10"
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-400">
                Tạo bot qua <span className="text-blue-400 font-medium">@BotFather</span> và lấy Chat ID từ <span className="text-blue-400 font-medium">@userinfobot</span>. Bấm <b>Lưu</b> sau khi nhập để áp dụng.
              </div>
              <Button loading={testingTelegram} disabled={!hasTelegramInput} onClick={onTestTelegram} icon={<SendOutlined />} className="shrink-0 text-xs">
                Gửi tin thử
              </Button>
            </div>
          </div>
        </Section>

        {/* Telegram Bot Giúp Gì Cho Bạn? */}
        <Section
          title="Kịch Bản Thông Báo Telegram"
          description="Hệ thống tự động giám sát 24/7 và gửi cảnh báo về điện thoại ngay cả khi tắt máy."
        >
          <div className="px-5 pb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Card 1: Cứu cánh dàn Via */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-rose-500/20 flex flex-col justify-between gap-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AlertOutlined className="text-rose-400 text-sm" />
                    <h4 className="text-xs font-bold text-rose-300 m-0">Via Lỗi / Checkpoint</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal m-0">
                    Báo ngay UID khi Via bị quét hoặc hết cookie, tự động cách ly bảo vệ dàn Fanpage.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <Tag color="error" className="text-[10px] m-0 border-0 px-1.5 py-0">Tự động 24/7</Tag>
                  <Button
                    size="small"
                    icon={<SendOutlined className="text-[10px]" />}
                    loading={sendingScenario === 'VIA_DEAD'}
                    disabled={!hasTelegramInput}
                    onClick={() => handleTestScenario('VIA_DEAD', 'Cảnh báo Via Lỗi / Checkpoint')}
                    className="border-rose-500/40 text-rose-300 hover:text-rose-200 text-xs h-7 px-2.5 rounded-lg"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>

              {/* Card 2: Báo cáo hoàn tất Buff */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-emerald-500/20 flex flex-col justify-between gap-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircleOutlined className="text-emerald-400 text-sm" />
                    <h4 className="text-xs font-bold text-emerald-300 m-0">Hoàn Tất Chiến Dịch</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal m-0">
                    Báo cáo link bài viết, số lượng tương tác thực tế và tỉ lệ thành công ngay khi buff xong.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <Tag color="success" className="text-[10px] m-0 border-0 px-1.5 py-0">Khi xong bài</Tag>
                  <Button
                    size="small"
                    icon={<SendOutlined className="text-[10px]" />}
                    loading={sendingScenario === 'BUFF_COMPLETED'}
                    disabled={!hasTelegramInput}
                    onClick={() => handleTestScenario('BUFF_COMPLETED', 'Báo cáo Hoàn tất Buff')}
                    className="border-emerald-500/40 text-emerald-300 hover:text-emerald-200 text-xs h-7 px-2.5 rounded-lg"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>

              {/* Card 3: Báo động dừng khẩn cấp */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-amber-500/20 flex flex-col justify-between gap-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <StopOutlined className="text-amber-400 text-sm" />
                    <h4 className="text-xs font-bold text-amber-300 m-0">Dừng Khẩn Cấp / Sự Cố</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal m-0">
                    Báo động khẩn khi ấn nút dừng hoặc gặp lỗi mất kết nối liên tiếp để kiểm tra kịp thời.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <Tag color="warning" className="text-[10px] m-0 border-0 px-1.5 py-0">Khẩn cấp</Tag>
                  <Button
                    size="small"
                    icon={<SendOutlined className="text-[10px]" />}
                    loading={sendingScenario === 'EMERGENCY_STOP'}
                    disabled={!hasTelegramInput}
                    onClick={() => handleTestScenario('EMERGENCY_STOP', 'Báo động Dừng khẩn cấp')}
                    className="border-amber-500/40 text-amber-300 hover:text-amber-200 text-xs h-7 px-2.5 rounded-lg"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>

              {/* Card 4: Săn bài viết mới */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-purple-500/20 flex flex-col justify-between gap-2.5">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <AimOutlined className="text-purple-400 text-sm" />
                    <h4 className="text-xs font-bold text-purple-300 m-0">Săn Bài Viết Mới (Auto-Hunter)</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal m-0">
                    Theo dõi Fanpage/Group mục tiêu, tự động báo tin và nạp bài mới vào hàng đợi buff.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <Tag color="purple" className="text-[10px] m-0 border-0 px-1.5 py-0">Tự động</Tag>
                  <Button
                    size="small"
                    icon={<SendOutlined className="text-[10px]" />}
                    loading={sendingScenario === 'HUNTER'}
                    disabled={!hasTelegramInput}
                    onClick={() => handleTestScenario('HUNTER', 'Săn bài mới')}
                    className="border-purple-500/40 text-purple-300 hover:text-purple-200 text-xs h-7 px-2.5 rounded-lg"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>

              {/* Card 5: Báo động bị chặn tốc độ */}
              <div className="p-3.5 rounded-xl bg-slate-900/40 border border-orange-500/20 flex flex-col justify-between gap-2.5 md:col-span-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <SafetyCertificateOutlined className="text-orange-400 text-sm" />
                    <h4 className="text-xs font-bold text-orange-300 m-0">Hạn Chế Thao Tác & Tự Động Hạ Nhiệt</h4>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-normal m-0">
                    Cảnh báo khi Facebook hạn chế thao tác, tự động tạm ngắt phiên và hạ nhiệt bảo vệ Via an toàn.
                  </p>
                </div>
                <div className="pt-2 flex items-center justify-between border-t border-slate-800/80">
                  <Tag color="volcano" className="text-[10px] m-0 border-0 px-1.5 py-0">Bảo vệ Via</Tag>
                  <Button
                    size="small"
                    icon={<SendOutlined className="text-[10px]" />}
                    loading={sendingScenario === 'ACTION_BLOCKED'}
                    disabled={!hasTelegramInput}
                    onClick={() => handleTestScenario('ACTION_BLOCKED', 'Cảnh báo Bị Chặn Tốc Độ')}
                    className="border-orange-500/40 text-orange-300 hover:text-orange-200 text-xs h-7 px-2.5 rounded-lg"
                  >
                    Gửi thử
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Lịch Sử Thông Báo Telegram Trong MySQL Database */}
        <Section
          title="Lịch Sử Thông Báo Telegram"
          description="Nhật ký tin nhắn được lưu trữ trong bảng telegram_notifications (Database: viplike_radiant)."
          extra={
            <div className="flex items-center gap-2">
              <Tag color="cyan" className="m-0 text-[11px] px-2 py-0.5 rounded">
                Database: viplike_radiant
              </Tag>
              <Button size="small" icon={<ReloadOutlined />} onClick={fetchHistory} loading={loadingHistory} className="text-xs">
                Làm mới
              </Button>
            </div>
          }
        >
          <div className="px-5 pb-5">
            {historyLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                Chưa có thông báo nào trong lịch sử. Hãy thử bấm các nút "Gửi thử" ở trên để kiểm tra kết nối!
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/40">
                <Table
                  dataSource={historyLogs}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 5, size: 'small', showTotal: (total) => `Tổng ${total} tin nhắn` }}
                  columns={[
                    {
                      title: 'Thời gian',
                      dataIndex: 'created_at',
                      key: 'created_at',
                      width: 150,
                      render: (val: string) => {
                        const d = val ? new Date(val) : new Date();
                        return (
                          <span className="font-mono text-[11px] text-slate-300">
                            {d.toLocaleString('vi-VN', { hour12: false })}
                          </span>
                        );
                      },
                    },
                    {
                      title: 'Loại sự kiện',
                      dataIndex: 'event_type',
                      key: 'event_type',
                      width: 170,
                      render: (type: string) => {
                        switch (type) {
                          case 'BUFF_COMPLETED':
                            return <Tag color="green" className="text-[11px] font-semibold">Buff hoàn tất</Tag>;
                          case 'VIA_DEAD':
                            return <Tag color="red" className="text-[11px] font-semibold">Via Checkpoint</Tag>;
                          case 'ACTION_BLOCKED':
                            return <Tag color="volcano" className="text-[11px] font-semibold">Chặn tốc độ</Tag>;
                          case 'EMERGENCY_STOP':
                            return <Tag color="error" className="text-[11px] font-semibold">Dừng khẩn cấp</Tag>;
                          case 'HUNTER':
                            return <Tag color="purple" className="text-[11px] font-semibold">Săn bài mới</Tag>;
                          case 'TEST':
                          case 'TEST_INIT':
                            return <Tag color="cyan" className="text-[11px] font-semibold">Tin nhắn thử</Tag>;
                          default:
                            return <Tag color="blue" className="text-[11px] font-semibold">{type}</Tag>;
                        }
                      },
                    },
                    {
                      title: 'Tiêu đề & Nội dung',
                      key: 'content',
                      render: (_, record: any) => (
                        <div className="py-1">
                          <div className="text-xs font-semibold text-slate-200">{record.title}</div>
                          <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 whitespace-pre-line font-mono">
                            {record.message}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Trạng thái & Nơi nhận',
                      key: 'status',
                      width: 170,
                      render: (_, record: any) => (
                        <div className="space-y-1">
                          <div>
                            <Tag color={record.status === 'SENT' ? 'success' : 'error'} className="text-[10px] font-mono">
                              {record.status === 'SENT' ? 'ĐÃ GỬI' : 'THẤT BẠI'}
                            </Tag>
                            {record.telegram_message_id && (
                              <span className="text-[10px] text-slate-500 font-mono">
                                #{record.telegram_message_id}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Chat ID: {record.chat_id}
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        </Section>

        {/* Thông báo */}
        <Section title="Thông báo" description="Chọn những sự kiện sẽ gửi về Telegram.">
          <ToggleRow
            title="Via bị checkpoint hoặc cookie hết hạn"
            description="Báo ngay và tạm ngưng dùng Via lỗi."
            checked={systemSettings.notifyOnViaDead !== false}
            onChange={(checked) => set({ notifyOnViaDead: checked })}
          />
          <ToggleRow
            title="Có bài viết mới cần xử lý"
            description="Gửi link bài vừa đăng và thời gian dự kiến chạy."
            checked={systemSettings.notifyOnHunter !== false}
            onChange={(checked) => set({ notifyOnHunter: checked })}
          />
          <ToggleRow
            title="Chiến dịch hoàn tất"
            description="Tổng kết số lượt thành công, thời gian chạy và khi hàng đợi đã trống."
            checked={systemSettings.notifyOnBuffDone !== false}
            onChange={(checked) => set({ notifyOnBuffDone: checked })}
          />
          <ToggleRow
            title="Via bị Facebook hạn chế thao tác (Action Blocked)"
            description="Báo ngay khi phát hiện Facebook yêu cầu dừng do thao tác quá nhanh."
            checked={systemSettings.notifyOnActionBlocked !== false}
            onChange={(checked) => set({ notifyOnActionBlocked: checked })}
          />
          <ToggleRow
            title="Hàng đợi gặp sự cố"
            description="Báo khi có 3 bài thất bại liên tiếp."
            checked={systemSettings.notifyOnQueueIssue !== false}
            onChange={(checked) => set({ notifyOnQueueIssue: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Báo cáo, giờ yên tĩnh, lệnh */}
        <Section title="Báo cáo & điều khiển" description="Tổng kết định kỳ, giờ không làm phiền và lệnh nhắn cho bot.">
          <ToggleRow
            title="Báo cáo hằng ngày"
            description="Gửi tổng kết 24 giờ qua: số bài xong, thất bại, Via còn hoạt động."
            checked={systemSettings.dailyReportEnabled !== false}
            onChange={(checked) => set({ dailyReportEnabled: checked })}
          />
          {systemSettings.dailyReportEnabled !== false && (
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-slate-800/80">
              <span className="text-sm text-slate-400">Gửi lúc</span>
              <Select
                value={Number(systemSettings.dailyReportHour ?? 8)}
                onChange={(v) => set({ dailyReportHour: v })}
                className="w-28"
                options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))}
              />
            </div>
          )}
          <ToggleRow
            title="Giờ yên tĩnh"
            description="Trong khung này chỉ gửi tin nghiêm trọng (Via lỗi, dừng khẩn cấp, hàng đợi sự cố). Tin còn lại được gom và gửi sau."
            checked={Boolean(systemSettings.quietHoursEnabled)}
            onChange={(checked) => set({ quietHoursEnabled: checked })}
          />
          {systemSettings.quietHoursEnabled && (
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-slate-800/80">
              <span className="text-sm text-slate-400">Từ – đến</span>
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  value={systemSettings.quietStart || '23:00'}
                  onChange={(e) => set({ quietStart: e.target.value })}
                  className="w-28"
                />
                <span className="text-slate-500">–</span>
                <Input
                  type="time"
                  value={systemSettings.quietEnd || '07:00'}
                  onChange={(e) => set({ quietEnd: e.target.value })}
                  className="w-28"
                />
              </div>
            </div>
          )}
          <ToggleRow
            title="Lệnh qua Telegram"
            description="Nhắn /status xem tình trạng, /stop dừng khẩn cấp, /resume khôi phục. Chỉ nhận từ đúng Chat ID ở trên."
            checked={systemSettings.telegramCommands !== false}
            onChange={(checked) => set({ telegramCommands: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Tự động */}
        <Section title="Tự động" description="Tự đưa bài vừa đăng vào hàng đợi.">
          <ToggleRow
            title="Tự thêm bài vừa đăng vào hàng đợi"
            checked={Boolean(systemSettings.autoBuffOwnPosts)}
            onChange={(checked) => set({ autoBuffOwnPosts: checked })}
          />
          <ToggleRow
            title="Bài đăng trên Fanpage"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnFanpage !== false}
            onChange={(checked) => set({ autoBuffOwnFanpage: checked })}
          />
          <ToggleRow
            title="Bài đăng trong Nhóm"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnGroup !== false}
            onChange={(checked) => set({ autoBuffOwnGroup: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Thuật toán Smart Adaptive Pacing & Bảo Vệ Via */}
        <Section
          title="Thuật Toán Smart Adaptive Pacing & Bảo Vệ Via"
          description="Tự động co giãn nhịp tương tác, ngắt nhịp nghỉ hạ nhiệt Via và ngăn chặn hoàn toàn cờ checkpoint của Meta."
        >
          <ToggleRow
            title="Bật thuật toán Smart Adaptive Pacing (Khuyên dùng)"
            description="Tự động phân tích số lượng Fanpage (2.8s - 5.8s) kèm jitter ngẫu nhiên ±15%, chống thuật toán AI của Meta gắn cờ tự động hoá."
            checked={systemSettings.smartAdaptivePacing !== false}
            onChange={(checked) => set({ smartAdaptivePacing: checked })}
          />
          <ToggleRow
            title="Tự động dừng khẩn cấp khi gặp cờ chặn Facebook (Action Blocked)"
            description="Ngay khi phát hiện bài viết bị Facebook chặn do thao tác quá nhanh, hệ thống lập tức ngắt phiên để Via không bị checkpoint."
            checked={systemSettings.autoStopOnActionBlocked !== false}
            onChange={(checked) => set({ autoStopOnActionBlocked: checked })}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Tự động hạ nhiệt Via (Auto-Cooldown)</span>
              <span className="block text-xs text-slate-500 mt-0.5">Số trang hoàn tất trước khi tạm nghỉ để Facebook reset bộ đếm spam.</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Mỗi</span>
                <Input
                  type="number"
                  min={5}
                  max={50}
                  value={systemSettings.cooldownEveryPages ?? 25}
                  onChange={(e) => set({ cooldownEveryPages: parseInt(e.target.value, 10) || 25 })}
                  className="w-20 font-mono text-xs"
                />
                <span className="text-xs text-slate-400">Page</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Nghỉ</span>
                <Input
                  type="number"
                  min={10}
                  max={180}
                  value={systemSettings.cooldownDurationSec ?? 20}
                  onChange={(e) => set({ cooldownDurationSec: parseInt(e.target.value, 10) || 20 })}
                  className="w-20 font-mono text-xs"
                />
                <span className="text-xs text-slate-400">giây</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Tốc độ mặc định khi tạo tác vụ</span>
              <span className="block text-xs text-slate-500 mt-0.5">Áp dụng cho Hàng đợi, Săn bài tự động và Buff trực tiếp.</span>
            </div>
            <Select
              value={systemSettings.defaultSpeedMode || 'NORMAL'}
              onChange={(v) => set({ defaultSpeedMode: v })}
              className="w-56 text-xs"
              options={[
                { value: 'NORMAL', label: 'Chuẩn (2.4s • 1 luồng/Via, Khuyên dùng)' },
                { value: 'FAST', label: 'Nhanh (2.0s)' },
                { value: 'SMART', label: 'Safe Smart (2.6s - 3.4s)' },
                { value: 'TURBO', label: 'Siêu Tốc (1.4s)' },
                { value: 'SAFE', label: 'An Toàn (5.0s)' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Số bài viết chạy song song cùng lúc (Parallel Workers)</span>
              <span className="block text-xs text-slate-500 mt-0.5">Tự động điều phối mỗi bài viết vào một Via độc lập (Lane riêng) để like đồng thời.</span>
            </div>
            <Select
              value={Number(systemSettings.maxParallelTasks || 2)}
              onChange={(v) => set({ maxParallelTasks: v })}
              className="w-56 text-xs"
              options={[
                { value: 1, label: '1 bài (Tuần tự)' },
                { value: 2, label: '2 bài cùng lúc (Khuyên dùng)' },
                { value: 3, label: '3 bài cùng lúc' },
                { value: 4, label: '4 bài cùng lúc' },
              ]}
            />
          </div>
          <div className="h-2" />
        </Section>

        {/* Thanh lưu cố định */}
        {canEdit && (
          <div className="sticky bottom-4 z-10 px-4 py-3 rounded-2xl border border-slate-800 bg-slate-900/95 backdrop-blur flex items-center justify-between gap-3 shadow-2xl">
            <span className="text-xs text-slate-400">Thay đổi có hiệu lực sau khi lưu.</span>
            <Button type="primary" loading={savingSettings} onClick={onSaveSettings} className="px-6">
              Lưu
            </Button>
          </div>
        )}
      </div>
    </ConfigProvider>
  );
});

export default SystemSettingsPage;
