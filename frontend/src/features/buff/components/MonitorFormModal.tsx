import React, { useState, useEffect } from 'react';
import { Modal, Button, Input, Select, InputNumber, Switch, App } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import axios from 'axios';
import type { BuffMonitor } from '../types';
import { SEEDING_NICHE_PRESETS } from '../constants';
import { resolveSpintax } from '../utils';

export interface MonitorFormModalProps {
  open: boolean;
  editing?: BuffMonitor | null;
  prefillUrl?: string;
  maxPagesPerPost: number;
  workerBaseUrl: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function MonitorFormModal({
  open,
  editing,
  prefillUrl,
  maxPagesPerPost,
  workerBaseUrl,
  onClose,
  onSaved,
}: MonitorFormModalProps) {
  const { message } = App.useApp();

  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null);
  const [loadingMonitors, setLoadingMonitors] = useState<boolean>(false);

  // Monitor Form state
  const [monTargetUrl, setMonTargetUrl] = useState<string>('');
  const [monTargetName, setMonTargetName] = useState<string>('');
  const [monTargetType, setMonTargetType] = useState<'PAGE' | 'GROUP' | 'PROFILE'>('PAGE');
  const [monInterval, setMonInterval] = useState<number>(10);
  const [monTargetLikes, setMonTargetLikes] = useState<number | 'ALL'>('ALL');
  const [monReaction, setMonReaction] = useState<string>('RANDOM_POSITIVE');
  const [monEnableComment, setMonEnableComment] = useState<boolean>(false);
  const [monCommentText, setMonCommentText] = useState<string>(
    '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\n' +
    'Đẹp xuất sắc luôn ạ! Chúc shop {bão đơn|buôn may bán đắt} nha! 🌟\n' +
    'Chất lượng tuyệt vời, giá cả hợp lý! Đã ủng hộ shop nhiều lần 👍'
  );
  const [monDelayMinutes, setMonDelayMinutes] = useState<number>(3);
  const [monViaMode, setMonViaMode] = useState<string>('ALL_VIAS');
  const [monMaxPostsPerDay, setMonMaxPostsPerDay] = useState<number>(5);
  const [monVariancePercent, setMonVariancePercent] = useState<number>(10);
  const [monEnableDripFeed, setMonEnableDripFeed] = useState<boolean>(false);
  const [monDripDurationMinutes, setMonDripDurationMinutes] = useState<number>(20);
  const [monExpiryDays, setMonExpiryDays] = useState<number>(30);
  const [spintaxSampleOutputs, setSpintaxSampleOutputs] = useState<string[]>([]);
  const [monShowAdvanced, setMonShowAdvanced] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setEditingMonitorId(editing.id);
      setMonTargetUrl(editing.targetUrl);
      setMonTargetName(editing.targetName);
      setMonTargetType(editing.targetType || 'PAGE');
      setMonInterval(editing.checkIntervalMinutes || 10);
      setMonTargetLikes(editing.buffConfig?.targetLikes || 'ALL');
      setMonReaction(editing.buffConfig?.reactionType || 'RANDOM_POSITIVE');
      setMonEnableComment(Boolean(editing.buffConfig?.enableComment));
      setMonCommentText(
        Array.isArray(editing.buffConfig?.comments) && editing.buffConfig.comments.length > 0
          ? editing.buffConfig.comments.join('\n')
          : '{Sản phẩm|Mẫu này} đẹp quá shop ơi! {Tư vấn|Inbox} em nhé! ❤️\nĐẹp xuất sắc luôn ạ! 🌟'
      );
      setMonDelayMinutes(editing.buffConfig?.delayMinutes || 3);
      setMonViaMode(editing.buffConfig?.viaMode || 'ALL_VIAS');
      setMonMaxPostsPerDay(editing.buffConfig?.maxPostsPerDay || 5);
      setMonVariancePercent(editing.buffConfig?.variancePercent ?? 10);
      setMonEnableDripFeed(Boolean(editing.buffConfig?.enableDripFeed));
      setMonDripDurationMinutes(editing.buffConfig?.dripDurationMinutes || 20);
      const remainingDays = (editing as any).expiresAt
        ? Math.max(1, Math.round((new Date((editing as any).expiresAt).getTime() - Date.now()) / (24 * 3600 * 1000)))
        : 30;
      setMonExpiryDays(remainingDays);
    } else {
      setEditingMonitorId(null);
      setMonTargetUrl(prefillUrl || '');
      setMonTargetName('');
      setMonTargetType('PAGE');
      setMonInterval(10);
      setMonTargetLikes(100);
      setMonReaction('RANDOM_POSITIVE');
      setMonEnableComment(false);
      setMonDelayMinutes(3);
      setMonViaMode('ALL_VIAS');
      setMonMaxPostsPerDay(5);
      setMonVariancePercent(10);
      setMonEnableDripFeed(false);
      setMonDripDurationMinutes(20);
      setMonExpiryDays(30);
    }
    setSpintaxSampleOutputs([]);
  }, [open, editing, prefillUrl]);

  const handleSaveMonitor = async () => {
    if (!monTargetUrl.trim()) {
      message.warning('Please enter the Fanpage / Group / Profile link to monitor!');
      return;
    }
    setLoadingMonitors(true);
    try {
      const commentsList = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
      const expiresAt = monExpiryDays > 0 ? new Date(Date.now() + monExpiryDays * 24 * 3600 * 1000).toISOString() : null;
      const payload = {
        id: editingMonitorId || undefined,
        targetUrl: monTargetUrl.trim(),
        targetName: monTargetName.trim() || undefined,
        targetType: monTargetType,
        checkIntervalMinutes: monInterval,
        expiresAt,
        buffConfig: {
          targetLikes: monTargetLikes,
          variancePercent: monVariancePercent,
          maxPostsPerDay: monMaxPostsPerDay,
          enableDripFeed: monEnableDripFeed,
          dripDurationMinutes: monDripDurationMinutes,
          reactionType: monReaction,
          enableLike: true,
          enableComment: monEnableComment,
          comments: commentsList,
          delayMinutes: monDelayMinutes,
          viaMode: monViaMode,
        },
        status: 'ACTIVE',
      };
      const res = await axios.post(`${workerBaseUrl}/api/buff-monitors`, payload);
      if (res.data?.success) {
        message.success(editingMonitorId ? 'Monitor updated!' : 'New auto-monitor added!');
        onClose();
        onSaved();
      } else {
        message.error(res.data?.error || 'Failed to save monitor');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setLoadingMonitors(false);
    }
  };

  const handleTestSpintaxInForm = () => {
    const lines = monCommentText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length === 0) {
      message.warning('Please enter at least 1 comment line or Spintax!');
      return;
    }
    const samples: string[] = [];
    for (let i = 0; i < 4; i++) {
      const picked = lines[i % lines.length];
      samples.push(resolveSpintax(picked));
    }
    setSpintaxSampleOutputs(samples);
    message.info('Generated 4 random comment samples from the Spintax!');
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={editingMonitorId ? 'Edit monitor' : 'Add monitor'}
      footer={[
        <Button key="cancel" onClick={onClose}>
          Cancel
        </Button>,
        <Button key="submit" type="primary" loading={loadingMonitors} onClick={handleSaveMonitor}>
          {editingMonitorId ? 'Save changes' : 'Start monitoring'}
        </Button>,
      ]}
      width={560}
      className="dark-modal"
    >
      <div className="space-y-5 py-1 text-slate-200">
        {/* TARGET */}
        <section className="space-y-3">
          <Input
            autoFocus
            size="large"
            placeholder="Paste a Fanpage or Group link"
            value={monTargetUrl}
            onChange={(e) => {
              const url = e.target.value;
              setMonTargetUrl(url);
              if (/facebook\.com\/groups\//i.test(url)) setMonTargetType('GROUP');
              else if (/facebook\.com\//i.test(url) && monTargetType === 'GROUP') setMonTargetType('PAGE');
            }}
          />
          <div className="flex gap-2">
            <Input
              placeholder="Nickname (optional)"
              value={monTargetName}
              onChange={(e) => setMonTargetName(e.target.value)}
              className="flex-1"
            />
            <Select
              value={monTargetType}
              onChange={(val) => setMonTargetType(val)}
              className="w-36"
              options={[
                { value: 'PAGE', label: 'Fanpage' },
                { value: 'GROUP', label: 'Group' },
                { value: 'PROFILE', label: 'Profile' },
              ]}
            />
          </div>
          {monTargetType === 'GROUP' && (
            <div className="text-[11px] text-slate-500">Private group: at least one via must be a member.</div>
          )}
        </section>

        {/* VIP PLAN */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Likes per post</label>
              <InputNumber
                min={5}
                max={500}
                value={monTargetLikes === 'ALL' ? null : monTargetLikes}
                onChange={(v) => setMonTargetLikes(v ? Number(v) : 'ALL')}
                placeholder={`Max ${maxPagesPerPost || 150}`}
                className="!w-full"
              />
              <button
                type="button"
                className={`mt-1 text-[11px] ${monTargetLikes === 'ALL' ? 'text-cyan-400' : 'text-slate-500 hover:text-cyan-400'}`}
                onClick={() => setMonTargetLikes('ALL')}
              >
                {monTargetLikes === 'ALL' ? `✓ Using max ${maxPagesPerPost || 150} pages` : 'Use max'}
              </button>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Posts per day</label>
              <InputNumber
                min={1}
                max={50}
                value={monMaxPostsPerDay}
                onChange={(v) => setMonMaxPostsPerDay(v || 5)}
                className="!w-full"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Duration</label>
              <Select
                value={monExpiryDays}
                onChange={(v) => setMonExpiryDays(v)}
                className="w-full"
                options={[
                  ...([7, 15, 30, 60, 90, 0].includes(monExpiryDays) ? [] : [{ value: monExpiryDays, label: `${monExpiryDays} days left` }]),
                  { value: 7, label: '7 days' },
                  { value: 15, label: '15 days' },
                  { value: 30, label: '30 days' },
                  { value: 60, label: '60 days' },
                  { value: 90, label: '90 days' },
                  { value: 0, label: 'No limit' },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Reaction</label>
              <Select
                value={monReaction}
                onChange={(val) => setMonReaction(val)}
                className="w-full"
                options={[
                  { value: 'RANDOM_POSITIVE', label: 'Like / Love / Care' },
                  { value: 'LIKE', label: 'Like' },
                  { value: 'LOVE', label: 'Love' },
                  { value: 'CARE', label: 'Care' },
                ]}
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Start buffing</label>
              <Select
                value={monDelayMinutes}
                onChange={(val) => setMonDelayMinutes(val)}
                className="w-full"
                options={[
                  { value: 0, label: 'As soon as a post is found' },
                  { value: 3, label: 'After 3 min' },
                  { value: 5, label: 'After 5 min' },
                  { value: 10, label: 'After 10 min' },
                ]}
              />
            </div>
          </div>
        </section>

        {/* ON/OFF OPTIONS */}
        <section className="divide-y divide-slate-800 border-y border-slate-800">
          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <div className="text-sm text-slate-200">Drip-feed likes</div>
              <div className="text-[11px] text-slate-500">Likes trickle in like real people</div>
            </div>
            <div className="flex items-center gap-2">
              {monEnableDripFeed && (
                <InputNumber
                  size="small"
                  min={5}
                  max={120}
                  value={monDripDurationMinutes}
                  onChange={(v) => setMonDripDurationMinutes(v || 20)}
                  addonAfter="min"
                  className="w-28"
                />
              )}
              <Switch checked={monEnableDripFeed} onChange={(checked) => setMonEnableDripFeed(checked)} />
            </div>
          </div>

          <div className="py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-200">Comments</div>
                <div className="text-[11px] text-slate-500">One random comment per page (Spintax)</div>
              </div>
              <Switch checked={monEnableComment} onChange={setMonEnableComment} />
            </div>

            {monEnableComment && (
              <div className="space-y-2 pt-1">
                <Input.TextArea
                  rows={4}
                  value={monCommentText}
                  onChange={(e) => setMonCommentText(e.target.value)}
                  placeholder="One template per line, e.g. {Đẹp quá|Xịn quá} {shop|bạn} ơi"
                  className="font-mono text-xs"
                />
                <div className="flex items-center justify-end gap-3">
                  <Button
                    size="small"
                    type="link"
                    className="!p-0"
                    onClick={() => {
                      const sampleTmpls = SEEDING_NICHE_PRESETS['SALES']?.templates || [];
                      setMonCommentText(sampleTmpls.join('\n'));
                    }}
                  >
                    Use sales template
                  </Button>
                  <Button size="small" onClick={handleTestSpintaxInForm}>
                    Preview
                  </Button>
                </div>

                {spintaxSampleOutputs.length > 0 && (
                  <div className="rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                    {spintaxSampleOutputs.map((s, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs text-slate-300">
                        {s}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ADVANCED */}
        <section>
          <button
            type="button"
            onClick={() => setMonShowAdvanced((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            <CaretRightOutlined className={`text-[10px] transition-transform ${monShowAdvanced ? 'rotate-90' : ''}`} />
            Advanced
            {!monShowAdvanced && (
              <span className="text-slate-600">
                · scan {monInterval}m · ±{monVariancePercent}% · {monViaMode === 'ALL_VIAS' ? 'all vias' : 'first via'}
              </span>
            )}
          </button>
          {monShowAdvanced && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Scan every</label>
                <Select
                  value={monInterval}
                  onChange={(val) => setMonInterval(val)}
                  className="w-full"
                  options={[5, 10, 15, 30, 60].map((m) => ({ value: m, label: `${m} min` }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Like count variance</label>
                <Select
                  value={monVariancePercent}
                  onChange={(v) => setMonVariancePercent(v)}
                  className="w-full"
                  options={[
                    { value: 0, label: 'None' },
                    { value: 5, label: '±5%' },
                    { value: 10, label: '±10%' },
                    { value: 15, label: '±15%' },
                    { value: 20, label: '±20%' },
                  ]}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Acting Via</label>
                <Select
                  value={monViaMode}
                  onChange={(val) => setMonViaMode(val)}
                  className="w-full"
                  options={[
                    { value: 'ALL_VIAS', label: 'All live vias' },
                    { value: 'CUSTOM', label: 'First via' },
                  ]}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
