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
  BUFF_COMPLETED: 'Completed',
  VIA_DEAD: 'Via error',
  ACTION_BLOCKED: 'Blocked',
  EMERGENCY_STOP: 'Emergency',
  HUNTER: 'New post',
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
        message.success(`Sent test "${label}" to Telegram`);
        fetchHistory();
      } else {
        message.error(res.data?.error || 'Could not send the simulation');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Error sending the simulation');
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
            message="Only admin accounts can change settings. You are viewing in read-only mode."
            className="rounded-xl"
          />
        )}

        {/* Only shown during an emergency stop; the Emergency stop button is already in the status bar above */}
        {bmOverview?.system?.isEmergencyStopped && (
          <Alert
            type="error"
            showIcon
            className="rounded-xl"
            message="The system is in emergency stop"
            description={bmOverview?.system?.emergencyReason || 'The queue and background tasks are paused.'}
            action={
              onResumeSystem && (
                <ConfigProvider componentDisabled={false}>
                  <Button size="small" onClick={onResumeSystem}>
                    Resume
                  </Button>
                </ConfigProvider>
              )
            }
          />
        )}

        {/* Telegram */}
        <Section
          title="Telegram"
          description="Get notifications on your phone via a Telegram bot."
          extra={
            <span
              className={`inline-flex items-center gap-1.5 text-xs shrink-0 ${
                telegramConnected ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${telegramConnected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
              {telegramConnected ? 'Connected' : 'Not connected'}
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
                    Send test
                  </Button>
                  <Button size="small" type="text" onClick={() => setEditingBot(true)}>
                    Change bot
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
                          ? `${systemSettings.telegramBotTokenMasked} · type to change`
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
                    Create a bot via <span className="text-blue-400">@BotFather</span>, get the Chat ID from <span className="text-blue-400">@userinfobot</span>, then click Save.
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {systemSettings?.botInfo && (
                      <Button size="small" type="text" onClick={() => setEditingBot(false)}>
                        Cancel
                      </Button>
                    )}
                    <Button size="small" loading={testingTelegram} disabled={!hasTelegramInput} onClick={onTestTelegram} icon={<SendOutlined />}>
                      Send test
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </Section>

        {/* Notifications */}
        <Section title="Notifications" description="Choose which events are sent to Telegram. Click ➤ to send a test.">
          <ToggleRow
            title="Via checkpoint / cookie expired"
            checked={systemSettings.notifyOnViaDead !== false}
            onChange={(checked) => set({ notifyOnViaDead: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'VIA_DEAD'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('VIA_DEAD', 'Via error')} className="!text-slate-500 hover:!text-slate-200" aria-label="Send test" />}
          />
          <ToggleRow
            title="New post caught"
            checked={systemSettings.notifyOnHunter !== false}
            onChange={(checked) => set({ notifyOnHunter: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'HUNTER'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('HUNTER', 'New post')} className="!text-slate-500 hover:!text-slate-200" aria-label="Send test" />}
          />
          <ToggleRow
            title="Post buff finished"
            checked={systemSettings.notifyOnBuffDone !== false}
            onChange={(checked) => set({ notifyOnBuffDone: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'BUFF_COMPLETED'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('BUFF_COMPLETED', 'Buff done')} className="!text-slate-500 hover:!text-slate-200" aria-label="Send test" />}
          />
          <ToggleRow
            title="Facebook blocked an action"
            checked={systemSettings.notifyOnActionBlocked !== false}
            onChange={(checked) => set({ notifyOnActionBlocked: checked })}
            extra={<Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'ACTION_BLOCKED'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('ACTION_BLOCKED', 'Blocked')} className="!text-slate-500 hover:!text-slate-200" aria-label="Send test" />}
          />
          <ToggleRow
            title="Queue failed 3 posts in a row"
            checked={systemSettings.notifyOnQueueIssue !== false}
            onChange={(checked) => set({ notifyOnQueueIssue: checked })}
          />
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <span className="text-sm text-slate-200">Emergency stop</span>
            <span className="flex items-center gap-3">
              <Button size="small" type="text" icon={<SendOutlined />} loading={sendingScenario === 'EMERGENCY_STOP'} disabled={!hasTelegramInput} onClick={() => handleTestScenario('EMERGENCY_STOP', 'Emergency stop')} className="!text-slate-500 hover:!text-slate-200" aria-label="Send test" />
              <span className="text-xs text-slate-500 w-11 text-right">Always</span>
            </span>
          </div>
          <div className="h-2" />
        </Section>

        {/* Reports, quiet hours, commands */}
        <Section title="Reports & commands" >
          <ToggleRow
            title="Daily report"
            description="Summary of the last 24 hours."
            checked={systemSettings.dailyReportEnabled !== false}
            onChange={(checked) => set({ dailyReportEnabled: checked })}
          />
          {systemSettings.dailyReportEnabled !== false && (
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-slate-800/80">
              <span className="text-sm text-slate-400">Send at</span>
              <Select
                value={Number(systemSettings.dailyReportHour ?? 8)}
                onChange={(v) => set({ dailyReportHour: v })}
                className="w-28"
                options={Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }))}
              />
            </div>
          )}
          <ToggleRow
            title="Quiet hours"
            description="Only urgent messages are sent; others are batched for later."
            checked={Boolean(systemSettings.quietHoursEnabled)}
            onChange={(checked) => set({ quietHoursEnabled: checked })}
          />
          {systemSettings.quietHoursEnabled && (
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-slate-800/80">
              <span className="text-sm text-slate-400">From – to</span>
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
            title="Telegram commands"
            description="/status · /stop · /resume"
            checked={systemSettings.telegramCommands !== false}
            onChange={(checked) => set({ telegramCommands: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Automation */}
        <Section title="Auto-buff posts made by the app">
          <ToggleRow
            title="Enabled"
            checked={Boolean(systemSettings.autoBuffOwnPosts)}
            onChange={(checked) => set({ autoBuffOwnPosts: checked })}
          />
          <ToggleRow
            title="Fanpage posts"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnFanpage !== false}
            onChange={(checked) => set({ autoBuffOwnFanpage: checked })}
          />
          <ToggleRow
            title="Group posts"
            disabled={!systemSettings.autoBuffOwnPosts}
            checked={systemSettings.autoBuffOwnGroup !== false}
            onChange={(checked) => set({ autoBuffOwnGroup: checked })}
          />
          <div className="h-2" />
        </Section>

        {/* Smart Adaptive Pacing & Via Protection */}
        <Section
          title="Speed & Via protection"
        >
          <ToggleRow
            title="Smart pacing"
            description="Automatically spaces actions by page count and adds random delays."
            checked={systemSettings.smartAdaptivePacing !== false}
            onChange={(checked) => set({ smartAdaptivePacing: checked })}
          />
          <ToggleRow
            title="Auto-stop when Facebook blocks an action"
            checked={systemSettings.autoStopOnActionBlocked !== false}
            onChange={(checked) => set({ autoStopOnActionBlocked: checked })}
          />
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Mid-run breaks</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400">Every</span>
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
                <span className="text-xs text-slate-400">Rest</span>
                <Input
                  type="number"
                  min={10}
                  max={180}
                  value={systemSettings.cooldownDurationSec ?? 20}
                  onChange={(e) => set({ cooldownDurationSec: parseInt(e.target.value, 10) || 20 })}
                  className="w-20 font-mono text-xs"
                />
                <span className="text-xs text-slate-400">sec</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Default speed</span>
            </div>
            <Select
              value={systemSettings.defaultSpeedMode || 'NORMAL'}
              onChange={(v) => set({ defaultSpeedMode: v })}
              className="w-52 text-xs"
              options={[
                { value: 'NORMAL', label: 'Standard · 2.4s (recommended)' },
                { value: 'FAST', label: 'Nhanh · 2.0s' },
                { value: 'SMART', label: 'Smart · 2.6–3.4s' },
                { value: 'TURBO', label: 'Turbo · 1.4s' },
                { value: 'SAFE', label: 'Safe · 5.0s' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-t border-slate-800/80">
            <div>
              <span className="block text-sm text-slate-200">Posts running at once</span>
            </div>
            <Select
              value={Number(systemSettings.maxParallelTasks || 2)}
              onChange={(v) => set({ maxParallelTasks: v })}
              className="w-52 text-xs"
              options={[
                { value: 1, label: '1 post' },
                { value: 2, label: '2 posts (recommended)' },
                { value: 3, label: '3 posts' },
                { value: 4, label: '4 posts' },
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
              Notification history
              <span className="text-xs font-normal text-slate-500">{historyLogs.length} most recent</span>
            </button>
            {showHistory && (
              <ConfigProvider componentDisabled={false}>
                <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchHistory} loading={loadingHistory} aria-label="Refresh" />
              </ConfigProvider>
            )}
          </div>
          {showHistory && (
            <div className="border-t border-slate-800/80 divide-y divide-slate-800/70 max-h-96 overflow-y-auto">
              {historyLogs.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">No notifications yet.</div>
              ) : (
                historyLogs.map((r: any) => (
                  <div key={r.id} className="px-5 py-2.5 flex items-center gap-3 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status === 'SENT' ? 'bg-emerald-400' : 'bg-rose-400'}`} title={r.status === 'SENT' ? 'Sent' : 'Failed'} />
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
            <span className="text-xs text-slate-400">Changes take effect after saving.</span>
            <Button type="primary" loading={savingSettings} onClick={onSaveSettings} className="px-6">
              Save
            </Button>
          </div>
        )}
      </div>
    </ConfigProvider>
  );
});

export default SystemSettingsPage;
