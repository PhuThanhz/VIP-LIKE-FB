import React from 'react';
import { Alert, Input, Button, Switch, Row, Col, ConfigProvider } from 'antd';
import {
  BellOutlined,
  SendOutlined,
  CheckOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  PlayCircleOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { isAdmin, useCurrentUser } from '../auth/session';

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

export const SystemSettingsPage: React.FC<SystemSettingsPageProps> = React.memo(({
  systemSettings,
  setSystemSettings,
  savingSettings,
  onSaveSettings,
  testingTelegram,
  onTestTelegram,
  bmOverview,
  onEmergencyStop,
  onResumeSystem,
}) => {
  // Backend chỉ cho ADMIN lưu cấu hình (403 với tài khoản khác) nên khoá form để tránh sửa rồi lưu thất bại
  const canEdit = isAdmin(useCurrentUser());

  return (
    <ConfigProvider componentDisabled={!canEdit}>
    <div className="space-y-6 max-w-[1100px] mx-auto pb-6">
      {!canEdit && (
        <Alert
          type="info"
          showIcon
          message="Chỉ tài khoản ADMIN được thay đổi cấu hình hệ thống. Bạn đang xem ở chế độ chỉ đọc."
          className="rounded-xl"
        />
      )}

      {/* 2. Emergency Stop Status & Control */}
      {bmOverview?.system?.isEmergencyStopped ? (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-800/80 text-rose-200 flex items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <StopOutlined className="text-rose-400 text-2xl shrink-0" />
            <div>
              <div className="text-sm font-bold uppercase tracking-wider text-rose-200">
                Hệ Thống Đang Trong Trạng Thái Dừng Khẩn Cấp (Emergency Stop)
              </div>
              <div className="text-xs text-rose-300/80 mt-0.5">
                Mọi tác vụ hàng đợi tự động và Playwright đang tạm dừng để bảo vệ dàn nick ({bmOverview?.system?.emergencyReason || 'Bởi Quản trị viên'}).
              </div>
            </div>
          </div>
          {onResumeSystem && (
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={onResumeSystem}
              className="bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-xs shrink-0 h-9"
            >
              Khôi phục ngay
            </Button>
          )}
        </div>
      ) : (
        <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 text-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <SafetyCertificateOutlined className="text-emerald-400 text-2xl shrink-0" />
            <div>
              <div className="text-sm font-bold text-emerald-300">
                Hệ Thống Vận Hành Bình Thường & Sẵn Sàng
              </div>
              <div className="text-xs text-emerald-400/80 mt-0.5">
                Các tiến trình chạy ngầm, hàng đợi tự động và trình giám sát Post Hunter đang hoạt động liên tục.
              </div>
            </div>
          </div>
          {onEmergencyStop && (
            <Button
              danger
              icon={<StopOutlined />}
              onClick={onEmergencyStop}
              className="rounded-xl text-xs font-semibold h-9"
            >
              Dừng khẩn cấp
            </Button>
          )}
        </div>
      )}

      {/* 3. Telegram Ops Bot Setup */}
      <div className="app-surface p-5 space-y-4 rounded-2xl">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800/80">
          <div className="w-9 h-9 rounded-xl bg-blue-950/90 border border-blue-800/60 flex items-center justify-center text-blue-400 text-lg">
            <RobotOutlined />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-100 m-0">
              Kết Nối Bot Telegram Giám Sát Thời Gian Thực
            </h3>
            <p className="text-xs text-slate-400 m-0 mt-0.5">
              Nhận thông báo tự động về điện thoại khi có bài viết mới hoặc khi Via gặp sự cố.
            </p>
          </div>
        </div>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              Telegram Bot Token:
            </label>
            <Input.Password
              autoComplete="off"
              placeholder={
                systemSettings.telegramBotTokenMasked
                  ? `Đang dùng: ${systemSettings.telegramBotTokenMasked} (Nhập để đổi)`
                  : 'Ví dụ: 7891234567:AAH...'
              }
              value={systemSettings.telegramBotToken}
              onChange={(e) => setSystemSettings((prev: any) => ({ ...prev, telegramBotToken: e.target.value }))}
              className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-blue-500"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Tạo bot và lấy token miễn phí từ <b>@BotFather</b> trên Telegram.
            </div>
          </Col>

          <Col xs={24} md={12}>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              Telegram Chat ID:
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="Ví dụ: 123456789 hoặc -100123456789"
                value={systemSettings.telegramChatId}
                onChange={(e) => setSystemSettings((prev: any) => ({ ...prev, telegramChatId: e.target.value }))}
                className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-blue-500 flex-1"
              />
              <Button
                loading={testingTelegram}
                onClick={onTestTelegram}
                icon={<SendOutlined />}
                className="bg-blue-950/80 border-blue-700/80 hover:border-blue-500 text-blue-300 font-semibold text-xs rounded-xl h-10 px-4"
              >
                Gửi Tin Test
              </Button>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Lấy Chat ID cá nhân hoặc nhóm từ <b>@userinfobot</b> hoặc <b>@getmyid_bot</b>.
            </div>
          </Col>
        </Row>
      </div>

      {/* 4. Automated Alert Policies */}
      <div className="app-surface p-5 space-y-4 rounded-2xl">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800/80">
          <div className="w-9 h-9 rounded-xl bg-cyan-950/90 border border-cyan-800/60 flex items-center justify-center text-cyan-400 text-lg">
            <BellOutlined />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-100 m-0">
              Chính Sách Cảnh Báo Tự Động
            </h3>
            <p className="text-xs text-slate-400 m-0 mt-0.5">
              Bật/tắt các loại thông báo gửi về Telegram của bạn.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">
                Cảnh báo tức thì khi Via bị Checkpoint hoặc hết hạn
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Tự động thông báo và cô lập Via lỗi để bảo vệ an toàn cho dàn Page còn lại.
              </div>
            </div>
            <Switch
              checked={systemSettings.notifyOnViaDead !== false}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, notifyOnViaDead: checked }))}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">
                Thông báo khi Post Hunter phát hiện bài viết mới
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Gửi đường link bài viết vừa đăng và đếm ngược thời gian chờ buff tự động.
              </div>
            </div>
            <Switch
              checked={systemSettings.notifyOnHunter !== false}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, notifyOnHunter: checked }))}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">
                Thông báo khi hoàn tất chiến dịch Buff tương tác
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Báo cáo tổng kết số lượt like/comment thành công và tổng thời gian hoàn tất.
              </div>
            </div>
            <Switch
              checked={systemSettings.notifyOnBuffDone !== false}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, notifyOnBuffDone: checked }))}
            />
          </div>
        </div>
      </div>

      {/* 5. Auto-Buff Own Posts Policy */}
      <div className="app-surface p-5 space-y-4 rounded-2xl">
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800/80">
          <div className="w-9 h-9 rounded-xl bg-purple-950/90 border border-purple-800/60 flex items-center justify-center text-purple-400 text-lg">
            <ThunderboltOutlined />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-100 m-0">
              Tự Buff Bài Khi Vừa Đăng Lên Hệ Thống
            </h3>
            <p className="text-xs text-slate-400 m-0 mt-0.5">
              Tự động xếp lịch buff tương tác ngay sau khi bài viết được đăng thành công.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">
                Bật tự động buff bài viết vừa đăng
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Đăng bài xong là nạp ngay vào hàng đợi tự động, buff xoay vòng bằng các Page của mọi Via.
              </div>
            </div>
            <Switch
              checked={Boolean(systemSettings.autoBuffOwnPosts)}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, autoBuffOwnPosts: checked }))}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">Áp dụng cho bài đăng lên Fanpage</div>
            </div>
            <Switch
              disabled={!systemSettings.autoBuffOwnPosts}
              checked={systemSettings.autoBuffOwnFanpage !== false}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, autoBuffOwnFanpage: checked }))}
            />
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-bold text-slate-200">Áp dụng cho bài đăng vào Nhóm (Groups)</div>
            </div>
            <Switch
              disabled={!systemSettings.autoBuffOwnPosts}
              checked={systemSettings.autoBuffOwnGroup !== false}
              onChange={(checked) => setSystemSettings((prev: any) => ({ ...prev, autoBuffOwnGroup: checked }))}
            />
          </div>
        </div>
      </div>

      {/* Thanh lưu cố định: luôn thấy nút Lưu dù đang ở phần nào của trang */}
      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 px-4 py-3 rounded-2xl border border-slate-800/80 bg-slate-900/95 backdrop-blur flex items-center justify-between gap-3 shadow-2xl">
          <span className="text-xs text-slate-400">Thay đổi chỉ có hiệu lực sau khi bấm Lưu.</span>
          <Button
            type="primary"
            icon={<CheckOutlined />}
            loading={savingSettings}
            onClick={onSaveSettings}
            className="bg-blue-600 hover:bg-blue-500 rounded-xl px-6 h-10 font-bold text-xs shadow-lg shadow-blue-500/20"
          >
            Lưu Cấu Hình
          </Button>
        </div>
      )}
    </div>
    </ConfigProvider>
  );
});

export default SystemSettingsPage;
