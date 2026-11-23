import React from 'react';
import { Button, InputNumber, Modal, Select } from 'antd';
import { RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';

export interface ResumeBuffModalProps {
  resumeModalOpen: boolean;
  onClose: () => void;
  resumeTargetUrl: string;
  resumeDoneLikes: number;
  resumeTargetLikes: number;
  resumeMissingLikes: number;
  setResumeMissingLikes: React.Dispatch<React.SetStateAction<number>>;
  resumeReaction: string;
  setResumeReaction: React.Dispatch<React.SetStateAction<string>>;
  isResumingRemaining: boolean;
  handleConfirmResume: () => void | Promise<void>;
}

/** Modal xác nhận chạy tiếp / bù like cho bài còn thiếu */
export default function ResumeBuffModal({
  resumeModalOpen,
  onClose,
  resumeTargetUrl,
  resumeDoneLikes,
  resumeTargetLikes,
  resumeMissingLikes,
  setResumeMissingLikes,
  resumeReaction,
  setResumeReaction,
  isResumingRemaining,
  handleConfirmResume,
}: ResumeBuffModalProps) {
  return (
    <>
      {/* MODAL: XÁC NHẬN CHẠY TIẾP / BÙ LIKE */}
      <Modal
        open={resumeModalOpen}
        onCancel={() => onClose()}
        title={
          <div className="flex items-center gap-2 text-base font-bold text-slate-100 pb-2 border-b border-slate-800">
            <ThunderboltOutlined className="text-cyan-400 text-lg" />
            <span>Tiếp Tục Chạy Thêm Like Cho Bài Viết</span>
          </div>
        }
        footer={[
          <Button key="cancel" onClick={() => onClose()} className="rounded-xl text-slate-300 border-slate-700">
            Hủy
          </Button>,
          <Button
            key="submit"
            type="primary"
            icon={<RocketOutlined />}
            loading={isResumingRemaining}
            onClick={handleConfirmResume}
            className="rounded-xl font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 border-none shadow-md shadow-cyan-600/20"
          >
            Xác Nhận Buff Thêm {resumeMissingLikes} Like
          </Button>,
        ]}
        width={560}
        className="dark-modal"
      >
        <div className="space-y-4 py-2">
          <div className="app-surface p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="text-[11px] text-slate-400">Link bài viết mục tiêu:</div>
            <div className="text-xs font-mono text-cyan-300 break-all select-all bg-slate-900/60 p-2 rounded-lg border border-slate-800/80">
              {resumeTargetUrl}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-800 text-center">
                <div className="text-[11px] text-slate-400">Đã Like thành công</div>
                <div className="text-lg font-bold text-emerald-400">{resumeDoneLikes} lượt</div>
              </div>
              <div className="bg-slate-900/50 p-2.5 rounded-lg border border-slate-800 text-center">
                <div className="text-[11px] text-slate-400">Mục tiêu chiến dịch</div>
                <div className="text-lg font-bold text-slate-200">{resumeTargetLikes} lượt</div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Số Like cần chạy thêm:</span>
              <span className="text-[11px] text-slate-400">
                (Thiếu <b className="text-amber-400">{Math.max(0, resumeTargetLikes - resumeDoneLikes)}</b> so với mục tiêu ban đầu)
              </span>
            </label>
            <div className="flex items-center gap-3">
              <InputNumber
                min={1}
                max={500}
                value={resumeMissingLikes}
                onChange={(val) => setResumeMissingLikes(val || 1)}
                className="w-full h-11 text-base font-bold rounded-xl"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-[11px] text-slate-500">Gợi ý nhanh:</span>
              {[
                { label: `Bù đủ (${Math.max(1, resumeTargetLikes - resumeDoneLikes)})`, val: Math.max(1, resumeTargetLikes - resumeDoneLikes) },
                { label: '+30 like', val: 30 },
                { label: '+50 like', val: 50 },
                { label: '+100 like', val: 100 },
              ].map((btn, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setResumeMissingLikes(btn.val)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Cảm xúc tương tác:</label>
            <Select
              value={resumeReaction}
              onChange={setResumeReaction}
              className="w-full h-10"
              options={[
                { value: 'LIKE', label: '👍 Thích (Like)' },
                { value: 'LOVE', label: '❤️ Yêu thích (Love)' },
                { value: 'CARE', label: '🥰 Thương thương (Care)' },
                { value: 'HAHA', label: '😆 Haha' },
                { value: 'WOW', label: '😮 Wow' },
                { value: 'RANDOM_POSITIVE', label: 'Ngẫu nhiên tích cực (Like/Love/Care/Haha)' },
              ]}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
