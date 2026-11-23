import React, { lazy, Suspense } from 'react';
import {
  Card,
  Input,
  Button,
  Select,
  Tag,
  Row,
  Col,
  Checkbox,
  Progress,
  Tabs,
  Modal,
  InputNumber,
  Segmented,
  Switch,
  Dropdown,
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  PlusCircleOutlined,
  ThunderboltFilled,
  ReloadOutlined,
  PlayCircleOutlined,
  CheckCircleFilled,
  ExportOutlined,
  RobotOutlined,
  UserOutlined,
  SearchOutlined,
  StopOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
  InfoCircleOutlined,
  CommentOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  ShareAltOutlined,
  ExclamationCircleOutlined,
  UpOutlined,
  DownOutlined,
  InteractionOutlined,
  AppstoreOutlined,
  BulbOutlined,
  ControlOutlined,
  LikeOutlined,
  EditOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { WORKER_BASE_URL } from '../config/axios';
import PasteLinkInput from '../components/common/PasteLinkInput';
import { TableSkeleton, PageSkeleton } from '../components/common/SaaSLoadingSkeleton';
import { parseFacebookCookie } from '../utils/cookieHelper';

// Tách nhỏ bundle (Code-splitting) với React.lazy cho các phân hệ quản trị lớn
const PostHunterTab = lazy(() => import('../components/buff/PostHunterTab'));
const BuffQueueTab = lazy(() => import('../components/buff/BuffQueueTab'));
const ViaManagementPage = lazy(() => import('./ViaManagementPage'));
const SystemSettingsPage = lazy(() => import('./SystemSettingsPage'));
const LicenseManagementPage = lazy(() => import('./LicenseManagementPage'));

import { REACTIONS, SPEED_PRESETS } from '../features/buff/constants';
import {
  formatDuration,
  extractCUser,
  formatDelaySeconds,
  getSpeedLabel,
  cleanPageName,
} from '../features/buff/utils';
import PageCardItem from '../features/buff/components/PageCardItem';
import MonitorFormModal from '../features/buff/components/MonitorFormModal';
import ViaHealthModal from '../features/buff/components/ViaHealthModal';
import LogDetailModal from '../features/buff/components/LogDetailModal';
import ManagePagesModal from '../features/buff/components/ManagePagesModal';
import HistoryTab from '../features/buff/components/HistoryTab';
import RunningTab from '../features/buff/components/RunningTab';
import ResumeBuffModal from '../features/buff/components/ResumeBuffModal';
import AiSeedingModal from '../features/buff/components/AiSeedingModal';
import { useBuffEngagementController } from '../features/buff/hooks/useBuffEngagementController';


export interface BuffEngagementProps {
  activeTabKey?: string;
  onTabChange?: (key: string) => void;
  onOpenViaManager?: () => void;
  onOpenSettings?: () => void;
  isExternalSettingsOpen?: boolean;
  onCloseExternalSettings?: () => void;
  dbStatus?: any;
  onCheckDb?: () => void;
  onStatsUpdate?: (stats: {
    queueCount: number;
    historyCount: number;
    monitorsCount: number;
    accountsCount: number;
  }) => void;
}

export default function BuffEngagement(props: BuffEngagementProps = {}) {
  const controller = useBuffEngagementController(props);
  const {
    message,
    openCookieAlertModal,
    activeTabKey,
    setActiveTabKey,
    selectedAccountId,
    setSelectedAccountId,
    customCookie,
    setCustomCookie,
    targetPostUrl,
    setTargetPostUrl,
    selectedReaction,
    setSelectedReaction,
    scannedPages,
    setScannedPages,
    actorMode,
    setActorMode,
    selectedPageIds,
    setSelectedPageIds,
    handleTogglePageId,
    pageSearchQuery,
    setPageSearchQuery,
    viaFilter,
    setViaFilter,
    likeFilter,
    setLikeFilter,
    speedMode,
    setSpeedMode,
    delayMs,
    setDelayMs,
    customSpeed,
    setCustomSpeed,
    enableHumanBehavior,
    setEnableHumanBehavior,
    fastSwitch,
    setFastSwitch,
    antiCheckpointGuard,
    setAntiCheckpointGuard,
    isAiGeneratingComments,
    concurrency,
    setConcurrency,
    dripFeedMode,
    setDripFeedMode,
    dripDurationMinutes,
    setDripDurationMinutes,
    autoFailoverLiveVia,
    setAutoFailoverLiveVia,
    showAdvancedSettings,
    setShowAdvancedSettings,
    aiPostPrompt,
    setAiPostPrompt,
    aiTone,
    setAiTone,
    aiCount,
    setAiCount,
    avatarCacheMap,
    autoBuffProgress,
    runningTargetInfo,
    liveLogs,
    runTiming,
    buffMode,
    setBuffMode,
    engagementMode,
    setEngagementMode,
    commentListText,
    setCommentListText,
    inlineCommentEditorOpen,
    setInlineCommentEditorOpen,
    parsedCommentLines,
    enableShare,
    setEnableShare,
    seedingPresets,
    interactedPagesLoading,
    queueItems,
    fetchBuffQueue,
    runMode,
    setRunMode,
    queueStartAfter,
    setQueueStartAfter,
    queueStartAt,
    setQueueStartAt,
    queueStagger,
    setQueueStagger,
    isEnqueueing,
    handleEnqueueFromForm,
    handleRunNowQueueTask,
    handleStopQueueTask,
    handleRemoveQueueTask,
    handleClearCompletedQueue,
    handleClearAllQueue,
    handleRetryQueueTask,
    monitors,
    postHunterPaused,
    fetchBuffMonitors,
    isMonitorModalOpen,
    setIsMonitorModalOpen,
    monitorModalTarget,
    checkingViaHealth,
    viaHealthResults,
    isHealthModalOpen,
    setIsHealthModalOpen,
    bmOverview,
    fetchBmOverview,
    systemSettings,
    setSystemSettings,
    savingSettings,
    testingTelegram,
    deadViaList,
    handleSaveSettings,
    handleTestTelegram,
    handleEmergencyStop,
    handleResumeSystem,
    handleRunViaHealthCheck,
    handleOpenAddMonitorModal,
    handleDeleteMonitor,
    handleTogglePostHunterPaused,
    handleToggleMonitor,
    handleScanNowMonitor,
    aiStudioModalOpen,
    setAiStudioModalOpen,
    selectedNiche,
    setSelectedNiche,
    handleGenerateAiComments,
    buffLogs,
    setBuffLogs,
    buffLogsLoading,
    loadingLogDetailId,
    handleViewLogDetail,
    reloadBuffLogs,
    autoSkipAlreadyLiked,
    setAutoSkipAlreadyLiked,
    logSearchQuery,
    setLogSearchQuery,
    selectedLogDetail,
    setSelectedLogDetail,
    batchLinksText,
    setBatchLinksText,
    batchLikesPerOrder,
    setBatchLikesPerOrder,
    batchLinkConcurrency,
    setBatchLinkConcurrency,
    batchOrders,
    setBatchOrders,
    pageDisplayLimit,
    setPageDisplayLimit,
    isBatchRunning,
    queryClient,
    managePagesModalOpen,
    setManagePagesModalOpen,
    targetViaForModal,
    setTargetViaForModal,
    loadingAccounts,
    refetchAccounts,
    accounts,
    fbAccounts,
    currentViaAccount,
    modalViaAccount,
    currentModalPages,
    handleOpenManagePages,
    parsedBatchLinks,
    invalidBatchLinesCount,
    runEstimate,
    handleSavePagesForTargetVia,
    handleDeletePageForTargetVia,
    handleClearPagesForTargetVia,
    viaGroupCounts,
    selectedPageIdsSet,
    combinedAlreadyLikedIds,
    unlikedScannedPages,
    filteredPages,
    expiredPagesSelectedCount,
    handleReplaceExpiredPagesWithLiveOnes,
    handleSelectAllUnliked,
    handleSelectRandomPages,
    scanPagesMutation,
    autoBuffMutation,
    handleStopAutoBuff,
    isResumingRemaining,
    resumeModalOpen,
    setResumeModalOpen,
    resumeTargetUrl,
    resumeDoneLikes,
    resumeTargetLikes,
    resumeMissingLikes,
    setResumeMissingLikes,
    resumeReaction,
    setResumeReaction,
    handleResumeRemaining,
    handleConfirmResume,
    handleStartNewCampaign,
    handleScanPages,
    handleStartAutoBuff,
    handleStartBatchBuff,
    handleStopBatchBuff,
    handleRefillSingleOrder,
    handleRefillBatchIncomplete,
    handleQuickPresetLike24,
    handleQuickPresetAiSeeding,
    handleQuickPresetVias,
    isAnyBuffRunning,
    isBuffTab,
    emergencyStopButton,
  } = controller;

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto px-2 sm:px-4 md:px-6 pb-28 md:pb-12">
      {/* Ngoài các tab Like & Bình luận (không có thanh tab), vẫn giữ nút dừng khẩn cấp khi đang chạy */}
      {!isBuffTab && isAnyBuffRunning && !bmOverview?.system?.isEmergencyStopped && (
        <div className="flex justify-end">{emergencyStopButton}</div>
      )}

      {/* CẢNH BÁO VIA HẾT HẠN COOKIE / CHECKPOINT */}
      {deadViaList.length > 0 && (
        <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-amber-200 font-medium">
              {deadViaList.length} Via cần cập nhật Cookie
            </div>
            <div className="text-xs text-amber-200/70 mt-0.5 truncate">
              {deadViaList
                .map((v) => `${v.viaName || v.uid} (${v.tokenStatus === 'CHECKPOINT' ? 'checkpoint' : 'hết hạn'})`)
                .join(' · ')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="small" loading={checkingViaHealth} onClick={handleRunViaHealthCheck}>
              Kiểm tra lại
            </Button>
            <Button
              size="small"
              type="primary"
              danger
              icon={<ThunderboltOutlined />}
              onClick={() => openCookieAlertModal(deadViaList[0]?.uid)}
              className="font-semibold shadow-sm"
            >
              Cập nhật Cookie ngay
            </Button>
          </div>
        </div>
      )}

      {/* BANNER CẢNH BÁO NẾU HỆ THỐNG ĐANG DỪNG KHẨN CẤP */}
      {bmOverview?.system?.isEmergencyStopped && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-center justify-between text-xs gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <StopOutlined className="text-rose-400 text-base shrink-0" />
            <div>
              <strong className="text-rose-200 text-xs font-semibold uppercase tracking-wider">Hệ thống đang dừng khẩn cấp (Emergency Stop)</strong>
              <div className="text-rose-300/80 text-[11px] mt-0.5">
                Toàn bộ hàng đợi tự động và tác vụ Playwright đang tạm dừng an toàn ({bmOverview?.system?.emergencyReason || 'Bởi Quản trị viên'}).
              </div>
            </div>
          </div>
          <Button
            size="small"
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleResumeSystem}
            className="bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold shrink-0 rounded-lg"
          >
            Khôi phục ngay
          </Button>
        </div>
      )}

      {/* Thanh điều hướng phân hệ VIPLIKE RADIANT (Linear/Apple-Tier Segmented Dock) */}
      {isBuffTab && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-800/60">
          <div
            role="tablist"
            aria-label="Điều hướng tính năng tương tác"
            className="inline-flex p-1.5 rounded-2xl bg-slate-900/85 border border-slate-800/90 backdrop-blur-xl shadow-lg shadow-black/25 gap-1.5 overflow-x-auto max-w-full scrollbar-none"
          >
            {[
              {
                key: 'buff-like',
                label: 'Tạo mới',
                icon: PlusCircleOutlined,
                iconColor: 'text-cyan-400',
                count: 0,
              },
              {
                key: 'buff-running',
                label: 'Tiến trình chạy',
                icon: ThunderboltFilled,
                iconColor: 'text-amber-400',
                count: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')) ? 1 : 0,
                isPulse: (autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')),
              },
              {
                key: 'buff-queue',
                label: 'Hàng đợi',
                icon: ClockCircleOutlined,
                iconColor: 'text-sky-400',
                count: queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length,
              },
              {
                key: 'buff-history',
                label: 'Lịch sử',
                icon: HistoryOutlined,
                iconColor: 'text-indigo-400',
                count: 0,
              },
              {
                key: 'buff-hunter',
                label: 'Săn bài tự động',
                icon: AimOutlined,
                iconColor: 'text-rose-400',
                count: monitors.length,
              },
            ].map((t) => {
              const active = activeTabKey === t.key;
              const IconComp = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTabKey(t.key)}
                  className={`group relative px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer select-none flex items-center gap-2 outline-none focus:outline-none shrink-0 ${
                    active
                      ? 'bg-gradient-to-b from-slate-800/95 to-slate-800/70 text-white font-semibold shadow-[0_2px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.12)] border border-cyan-500/35'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                  }`}
                >
                  {/* Icon vector chuyên nghiệp */}
                  <span
                    className={`flex items-center justify-center text-sm transition-transform duration-200 group-hover:scale-110 ${
                      active ? t.iconColor : 'text-slate-400 group-hover:text-slate-300'
                    }`}
                  >
                    <IconComp />
                  </span>

                  {/* Nhãn tính năng */}
                  <span>{t.label}</span>

                  {/* Đèn báo live radar cho Tiến trình chạy */}
                  {t.isPulse && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"></span>
                    </span>
                  )}

                  {/* Badge số lượng hiện đại */}
                  {t.count > 0 && !t.isPulse && (
                    <span
                      className={`ml-0.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold tabular-nums leading-none transition-colors ${
                        active
                          ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm'
                          : 'bg-slate-800/90 text-slate-400 border border-slate-700/50'
                      }`}
                    >
                      {t.count > 999 ? '999+' : t.count}
                    </span>
                  )}

                  {/* Đường viền neon ánh sáng dưới chân tab đang active */}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Bên phải: số Via/Page (bấm để kiểm tra Via) + dừng khẩn cấp khi đang chạy */}
          <div className="flex items-center gap-2 pr-1 shrink-0">
            <Tooltip title="Bấm để kiểm tra tình trạng cookie của các Via">
              <Button size="small" loading={checkingViaHealth} onClick={handleRunViaHealthCheck} className="text-xs">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${bmOverview?.deadVias > 0 ? 'bg-rose-400' : 'bg-emerald-400'}`} />
                <span className="text-slate-300">{bmOverview?.liveVias ?? fbAccounts.length} Via</span>
                {bmOverview?.deadVias > 0 && <span className="text-rose-400">· {bmOverview.deadVias} lỗi</span>}
                <span className="text-slate-500">·</span>
                <span className="text-slate-300">{scannedPages.length} Page</span>
              </Button>
            </Tooltip>
            {isAnyBuffRunning && !bmOverview?.system?.isEmergencyStopped && emergencyStopButton}
          </div>
        </div>
      )}

      <Tabs
        activeKey={activeTabKey}
        onChange={(k) => setActiveTabKey(k)}
        renderTabBar={() => null}
        animated={false}
        destroyOnHidden={false}
        tabBarExtraContent={<span className="text-xs text-slate-400">{fbAccounts.length} nick · {scannedPages.length} Page</span>}
        items={[
          {
            key: 'buff-like',
            label: 'Like & bình luận',
            children: (
              <div className="space-y-5">
                <Row gutter={[20, 20]} align="top">
                  {/* CỘT TRÁI: 1. Bài viết → 2. Tương tác → 3. Tài khoản */}
                  <Col xs={24} lg={15}>
                    <div className="space-y-4">
                      {/* TOP HERO COMMAND BAR: DÁN LINK & QUICK PRESETS */}
                      <div className="app-surface p-5 space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                                  1
                                </span>
                                <span className="text-sm sm:text-base font-semibold text-slate-100">
                                  Bài viết
                                </span>
                                {targetPostUrl && (
                                  <span className="text-xs text-slate-400">
                                    {targetPostUrl.includes('/groups/')
                                      ? 'Nhóm Facebook'
                                      : targetPostUrl.includes('/reel')
                                      ? 'Video Reels'
                                      : 'Bài viết'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Mẫu nhanh: gom 3 preset vào 1 nút để bớt một hàng nút trên form */}
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  {
                                    key: 'all-pages',
                                    icon: <ThunderboltFilled className="text-blue-400" />,
                                    label: `Like bằng toàn bộ Page (${scannedPages.length})`,
                                    onClick: handleQuickPresetLike24,
                                  },
                                  {
                                    key: 'ai-seeding',
                                    icon: <RobotOutlined className="text-purple-400" />,
                                    label: 'Like + bình luận AI',
                                    onClick: handleQuickPresetAiSeeding,
                                  },
                                  {
                                    key: 'vias',
                                    icon: <UserOutlined className="text-emerald-400" />,
                                    label: `Dùng nick cá nhân (${fbAccounts.length})`,
                                    onClick: handleQuickPresetVias,
                                  },
                                ],
                              }}
                            >
                              <Button icon={<ThunderboltFilled className="text-amber-400" />}>
                                Mẫu nhanh <DownOutlined className="text-[10px]" />
                              </Button>
                            </Dropdown>
                            <Segmented
                              size="middle"
                              value={buffMode}
                              onChange={(val) => setBuffMode(val as 'SINGLE' | 'BATCH')}
                              options={[
                                { label: '1 link', value: 'SINGLE' },
                                { label: 'Nhiều link', value: 'BATCH' },
                              ]}
                            />
                          </div>
                        </div>

                        {/* Input link hoặc danh sách link */}
                        {buffMode === 'SINGLE' ? (
                          <div>
                            <PasteLinkInput
                              value={targetPostUrl}
                              onChange={(val) => setTargetPostUrl(val)}
                              placeholder="Dán link bài viết Facebook (Group, Fanpage, Profile, Reels)"
                            />

                            {/* Đang kiểm tra lịch sử chống trùng */}
                            {interactedPagesLoading && (
                              <div className="mt-2.5 text-[11px] text-cyan-400 flex items-center gap-1.5">
                                <LoadingOutlined spin /> Đang kiểm tra các Page đã từng like bài viết này (kể cả link /share/)...
                              </div>
                            )}

                            {/* Cảnh báo nếu đã từng like bài viết này */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-amber-300 font-semibold flex items-center gap-2">
                                  <InfoCircleOutlined className="text-amber-400 text-sm" />
                                  <span>
                                    Đã lưu <b>{combinedAlreadyLikedIds.size} Page/Via</b> từng like bài viết này trước đó (còn <b>{unlikedScannedPages.length}</b> chưa like)
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
                                    message.success(`Đã tự động bỏ chọn các tài khoản đã like bài viết này!`);
                                  }}
                                  className="text-xs p-0 h-auto text-amber-400 font-bold hover:underline shrink-0"
                                >
                                  Bỏ chọn {combinedAlreadyLikedIds.size} tài khoản đã like
                                </Button>
                              </div>
                            )}

                            {/* Thanh Chọn Nhanh Số Lượng Like Ngay Dưới Ô Nhập Link (Không cần cuộn chuột) */}
                            {scannedPages.length > 0 && (
                              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-300">Số like</span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {[30, 50, 100, 200, 300]
                                    .filter((n) => n <= scannedPages.length)
                                    .map((num) => {
                                      const isSelected = selectedPageIds.length === num;
                                      return (
                                        <button
                                          key={num}
                                          type="button"
                                          onClick={() => handleSelectRandomPages(num)}
                                          className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                            isSelected
                                              ? 'bg-blue-600 text-white border-blue-500 shadow-md shadow-blue-500/20'
                                              : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-blue-400 hover:text-white'
                                          }`}
                                        >
                                          {num}
                                        </button>
                                      );
                                    })}
                                  <button
                                    type="button"
                                    onClick={handleSelectAllUnliked}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      selectedPageIds.length > 0 &&
                                      selectedPageIds.length === (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                        ? 'bg-cyan-600 text-white border-cyan-500 shadow-md'
                                        : 'bg-cyan-950/60 text-cyan-300 border-cyan-800/80 hover:border-cyan-400'
                                    }`}
                                  >
                                    {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                      ? `Chưa like (${unlikedScannedPages.length})`
                                      : `Tất cả (${scannedPages.length})`}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-bold text-slate-200">
                                Danh sách link Facebook (Mỗi dòng một link):
                              </span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono px-2.5 py-0.5 rounded-md bg-blue-950/90 border border-blue-700/70 text-blue-300 font-bold">
                                  {parsedBatchLinks.length} link hợp lệ
                                </span>
                                {invalidBatchLinesCount > 0 && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-950/90 border border-amber-700/70 text-amber-300 font-semibold flex items-center gap-1" title="Có dòng không nhận diện được định dạng Facebook hợp lệ">
                                    <ExclamationCircleOutlined className="text-amber-400" /> {invalidBatchLinesCount} dòng lỗi/bỏ qua
                                  </span>
                                )}
                                {batchLinksText && (
                                  <Button
                                    type="link"
                                    size="small"
                                    danger
                                    onClick={() => setBatchLinksText('')}
                                    className="text-xs p-0 h-auto font-semibold"
                                  >
                                    Xóa hết
                                  </Button>
                                )}
                              </div>
                            </div>
                            <Input.TextArea
                              rows={4}
                              value={batchLinksText}
                              onChange={(e) => setBatchLinksText(e.target.value)}
                              placeholder={`https://www.facebook.com/groups/123456/posts/7891011/\nfacebook.com/share/p/1CmWWe4m7g/\nhttps://www.facebook.com/share/p/19ivmH7zUw/`}
                              className="font-mono text-xs bg-slate-950 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-blue-400"
                            />

                            {/* Bộ chọn luồng chạy Song Song vs Tuần Tự */}
                            <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                              <div>
                                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                  <ThunderboltFilled className="text-cyan-400" /> Luồng thực thi liên kết:
                                </span>
                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                  {batchLinkConcurrency === 2
                                    ? 'Chạy song song 2 link cùng lúc (Tự động xoay vòng phân tách dàn Via mẹ tránh nghẽn)'
                                    : 'Chạy tuần tự từng link (Xong link 1 mới bắt đầu link 2, an toàn tối đa)'}
                                </span>
                              </div>
                              <Segmented
                                size="small"
                                value={batchLinkConcurrency}
                                onChange={(val) => setBatchLinkConcurrency(Number(val))}
                                options={[
                                  { label: 'Tuần tự (1 link)', value: 1 },
                                  { label: 'Song song (2 link)', value: 2 },
                                ]}
                                className="bg-slate-900 border border-slate-700 text-slate-200 text-xs shrink-0"
                              />
                            </div>

                            {/* Chọn & Nhập Số Lượng Like Mỗi Bài trong Batch */}
                            <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5 shadow-sm">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                    <ThunderboltFilled className="text-amber-400" /> Mục tiêu Like mỗi bài:
                                  </span>
                                  <span className="text-[10px] text-slate-400 block mt-0.5">
                                    Nhập số Like mong muốn cho từng bài viết trong danh sách
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <InputNumber
                                    min={1}
                                    max={Math.max(1, scannedPages.length || 1000)}
                                    value={batchLikesPerOrder}
                                    onChange={(val) => setBatchLikesPerOrder(Number(val) || 1)}
                                    className="w-28 text-center font-mono font-bold bg-slate-900 border-slate-700 text-cyan-300"
                                    addonAfter="Like"
                                  />
                                </div>
                              </div>

                              {/* Nút chọn nhanh */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
                                <span className="text-[11px] text-slate-400 font-medium mr-1">Gợi ý nhanh:</span>
                                {[10, 20, 50, 100, 200].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => {
                                      setBatchLikesPerOrder(n);
                                      if (n > fbAccounts.length && actorMode === 'VIAS') {
                                        setActorMode('FANPAGES');
                                        message.info(`Đã tự động chuyển sang Dàn Fanpage vệ tinh để có đủ ${n} like!`);
                                      }
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      batchLikesPerOrder === n
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-md'
                                        : 'bg-slate-900 text-slate-300 border-slate-700/80 hover:border-blue-400'
                                    }`}
                                  >
                                    {n} Like
                                  </button>
                                ))}
                                {scannedPages.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setBatchLikesPerOrder(scannedPages.length)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                                      batchLikesPerOrder === scannedPages.length
                                        ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                                        : 'bg-slate-900 text-emerald-300 border-emerald-800/60 hover:border-emerald-400'
                                    }`}
                                  >
                                    Tối đa ({scannedPages.length})
                                  </button>
                                )}
                              </div>

                              {/* Cảnh báo nếu đang ở chế độ Nick cá nhân mà chỉ có 3 Via */}
                              {actorMode === 'VIAS' && (
                                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                                  <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                                    <span>⚠️ Đang ở <b>Nick cá nhân ({fbAccounts.length} Via)</b>: Chỉ tối đa {fbAccounts.length} like/bài (1 nick chỉ like được 1 lần).</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActorMode('FANPAGES');
                                      message.success('Đã chuyển sang Dàn Fanpage vệ tinh! Bạn có thể buff 100+ like mỗi bài.');
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer shrink-0 border-none transition-all shadow-sm"
                                  >
                                    👉 Bấm để chuyển sang Dàn Fanpage (634 Page)
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* BẢNG CẤU HÌNH TINH CHỈNH TƯƠNG TÁC */}
                      <div className="p-4 sm:p-5 app-surface space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                          <span className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                              2
                            </span>
                            <span className="text-sm sm:text-base font-semibold text-slate-100">Tương tác</span>
                          </span>
                        </div>

                        {/* 1. Hình thức tương tác: Combo / Like / Comment */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Hình thức tương tác:
                          </label>
                          <div className="grid grid-cols-3 gap-2">
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <LikeOutlined className="text-base" />
                              <span className="text-xs font-bold">Chỉ thả like/tim</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('LIKE_AND_COMMENT')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'LIKE_AND_COMMENT'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <CommentOutlined className="text-base" />
                              <span className="text-xs font-bold">Like + bình luận</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEngagementMode('COMMENT_ONLY')}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                                engagementMode === 'COMMENT_ONLY'
                                  ? 'border-blue-500 bg-blue-600/30 text-white font-bold shadow-md shadow-blue-500/20'
                                  : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                              }`}
                            >
                              <EditOutlined className="text-base" />
                              <span className="text-xs font-bold">Chỉ bình luận</span>
                            </button>
                          </div>
                        </div>

                        {/* Tùy chọn Buff Share (Chia sẻ lên tường Fanpage) */}
                        <div className="px-3 py-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between gap-3">
                          <Tooltip title="Fanpage tự bấm Chia sẻ bài lên dòng thời gian của mình để tăng reach">
                            <span className="text-xs font-medium text-slate-200 flex items-center gap-2 cursor-help">
                              <ShareAltOutlined className="text-slate-400" /> Chia sẻ lên tường Fanpage
                            </span>
                          </Tooltip>
                          <Switch size="small" checked={enableShare} onChange={setEnableShare} />
                        </div>

                        {/* 2. Reaction Picker: 7 Cảm xúc Facebook + 2 Thẻ Trộn Tự Nhiên */}
                        {engagementMode !== 'COMMENT_ONLY' && (
                          <div className="space-y-2.5">
                            <label className="text-xs font-semibold text-slate-300 block">Cảm xúc</label>

                            {/* Hàng 1: 7 Cảm xúc chuẩn Facebook */}
                            <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5 p-2 rounded-xl bg-slate-950/80 border border-slate-800">
                              {REACTIONS.filter((r) => !r.isRandom).map((r) => {
                                const isSelected = selectedReaction === r.key;
                                return (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`py-2 px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer border active:scale-[0.95] hover:scale-[1.02] ${
                                      isSelected
                                        ? 'bg-blue-600/30 border-blue-500 text-white shadow-md shadow-blue-500/20'
                                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                                    }`}
                                    title={r.label}
                                  >
                                    <span className="text-2xl leading-none">{r.emoji}</span>
                                    <span className="text-[10px] sm:text-[11px] font-semibold">{r.shortLabel}</span>
                                  </button>
                                );
                              })}
                            </div>

                            {/* Hàng 2: 2 Chế độ Trộn Cảm Xúc Thông Minh (Chống quét & Tự nhiên nhất) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {REACTIONS.filter((r) => r.isRandom).map((r) => {
                                const isSelected = selectedReaction === r.key;
                                return (
                                  <Tooltip key={r.key} title={r.desc}>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedReaction(r.key)}
                                    className={`px-3 py-2 rounded-xl flex items-center gap-2 transition-all cursor-pointer border text-left w-full ${
                                      isSelected
                                        ? 'bg-blue-950/40 border-blue-500 text-white shadow-md shadow-blue-500/20'
                                        : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                                    }`}
                                  >
                                    {r.key === 'RANDOM_POSITIVE' ? (
                                      <InteractionOutlined className={isSelected ? 'text-blue-300' : 'text-slate-400'} />
                                    ) : (
                                      <AppstoreOutlined className={isSelected ? 'text-blue-300' : 'text-slate-400'} />
                                    )}
                                    <span className="text-xs font-semibold text-slate-200 truncate">{r.shortLabel}</span>
                                  </button>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* 2.5. Thanh Seeding Studio Tinh Gọn (Nếu bật Bình luận) */}
                        {engagementMode !== 'LIKE_ONLY' && (
                          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 transition-all space-y-2.5">
                            {/* Dòng tiêu đề + trạng thái + các nút thao tác */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="w-6 h-6 rounded-lg bg-blue-950/90 border border-blue-700/60 flex items-center justify-center text-blue-400 text-xs shrink-0">
                                  <CommentOutlined />
                                </div>
                                <span className="text-xs font-bold text-slate-200">
                                  Nội dung bình luận Seeding
                                </span>
                                {parsedCommentLines.length > 0 ? (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-bold">
                                    {parsedCommentLines.length} câu đã nạp
                                  </span>
                                ) : (
                                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-800/60 text-amber-300 font-medium">
                                    Chưa có câu nào
                                  </span>
                                )}
                              </div>

                              {/* Nhóm nút hành động */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<RobotOutlined spin={isAiGeneratingComments} />}
                                  loading={isAiGeneratingComments}
                                  onClick={handleGenerateAiComments}
                                  className="bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold text-xs h-7 px-2.5 rounded-lg border-none cursor-pointer"
                                  title="Tự động viết bình luận bằng AI theo link bài viết"
                                >
                                  Tạo bằng AI
                                </Button>
                                <Button
                                  size="small"
                                  icon={<AppstoreOutlined />}
                                  onClick={() => setAiStudioModalOpen(true)}
                                  className="text-xs h-7 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 cursor-pointer font-medium"
                                  title="Mở Studio chọn kịch bản theo ngành hàng hoặc trộn Spintax"
                                >
                                  Soạn &amp; Mẫu Seeding
                                </Button>
                                {parsedCommentLines.length > 0 && (
                                  <>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        const shuffled = [...parsedCommentLines].sort(() => Math.random() - 0.5);
                                        setCommentListText(shuffled.join('\n'));
                                        message.info('Đã đảo ngẫu nhiên thứ tự bình luận!');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-slate-300 cursor-pointer"
                                      title="Đảo ngẫu nhiên thứ tự câu"
                                    >
                                      Đảo
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setCommentListText('');
                                        message.info('Đã xóa trắng danh sách bình luận');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-rose-400 hover:text-rose-300 cursor-pointer"
                                      title="Xóa trắng"
                                    >
                                      Xóa
                                    </Button>
                                  </>
                                )}
                                <Button
                                  size="small"
                                  type="text"
                                  onClick={() => setInlineCommentEditorOpen(!inlineCommentEditorOpen)}
                                  className="text-xs h-7 px-2 text-cyan-400 hover:text-cyan-300 cursor-pointer font-medium"
                                >
                                  {inlineCommentEditorOpen ? 'Thu gọn' : 'Nhập nhanh'}
                                </Button>
                              </div>
                            </div>

                            {/* Preview ngắn khi đã có câu và chưa mở nhập nhanh */}
                            {parsedCommentLines.length > 0 && !inlineCommentEditorOpen && (
                              <div
                                onClick={() => setAiStudioModalOpen(true)}
                                className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all cursor-pointer group"
                                title="Bấm để mở Studio xem toàn bộ và chỉnh sửa"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                  <span>Xem trước ({parsedCommentLines.length} câu):</span>
                                  <span className="text-cyan-400 group-hover:underline text-[11px]">Mở studio chỉnh sửa &rarr;</span>
                                </div>
                                <div className="space-y-1">
                                  {parsedCommentLines.slice(0, 2).map((line, idx) => (
                                    <div key={idx} className="text-xs text-slate-200 truncate flex items-center gap-1.5 font-mono">
                                      <span className="text-slate-500 font-bold select-none text-[10px]">#{idx + 1}</span>
                                      <span className="truncate">{line}</span>
                                    </div>
                                  ))}
                                  {parsedCommentLines.length > 2 && (
                                    <div className="text-[11px] text-slate-500 italic">
                                      ... và còn {parsedCommentLines.length - 2} câu bình luận khác
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Khi chưa có câu nào: Gợi ý kịch bản 1-click */}
                            {parsedCommentLines.length === 0 && !inlineCommentEditorOpen && (
                              <div className="flex items-center gap-2 flex-wrap py-0.5">
                                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                                  <BulbOutlined className="text-amber-400" /> Kịch bản mẫu 1-click:
                                </span>
                                {seedingPresets.map((pr) => (
                                  <button
                                    key={pr.id}
                                    type="button"
                                    onClick={() => {
                                      setCommentListText(pr.comments.join('\n'));
                                      message.success(`Đã nạp kịch bản: ${pr.name} (${pr.comments.length} câu)`);
                                    }}
                                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
                                  >
                                    {pr.badge ? `[${pr.badge}] ` : ''}{pr.name}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Ô nhập nhanh mở rộng (nếu người dùng bấm "Nhập nhanh") */}
                            {inlineCommentEditorOpen && (
                              <div className="space-y-2 pt-1">
                                <Input.TextArea
                                  rows={3}
                                  value={commentListText}
                                  onChange={(e) => setCommentListText(e.target.value)}
                                  placeholder="Mỗi dòng một câu bình luận (ví dụ: Bài viết rất hay và ý nghĩa ạ!)..."
                                  className="font-sans text-xs bg-slate-900/90 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-cyan-400"
                                />
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <span>Mỗi nick Facebook sẽ lấy 1 câu bình luận theo thứ tự hoặc ngẫu nhiên.</span>
                                  <button
                                    type="button"
                                    onClick={() => setInlineCommentEditorOpen(false)}
                                    className="text-cyan-400 hover:underline cursor-pointer bg-transparent border-none p-0"
                                  >
                                    Thu gọn lại
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. Khối Cài Đặt Nâng Cao & Tốc Độ (Thu Gọn / Collapsible) */}
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                          <div
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ControlOutlined className="text-cyan-400 text-sm" />
                              <span className="text-xs font-bold text-slate-200">
                                Cài đặt nâng cao &amp; tốc độ (tùy chọn)
                              </span>
                              <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                                {getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} • {concurrency} luồng • {dripFeedMode ? `rải đều ${dripDurationMinutes} phút` : 'chạy ngay'}
                              </span>
                            </div>
                            <span className="text-xs text-cyan-400 font-semibold flex items-center gap-1">
                              {showAdvancedSettings ? <><UpOutlined className="text-[10px]" /> Thu gọn</> : <><DownOutlined className="text-[10px]" /> Mở rộng</>}
                            </span>
                          </div>


                          {showAdvancedSettings && (
                            <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2.5 mt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                                {/* TỐC ĐỘ BUFF (SPEED MODE PRESET) */}
                                <div className="flex flex-col items-stretch p-3 rounded-xl bg-slate-950/80 border border-cyan-800/60 text-xs shadow-sm sm:col-span-2 gap-2">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Tốc độ
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {engagementMode !== 'LIKE_ONLY'
                                        ? `Có bình luận nên nghỉ tối thiểu 12s giữa 2 lượt (đang: ${formatDelaySeconds(delayMs)})`
                                        : `Nghỉ ${formatDelaySeconds(delayMs)} giữa 2 lượt like`}
                                    </span>
                                  </div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={customSpeed ? 'CUSTOM' : speedMode}
                                    onChange={(val) => {
                                      if (val === 'CUSTOM') {
                                        // Giữ giãn cách hiện tại, backend chạy theo nhịp chuẩn
                                        setCustomSpeed(true);
                                        setSpeedMode('NORMAL');
                                        return;
                                      }
                                      const preset = SPEED_PRESETS.find((p) => p.key === val);
                                      if (!preset) return;
                                      setCustomSpeed(false);
                                      setSpeedMode(preset.key);
                                      setDelayMs(engagementMode !== 'LIKE_ONLY' ? Math.max(delayMs, 12000) : preset.delayMs);
                                      setEnableHumanBehavior(preset.human);
                                      setFastSwitch(true);
                                    }}
                                    options={[
                                      ...SPEED_PRESETS.map((p) => ({
                                        label: p.name,
                                        value: p.key,
                                        title: `${p.name}: nghỉ ${formatDelaySeconds(p.delayMs)} giữa 2 lượt like`,
                                      })),
                                      { label: 'Tùy chỉnh', value: 'CUSTOM', title: 'Tự chọn thời gian nghỉ giữa 2 lượt' },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                {speedMode === 'SMART' && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-[11px] text-cyan-300">
                                    <SafetyCertificateOutlined className="text-cyan-400 text-sm shrink-0" />
                                    <span>
                                      <b>Tốc độ tự động đang bật:</b> Tự động giãn nhịp ({selectedPageIds.length <= 30 ? '~2.2s' : selectedPageIds.length <= 80 ? '~2.6s' : '~3.0s'}), thời gian đọc bài ~1.2s và nghỉ hạ nhiệt sau mỗi 25 page để vừa nhanh vừa hạn chế bị Facebook gắn cờ spam.
                                    </span>
                                  </div>
                                )}
                                {selectedPageIds.length > 80 && (speedMode === 'TURBO' || speedMode === 'FAST') && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-300">
                                    <ThunderboltFilled className="text-amber-400 text-sm shrink-0" />
                                    <span>
                                      <b>Lưu ý an toàn:</b> Bạn đang chọn {selectedPageIds.length} Page với tốc độ {speedMode === 'TURBO' ? 'Siêu tốc' : 'Rất nhanh'}. Khuyên dùng <b>Chuẩn</b> hoặc <b>Tự động</b> khi chạy số lượng rất lớn để tránh bị Facebook hạn chế thao tác.
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-slate-200 font-bold block">Mô phỏng người dùng</span>
                                    <span className="text-[10px] text-slate-400">Lướt đọc bài tự nhiên (0.5s - 1.5s)</span>
                                  </div>
                                  <Checkbox
                                    checked={enableHumanBehavior}
                                    onChange={(e) => setEnableHumanBehavior(e.target.checked)}
                                    className="text-emerald-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                {/* Giãn cách chỉ hiện khi chọn "Tùy chỉnh" hoặc có bình luận (các mức tốc độ đã kèm sẵn giãn cách) */}
                                {(customSpeed || engagementMode !== 'LIKE_ONLY') && (
                                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-sm">
                                    <div>
                                      <span className="text-slate-200 font-bold block">Giãn cách</span>
                                      <span className="text-[10px] text-slate-400">Nghỉ giữa 2 lượt</span>
                                    </div>
                                    <Select
                                      size="small"
                                      value={delayMs}
                                      onChange={(val) => setDelayMs(val)}
                                      className="w-36"
                                      options={
                                        engagementMode !== 'LIKE_ONLY'
                                          ? [
                                              { value: 12000, label: '12s (khuyên dùng)' },
                                              { value: 16000, label: '16s (an toàn cao)' },
                                              { value: 25000, label: '25s (rất an toàn)' },
                                            ]
                                          : [1200, 1800, 2200, 2500, 3500, 4500, 5000, 8000].map((v) => ({
                                              value: v,
                                              label: formatDelaySeconds(v),
                                            }))
                                      }
                                    />
                                  </div>
                                )}

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-blue-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-blue-300 font-bold block flex items-center gap-1">
                                      <span>Đổi Page trên bài (Fast-Switch)</span>
                                    </span>
                                    <span className="text-[10px] text-slate-400">Đổi trực tiếp qua Voice Switcher</span>
                                  </div>
                                  <Checkbox
                                    checked={fastSwitch}
                                    onChange={(e) => setFastSwitch(e.target.checked)}
                                    className="text-blue-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                <div className="flex flex-col items-stretch gap-2 p-3 rounded-xl bg-slate-950/80 border border-cyan-900/60 text-xs shadow-sm sm:col-span-2">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Luồng chạy song song
                                    </span>
                                    <span className="text-[11px] text-slate-400">Nhiều luồng chạy nhanh hơn x2 - x3</span>
                                  </div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={concurrency}
                                    onChange={(val) => setConcurrency(Number(val))}
                                    options={[
                                      { label: '1 luồng', value: 1 },
                                      { label: '2 luồng (khuyên dùng)', value: 2 },
                                      { label: '3 luồng', value: 3 },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-indigo-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-indigo-300 font-bold block flex items-center gap-1">
                                      <SafetyCertificateOutlined className="text-indigo-400" /> Buff rải đều (Drip-feed)
                                    </span>
                                    <span className="text-[10px] text-slate-400">Rải đều theo thời gian chống quét</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    {dripFeedMode && (
                                      <Select
                                        size="small"
                                        value={dripDurationMinutes}
                                        onChange={(val) => setDripDurationMinutes(val)}
                                        className="w-24 text-xs"
                                        options={[
                                          { value: 15, label: '15 phút' },
                                          { value: 30, label: '30 phút' },
                                          { value: 60, label: '1 giờ' },
                                          { value: 120, label: '2 giờ' },
                                          { value: 240, label: '4 giờ' },
                                        ]}
                                      />
                                    )}
                                    <Switch
                                      checked={dripFeedMode}
                                      onChange={(val) => setDripFeedMode(val)}
                                      checkedChildren="Bật"
                                      unCheckedChildren="Tắt"
                                      className="bg-slate-800"
                                    />
                                  </div>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-amber-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-amber-300 font-bold block flex items-center gap-1">
                                      <span>Bảo vệ BM &amp; Via</span>
                                    </span>
                                    <span className="text-[10px] text-slate-400">Batch Cooldown &amp; dừng khi bị chặn</span>
                                  </div>
                                  <Checkbox
                                    checked={antiCheckpointGuard}
                                    onChange={(e) => setAntiCheckpointGuard(e.target.checked)}
                                    className="text-amber-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-emerald-300 font-bold block flex items-center gap-1">
                                      <SafetyCertificateOutlined className="text-emerald-400" /> Tự động bù Via Live (Auto-Failover)
                                    </span>
                                    <span className="text-[10px] text-slate-400">Tự động bù Page từ Via Live khi phát hiện Via hết cookie</span>
                                  </div>
                                  <Checkbox
                                    checked={autoFailoverLiveVia}
                                    onChange={(e) => setAutoFailoverLiveVia(e.target.checked)}
                                    className="text-emerald-400 font-bold"
                                  >
                                    Bật
                                  </Checkbox>
                                </div>
                              </div>

                              {/* Checkbox Tránh like trùng */}
                              <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/60 text-xs">
                                <Checkbox
                                  checked={autoSkipAlreadyLiked}
                                  onChange={(e) => setAutoSkipAlreadyLiked(e.target.checked)}
                                  className="text-slate-200 font-medium"
                                >
                                  Tự động bỏ qua nick/page đã like bài viết này trước đó
                                </Checkbox>
                                <span className="text-amber-400 font-semibold text-[11px] hidden sm:inline">
                                  Chống trùng lặp
                                </span>
                              </div>
                            </div>
                          )}
                        </div>


                      </div>

                      <div className="app-surface p-5 space-y-4">
                        {/* Card Header */}
                        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                              3
                            </span>
                            <span className="text-sm sm:text-base font-semibold text-slate-100">Tài khoản thực hiện</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              type="text"
                              size="small"
                              icon={<ReloadOutlined spin={scanPagesMutation.isPending || loadingAccounts} />}
                              loading={scanPagesMutation.isPending || loadingAccounts}
                              onClick={async () => {
                                await queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
                                await refetchAccounts();
                                message.success(`Đã cập nhật: ${fbAccounts.length} Via sẵn sàng!`);
                                handleScanPages();
                              }}
                              className="text-slate-300 hover:text-blue-400 text-xs px-2.5 h-7 rounded-lg border border-slate-700 hover:border-blue-500 bg-slate-800/80 font-semibold cursor-pointer"
                              title="Làm mới dàn Via & Quét thêm Fanpage từ Facebook"
                            >
                              Quét lại
                            </Button>
                            <Button
                              type="primary"
                              size="small"
                              icon={<SettingOutlined />}
                              onClick={() => handleOpenManagePages(selectedAccountId)}
                              className="bg-blue-600 hover:bg-blue-500 text-on-accent font-bold rounded-lg text-xs h-7 px-2.5 shadow-sm border-none cursor-pointer"
                            >
                              Quản lý Page ({scannedPages.length})
                            </Button>
                          </div>
                        </div>

                        {/* Dropdown chọn nick mẹ */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-semibold text-slate-300">
                              Tài khoản Facebook sở hữu Page:
                            </label>
                            {currentViaAccount && (
                              <span className="text-[11px] text-blue-400 font-mono">
                                c_user: {extractCUser(currentViaAccount.cookieString || currentViaAccount.accessToken) || 'N/A'}
                              </span>
                            )}
                            {selectedAccountId === 'ALL_VIAS' && (
                              <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                {actorMode === 'VIAS'
                                  ? `Gộp ${fbAccounts.length} nick Via (${selectedPageIds.length}/${scannedPages.length})`
                                  : `Gộp ${fbAccounts.length} Via (${scannedPages.length} Fanpage)`}
                              </span>
                            )}
                          </div>
                          <Select
                            className="w-full"
                            size="large"
                            loading={loadingAccounts}
                            value={selectedAccountId}
                            onChange={(val) => {
                              setSelectedAccountId(val);
                              if (val === 'CUSTOM') {
                                setScannedPages([]);
                                setSelectedPageIds([]);
                              }
                            }}
                            options={[
                              ...(fbAccounts.length > 1
                                ? [
                                    {
                                      value: 'ALL_VIAS',
                                      label: `Tất cả nick (${fbAccounts.length}): ${
                                        fbAccounts
                                          .slice(0, 4)
                                          .map((a) => a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`)
                                          .join(' + ') +
                                        (fbAccounts.length > 4 ? ` + ${fbAccounts.length - 4} nick khác` : '')
                                      }`,
                                    },
                                  ]
                                : []),
                              { value: 'CUSTOM', label: 'Nhập cookie thủ công' },
                              ...fbAccounts.map((a) => ({
                                value: a.id,
                                label: `${a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`} (${
                                  a.tokenStatus === 'OK' ? 'Cookie sống' : 'Cần kiểm tra'
                                })`,
                              })),
                            ]}
                          />
                        </div>

                        {/* Cookie thủ công nếu chọn CUSTOM */}
                        {selectedAccountId === 'CUSTOM' && (
                          <div className="space-y-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/70">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-slate-200">
                                Nhập cookie nick Facebook mẹ:
                              </label>
                              <span className="text-[11px] text-slate-400">
                                (Chứa <b>c_user</b> & <b>xs</b>)
                              </span>
                            </div>

                            <Row gutter={10}>
                              <Col span={10}>
                                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                  c_user:
                                </label>
                                <Input
                                  placeholder="10008321..."
                                  value={
                                    customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] ||
                                    (customCookie.includes('=') ? '' : customCookie)
                                  }
                                  onChange={(e) => {
                                    const val = e.target.value.trim();
                                    const parsed = parseFacebookCookie(val);
                                    if (parsed.isJson) {
                                      setCustomCookie(parsed.cookieString);
                                      message.success(`Đã nhận diện JSON Cookie: UID ${parsed.c_user || 'N/A'}`);
                                      return;
                                    }
                                    const currentXs = customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      val && currentXs
                                        ? `c_user=${val}; xs=${currentXs}`
                                        : val
                                        ? `c_user=${val}`
                                        : ''
                                    );
                                  }}
                                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                                />
                              </Col>
                              <Col span={14}>
                                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                                  xs:
                                </label>
                                <Input.Password
                                  placeholder="27%3ABc0..."
                                  value={customCookie.match(/(?:^|;\s*)xs=([^;]+)/)?.[1] || ''}
                                  onChange={(e) => {
                                    const val = e.target.value.trim();
                                    const parsed = parseFacebookCookie(val);
                                    if (parsed.isJson) {
                                      setCustomCookie(parsed.cookieString);
                                      message.success(`Đã nhận diện JSON Cookie: xs ${parsed.xs ? parsed.xs.slice(0, 15) + '...' : ''}`);
                                      return;
                                    }
                                    const currentCUser = customCookie.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1] || '';
                                    setCustomCookie(
                                      currentCUser && val
                                        ? `c_user=${currentCUser}; xs=${val}`
                                        : val
                                        ? `xs=${val}`
                                        : ''
                                    );
                                  }}
                                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                                />
                              </Col>
                            </Row>

                            <Input.TextArea
                              rows={2}
                              placeholder="Dán toàn bộ chuỗi cookie hoặc quăng 1 đống JSON Cookie-Editor vào đây..."
                              value={customCookie}
                              onChange={(e) => {
                                const val = e.target.value;
                                const parsed = parseFacebookCookie(val);
                                if (parsed.isJson) {
                                  setCustomCookie(parsed.cookieString);
                                  message.success(`Đã tự động nhận diện JSON Cookie (${parsed.cookieCount} cookies)!`);
                                } else {
                                  setCustomCookie(val);
                                }
                              }}
                              className="font-mono text-[11px] rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                            />
                          </div>
                        )}

                        {/* CHỌN: DÀN FANPAGE VỆ TINH HAY DÀN VIA CÁ NHÂN */}
                        <div className="p-1 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setActorMode('FANPAGES')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              actorMode === 'FANPAGES'
                                ? 'bg-blue-600 text-on-accent'
                                : 'text-slate-400 hover:text-white hover:bg-slate-900'
                            }`}
                          >
                            <span>Page</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-950 border border-blue-700 text-blue-300">
                              {scannedPages.length}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setActorMode('VIAS')}
                            className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                              actorMode === 'VIAS'
                                ? 'bg-blue-600 text-on-accent'
                                : 'text-slate-400 hover:text-white hover:bg-slate-900'
                            }`}
                          >
                            <span>Nick cá nhân</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                              {fbAccounts.length}
                            </span>
                          </button>
                        </div>

                        {/* Danh sách Fanpage / Via với Interactive Grid Cards */}
                        {scannedPages.length > 0 ? (
                          <div className="space-y-2.5 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-200">
                                {actorMode === 'VIAS' ? 'Chọn nick Via tương tác:' : 'Chọn Fanpage tương tác:'}{' '}
                                <span className="text-blue-400 font-mono font-bold">
                                  ({selectedPageIds.length}/{scannedPages.length})
                                </span>
                              </span>
                              <Checkbox
                                checked={
                                  selectedPageIds.length > 0 &&
                                  selectedPageIds.length === (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                }
                                indeterminate={
                                  selectedPageIds.length > 0 &&
                                  selectedPageIds.length < (autoSkipAlreadyLiked ? unlikedScannedPages.length : scannedPages.length)
                                }
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    handleSelectAllUnliked();
                                  } else {
                                    setSelectedPageIds([]);
                                  }
                                }}
                              >
                                <span className="text-xs text-slate-300 font-semibold">
                                  {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                    ? `Chọn tất cả chưa like (${unlikedScannedPages.length})`
                                    : 'Chọn tất cả'}
                                </span>
                              </Checkbox>
                            </div>

                            {/* Thanh công cụ Chọn Nhanh Số Lượng Page (20, 50, 100, 200, 300, 400, 500, All) */}
                            {scannedPages.length > 5 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/70 border border-slate-800/80">
                                <span className="text-[11px] text-slate-400 font-semibold">Chọn nhanh:</span>
                                {[20, 50, 100, 200, 300, 400, 500]
                                  .filter((n) => n <= (viaFilter !== 'ALL' ? (viaGroupCounts[viaFilter] || scannedPages.length) : scannedPages.length))
                                  .map((num) => (
                                    <Button
                                      key={num}
                                      size="small"
                                      onClick={() => handleSelectRandomPages(num)}
                                      className="bg-slate-900 border-slate-700/80 hover:border-cyan-500 text-slate-200 text-[11px] font-semibold rounded-lg px-2 h-6"
                                    >
                                      {num} Page
                                    </Button>
                                  ))}
                                {commentListText.split('\n').filter((s) => s.trim()).length > 0 && (
                                  <Button
                                    size="small"
                                    icon={<CommentOutlined className="text-xs" />}
                                    onClick={() => handleSelectRandomPages(commentListText.split('\n').filter((s) => s.trim()).length)}
                                    className="bg-blue-950/90 border-blue-600/90 hover:border-blue-400 text-blue-200 text-[11px] font-bold rounded-lg px-2 h-6"
                                  >
                                    {commentListText.split('\n').filter((s) => s.trim()).length} Page (Theo cmt)
                                  </Button>
                                )}
                                <Button
                                  size="small"
                                  onClick={handleSelectAllUnliked}
                                  className="bg-cyan-950/80 border-cyan-800 text-cyan-300 text-[11px] font-semibold rounded-lg px-2 h-6"
                                >
                                  {autoSkipAlreadyLiked && combinedAlreadyLikedIds.size > 0
                                    ? `Chưa like (${viaFilter !== 'ALL' ? filteredPages.filter(p => !combinedAlreadyLikedIds.has(p.id)).length : unlikedScannedPages.length})`
                                    : `Tất cả (${viaFilter !== 'ALL' ? filteredPages.length : scannedPages.length})`}
                                </Button>
                                {selectedPageIds.length > 0 && (
                                  <Button
                                    size="small"
                                    onClick={() => setSelectedPageIds([])}
                                    className="bg-slate-900 border-slate-800 text-slate-400 text-[11px] rounded-lg px-2 h-6"
                                  >
                                    Bỏ chọn
                                  </Button>
                                )}
                              </div>
                            )}

                            {/* Bộ lọc trạng thái Chưa like / Đã like */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <span className="text-[11px] font-semibold text-slate-400">Trạng thái bài này:</span>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('ALL')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'ALL'
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  Tất cả ({scannedPages.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('UNLIKED')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'UNLIKED'
                                      ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                                      : 'bg-slate-900 text-emerald-300 border-slate-800 hover:border-emerald-700'
                                  }`}
                                >
                                  Chưa like ({unlikedScannedPages.length})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLikeFilter('LIKED')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    likeFilter === 'LIKED'
                                      ? 'bg-amber-600 text-white border-amber-500 shadow-sm'
                                      : 'bg-slate-900 text-amber-300 border-slate-800 hover:border-amber-700'
                                  }`}
                                >
                                  Đã like ({scannedPages.length - unlikedScannedPages.length})
                                </button>
                              </div>
                            )}

                            {/* Nút lọc nhanh theo từng Via khi chọn Gộp ALL_VIAS */}
                            {selectedAccountId === 'ALL_VIAS' && Object.keys(viaGroupCounts).length > 1 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <span className="text-[11px] font-semibold text-slate-400">Xem theo Via:</span>
                                <button
                                  type="button"
                                  onClick={() => setViaFilter('ALL')}
                                  className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                    viaFilter === 'ALL'
                                      ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                      : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                  }`}
                                >
                                  Tất cả ({scannedPages.length})
                                </button>
                                {Object.entries(viaGroupCounts).map(([vName, count]) => (
                                  <button
                                    key={vName}
                                    type="button"
                                    onClick={() => setViaFilter(vName)}
                                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer border ${
                                      viaFilter === vName
                                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                                    }`}
                                  >
                                    {vName} ({count})
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Ô tìm kiếm Page/Via */}
                            {scannedPages.length > 6 && (
                              <Input
                                prefix={<SearchOutlined className="text-slate-400" />}
                                placeholder={actorMode === 'VIAS' ? 'Tìm Via theo tên hoặc UID...' : 'Tìm Fanpage theo tên hoặc ID...'}
                                size="middle"
                                value={pageSearchQuery}
                                onChange={(e) => setPageSearchQuery(e.target.value)}
                                className="text-xs rounded-xl bg-slate-950/70 border-slate-700 text-slate-100"
                              />
                            )}

                            {/* Cảnh báo phát hiện Page thuộc Via đã hết hạn Cookie */}
                            {expiredPagesSelectedCount > 0 && (
                              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-rose-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <ExclamationCircleOutlined className="text-rose-400 text-sm shrink-0" />
                                  <span>
                                    Phát hiện <b>{expiredPagesSelectedCount} Page</b> thuộc Via hết cookie (không like được).
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={handleReplaceExpiredPagesWithLiveOnes}
                                  className="text-[11px] h-6 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border-none text-white font-semibold cursor-pointer shrink-0"
                                >
                                  ⚡ Tự động thay bằng Page từ Via Live
                                </Button>
                              </div>
                            )}

                            {/* Cảnh báo phát hiện Page đã từng tương tác bài viết này */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs flex items-center justify-between gap-2">
                                <span className="text-amber-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <InfoCircleOutlined className="text-amber-400" />
                                  <span>
                                    Đã lưu <b>{combinedAlreadyLikedIds.size} Page</b> từng like bài này (còn <b>{unlikedScannedPages.length} Page</b> chưa like). Nút "Chọn nhanh" sẽ tự động chọn các Page chưa like!
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
                                    message.success('Đã tự động bỏ chọn các Page đã từng like bài viết này!');
                                  }}
                                  className="text-[11px] h-6 px-2 rounded-lg bg-amber-900/60 border-amber-600/50 text-amber-200 cursor-pointer shrink-0"
                                >
                                  Bỏ chọn Page đã like
                                </Button>
                              </div>
                            )}

                            {/* Grid các Via/Fanpage card (Memoized Component tránh re-render giật lag) */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[360px] overflow-y-auto pr-1">
                              {filteredPages.slice(0, pageDisplayLimit).map((page) => {
                                const isChecked = selectedPageIdsSet.has(page.id);
                                const isAlreadyLiked = combinedAlreadyLikedIds.has(page.id);
                                const cleanName = cleanPageName(page.name);
                                const avatarInfo = avatarCacheMap[page.id];
                                const avatarUrl =
                                  page.avatarUrl ||
                                  avatarInfo?.avatarUrl ||
                                  (page.id ? `https://graph.facebook.com/${page.id}/picture?type=square` : '');
                                return (
                                  <PageCardItem
                                    key={page.id}
                                    page={page}
                                    isChecked={isChecked}
                                    isAlreadyLiked={isAlreadyLiked}
                                    cleanName={cleanName}
                                    avatarUrl={avatarUrl}
                                    actorMode={actorMode}
                                    selectedAccountId={selectedAccountId}
                                    onToggle={handleTogglePageId}
                                  />
                                );
                              })}

                              {/* Tải thêm / Hiển thị tất cả khi số Page lớn */}
                              {filteredPages.length > pageDisplayLimit && (
                                <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-300">
                                  <span>
                                    Đang hiển thị <b className="text-white">{pageDisplayLimit}</b> / <b className="text-white">{filteredPages.length}</b> tài khoản
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="small"
                                      onClick={() => setPageDisplayLimit((prev) => prev + 60)}
                                      className="text-xs h-7 rounded-lg bg-slate-800 border-slate-700 text-blue-400 hover:text-blue-300 cursor-pointer font-semibold"
                                    >
                                      Xem thêm +60
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => setPageDisplayLimit(filteredPages.length)}
                                      className="text-xs h-7 rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                                    >
                                      Hiện tất cả ({filteredPages.length})
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="p-5 rounded-xl border border-dashed border-slate-800 text-center text-xs text-slate-400 space-y-2">
                            <p>Chưa có Fanpage nào được tải cho tài khoản này.</p>
                            <button
                              type="button"
                              onClick={() => handleOpenManagePages(selectedAccountId)}
                              className="text-blue-400 hover:underline font-bold cursor-pointer"
                            >
                              Bấm vào đây để nhập danh sách i_user
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </Col>

                  {/* CỘT PHẢI (ghim): tóm tắt, nút bắt đầu, tiến trình */}
                  <Col xs={24} lg={9}>
                    <div className="space-y-4 lg:sticky lg:top-24">
                      {/* Tóm tắt + nút bắt đầu */}
                      <div className="app-surface p-4 sm:p-5 space-y-4">
                        <div className="text-sm font-semibold text-slate-100">Tóm tắt</div>
                        <dl className="m-0 space-y-2 text-sm">
                          {[
                            {
                              k: 'Bài viết',
                              v:
                                buffMode === 'BATCH'
                                  ? `${parsedBatchLinks.length} link`
                                  : targetPostUrl
                                  ? targetPostUrl.replace(/^https?:\/\/(www\.)?/, '')
                                  : 'Chưa có',
                              muted: buffMode === 'SINGLE' ? !targetPostUrl : parsedBatchLinks.length === 0,
                            },
                            {
                              k: 'Hình thức',
                              v: engagementMode === 'LIKE_ONLY' ? 'Chỉ like' : engagementMode === 'COMMENT_ONLY' ? 'Chỉ bình luận' : 'Like + bình luận',
                            },
                            {
                              k: 'Cảm xúc',
                              v: (() => {
                                const r = REACTIONS.find((x) => x.key === selectedReaction);
                                return r ? `${r.emoji} ${r.shortLabel}` : selectedReaction;
                              })(),
                            },
                            {
                              k: 'Tài khoản',
                              v: `${selectedPageIds.length} ${actorMode === 'VIAS' ? 'nick cá nhân' : 'Page'}`,
                              muted: selectedPageIds.length === 0,
                            },
                            { k: 'Tốc độ', v: `${getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} · ${concurrency} luồng` },
                            {
                              k: 'Dự kiến',
                              v: runEstimate
                                ? `~${formatDuration(runEstimate.total)}${runEstimate.links > 1 ? ` (${formatDuration(runEstimate.perLink)}/bài)` : ''}`
                                : 'Chưa đủ thông tin',
                              muted: !runEstimate,
                            },
                          ].map((row) => (
                            <div key={row.k} className="flex items-center justify-between gap-3">
                              <dt className="text-slate-400 shrink-0">{row.k}</dt>
                              <dd className={`m-0 truncate text-right ${row.muted ? 'text-slate-500' : 'text-slate-100'}`}>{row.v}</dd>
                            </div>
                          ))}
                        </dl>
                        {runEstimate && (
                          <p className="text-xs text-slate-500 m-0 -mt-2">
                            {runEstimate.basis === 'history'
                              ? 'Ước tính từ tốc độ thực tế của các bài đã chạy gần đây.'
                              : 'Ước tính sơ bộ theo cài đặt tốc độ, chính xác hơn sau vài bài chạy.'}
                          </p>
                        )}

                        {/* Chế độ chạy: Chạy ngay hoặc Đưa vào hàng đợi */}
                        <div className="space-y-3 pt-1">
                          <Segmented
                            block
                            value={runMode}
                            onChange={(v) => setRunMode(v as 'NOW' | 'QUEUE')}
                            disabled={autoBuffMutation.isPending || isBatchRunning}
                            options={[
                              { label: 'Chạy ngay', value: 'NOW' },
                              { label: 'Đưa vào hàng đợi', value: 'QUEUE' },
                            ]}
                          />

                          {runMode === 'QUEUE' && (
                            <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 space-y-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-slate-400 shrink-0 font-medium">Bắt đầu:</span>
                                <Select
                                  value={queueStartAfter}
                                  onChange={setQueueStartAfter}
                                  className="w-44"
                                  options={[
                                    { value: 0, label: 'Ngay khi tới lượt' },
                                    { value: 5, label: 'Sau 5 phút' },
                                    { value: 15, label: 'Sau 15 phút' },
                                    { value: 30, label: 'Sau 30 phút' },
                                    { value: 60, label: 'Sau 1 giờ' },
                                    { value: 'AT', label: 'Vào giờ cụ thể' },
                                  ]}
                                />
                              </div>
                              {queueStartAfter === 'AT' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-400 shrink-0 font-medium">Giờ hẹn:</span>
                                  <Input
                                    type="time"
                                    value={queueStartAt}
                                    onChange={(e) => setQueueStartAt(e.target.value)}
                                    className="w-44"
                                  />
                                </div>
                              )}
                              {buffMode === 'BATCH' && (
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-slate-400 shrink-0 font-medium">Giãn cách:</span>
                                  <Select
                                    value={queueStagger}
                                    onChange={setQueueStagger}
                                    className="w-44"
                                    options={[
                                      { value: 0, label: 'Không giãn cách' },
                                      { value: 3, label: '3 phút' },
                                      { value: 5, label: '5 phút' },
                                      { value: 10, label: '10 phút' },
                                      { value: 30, label: '30 phút' },
                                    ]}
                                  />
                                </div>
                              )}
                            </div>
                          )}

                          {/* Action Buttons */}
                          {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                            <div className="space-y-2.5">
                              <div className="p-3 rounded-xl bg-blue-950/50 border border-blue-500/40 text-xs flex items-center justify-between shadow-sm">
                                <span className="text-blue-300 font-bold flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                                  Đang có bài chạy trực tiếp ({autoBuffProgress.percent}%)
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => setActiveTabKey('buff-running')}
                                  className="text-xs p-0 text-cyan-400 font-semibold"
                                >
                                  Xem tiến trình →
                                </Button>
                              </div>
                              <Button
                                type="primary"
                                size="large"
                                icon={<ClockCircleOutlined />}
                                loading={isEnqueueing}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl.trim()}
                                onClick={handleEnqueueFromForm}
                                className="w-full h-11 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 border-none shadow-lg shadow-amber-600/25"
                              >
                                Đưa bài mới này vào Hàng đợi (Chờ chạy tiếp theo)
                              </Button>
                            </div>
                          ) : runMode === 'QUEUE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                icon={<ClockCircleOutlined />}
                                loading={isEnqueueing}
                                disabled={
                                  selectedPageIds.length === 0 ||
                                  (buffMode === 'BATCH' ? parsedBatchLinks.length === 0 : !targetPostUrl.trim())
                                }
                                onClick={handleEnqueueFromForm}
                                className="w-full h-11 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 border-none shadow-md shadow-amber-600/20"
                              >
                                {(buffMode === 'BATCH' ? parsedBatchLinks.length === 0 : !targetPostUrl.trim())
                                  ? 'Dán link bài viết ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số Like ở bước 1 hoặc 3'
                                  : buffMode === 'BATCH'
                                  ? `Thêm ${parsedBatchLinks.length} bài vào hàng đợi`
                                  : 'Xác nhận thêm vào hàng đợi'}
                              </Button>
                            </div>
                          ) : buffMode === 'SINGLE' ? (
                            <div className="space-y-2">
                              <Button
                                type="primary"
                                size="large"
                                icon={<RocketOutlined />}
                                loading={autoBuffMutation.isPending}
                                disabled={selectedPageIds.length === 0 || !targetPostUrl}
                                onClick={handleStartAutoBuff}
                                className="w-full h-11 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20"
                              >
                                {autoBuffMutation.isPending
                                  ? 'Đang khởi chạy...'
                                  : !targetPostUrl
                                  ? 'Dán link bài viết ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số Like ở bước 1 hoặc 3'
                                  : 'Bắt đầu chạy ngay'}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {!isBatchRunning ? (
                                <Button
                                  type="primary"
                                  size="large"
                                  icon={<RocketOutlined />}
                                  disabled={parsedBatchLinks.length === 0 || selectedPageIds.length === 0}
                                  onClick={handleStartBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold shadow-md shadow-blue-600/20"
                                >
                                  {parsedBatchLinks.length === 0
                                    ? 'Dán danh sách link ở bước 1'
                                    : `Bắt đầu chạy ${parsedBatchLinks.length} bài viết`}
                                </Button>
                              ) : (
                                <Button
                                  danger
                                  size="large"
                                  onClick={handleStopBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold"
                                >
                                  Dừng toàn bộ hàng loạt
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* MINI STATUS WIDGET TRÊN TAB TẠO MỚI (KHÔNG CHIẾM DIỆN TÍCH FORM) */}
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                        <div className="p-4 rounded-xl border border-blue-500/40 bg-blue-950/20 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-blue-800/30">
                            <span className="text-xs font-bold text-blue-300 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                              Có 1 tiến trình đang chạy ngầm
                            </span>
                            <span className="font-mono text-xs font-bold text-blue-300">{autoBuffProgress.percent}%</span>
                          </div>

                          <div className="space-y-2">
                            <div className="text-xs text-slate-300 truncate font-mono bg-slate-950/60 p-2 rounded-lg border border-slate-800">
                              🎯 {runningTargetInfo?.url || 'Bài viết Facebook'}
                            </div>

                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span className="truncate max-w-[200px]">
                                Đang xử lý: <b className="text-white">{autoBuffProgress.currentRunningPageName || 'Đang mở Facebook...'}</b>
                              </span>
                              <span className="font-mono font-bold text-slate-200">
                                {autoBuffProgress.success + autoBuffProgress.alreadyLiked}/{autoBuffProgress.total}
                              </span>
                            </div>

                            <Progress percent={autoBuffProgress.percent} size={['100%', 5]} showInfo={false} />

                            <div className="grid grid-cols-4 gap-1.5 pt-1">
                              <div className="p-1.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center">
                                <div className="text-[10px] text-slate-400">Tổng</div>
                                <div className="text-xs font-bold text-slate-100">{autoBuffProgress.total}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/50 text-center">
                                <div className="text-[10px] text-emerald-400">Thành công</div>
                                <div className="text-xs font-bold text-emerald-300">{autoBuffProgress.success}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-blue-950/40 border border-blue-800/50 text-center">
                                <div className="text-[10px] text-blue-400">Đã like</div>
                                <div className="text-xs font-bold text-blue-300">{autoBuffProgress.alreadyLiked}</div>
                              </div>
                              <div className="p-1.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-center">
                                <div className="text-[10px] text-rose-400">Lỗi</div>
                                <div className="text-xs font-bold text-rose-300">{autoBuffProgress.failed}</div>
                              </div>
                            </div>
                          </div>

                          <div className="pt-1 flex items-center gap-2">
                            <Button
                              type="primary"
                              size="middle"
                              onClick={() => setActiveTabKey('buff-running')}
                              className="flex-1 text-xs font-semibold rounded-lg"
                              icon={<ExportOutlined />}
                            >
                              Xem chi tiết tiến trình ➔
                            </Button>
                          </div>
                        </div>
                      ) : autoBuffProgress.status === 'DONE' ? (
                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                              <CheckCircleFilled className="text-emerald-400" /> Tiến trình vừa hoàn tất!
                            </span>
                            <Tag color="success">{autoBuffProgress.success}/{autoBuffProgress.total} Like</Tag>
                          </div>
                          <div className="text-xs text-slate-300 truncate font-mono bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                            {runningTargetInfo?.url || 'Bài viết Facebook'}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => setActiveTabKey('buff-running')}
                              className="text-xs flex-1 rounded-lg"
                            >
                              Xem bảng kết quả ➔
                            </Button>
                            <Button
                              size="small"
                              onClick={() => setActiveTabKey('buff-history')}
                              className="text-xs rounded-lg"
                            >
                              Xem Lịch sử
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </Col>
                </Row>
              </div>
            ),
          },
          {
            key: 'buff-running',
            label: (
              <span className="flex items-center gap-1.5">
                <PlayCircleOutlined className="text-blue-400" />
                <span>Tiến trình chạy</span>
                {(autoBuffProgress.status === 'RUNNING' || isBatchRunning || queueItems.some((i) => i.status === 'RUNNING')) && (
                  <span className="relative flex h-2 w-2 ml-0.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                )}
              </span>
            ),
            children: (
              <RunningTab
                autoBuffProgress={autoBuffProgress}
                runTiming={runTiming}
                runningTargetInfo={runningTargetInfo}
                liveLogs={liveLogs}
                avatarCacheMap={avatarCacheMap}
                buffLogs={buffLogs}
                queueItems={queueItems}
                batchOrders={batchOrders}
                setBatchOrders={setBatchOrders}
                batchLinkConcurrency={batchLinkConcurrency}
                isBatchRunning={isBatchRunning}
                isResumingRemaining={isResumingRemaining}
                buffMode={buffMode}
                setBuffMode={setBuffMode}
                delayMs={delayMs}
                engagementMode={engagementMode}
                selectedAccountId={selectedAccountId}
                setSelectedAccountId={setSelectedAccountId}
                selectedReaction={selectedReaction}
                targetPostUrl={targetPostUrl}
                setActiveTabKey={setActiveTabKey}
                setActorMode={setActorMode}
                setBatchLikesPerOrder={setBatchLikesPerOrder}
                setBatchLinksText={setBatchLinksText}
                handleOpenManagePages={handleOpenManagePages}
                handleRefillBatchIncomplete={handleRefillBatchIncomplete}
                handleRefillSingleOrder={handleRefillSingleOrder}
                handleResumeRemaining={handleResumeRemaining}
                handleStartNewCampaign={handleStartNewCampaign}
                handleStopAutoBuff={handleStopAutoBuff}
                handleStopQueueTask={handleStopQueueTask}
              />
            ),
          },
          {
            key: 'buff-queue',
            label: (
              <span className="flex items-center gap-1.5">
                <ThunderboltOutlined className="text-amber-400" />
                <span>Hàng đợi tự động</span>
                {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-md text-[10px] bg-amber-500/20 text-amber-300 font-mono font-bold border border-amber-500/40">
                    {queueItems.filter((i) => i.status === 'QUEUED' || i.status === 'RUNNING').length}
                  </span>
                )}
              </span>
            ),
            children: (
              <Suspense fallback={<TableSkeleton rows={5} columns={4} />}>
                <BuffQueueTab
                  workerBaseUrl={WORKER_BASE_URL}
                  queueItems={queueItems}
                  fbAccounts={fbAccounts}
                  scannedPages={scannedPages}
                  onRefresh={fetchBuffQueue}
                  onRunNow={handleRunNowQueueTask}
                  onRetry={handleRetryQueueTask}
                  onStop={handleStopQueueTask}
                  onRemove={handleRemoveQueueTask}
                  onClearCompleted={handleClearCompletedQueue}
                  onClearAll={handleClearAllQueue}
                  onEmergencyStop={handleEmergencyStop}
                  onResume={handleResumeSystem}
                  isEmergencyStopped={Boolean(bmOverview?.system?.isEmergencyStopped)}
                  totalAvailablePages={scannedPages.length || 50}
                  maxParallelTasks={systemSettings?.maxParallelTasks || 2}
                  onCreateNew={() => {
                    setRunMode('QUEUE');
                    setActiveTabKey('buff-like');
                  }}
                  onViewHistory={(url) => {
                    if (url) {
                      const cleanUrl = url.trim().replace(/\/+$/, '');
                      setLogSearchQuery(cleanUrl);
                    }
                    reloadBuffLogs(false);
                    setActiveTabKey('buff-history');
                  }}
                />
              </Suspense>
            ),
          },
          {
            key: 'buff-history',
            label: (
              <span className="flex items-center gap-1.5">
                <CheckCircleFilled className="text-emerald-400" />
                <span>Lịch sử tương tác ({buffLogs.length})</span>
              </span>
            ),
            children: (
              <HistoryTab
                buffLogs={buffLogs}
                setBuffLogs={setBuffLogs}
                buffLogsLoading={buffLogsLoading}
                reloadBuffLogs={reloadBuffLogs}
                handleViewLogDetail={handleViewLogDetail}
                loadingLogDetailId={loadingLogDetailId}
                logSearchQuery={logSearchQuery}
                setLogSearchQuery={setLogSearchQuery}
                onGoCreate={() => setActiveTabKey('buff-like')}
                onBuffAgain={(log) => {
                  setTargetPostUrl(log.targetUrl);
                  setSelectedReaction(log.reactionType);
                  setActiveTabKey('buff-like');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  message.info('Đã nạp lại link vào form. Các Page đã like sẽ được tự động bỏ qua.');
                }}
              />
            ),
          },
          {
            key: 'buff-hunter',
            label: `Săn bài tự động (${monitors.length})`,
            children: (
              <Suspense fallback={<TableSkeleton rows={4} columns={3} />}>
                <PostHunterTab
                  workerBaseUrl={WORKER_BASE_URL}
                  monitors={monitors as any}
                  queueItems={queueItems}
                  postHunterPaused={postHunterPaused}
                  onTogglePostHunterPaused={handleTogglePostHunterPaused}
                  autoBuffOwnPosts={Boolean(bmOverview?.system?.autoBuffOwnPosts)}
                  maxPagesPerPost={Number(bmOverview?.system?.maxPagesPerPost) || 60}
                  onRefresh={fetchBuffMonitors}
                  onAdd={(url) => handleOpenAddMonitorModal(undefined, url)}
                  onEdit={(m) => handleOpenAddMonitorModal(m as any)}
                  onToggle={handleToggleMonitor}
                  onDelete={handleDeleteMonitor}
                  onScanNow={handleScanNowMonitor}
                  onQueueUrl={(url) => {
                    setTargetPostUrl(url);
                    setActiveTabKey('buff-like');
                  }}
                  onOpenQueue={() => setActiveTabKey('buff-queue')}
                  onOpenSettings={() => {
                    setActiveTabKey('system-settings');
                  }}
                />
              </Suspense>
            ),
          },
          {
            key: 'via-management',
            label: 'Dàn Via & Fanpage',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Dàn Via & Fanpage..." />}>
                <ViaManagementPage
                  accounts={accounts as any[]}
                  loading={loadingAccounts}
                  onRefresh={() => {
                    refetchAccounts();
                    fetchBmOverview();
                  }}
                  dbStatus={props.dbStatus}
                  onCheckDb={props.onCheckDb}
                  onNavigateToBuff={() => setActiveTabKey('buff-like')}
                />
              </Suspense>
            ),
          },
          {
            key: 'system-settings',
            label: 'Cấu Hình & Telegram',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Cấu hình hệ thống..." />}>
                <SystemSettingsPage
                  systemSettings={systemSettings}
                  setSystemSettings={setSystemSettings}
                  savingSettings={savingSettings}
                  onSaveSettings={handleSaveSettings}
                  testingTelegram={testingTelegram}
                  onTestTelegram={handleTestTelegram}
                  bmOverview={bmOverview}
                  onEmergencyStop={handleEmergencyStop}
                  onResumeSystem={handleResumeSystem}
                />
              </Suspense>
            ),
          },
          {
            key: 'license-management',
            label: 'Cho Thuê & Bản Quyền',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Quản lý Bản quyền..." />}>
                <LicenseManagementPage />
              </Suspense>
            ),
          },
        ]}
      />


      {/* Modal Xem Chi Tiết Log Lịch Sử Tương Tác */}
      <LogDetailModal
        log={selectedLogDetail}
        onClose={() => setSelectedLogDetail(null)}
        onReuse={(log) => {
          setTargetPostUrl(log.targetUrl);
          setSelectedReaction(log.reactionType);
          setSelectedLogDetail(null);
          setActiveTabKey('buff-like');
          message.info('Đã nạp lại bài viết này vào form để tiếp tục.');
        }}
      />

      {/* Modal Khai Báo & Quản Lý i_user (Fanpage) cho Từng Via */}
      <ManagePagesModal
        managePagesModalOpen={managePagesModalOpen}
        onClose={() => setManagePagesModalOpen(false)}
        fbAccounts={fbAccounts}
        targetViaForModal={targetViaForModal}
        setTargetViaForModal={setTargetViaForModal}
        modalViaAccount={modalViaAccount}
        currentModalPages={currentModalPages}
        handleSavePagesForTargetVia={handleSavePagesForTargetVia}
        handleDeletePageForTargetVia={handleDeletePageForTargetVia}
        handleClearPagesForTargetVia={handleClearPagesForTargetVia}
      />

      {/* MODAL: AI SEEDING STUDIO & SPINTAX ENGINE */}
      <AiSeedingModal
        aiStudioModalOpen={aiStudioModalOpen}
        onClose={() => setAiStudioModalOpen(false)}
        selectedNiche={selectedNiche}
        setSelectedNiche={setSelectedNiche}
        commentListText={commentListText}
        setCommentListText={setCommentListText}
        parsedCommentLines={parsedCommentLines}
        aiPostPrompt={aiPostPrompt}
        setAiPostPrompt={setAiPostPrompt}
        aiTone={aiTone}
        setAiTone={setAiTone}
        aiCount={aiCount}
        setAiCount={setAiCount}
        isAiGeneratingComments={isAiGeneratingComments}
        handleGenerateAiComments={handleGenerateAiComments}
      />

      {/* MODAL: THÊM / CẬP NHẬT MỤC TIÊU THEO DÕI POST HUNTER */}
      <MonitorFormModal
        open={isMonitorModalOpen}
        editing={monitorModalTarget.editing}
        prefillUrl={monitorModalTarget.prefillUrl}
        maxPagesPerPost={systemSettings?.maxPagesPerPost || 150}
        workerBaseUrl={WORKER_BASE_URL}
        onClose={() => setIsMonitorModalOpen(false)}
        onSaved={fetchBuffMonitors}
      />

      {/* MODAL: BÁO CÁO SỨC KHỎE DÀN VIA TRONG BM */}
      <ViaHealthModal
        open={isHealthModalOpen}
        results={viaHealthResults}
        onClose={() => setIsHealthModalOpen(false)}
      />

      {/* MODAL: XÁC NHẬN CHẠY TIẾP / BÙ LIKE */}
      <ResumeBuffModal
        resumeModalOpen={resumeModalOpen}
        onClose={() => setResumeModalOpen(false)}
        resumeTargetUrl={resumeTargetUrl}
        resumeDoneLikes={resumeDoneLikes}
        resumeTargetLikes={resumeTargetLikes}
        resumeMissingLikes={resumeMissingLikes}
        setResumeMissingLikes={setResumeMissingLikes}
        resumeReaction={resumeReaction}
        setResumeReaction={setResumeReaction}
        isResumingRemaining={isResumingRemaining}
        handleConfirmResume={handleConfirmResume}
      />


    </div>
  );
}
