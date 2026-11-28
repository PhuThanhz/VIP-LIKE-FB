import React, { useState, useEffect, useCallback } from 'react';
import { Alert, App, Input, Button, Switch, ConfigProvider, Select, Tag } from 'antd';
import { SendOutlined, ReloadOutlined, CaretRightOutlined } from '@ant-design/icons';
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

/** Settings block: title + short description, content below */
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

/** One on/off row in a list (separated by a divider) */
const ToggleRow: React.FC<{
  title: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  extra?: React.ReactNode;
  onChange: (checked: boolean) => void;
}> = ({ title, description, checked, disabled, extra, onChange }) => (
  <label
    className={`flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80 ${
      disabled ? 'opacity-50' : 'cursor-pointer hover:bg-slate-800/20'
    }`}
  >
    <span className="min-w-0">
      <span className="block text-sm text-slate-200">{title}</span>
      {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
    </span>
    <span className="flex items-center gap-3 shrink-0">
      {extra && <span onClick={(e) => e.preventDefault()}>{extra}</span>}
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </span>
  </label>
);

const EVENT_LABELS: Record<string, string> = {
  BUFF_COMPLETED: 'Hoàn tất',
  VIA_DEAD: 'Via lỗi',
  ACTION_BLOCKED: 'Bị chặn',
  EMERGENCY_STOP: 'Khẩn cấp',
  HUNTER: 'Bài mới',
  TEST: 'Test',
  TEST_INIT: 'Test',
};

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
  // The backend only lets ADMIN save settings (403 for other accounts), so lock the form to avoid edits that fail to save
  const canEdit = isAdmin(useCurrentUser());
  const { message } = App.useApp();
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [editingBot, setEditingBot] = useState<boolean>(false);
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
        message.success(`Đã gửi thử "${label}" tới Telegram`);
        fetchHistory();
      } else {
        message.error(res.data?.error || 'Không gửi được tin thử');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Lỗi khi gửi tin thử');
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
            message="Chỉ tài khoản admin được đổi cài đặt. Bạn đang ở chế độ chỉ xem."
            className="rounded-xl"
          />
        )}

        {/* Only shown during an emergency stop; the Emergency stop button is already in the status bar above */}
        {bmOverview?.system?.isEmergencyStopped && (
          <Alert
            type="error"
            showIcon
            className="rounded-xl"
            message="Hệ thống đang dừng khẩn cấp"
            description={bmOverview?.system?.emergencyReason || 'Hàng đợi và các tác vụ nền đang tạm dừng.'}
            action={
              onResumeSystem && (
                <ConfigProvider componentDisabled={false}>
                  <Button size="small" onClick={onResumeSystem}>
                    Chạy lại
                  </Button>
                </ConfigProvider>
              )
            }
          />
        )}

        {/* Telegram */}
        <Section
          title="Telegram"
          description="Nhận thông báo trên điện thoại qua bot Telegram."
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
            {systemSettings?.botInfo && !editingBot ? (
              <div className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl bg-slate-900/60 border border-slate-800">
                <div className="min-w-0">
                  <div className="text-sm text-slate-100 truncate">
                    {systemSettings.botInfo.firstName}{' '}
                    <a
                      href={`https://t.me/${systemSettings.botInfo.username}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                    >
                      @{systemSettings.botInfo.username}
                    </a>
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 font-mono">Chat ID {systemSettings.telegramChatId || '—'}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="small" loading={testingTelegram} disabled={!hasTelegramInput} onClick={onTestTelegram} icon={<SendOutlined />}>
                    Gửi thử
                  </Button>
                  <Button size="small" type="text" onClick={() => setEditingBot(true)}>
                    Đổi bot
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Bot token</label>
                    <Input.Password
                      autoComplete="off"
                      placeholder={
                        systemSettings.telegramBotTokenMasked
                          ? `${systemSettings.telegramBotTokenMasked} · gõ để đổi`
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
                      placeholder="123456789 or -100123456789"
                      value={systemSettings.telegramChatId}
                      onChange={(e) => set({ telegramChatId: e.target.value })}
                      className="font-mono text-xs h-10"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    Tạo bot qua <span className="text-blue-400">@BotFather</span>, lấy Chat ID từ <span className="text-blue-400">@userinfobot</span>, rồi bấm Lưu.
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {systemSettings?.botInfo && (
                      <Button size="small" type="text" onClick={() => setEditingBot(false)}>
                        Hủy
                      </Button>
                    )}
                    <Button size="small" loading={testingTelegram} disabled={!hasTelegramInput} onClick={onTestTelegram} icon={<SendOutlined />}>
                      Gửi thử
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Thông báo" description="Chọn sự kiện nào được gửi về Telegram. Bấm ➤ để gửi thử.">
          <ToggleRow
            title="Via dính checkpoint / hết hạn cookie"
            checked={systemSettings.notifyOnViaDead !== false}
            onChange={(checked) => set({ notifyOnViaDead: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'VIA_DEAD'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('VIA_DEAD', 'Via lỗi')} className="!text-slate-500 hover:!text-slate-200" aria-label="Gửi thử" />}
          />
          <ToggleRow
            title="Bắt được bài mới"
            checked={systemSettings.notifyOnHunter !== false}
            onChange={(checked) => set({ notifyOnHunter: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'HUNTER'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('HUNTER', 'Bài mới')} className="!text-slate-500 hover:!text-slate-200" aria-label="Gửi thử" />}
          />
          <ToggleRow
            title="Buff xong một bài"
            checked={systemSettings.notifyOnBuffDone !== false}
            onChange={(checked) => set({ notifyOnBuffDone: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'BUFF_COMPLETED'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('BUFF_COMPLETED', 'Buff xong')} className="!text-slate-500 hover:!text-slate-200" aria-label="Gửi thử" />}
          />
          <ToggleRow
            title="Facebook chặn thao tác"
            checked={systemSettings.notifyOnActionBlocked !== false}
            onChange={(checked) => set({ notifyOnActionBlocked: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'ACTION_BLOCKED'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('ACTION_BLOCKED', 'Bị chặn')} className="!text-slate-500 hover:!text-slate-200" aria-label="Gửi thử" />}
          />
          <ToggleRow
            title="Hàng đợi lỗi 3 bài liên tiếp"
            checked={systemSettings.notifyOnQueueIssue !== false}
            onChange={(checked) => set({ notifyOnQueueIssue: checked })}
          />
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <span className="text-sm text-slate-200">Dừng khẩn cấp</span>
            <span className="flex items-center gap-3">
              <Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'EMERGENCY_STOP'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('EMERGENCY_STOP', 'Dừng khẩn cấp')} className="!text-slate-500 hover:!text-slate-200" aria-label="Gửi thử" />
              <span className="text-xs text-slate-500 w-11 text-right">Luôn gửi</span>
            </span>
          </div>
          <div className="h-2" />
        </Section>

        {/* Reports, quiet hours, commands */}
        <Section title="Báo cáo & lệnh" >
          <ToggleRow
            title="Báo cáo hằng ngày"
            description="Tóm tắt 24 giờ qua."
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
            title="Giờ yên lặng"
            description="Chỉ gửi tin khẩn; tin khác được gộp gửi sau."
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
            title="Lệnh Telegram"
            description="/status · /stop · /resume"
            checked={systemSettings.telegramCommands !== false}
            onChange={(checked) => set({ telegramCommands: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Automation */}
        <Section title="Tự buff bài do app đăng">
          <ToggleRow
            title="Bật"
            checked={Boolean(systemSettings.autoBuffOwnPosts)}
            onChange={(checked) => set({ autoBuffOwnPosts: checked })}
          />
          <ToggleRow
            title="Bài Fanpage"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnFanpage !== false}
            onChange={(checked) => set({ autoBuffOwnFanpage: checked })}
          />
          <ToggleRow
            title="Bài Group"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnGroup !== false}
            onChange={(checked) => set({ autoBuffOwnGroup: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Smart Adaptive Pacing & Via Protection */}
        <Section
          title="Tốc độ & Bảo vệ Via"
        >
          <ToggleRow
            title="Giãn nhịp thông minh"
            description="Tự giãn cách thao tác theo số page và thêm độ trễ ngẫu nhiên."
            checked={systemSettings.smartAdaptivePacing !== false}
            onChange={(checked) => set({ smartAdaptivePacing: checked })}
          />
          <ToggleRow
            title="Tự dừng khi Facebook chặn thao tác"
            checked={systemSettings.autoStopOnActionBlocked !== false}
            onChange={(checked) => set({ autoStopOnActionBlocked: checked })}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Nghỉ giữa chừng</span>
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
              <span className="block text-sm text-slate-200">Tốc độ mặc định</span>
            </div>
            <Select
              value={systemSettings.defaultSpeedMode || 'NORMAL'}
              onChange={(v) => set({ defaultSpeedMode: v })}
              className="w-52 text-xs"
              options={[
                { value: 'NORMAL', label: 'Tiêu chuẩn · 2.4s (khuyên dùng)' },
                { value: 'FAST', label: 'Nhanh · 2.0s' },
                { value: 'SMART', label: 'Thông minh · 2.6–3.4s' },
                { value: 'TURBO', label: 'Turbo · 1.4s' },
                { value: 'SAFE', label: 'An toàn · 5.0s' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Số bài chạy cùng lúc</span>
            </div>
            <Select
              value={Number(systemSettings.maxParallelTasks || 2)}
              onChange={(v) => set({ maxParallelTasks: v })}
              className="w-52 text-xs"
              options={[
                { value: 1, label: '1 bài' },
                { value: 2, label: '2 bài (khuyên dùng)' },
                { value: 3, label: '3 bài' },
                { value: 4, label: '4 bài' },
              ]}
            />
          </div>
          <div className="h-2" />
        </Section>

        {/* Notification history (collapsed) */}
        <section className="app-surface rounded-2xl">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-2 text-base font-semibold text-slate-100"
            >
              <CaretRightOutlined className={`text-xs text-slate-500 transition-transform ${showHistory ? 'rotate-90' : ''}`} />
              Lịch sử thông báo
              <span className="text-xs font-normal text-slate-500">{historyLogs.length} gần nhất</span>
            </button>
            {showHistory && (
              <ConfigProvider componentDisabled={false}>
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchHistory} loading={loadingHistory} aria-label="Làm mới" />
              </ConfigProvider>
            )}
          </div>
          {showHistory && (
            <div className="border-t border-slate-800/80 divide-y divide-slate-800/70 max-h-96 overflow-y-auto">
              {historyLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">Chưa có thông báo nào.</div>
              ) : (
                historyLogs.map((r: any) => (
                  <div key={r.id} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'SENT' ? 'bg-emerald-400' : 'bg-rose-400'}`} title={r.status === 'SENT' ? 'Đã gửi' : 'Thất bại'} />
                    <span className="w-28 shrink-0 font-mono text-[11px] text-slate-500">
                      {(r.created_at ? new Date(r.created_at) : new Date()).toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                    </span>
                    <Tag className="!m-0 shrink-0 text-[10px]">{EVENT_LABELS[r.event_type] || r.event_type}</Tag>
                    <span className="min-w-0 truncate text-slate-300" title={r.message}>{r.title}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </section>

        {/* Sticky save bar */}
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
