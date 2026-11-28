import React from 'react';
import { Modal, Button, Tag } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';

export interface ViaHealthModalProps {
  open: boolean;
  results: any[];
  onClose: () => void;
}

export default function ViaHealthModal({ open, results, onClose }: ViaHealthModalProps) {
  const viaHealthResults = results || [];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div className="flex items-center gap-2 text-base font-bold text-slate-100 pb-2 border-b border-slate-800">
          <SafetyCertificateOutlined className="text-emerald-400 text-lg" />
          <span>Báo cáo sức khỏe Via Facebook (Live/Die)</span>
        </div>
      }
      footer={[
        <Button key="close" type="primary" onClick={onClose} className="rounded-xl">
          Đóng
        </Button>,
      ]}
      width={720}
      className="dark-modal"
    >
      <div className="space-y-4 py-2 text-slate-200">
        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
          <span>Số via đã kiểm tra: <strong className="text-slate-100">{viaHealthResults.length}</strong></span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            Hoạt động: {viaHealthResults.filter((r) => r.isLive).length}
          </span>
          <span className="inline-flex items-center gap-1.5 text-rose-400 font-semibold">
            <span className="w-2 h-2 rounded-full bg-rose-400"></span>
            Lỗi / Hết hạn: {viaHealthResults.filter((r) => !r.isLive).length}
          </span>
        </div>

        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {viaHealthResults.map((v, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                v.isLive
                  ? 'bg-slate-900/80 border-emerald-800/40'
                  : 'bg-rose-950/20 border-rose-800/40'
              }`}
            >
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100">{v.viaName || `Via ${v.uid}`}</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                    v.isLive
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${v.isLive ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                    {v.isLive ? 'LIVE' : v.status === 'CHECKPOINT' ? 'CHECKPOINT' : 'EXPIRED'}
                  </span>
                  {v.proxyUrl && (
                    <Tag color="purple" className="text-[10px] font-mono">
                      Proxy: {v.proxyUrl.split('@').pop() || 'Riêng'}
                    </Tag>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 font-mono">UID: {v.uid || 'N/A'} {v.name && `· Tên Facebook: ${v.name}`}</div>
                {v.error && <div className="text-[11px] text-rose-400">{v.error}</div>}
              </div>
              <div className="shrink-0 text-right text-[11px] text-slate-500 font-mono">
                {new Date(v.checkedAt).toLocaleTimeString('vi-VN')}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
