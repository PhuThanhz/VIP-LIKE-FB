import React, { type ReactNode } from 'react';
import { Modal, Button, Tag, App } from 'antd';
import {
  HistoryOutlined,
  CopyOutlined,
  ExportOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseCircleFilled,
} from '@ant-design/icons';
import type { BuffLogEntry } from '../types';
import { REACTIONS } from '../constants';
import { getLogCounts } from '../utils';

export interface LogDetailModalProps {
  log: BuffLogEntry | null;
  onClose: () => void;
  onReuse: (log: BuffLogEntry) => void;
}

export default function LogDetailModal({ log, onClose, onReuse }: LogDetailModalProps) {
  const { message } = App.useApp();
  const selectedLogDetail = log;

  return (
    <Modal
      open={!!selectedLogDetail}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose} className="rounded-xl">
          Close
        </Button>,
        selectedLogDetail && (
          <Button
            key="buff-again"
            type="primary"
            className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl"
            onClick={() => onReuse(selectedLogDetail)}
          >
            Load this post to keep buffing
          </Button>
        ),
      ]}
      width={760}
      centered
      destroyOnHidden
      title={
        <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
          <HistoryOutlined className="text-blue-400 text-lg" />
          <div>
            <div className="font-bold text-base text-slate-100">
              History details
            </div>
            <div className="text-[11px] text-slate-400 font-normal">
              Time:{' '}
              <span className="font-mono text-slate-300">
                {selectedLogDetail ? new Date(selectedLogDetail.createdAt).toLocaleString('vi-VN') : ''}
              </span>{' '}
              • Mode:{' '}
              <span className="font-semibold text-blue-400">
                {selectedLogDetail?.type === 'QUEUE'
                  ? 'Auto queue (Queue)'
                  : selectedLogDetail?.type === 'BATCH'
                  ? 'Bulk (Batch)'
                  : 'Single'}
              </span>
            </div>
          </div>
        </div>
      }
    >
      {selectedLogDetail && (
        <div className="py-2 space-y-4 text-xs">
          {/* Target Post Info */}
          <div className="p-3.5 bg-slate-950/50 border border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200">Target post link:</span>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(selectedLogDetail.targetUrl);
                    message.success('Link copied!');
                  }}
                  className="text-xs"
                >
                  Copy
                </Button>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ExportOutlined />}
                  onClick={() => window.open(selectedLogDetail.targetUrl, '_blank')}
                  className="text-xs"
                >
                  Open Facebook
                </Button>
              </div>
            </div>
            <div className="font-mono text-blue-400 break-all bg-slate-900 p-2 rounded-lg border border-slate-800">
              {selectedLogDetail.targetUrl}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-slate-500">Reaction:</span>
              {(() => {
                const rObj = REACTIONS.find((r) => r.key === selectedLogDetail.reactionType) || REACTIONS[0];
                return (
                  <Tag className="font-bold">
                    {rObj.emoji} {rObj.label}
                  </Tag>
                );
              })()}
              {selectedLogDetail.accountName && (
                <>
                  <span className="text-slate-400">•</span>
                  <span className="text-slate-500">Parent account:</span>
                  <Tag color="cyan">{selectedLogDetail.accountName}</Tag>
                </>
              )}
            </div>
          </div>

          {/* Quick Metrics */}
          {(() => {
            const counts = getLogCounts(selectedLogDetail);
            return (
          <div className="grid grid-cols-4 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
              <div className="text-[10px] text-slate-500 font-bold uppercase">Total Pages</div>
              <div className="text-lg font-semibold text-slate-100">{counts.total}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-center">
              <div className="text-[10px] text-emerald-400 font-bold uppercase">Success</div>
              <div className="text-lg font-semibold text-emerald-400">{counts.success}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60 text-center">
              <div className="text-[10px] text-blue-400 font-bold uppercase">Already Liked</div>
              <div className="text-lg font-semibold text-blue-400">{counts.alreadyLiked}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-center">
              <div className="text-[10px] text-rose-400 font-bold uppercase">Failed / Error</div>
              <div className="text-lg font-semibold text-rose-400">{counts.failed}</div>
              {counts.unverified + counts.skipped > 0 && (
                <div className="text-[10px] text-slate-400">
                  {counts.unverified > 0 && `${counts.unverified} unverified`}
                  {counts.unverified > 0 && counts.skipped > 0 && ' • '}
                  {counts.skipped > 0 && `${counts.skipped} skipped / stopped`}
                </div>
              )}
            </div>
          </div>
            );
          })()}

          {/* Detailed Table of Pages */}
          <div className="space-y-2">
            <div className="font-bold text-slate-200 flex items-center justify-between">
              <span>Per-Fanpage details ({selectedLogDetail.details.length} Pages):</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-2 bg-slate-950/50">
              {selectedLogDetail.details.map((detail, idx) => {
                let statusTag: ReactNode;
                if (detail.status === 'SUCCESS') {
                  statusTag = <Tag color="success" icon={<CheckCircleFilled />}>Success</Tag>;
                } else if (detail.status === 'ALREADY_LIKED') {
                  statusTag = <Tag color="blue" icon={<CheckOutlined />}>Already liked</Tag>;
                } else if (detail.status === 'NO_BUTTON') {
                  statusTag = <Tag color="warning">Like button not found</Tag>;
                } else if (detail.status === 'ERROR') {
                  statusTag = <Tag color="error" icon={<CloseCircleFilled />}>Error</Tag>;
                } else if (detail.status === 'UNVERIFIED') {
                  statusTag = <Tag color="gold">Unverified</Tag>;
                } else if (detail.status === 'SKIPPED') {
                  statusTag = <Tag color="default">Skipped / Stopped</Tag>;
                } else {
                  statusTag = <Tag color="default">Not run</Tag>;
                }

                return (
                  <div
                    key={detail.pageId + idx}
                    className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-bold text-slate-400 font-mono text-[10px]">#{idx + 1}</span>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-100 truncate">{detail.pageName}</div>
                        {detail.commentText && (
                          <div className="text-[11px] text-blue-400 italic truncate max-w-[320px] font-medium">
                            "{detail.commentText}"
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-slate-400">ID: {detail.pageId}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {detail.message && (
                        <span className="text-[11px] text-slate-400 hidden sm:inline truncate max-w-[200px]" title={detail.message}>
                          {detail.message}
                        </span>
                      )}
                      {statusTag}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
