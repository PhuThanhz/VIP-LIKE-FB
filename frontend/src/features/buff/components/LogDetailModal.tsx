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
          Đóng
        </Button>,
        selectedLogDetail && (
          <Button
            key="buff-again"
            type="primary"
            className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl"
            onClick={() => onReuse(selectedLogDetail)}
          >
            Nạp bài này để buff tiếp
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
              Chi tiết lịch sử
            </div>
            <div className="text-[11px] text-slate-400 font-normal">
              Thời gian:{' '}
              <span className="font-mono text-slate-300">
                {selectedLogDetail ? new Date(selectedLogDetail.createdAt).toLocaleString('vi-VN') : ''}
              </span>{' '}
              • Chế độ:{' '}
              <span className="font-semibold text-blue-400">
                {selectedLogDetail?.type === 'QUEUE'
                  ? 'Hàng đợi tự động'
                  : selectedLogDetail?.type === 'BATCH'
                  ? 'Hàng loạt'
                  : 'Đơn lẻ'}
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
              <span className="font-bold text-slate-200">Link bài viết:</span>
              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => {
                    navigator.clipboard.writeText(selectedLogDetail.targetUrl);
                    message.success('Đã sao chép link!');
                  }}
                  className="text-xs"
                >
                  Sao chép
                </Button>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<ExportOutlined />}
                  onClick={() => window.open(selectedLogDetail.targetUrl, '_blank')}
                  className="text-xs"
                >
                  Mở Facebook
                </Button>
              </div>
            </div>
            <div className="font-mono text-blue-400 break-all bg-slate-900 p-2 rounded-lg border border-slate-800">
              {selectedLogDetail.targetUrl}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-slate-500">Cảm xúc:</span>
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
                  <span className="text-slate-500">Tài khoản gốc:</span>
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
              <div className="text-[10px] text-slate-500 font-bold uppercase">Tổng số Page</div>
              <div className="text-lg font-semibold text-slate-100">{counts.total}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-center">
              <div className="text-[10px] text-emerald-400 font-bold uppercase">Thành công</div>
              <div className="text-lg font-semibold text-emerald-400">{counts.success}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60 text-center">
              <div className="text-[10px] text-blue-400 font-bold uppercase">Đã like trước</div>
              <div className="text-lg font-semibold text-blue-400">{counts.alreadyLiked}</div>
            </div>
            <div className="p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-center">
              <div className="text-[10px] text-rose-400 font-bold uppercase">Thất bại / Lỗi</div>
              <div className="text-lg font-semibold text-rose-400">{counts.failed}</div>
              {counts.unverified + counts.skipped > 0 && (
                <div className="text-[10px] text-slate-400">
                  {counts.unverified > 0 && `${counts.unverified} unverified`}
                  {counts.unverified > 0 && counts.skipped > 0 && ' • '}
                  {counts.skipped > 0 && `${counts.skipped} bỏ qua / dừng`}
                </div>
              )}
            </div>
          </div>
            );
          })()}

          {/* Detailed Table of Pages */}
          <div className="space-y-2">
            <div className="font-bold text-slate-200 flex items-center justify-between">
              <span>Chi tiết từng Fanpage ({selectedLogDetail.details.length} Page):</span>
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 border border-slate-800 rounded-xl p-2 bg-slate-950/50">
              {selectedLogDetail.details.map((detail, idx) => {
                let statusTag: ReactNode;
                if (detail.status === 'SUCCESS') {
                  statusTag = <Tag color="success" icon={<CheckCircleFilled />}>Thành công</Tag>;
                } else if (detail.status === 'ALREADY_LIKED') {
                  statusTag = <Tag color="blue" icon={<CheckOutlined />}>Đã like trước</Tag>;
                } else if (detail.status === 'NO_BUTTON') {
                  statusTag = <Tag color="warning">Không tìm thấy nút Like</Tag>;
                } else if (detail.status === 'ERROR') {
                  statusTag = <Tag color="error" icon={<CloseCircleFilled />}>Lỗi</Tag>;
                } else if (detail.status === 'UNVERIFIED') {
                  statusTag = <Tag color="gold">Chưa xác minh</Tag>;
                } else if (detail.status === 'SKIPPED') {
                  statusTag = <Tag color="default">Bỏ qua / Dừng</Tag>;
                } else {
                  statusTag = <Tag color="default">Chưa chạy</Tag>;
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
