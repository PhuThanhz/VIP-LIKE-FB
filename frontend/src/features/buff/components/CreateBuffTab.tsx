import { AppstoreOutlined, BulbOutlined, CheckCircleFilled, ClockCircleOutlined, CommentOutlined, ControlOutlined, DownOutlined, EditOutlined, ExclamationCircleOutlined, ExportOutlined, InfoCircleOutlined, InteractionOutlined, LikeOutlined, LoadingOutlined, ReloadOutlined, RobotOutlined, RocketOutlined, SafetyCertificateOutlined, SearchOutlined, SettingOutlined, ShareAltOutlined, ThunderboltFilled, UpOutlined, UserOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Button, Checkbox, Col, Dropdown, Input, InputNumber, Progress, Row, Segmented, Select, Switch, Tag, Tooltip } from 'antd';
import PageCardItem from './PageCardItem';
import PasteLinkInput from '../../../components/common/PasteLinkInput';
import { REACTIONS, SPEED_PRESETS } from '../constants';
import { cleanPageName, extractCUser, formatDelaySeconds, formatDuration, getSpeedLabel } from '../utils';
import { parseFacebookCookie } from '../../../utils/cookieHelper';
import type { BuffController } from '../hooks/useBuffEngagementController';
import LikeCapacityCard from './LikeCapacityCard';
import { useCookieAlert } from '../../../components/common/CookieAlertManager';

