import React, { lazy, Suspense } from 'react';
import {
  Button,
  Tabs,
  Modal,
  Segmented,
  Tooltip,
} from 'antd';
import {
  AimOutlined,
  PlusCircleOutlined,
  ThunderboltFilled,
  PlayCircleOutlined,
  CheckCircleFilled,
  StopOutlined,
  ThunderboltOutlined,
  HistoryOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { WORKER_BASE_URL } from '../config/axios';
import { TableSkeleton, PageSkeleton } from '../components/common/SaaSLoadingSkeleton';

// Code-splitting with React.lazy for the large admin modules
const PostHunterTab = lazy(() => import('../components/buff/PostHunterTab'));
const BuffQueueTab = lazy(() => import('../components/buff/BuffQueueTab'));
const ViaManagementPage = lazy(() => import('./ViaManagementPage'));
const SystemSettingsPage = lazy(() => import('./SystemSettingsPage'));
const LicenseManagementPage = lazy(() => import('./LicenseManagementPage'));

import MonitorFormModal from '../features/buff/components/MonitorFormModal';
import ViaHealthModal from '../features/buff/components/ViaHealthModal';
import LogDetailModal from '../features/buff/components/LogDetailModal';
import ManagePagesModal from '../features/buff/components/ManagePagesModal';
import HistoryTab from '../features/buff/components/HistoryTab';
import RunningTab from '../features/buff/components/RunningTab';
import ResumeBuffModal from '../features/buff/components/ResumeBuffModal';
import AiSeedingModal from '../features/buff/components/AiSeedingModal';
import { useBuffEngagementController } from '../features/buff/hooks/useBuffEngagementController';
import CreateBuffTab from '../features/buff/components/CreateBuffTab';


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
    targetPostUrl,
    setTargetPostUrl,
    selectedReaction,
    setSelectedReaction,
    scannedPages,
    setActorMode,
    delayMs,
    isAiGeneratingComments,
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
    commentListText,
    setCommentListText,
    parsedCommentLines,
    queueItems,
    fetchBuffQueue,
    setRunMode,
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
    logSearchQuery,
    setLogSearchQuery,
    selectedLogDetail,
    setSelectedLogDetail,
    setBatchLinksText,
    setBatchLikesPerOrder,
    batchLinkConcurrency,
    batchOrders,
    setBatchOrders,
    isBatchRunning,
    managePagesModalOpen,
    setManagePagesModalOpen,
    targetViaForModal,
    setTargetViaForModal,
    loadingAccounts,
    refetchAccounts,
    accounts,
    fbAccounts,
    modalViaAccount,
    currentModalPages,
    handleOpenManagePages,
    handleSavePagesForTargetVia,
    handleDeletePageForTargetVia,
    handleClearPagesForTargetVia,
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
    handleRefillSingleOrder,
    handleRefillBatchIncomplete,
    isAnyBuffRunning,
    isBuffTab,
    emergencyStopButton,
  } = controller;

  return (
    <div className="space-y-5 max-w-[1440px] mx-auto px-2 sm:px-4 md:px-6 pb-28 md:pb-12">
      {/* Outside the Likes & Comments tabs (no tab bar), keep the emergency stop button while running */}
      {!isBuffTab && isAnyBuffRunning && !bmOverview?.system?.isEmergencyStopped && (
        <div className="flex justify-end">{emergencyStopButton}</div>
      )}

      {/* WARNING: VIA COOKIE EXPIRED / CHECKPOINT */}
      {deadViaList.length > 0 && (
        <div className="px-4 py-3 rounded-xl border border-amber-500/30 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            <div className="text-amber-200 font-medium">
              {deadViaList.length} Via cần cập nhật Cookie
            </div>
            <div className="text-xs text-amber-200/70 mt-0.5 truncate">
              {deadViaList
                .map((v) => `${v.viaName || v.uid} (${v.tokenStatus === 'CHECKPOINT' ? 'checkpoint' : 'expired'})`)
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

      {/* WARNING BANNER WHEN THE SYSTEM IS IN EMERGENCY STOP */}
      {bmOverview?.system?.isEmergencyStopped && (
        <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-rose-200 flex items-center justify-between text-xs gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <StopOutlined className="text-rose-400 text-base shrink-0" />
            <div>
              <strong className="text-rose-200 text-xs font-semibold uppercase tracking-wider">Hệ thống đang dừng khẩn cấp</strong>
              <div className="text-rose-300/80 text-[11px] mt-0.5">
                Toàn bộ hàng đợi tự động và task Playwright đã tạm dừng an toàn ({bmOverview?.system?.emergencyReason || 'Bởi quản trị viên'}).
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
            Chạy lại ngay
          </Button>
        </div>
      )}

      {/* VIPLIKE RADIANT module navigation (Linear/Apple-tier segmented dock) */}
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
                label: 'Tiến độ trực tiếp',
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
                label: 'Săn bài',
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
                  {/* Vector icon */}
                  <span
                    className={`flex items-center justify-center text-sm transition-transform duration-200 group-hover:scale-110 ${
                      active ? t.iconColor : 'text-slate-400 group-hover:text-slate-300'
                    }`}
                  >
                    <IconComp />
                  </span>

                  {/* Feature label */}
                  <span>{t.label}</span>

                  {/* Live radar indicator for Live progress */}
                  {t.isPulse && (
                    <span className="relative flex h-2 w-2 ml-0.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]"></span>
                    </span>
                  )}

                  {/* Count badge */}
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

                  {/* Neon underline for the active tab */}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent rounded-full shadow-[0_0_8px_rgba(34,211,238,0.9)]" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Right side: Via/Page counts (click to check Vias) + emergency stop while running */}
          <div className="flex items-center gap-2 pr-1 shrink-0">
            <Tooltip title="Bấm để kiểm tra trạng thái cookie của các Via">
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
              <CreateBuffTab controller={controller} />
            ),
          },
          {
            key: 'buff-running',
            label: (
              <span className="flex items-center gap-1.5">
                <PlayCircleOutlined className="text-blue-400" />
                <span>Tiến độ trực tiếp</span>
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
                  message.info('Đã nạp lại link vào form. Page đã like sẽ tự được bỏ qua.');
                }}
              />
            ),
          },
          {
            key: 'buff-hunter',
            label: `Săn bài (${monitors.length})`,
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
            label: 'Via & Fanpage',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải Via & Fanpage..." />}>
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
            label: 'Cấu hình & Telegram',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải cấu hình hệ thống..." />}>
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
            label: 'Cho thuê & Bản quyền',
            children: (
              <Suspense fallback={<PageSkeleton title="Đang tải quản lý bản quyền..." />}>
                <LicenseManagementPage />
              </Suspense>
            ),
          },
        ]}
      />


      {/* Engagement history log detail modal */}
      <LogDetailModal
        log={selectedLogDetail}
        onClose={() => setSelectedLogDetail(null)}
        onReuse={(log) => {
          setTargetPostUrl(log.targetUrl);
          setSelectedReaction(log.reactionType);
          setSelectedLogDetail(null);
          setActiveTabKey('buff-like');
          message.info('Đã nạp lại bài vào form để chạy tiếp.');
        }}
      />

      {/* Modal to declare & manage i_user (Fanpages) per Via */}
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

      {/* MODAL: ADD / UPDATE POST HUNTER MONITOR */}
      <MonitorFormModal
        open={isMonitorModalOpen}
        editing={monitorModalTarget.editing}
        prefillUrl={monitorModalTarget.prefillUrl}
        maxPagesPerPost={systemSettings?.maxPagesPerPost || 150}
        workerBaseUrl={WORKER_BASE_URL}
        onClose={() => setIsMonitorModalOpen(false)}
        onSaved={fetchBuffMonitors}
      />

      {/* MODAL: BM VIA FLEET HEALTH REPORT */}
      <ViaHealthModal
        open={isHealthModalOpen}
        results={viaHealthResults}
        onClose={() => setIsHealthModalOpen(false)}
      />

      {/* MODAL: CONFIRM CONTINUE / TOP UP LIKES */}
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