/** "New" tab: enter the post, engagement, pick accounts/Fanpages, run now or add to the queue */
export default function CreateBuffTab({ controller }: { controller: BuffController }) {
  const { openModal: openCookieModal } = useCookieAlert();
  const {
    actorMode,
    bmOverview,
    antiCheckpointGuard,
    autoBuffMutation,
    autoBuffProgress,
    autoFailoverLiveVia,
    autoSkipAlreadyLiked,
    avatarCacheMap,
    batchLikesPerOrder,
    batchLinkConcurrency,
    batchLinksText,
    buffMode,
    combinedAlreadyLikedIds,
    commentListText,
    concurrency,
    currentViaAccount,
    customCookie,
    customSpeed,
    delayMs,
    dripDurationMinutes,
    dripFeedMode,
    enableHumanBehavior,
    enableShare,
    engagementMode,
    expiredPagesSelectedCount,
    fastSwitch,
    fbAccounts,
    filteredPages,
    handleEnqueueFromForm,
    handleGenerateAiComments,
    handleOpenManagePages,
    handleQuickPresetAiSeeding,
    handleQuickPresetLike24,
    handleQuickPresetVias,
    handleReplaceExpiredPagesWithLiveOnes,
    handleScanPages,
    handleSelectAllUnliked,
    handleSelectRandomPages,
    handleStartAutoBuff,
    handleStartBatchBuff,
    handleStopBatchBuff,
    handleTogglePageId,
    inlineCommentEditorOpen,
    interactedPagesLoading,
    invalidBatchLinesCount,
    isAiGeneratingComments,
    isBatchRunning,
    isEnqueueing,
    likeFilter,
    loadingAccounts,
    message,
    pageDisplayLimit,
    pageSearchQuery,
    parsedBatchLinks,
    parsedCommentLines,
    queryClient,
    queueStagger,
    queueStartAfter,
    queueStartAt,
    refetchAccounts,
    runEstimate,
    runMode,
    runningTargetInfo,
    scanPagesMutation,
    scannedPages,
    seedingPresets,
    selectedAccountId,
    selectedPageIds,
    selectedPageIdsSet,
    selectedReaction,
    setActiveTabKey,
    setActorMode,
    setAiStudioModalOpen,
    setAntiCheckpointGuard,
    setAutoFailoverLiveVia,
    setAutoSkipAlreadyLiked,
    setBatchLikesPerOrder,
    setBatchLinkConcurrency,
    setBatchLinksText,
    setBuffMode,
    setCommentListText,
    setConcurrency,
    setCustomCookie,
    setCustomSpeed,
    setDelayMs,
    setDripDurationMinutes,
    setDripFeedMode,
    setEnableHumanBehavior,
    setEnableShare,
    setEngagementMode,
    setFastSwitch,
    setInlineCommentEditorOpen,
    setLikeFilter,
    setPageDisplayLimit,
    setPageSearchQuery,
    setQueueStagger,
    setQueueStartAfter,
    setQueueStartAt,
    setRunMode,
    setScannedPages,
    setSelectedAccountId,
    setSelectedPageIds,
    setSelectedReaction,
    setShowAdvancedSettings,
    setSpeedMode,
    setTargetPostUrl,
    setViaFilter,
    showAdvancedSettings,
    speedMode,
    targetPostUrl,
    unlikedScannedPages,
    deadViaSummary,
    usableUnlikedCount,
    viaFilter,
    viaGroupCounts,
  } = controller;

  // "Other" box in the quick like-count row (only applied on Enter / blur so pages aren't reselected on every keystroke)
  const QUICK_LIKE_COUNTS = [10, 30, 50, 100, 200, 300];
  const [customLikeCount, setCustomLikeCount] = useState<number | null>(null);
  const applyCustomLikeCount = () => {
    if (customLikeCount && customLikeCount > 0 && selectedPageIds.length !== customLikeCount) {
      handleSelectRandomPages(customLikeCount);
    }
  };

  return (
              <div className="space-y-5">
                <Row gutter={[20, 20]} align="top">
                  {/* LEFT COLUMN: 1. Post → 2. Engagement → 3. Accounts */}
                  <Col xs={24} lg={15}>
                    <div className="space-y-4">
                      {/* TOP HERO COMMAND BAR: PASTE LINK & QUICK PRESETS */}
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
                                      ? 'Group Facebook'
                                      : targetPostUrl.includes('/reel')
                                      ? 'Video Reels'
                                      : 'Bài viết'}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Quick presets: 3 presets in 1 button to save a row of buttons on the form */}
                            <Dropdown
                              trigger={['click']}
                              menu={{
                                items: [
                                  {
                                    key: 'all-pages',
                                    icon: <ThunderboltFilled className="text-blue-400" />,
                                    label: `Like bằng tất cả Page (${scannedPages.length})`,
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
                                    label: `Dùng tài khoản cá nhân (${fbAccounts.length})`,
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

                        {/* Link input or link list */}
                        {buffMode === 'SINGLE' ? (
                          <div>
                            <PasteLinkInput
                              value={targetPostUrl}
                              onChange={(val) => setTargetPostUrl(val)}
                              placeholder="Dán link bài Facebook (Group, Fanpage, Profile, Reels)"
                            />

                            {/* Checking dedupe history */}
                            {interactedPagesLoading && (
                              <div className="mt-2.5 text-[11px] text-cyan-400 flex items-center gap-1.5">
                                <LoadingOutlined spin /> Đang kiểm tra Page nào đã like bài này (kể cả link /share/)...
                              </div>
                            )}

                            {/* Warning if this post was already liked */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-amber-300 font-semibold flex items-center gap-2">
                                  <InfoCircleOutlined className="text-amber-400 text-sm" />
                                  <span>
                                    <b>{combinedAlreadyLikedIds.size} Pages/Vias</b> đã like bài này (<b>{unlikedScannedPages.length}</b> chưa like)
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  type="link"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
                                    message.success(`Đã tự bỏ chọn các tài khoản đã like bài này!`);
                                  }}
                                  className="text-xs p-0 h-auto text-amber-400 font-bold hover:underline shrink-0"
                                >
                                  Bỏ chọn {combinedAlreadyLikedIds.size} tài khoản đã like
                                </Button>
                              </div>
                            )}

                            {/* Dead Vias silently shrink the like ceiling: say so before the run, not after */}
                            {deadViaSummary.length > 0 && (
                              <div className="mt-3 p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-rose-200 flex items-start gap-2">
                                  <ExclamationCircleOutlined className="text-rose-400 text-sm mt-0.5" />
                                  <span>
                                    Chỉ <b>{usableUnlikedCount}</b> Page có thể like bài này lúc này.{' '}
                                    {deadViaSummary.map((v, i) => (
                                      <span key={v.viaName}>
                                        {i > 0 && ', '}
                                        <b>{v.viaName}</b> ({v.status === 'CHECKPOINT' ? 'checkpoint' : 'cookie hết hạn'}): {v.lostPages} Page không dùng được
                                      </span>
                                    ))}
                                    .
                                  </span>
                                </span>
                                <Button size="small" danger onClick={() => openCookieModal()} className="shrink-0">
                                  Cập nhật Cookie
                                </Button>
                              </div>
                            )}

                            {/* Quick like-count bar right under the link input (no scrolling needed) */}
                            {scannedPages.length > 0 && (
                              <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-300">Like</span>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {QUICK_LIKE_COUNTS
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
                                  <InputNumber
                                    size="small"
                                    min={1}
                                    max={scannedPages.length}
                                    precision={0}
                                    placeholder="Khác"
                                    value={customLikeCount}
                                    onChange={(v) => setCustomLikeCount(v ? Number(v) : null)}
                                    onPressEnter={applyCustomLikeCount}
                                    onBlur={applyCustomLikeCount}
                                    className={`!w-[88px] ${
                                      selectedPageIds.length > 0 &&
                                      selectedPageIds.length === customLikeCount &&
                                      !QUICK_LIKE_COUNTS.includes(customLikeCount)
                                        ? '!border-blue-500'
                                        : ''
                                    }`}
                                  />
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
                                Link Facebook (mỗi dòng một link):
                              </span>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-mono px-2.5 py-0.5 rounded-md bg-blue-950/90 border border-blue-700/70 text-blue-300 font-bold">
                                  {parsedBatchLinks.length} link hợp lệ
                                </span>
                                {invalidBatchLinesCount > 0 && (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-amber-950/90 border border-amber-700/70 text-amber-300 font-semibold flex items-center gap-1" title="Một số dòng không đúng định dạng Facebook">
                                    <ExclamationCircleOutlined className="text-amber-400" /> {invalidBatchLinesCount} dòng không hợp lệ/bỏ qua
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

                            {/* Parallel vs sequential selector */}
                            <div className="mt-2.5 p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                              <div>
                                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                  <ThunderboltFilled className="text-cyan-400" /> Cách chạy link:
                                </span>
                                <span className="text-[10px] text-slate-400 block mt-0.5">
                                  {batchLinkConcurrency === 2
                                    ? 'Chạy 2 link song song (tự chia Via gốc để tránh nghẽn)'
                                    : 'Chạy lần lượt từng link (link 2 chạy sau khi link 1 xong, an toàn nhất)'}
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

                            {/* Pick & enter likes per post in the Batch */}
                            <div className="mt-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5 shadow-sm">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div>
                                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                    <ThunderboltFilled className="text-amber-400" /> Mục tiêu like mỗi bài:
                                  </span>
                                  <span className="text-[10px] text-slate-400 block mt-0.5">
                                    Nhập số like muốn có cho mỗi bài trong danh sách
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

                              {/* Quick-pick buttons */}
                              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-800/60">
                                <span className="text-[11px] text-slate-400 font-medium mr-1">Chọn nhanh:</span>
                                {[10, 20, 50, 100, 200].map((n) => (
                                  <button
                                    key={n}
                                    type="button"
                                    onClick={() => {
                                      setBatchLikesPerOrder(n);
                                      if (n > fbAccounts.length && actorMode === 'VIAS') {
                                        setActorMode('FANPAGES');
                                        message.info(`Đã tự chuyển sang Fanpage vệ tinh để đạt ${n} like!`);
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

                              {/* Warning when in personal-account mode with only 3 Vias */}
                              {actorMode === 'VIAS' && (
                                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 mt-1">
                                  <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                                    <span>⚠️ Đang dùng <b>tài khoản cá nhân ({fbAccounts.length} Via)</b>: tối đa {fbAccounts.length} like/bài (mỗi tài khoản chỉ like được một lần).</span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActorMode('FANPAGES');
                                      message.success('Đã chuyển sang Fanpage vệ tinh! Bạn có thể buff 100+ like mỗi bài.');
                                    }}
                                    className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold cursor-pointer shrink-0 border-none transition-all shadow-sm"
                                  >
                                    👉 Bấm để chuyển sang Fanpage (634 Page)
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ENGAGEMENT FINE-TUNING PANEL */}
                      <div className="p-4 sm:p-5 app-surface space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                          <span className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-semibold flex items-center justify-center text-xs shrink-0">
                              2
                            </span>
                            <span className="text-sm sm:text-base font-semibold text-slate-100">Tương tác</span>
                          </span>
                        </div>

                        {/* 1. Engagement type: Combo / Like / Comment */}
                        <div>
                          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                            Kiểu tương tác:
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
                              <span className="text-xs font-bold">Chỉ like/thả cảm xúc</span>
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

                        {/* Buff Share option (share to the Fanpage wall) */}
                        <div className="px-3 py-2.5 rounded-xl border border-slate-800/80 flex items-center justify-between gap-3">
                          <Tooltip title="Fanpage bấm Chia sẻ để đăng lên tường của mình, tăng tiếp cận">
                            <span className="text-xs font-medium text-slate-200 flex items-center gap-2 cursor-help">
                              <ShareAltOutlined className="text-slate-400" /> Chia sẻ lên tường Fanpage
                            </span>
                          </Tooltip>
                          <Switch size="small" checked={enableShare} onChange={setEnableShare} />
                        </div>

                        {/* 2. Reaction picker: 7 Facebook reactions + 2 natural-mix cards */}
                        {engagementMode !== 'COMMENT_ONLY' && (
                          <div className="space-y-2.5">
                            <label className="text-xs font-semibold text-slate-300 block">Cảm xúc</label>

                            {/* Row 1: the 7 standard Facebook reactions */}
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

                            {/* Row 2: 2 smart reaction-mix modes (anti-detection & most natural) */}
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

                        {/* 2.5. Compact Seeding Studio bar (when comments are on) */}
                        {engagementMode !== 'LIKE_ONLY' && (
                          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700/80 transition-all space-y-2.5">
                            {/* Title row + status + action buttons */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800/60">
                              <div className="flex items-center gap-2 flex-wrap">
                                <div className="w-6 h-6 rounded-lg bg-blue-950/90 border border-blue-700/60 flex items-center justify-center text-blue-400 text-xs shrink-0">
                                  <CommentOutlined />
                                </div>
                                <span className="text-xs font-bold text-slate-200">
                                  Nội dung bình luận seeding
                                </span>
                                {parsedCommentLines.length > 0 ? (
                                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-700/60 text-emerald-300 font-bold">
                                    {parsedCommentLines.length} dòng đã nạp
                                  </span>
                                ) : (
                                  <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-800/60 text-amber-300 font-medium">
                                    Chưa có dòng nào
                                  </span>
                                )}
                              </div>

                              {/* Action button group */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Button
                                  size="small"
                                  type="primary"
                                  icon={<RobotOutlined spin={isAiGeneratingComments} />}
                                  loading={isAiGeneratingComments}
                                  onClick={handleGenerateAiComments}
                                  className="bg-blue-600 hover:bg-blue-500 text-on-accent font-semibold text-xs h-7 px-2.5 rounded-lg border-none cursor-pointer"
                                  title="Tự viết bình luận bằng AI từ link bài"
                                >
                                  Tạo bằng AI
                                </Button>
                                <Button
                                  size="small"
                                  icon={<AppstoreOutlined />}
                                  onClick={() => setAiStudioModalOpen(true)}
                                  className="text-xs h-7 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200 cursor-pointer font-medium"
                                  title="Mở Studio để chọn kịch bản theo ngành hoặc trộn Spintax"
                                >
                                  Soạn &amp; Mẫu seeding
                                </Button>
                                {parsedCommentLines.length > 0 && (
                                  <>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        const shuffled = [...parsedCommentLines].sort(() => Math.random() - 0.5);
                                        setCommentListText(shuffled.join('\n'));
                                        message.info('Đã xáo trộn thứ tự bình luận!');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-slate-300 cursor-pointer"
                                      title="Xáo trộn thứ tự dòng"
                                    >
                                      Xáo trộn
                                    </Button>
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setCommentListText('');
                                        message.info('Đã xóa danh sách bình luận');
                                      }}
                                      className="text-xs h-7 px-2 rounded-lg bg-slate-900 border-slate-700 text-rose-400 hover:text-rose-300 cursor-pointer"
                                      title="Xóa"
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

                            {/* Short preview when there are lines and quick entry is closed */}
                            {parsedCommentLines.length > 0 && !inlineCommentEditorOpen && (
                              <div
                                onClick={() => setAiStudioModalOpen(true)}
                                className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 transition-all cursor-pointer group"
                                title="Bấm mở Studio để xem và sửa toàn bộ"
                              >
                                <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                                  <span>Xem trước ({parsedCommentLines.length} dòng):</span>
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
                                      ... và {parsedCommentLines.length - 2} bình luận khác
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* When there are no lines: 1-click script suggestions */}
                            {parsedCommentLines.length === 0 && !inlineCommentEditorOpen && (
                              <div className="flex items-center gap-2 flex-wrap py-0.5">
                                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                                  <BulbOutlined className="text-amber-400" /> 1-click sample scripts:
                                </span>
                                {seedingPresets.map((pr) => (
                                  <button
                                    key={pr.id}
                                    type="button"
                                    onClick={() => {
                                      setCommentListText(pr.comments.join('\n'));
                                      message.success(`Đã nạp kịch bản: ${pr.name} (${pr.comments.length} dòng)`);
                                    }}
                                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-cyan-300 border border-slate-800 hover:border-slate-700 transition-all cursor-pointer"
                                  >
                                    {pr.badge ? `[${pr.badge}] ` : ''}{pr.name}
                                  </button>
                                ))}
                              </div>
                            )}

                            {/* Expanded quick-entry box (when the user clicks "Quick entry") */}
                            {inlineCommentEditorOpen && (
                              <div className="space-y-2 pt-1">
                                <Input.TextArea
                                  rows={3}
                                  value={commentListText}
                                  onChange={(e) => setCommentListText(e.target.value)}
                                  placeholder="One comment per line (e.g. Bài viết rất hay và ý nghĩa ạ!)..."
                                  className="font-sans text-xs bg-slate-900/90 text-slate-100 border-slate-700 rounded-xl placeholder:text-slate-500 focus:border-cyan-400"
                                />
                                <div className="flex items-center justify-between text-[11px] text-slate-400">
                                  <span>Mỗi tài khoản Facebook lấy 1 bình luận, theo thứ tự hoặc ngẫu nhiên.</span>
                                  <button
                                    type="button"
                                    onClick={() => setInlineCommentEditorOpen(false)}
                                    className="text-cyan-400 hover:underline cursor-pointer bg-transparent border-none p-0"
                                  >
                                    Thu gọn
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 3. Advanced settings & speed block (collapsible) */}
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                          <div
                            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                            className="p-3 flex items-center justify-between cursor-pointer hover:bg-slate-900/40 transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <ControlOutlined className="text-cyan-400 text-sm" />
                              <span className="text-xs font-bold text-slate-200">
                                Cài đặt nâng cao &amp; tốc độ (không bắt buộc)
                              </span>
                              <span className="text-[10px] text-cyan-300 font-mono bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded-full">
                                {getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} • {concurrency} luồng • {dripFeedMode ? `drip-feed over ${dripDurationMinutes} min` : 'chạy ngay'}
                              </span>
                            </div>
                            <span className="text-xs text-cyan-400 font-semibold flex items-center gap-1">
                              {showAdvancedSettings ? <><UpOutlined className="text-[10px]" /> Thu gọn</> : <><DownOutlined className="text-[10px]" /> Mở rộng</>}
                            </span>
                          </div>


                          {showAdvancedSettings && (
                            <div className="p-3 pt-0 border-t border-slate-800/80 space-y-2.5 mt-1">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                                {/* BUFF SPEED (SPEED MODE PRESET) */}
                                <div className="flex flex-col items-stretch p-3 rounded-xl bg-slate-950/80 border border-cyan-800/60 text-xs shadow-sm sm:col-span-2 gap-2">
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                    <span className="text-cyan-300 font-bold flex items-center gap-1">
                                      <ThunderboltFilled className="text-cyan-400" /> Tốc độ
                                    </span>
                                    <span className="text-[11px] text-slate-400">
                                      {engagementMode !== 'LIKE_ONLY'
                                        ? `Khi có bình luận, mỗi lượt nghỉ ít nhất 12s (hiện tại: ${formatDelaySeconds(delayMs)})`
                                        : `nghỉ ${formatDelaySeconds(delayMs)} giữa các like`}
                                    </span>
                                  </div>
                                  <Segmented
                                    block
                                    size="small"
                                    value={customSpeed ? 'CUSTOM' : speedMode}
                                    onChange={(val) => {
                                      if (val === 'CUSTOM') {
                                        // Keep the current delay; the backend runs at the standard pace
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
                                        title: `${p.name}: nghỉ ${formatDelaySeconds(p.delayMs)} giữa các like`,
                                      })),
                                      { label: 'Tùy chỉnh', value: 'CUSTOM', title: 'Tự chọn thời gian nghỉ giữa các lượt' },
                                    ]}
                                    className="bg-slate-900 border border-slate-700 text-slate-200"
                                  />
                                </div>

                                {speedMode === 'SMART' && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-[11px] text-cyan-300">
                                    <SafetyCertificateOutlined className="text-cyan-400 text-sm shrink-0" />
                                    <span>
                                      <b>Đang bật tốc độ tự động:</b> tự giãn nhịp ({selectedPageIds.length <= 30 ? '~2.2s' : selectedPageIds.length <= 80 ? '~2.6s' : '~3.0s'}), ~1.2s đọc bài và nghỉ sau mỗi 25 page, vừa nhanh vừa hạn chế bị Facebook đánh dấu spam.
                                    </span>
                                  </div>
                                )}
                                {selectedPageIds.length > 80 && (speedMode === 'TURBO' || speedMode === 'FAST') && (
                                  <div className="sm:col-span-2 flex items-center gap-2 p-2 rounded-lg bg-amber-950/40 border border-amber-700/50 text-[11px] text-amber-300">
                                    <ThunderboltFilled className="text-amber-400 text-sm shrink-0" />
                                    <span>
                                      <b>Lưu ý an toàn:</b> Bạn đang chọn {selectedPageIds.length} Page ở tốc độ {speedMode === 'TURBO' ? 'Turbo' : 'Rất nhanh'} . <b>Tiêu chuẩn</b> hoặc <b>Tự động</b> được khuyên dùng cho lượt chạy rất lớn để tránh bị Facebook giới hạn thao tác.
                                    </span>
                                  </div>
                                )}

                                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-emerald-900/60 text-xs shadow-sm">
                                  <div>
                                    <span className="text-slate-200 font-bold block">Giả lập người thật</span>
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

                                {/* Delay only shows with "Custom" or comments (speed levels already include a delay) */}
                                {(customSpeed || engagementMode !== 'LIKE_ONLY') && (
                                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs shadow-sm">
                                    <div>
                                      <span className="text-slate-200 font-bold block">Độ trễ</span>
                                      <span className="text-[10px] text-slate-400">Nghỉ giữa các lượt</span>
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
                                              { value: 16000, label: '16s (an toàn hơn)' },
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
                                      <span>Đổi Page ngay trên bài (Fast-Switch)</span>
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
                                      <ThunderboltFilled className="text-cyan-400" /> Số luồng song song
                                    </span>
                                    <span className="text-[11px] text-slate-400">Nhiều luồng chạy nhanh gấp 2 - 3 lần</span>
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
                                      <SafetyCertificateOutlined className="text-indigo-400" /> Buff nhỏ giọt
                                    </span>
                                    <span className="text-[10px] text-slate-400">Rải theo thời gian để tránh bị phát hiện</span>
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
                                    <span className="text-[10px] text-slate-400">Nghỉ theo đợt &amp; dừng khi bị chặn</span>
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
                                      <SafetyCertificateOutlined className="text-emerald-400" /> Tự bù từ Via live (Auto-Failover)
                                    </span>
                                    <span className="text-[10px] text-slate-400">Tự lấy Page từ Via live khi cookie của một Via hết hạn</span>
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

                              {/* Avoid duplicate likes checkbox */}
                              <div className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800/80 bg-slate-950/60 text-xs">
                                <Checkbox
                                  checked={autoSkipAlreadyLiked}
                                  onChange={(e) => setAutoSkipAlreadyLiked(e.target.checked)}
                                  className="text-slate-200 font-medium"
                                >
                                  Tự bỏ qua tài khoản/page đã like bài này
                                </Checkbox>
                                <span className="text-amber-400 font-semibold text-[11px] hidden sm:inline">
                                  Chống trùng
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
                              title="Làm mới Via & quét Facebook tìm thêm Fanpage"
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

                        {/* Parent account dropdown */}
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
                                  ? `Gộp ${fbAccounts.length} tài khoản Via (${selectedPageIds.length}/${scannedPages.length})`
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
                                      label: `Tất cả tài khoản (${fbAccounts.length}): ${
                                        fbAccounts
                                          .slice(0, 4)
                                          .map((a) => a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`)
                                          .join(' + ') +
                                        (fbAccounts.length > 4 ? ` + ${fbAccounts.length - 4} khác` : '')
                                      }`,
                                    },
                                  ]
                                : []),
                              { value: 'CUSTOM', label: 'Nhập cookie thủ công' },
                              ...fbAccounts.map((a) => ({
                                value: a.id,
                                label: `${a.pageName || `Via ${String(a.platformAccountId || a.id).slice(-4)}`} (${
                                  a.tokenStatus === 'OK' ? 'Cookie còn sống' : 'Cần kiểm tra'
                                })`,
                              })),
                            ]}
                          />
                        </div>

                        {/* Manual cookie when CUSTOM is selected */}
                        {selectedAccountId === 'CUSTOM' && (
                          <div className="space-y-3 p-3.5 rounded-xl border border-slate-800 bg-slate-950/70">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-bold text-slate-200">
                                Nhập cookie tài khoản Facebook gốc:
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
                                      message.success(`Phát hiện JSON Cookie: UID ${parsed.c_user || 'N/A'}`);
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
                                      message.success(`Phát hiện JSON Cookie: xs ${parsed.xs ? parsed.xs.slice(0, 15) + '...' : ''}`);
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
                              placeholder="Dán toàn bộ chuỗi cookie hoặc khối JSON Cookie-Editor vào đây..."
                              value={customCookie}
                              onChange={(e) => {
                                const val = e.target.value;
                                const parsed = parseFacebookCookie(val);
                                if (parsed.isJson) {
                                  setCustomCookie(parsed.cookieString);
                                  message.success(`Đã tự nhận diện JSON Cookie (${parsed.cookieCount} cookie)!`);
                                } else {
                                  setCustomCookie(val);
                                }
                              }}
                              className="font-mono text-[11px] rounded-xl bg-slate-900 border-slate-700 text-slate-100"
                            />
                          </div>
                        )}

                        {/* CHOOSE: SATELLITE FANPAGES OR PERSONAL VIAS */}
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
                            <span>Tài khoản cá nhân</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700 text-emerald-300">
                              {fbAccounts.length}
                            </span>
                          </button>
                        </div>

                        {/* Fanpage / Via list with interactive grid cards */}
                        {scannedPages.length > 0 ? (
                          <div className="space-y-2.5 pt-1">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-200">
                                {actorMode === 'VIAS' ? 'Chọn tài khoản Via thực hiện:' : 'Chọn Fanpage thực hiện:'}{' '}
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

                            {/* Quick Page count toolbar (20, 50, 100, 200, 300, 400, 500, All) */}
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

                            {/* Not liked / Liked status filter */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="flex items-center gap-1.5 flex-wrap p-2 rounded-xl bg-slate-950/60 border border-slate-800/80">
                                <span className="text-[11px] font-semibold text-slate-400">Trạng thái trên bài này:</span>
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

                            {/* Quick filter per Via when ALL_VIAS is combined */}
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

                            {/* Page/Via search box */}
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

                            {/* Warning: Pages belonging to a cookie-expired Via */}
                            {expiredPagesSelectedCount > 0 && (
                              <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-500/40 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shadow-sm">
                                <span className="text-rose-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <ExclamationCircleOutlined className="text-rose-400 text-sm shrink-0" />
                                  <span>
                                    Phát hiện <b>{expiredPagesSelectedCount} Page</b> thuộc Via hết hạn cookie (không like được).
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={handleReplaceExpiredPagesWithLiveOnes}
                                  className="text-[11px] h-6 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 border-none text-white font-semibold cursor-pointer shrink-0"
                                >
                                  ⚡ Thay bằng Page từ Via live
                                </Button>
                              </div>
                            )}

                            {/* Warning: Pages that already engaged with this post */}
                            {combinedAlreadyLikedIds.size > 0 && (
                              <div className="p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs flex items-center justify-between gap-2">
                                <span className="text-amber-300 font-medium flex items-center gap-1.5 text-[11px]">
                                  <InfoCircleOutlined className="text-amber-400" />
                                  <span>
                                    <b>{combinedAlreadyLikedIds.size} Page</b> đã like bài này (<b>{unlikedScannedPages.length} Page</b> chưa like). Các nút "Chọn nhanh" tự chọn Page chưa like!
                                  </span>
                                </span>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setSelectedPageIds((prev) => prev.filter((id) => !combinedAlreadyLikedIds.has(id)));
                                    message.success('Đã tự bỏ chọn các Page đã like bài này!');
                                  }}
                                  className="text-[11px] h-6 px-2 rounded-lg bg-amber-900/60 border-amber-600/50 text-amber-200 cursor-pointer shrink-0"
                                >
                                  Bỏ chọn Page đã like
                                </Button>
                              </div>
                            )}

                            {/* Via/Fanpage card grid (memoized component to avoid laggy re-renders) */}
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

                              {/* Load more / show all when there are many Pages */}
                              {filteredPages.length > pageDisplayLimit && (
                                <div className="sm:col-span-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-300">
                                  <span>
                                    Đang hiện <b className="text-white">{pageDisplayLimit}</b> / <b className="text-white">{filteredPages.length}</b> tài khoản
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="small"
                                      onClick={() => setPageDisplayLimit((prev) => prev + 60)}
                                      className="text-xs h-7 rounded-lg bg-slate-800 border-slate-700 text-blue-400 hover:text-blue-300 cursor-pointer font-semibold"
                                    >
                                      Hiện thêm 60
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
                            <p>Tài khoản này chưa có Fanpage nào.</p>
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

                  {/* RIGHT COLUMN (pinned): summary, start button, progress */}
                  <Col xs={24} lg={9}>
                    <div className="space-y-4 lg:sticky lg:top-24">
                      {/* Summary + start button */}
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
                              k: 'Loại',
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
                              v: `${selectedPageIds.length} ${actorMode === 'VIAS' ? 'tài khoản cá nhân' : 'Page'}`,
                              muted: selectedPageIds.length === 0,
                            },
                            { k: 'Tốc độ', v: `${getSpeedLabel(speedMode, customSpeed, delayMs, engagementMode !== 'LIKE_ONLY')} · ${concurrency} luồng` },
                            {
                              k: 'Ước tính',
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
                              ? 'Ước tính từ tốc độ thực của các bài chạy gần đây.'
                              : 'Ước tính sơ bộ từ cài đặt tốc độ; sẽ chính xác hơn sau vài lượt chạy.'}
                          </p>
                        )}

                        {/* Run mode: run now or add to the queue */}
                        <div className="space-y-3 pt-1">
                          <Segmented
                            block
                            value={runMode}
                            onChange={(v) => setRunMode(v as 'NOW' | 'QUEUE')}
                            disabled={autoBuffMutation.isPending || isBatchRunning}
                            options={[
                              { label: 'Chạy ngay', value: 'NOW' },
                              { label: 'Thêm vào hàng đợi', value: 'QUEUE' },
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
                                    { value: 0, label: 'Khi tới lượt' },
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
                                  <span className="text-slate-400 shrink-0 font-medium">Thời gian:</span>
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
                                  Xem tiến độ →
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
                                Thêm bài mới này vào Hàng đợi (chạy tiếp theo)
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
                                  ? 'Dán link bài ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số like ở bước 1 hoặc 3'
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
                                  ? 'Đang bắt đầu...'
                                  : !targetPostUrl
                                  ? 'Dán link bài ở bước 1'
                                  : selectedPageIds.length === 0
                                  ? 'Chọn số like ở bước 1 hoặc 3'
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
                                    : `Bắt đầu chạy ${parsedBatchLinks.length} bài`}
                                </Button>
                              ) : (
                                <Button
                                  danger
                                  size="large"
                                  onClick={handleStopBatchBuff}
                                  className="w-full h-11 rounded-xl text-sm font-bold"
                                >
                                  Dừng cả danh sách
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Like capacity of the Via fleet (max likes per post) */}
                      <LikeCapacityCard bmOverview={bmOverview} />

                      {/* MINI STATUS WIDGET ON THE NEW TAB (DOESN'T TAKE FORM SPACE) */}
                      {autoBuffProgress.status === 'RUNNING' || isBatchRunning ? (
                        <div className="p-4 rounded-xl border border-blue-500/40 bg-blue-950/20 space-y-3">
                          <div className="flex items-center justify-between pb-2 border-b border-blue-800/30">
                            <span className="text-xs font-bold text-blue-300 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                              Có 1 lượt đang chạy nền
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
                              Xem chi tiết lượt chạy ➔
                            </Button>
                          </div>
                        </div>
                      ) : autoBuffProgress.status === 'DONE' ? (
                        <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-950/20 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                              <CheckCircleFilled className="text-emerald-400" /> Vừa chạy xong!
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
                              Xem kết quả ➔
                            </Button>
                            <Button
                              size="small"
                              onClick={() => setActiveTabKey('buff-history')}
                              className="text-xs rounded-lg"
                            >
                              Xem lịch sử
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </Col>
                </Row>
              </div>
  );
}
