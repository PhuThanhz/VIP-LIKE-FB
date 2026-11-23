import React, { useState } from 'react';
import { App } from 'antd';
import { Button, Input, Modal, Select } from 'antd';
import { EditOutlined, ReloadOutlined, RobotOutlined, SafetyCertificateOutlined, ThunderboltFilled } from '@ant-design/icons';
import { SEEDING_NICHE_PRESETS } from '../constants';
import { resolveSpintax } from '../utils';

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export interface AiSeedingModalProps {
  aiStudioModalOpen: boolean;
  onClose: () => void;
  selectedNiche: string;
  setSelectedNiche: SetState<string>;
  commentListText: string;
  setCommentListText: SetState<string>;
  parsedCommentLines: string[];
  aiPostPrompt: string;
  setAiPostPrompt: SetState<string>;
  aiTone: string;
  setAiTone: SetState<string>;
  aiCount: number;
  setAiCount: SetState<number>;
  isAiGeneratingComments: boolean;
  handleGenerateAiComments: () => void | Promise<void>;
}

/** Studio AI Seeding & Spintax: chọn kịch bản theo ngành, sinh bình luận bằng AI */
export default function AiSeedingModal({
  aiStudioModalOpen,
  onClose,
  selectedNiche,
  setSelectedNiche,
  commentListText,
  setCommentListText,
  parsedCommentLines,
  aiPostPrompt,
  setAiPostPrompt,
  aiTone,
  setAiTone,
  aiCount,
  setAiCount,
  isAiGeneratingComments,
  handleGenerateAiComments,
}: AiSeedingModalProps) {
  const { message } = App.useApp();
  const [previewSamples, setPreviewSamples] = useState<string[]>([]);

  return (
    <>
      {/* MODAL: AI SEEDING STUDIO & SPINTAX ENGINE */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-white font-semibold text-base sm:text-lg">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-on-accent">
              <RobotOutlined className="text-base" />
            </div>
            <div>
              <div>AI SEEDING STUDIO & BỘ TRỘN SPINTAX</div>
              <div className="text-[11px] font-normal text-slate-400">
                Sinh bình luận tự nhiên theo ngành hàng, chống trùng lặp và né thuật toán quét bot của Meta.
              </div>
            </div>
          </div>
        }
        open={aiStudioModalOpen}
        onCancel={() => onClose()}
        footer={null}
        width={780}
        centered
        className="dark-modal"
        styles={{
          body: {
            backgroundColor: 'var(--modal-bg)',
            color: 'var(--text-strong)',
          },
          header: {
            backgroundColor: 'var(--modal-bg)',
            borderBottom: '1px solid var(--border)',
          },
        }}
      >
        <div className="space-y-4 pt-3 text-xs sm:text-sm">
          {/* 1. Chọn Ngành Nghề / Niche */}
          <div className="space-y-2">
            <label className="font-bold text-slate-300 block">Chủ đề bài viết:</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {Object.entries(SEEDING_NICHE_PRESETS).map(([key, item]) => {
                const isSelected = selectedNiche === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setSelectedNiche(key);
                      setPreviewSamples(item.templates.map(resolveSpintax));
                    }}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2 ${
                      isSelected
                        ? 'bg-blue-600/30 border-blue-500 text-white'
                        : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                    }`}
                  >
                    <span className="font-bold text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 1.1 Nhập ngữ cảnh bài viết & Phong cách AI */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div>
              <label className="font-bold text-slate-300 block mb-1">
                Nội dung / Tóm tắt bài viết (AI đọc ngữ cảnh):
              </label>
              <Input.TextArea
                rows={2}
                placeholder="Dán tiêu đề, giá bán, hoặc thông tin bài viết (VD: Áo polo nam cotton 199k freeship toàn quốc)..."
                value={aiPostPrompt}
                onChange={(e) => setAiPostPrompt(e.target.value)}
                className="bg-slate-950/70 border-slate-700 text-slate-100 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Phong cách bình luận (Tone):
                </label>
                <Select
                  size="small"
                  value={aiTone}
                  onChange={setAiTone}
                  className="w-full text-xs"
                  options={[
                    { value: 'customer_inquiry', label: 'Khách hỏi mua / Tư vấn (Size, ship, giá)' },
                    { value: 'enthusiastic', label: 'Khen ngợi / Đánh giá 5 sao (Đẹp, ưng ý)' },
                    { value: 'expert', label: 'Hào hứng / Thảo luận (Đồng tình, chia sẻ)' },
                    { value: 'natural', label: 'Tự nhiên tổng hợp (Đa góc nhìn)' },
                  ]}
                />
              </div>
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Số lượng bình luận cần tạo:
                </label>
                <Select
                  size="small"
                  value={aiCount}
                  onChange={setAiCount}
                  className="w-full text-xs"
                  options={[
                    { value: 10, label: '10 bình luận' },
                    { value: 15, label: '15 bình luận' },
                    { value: 20, label: '20 bình luận' },
                    { value: 30, label: '30 bình luận' },
                  ]}
                />
              </div>
            </div>
          </div>

          {/* 2. Mẫu Cấu Trúc Spintax Gốc */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">
                Cấu trúc Spintax gốc của ngành "{SEEDING_NICHE_PRESETS[selectedNiche]?.label}":
              </span>
              <span className="text-[11px] text-slate-500 font-mono">Cú pháp: {'{A|B|C} {D|E}'}</span>
            </div>
            <div className="space-y-1 font-mono text-[11px] text-blue-300 max-h-36 overflow-y-auto pr-1">
              {SEEDING_NICHE_PRESETS[selectedNiche]?.templates.map((tmpl, idx) => (
                <div key={idx} className="p-1.5 rounded bg-slate-900/80 border border-slate-800/80">
                  {tmpl}
                </div>
              ))}
            </div>
          </div>

          {/* 3. Live Spintax Tester */}
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-bold text-blue-300 flex items-center gap-1.5 text-xs">
                <ThunderboltFilled className="text-amber-400" />
                Kết quả thực tế khi Bot đi bình luận (Đã xoay Spintax ngẫu nhiên):
              </span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  setPreviewSamples(tmpls.map(resolveSpintax));
                  message.info('Đã xoay biến thể Spintax mới!');
                }}
                className="text-[11px] bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
              >
                Xoay Thử Lại
              </Button>
            </div>

            <div className="space-y-1.5">
              {previewSamples.map((sample, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-2 p-2 rounded-lg bg-slate-900/60 border border-slate-800/60 text-slate-200 text-xs"
                >
                  <span className="text-[10px] font-bold text-blue-400 shrink-0 select-none">#{idx + 1}</span>
                  <span className="flex-1">{sample}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 3.5. Soạn thảo & Danh sách câu bình luận áp dụng thực tế */}
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <EditOutlined className="text-cyan-400" />
                Danh sách câu bình luận áp dụng ({parsedCommentLines.length} câu):
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Mỗi dòng một câu</span>
                {commentListText.trim() && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setCommentListText('');
                      message.info('Đã xóa trắng danh sách bình luận');
                    }}
                    className="text-[11px] p-0 h-auto"
                  >
                    Xóa trắng
                  </Button>
                )}
              </div>
            </div>
            <Input.TextArea
              rows={4}
              value={commentListText}
              onChange={(e) => setCommentListText(e.target.value)}
              placeholder="Bạn có thể dán hoặc tự gõ thêm các câu bình luận riêng tại đây (mỗi dòng một câu)..."
              className="font-sans text-xs bg-slate-900 border-slate-700 text-slate-100 rounded-xl placeholder:text-slate-500"
            />
          </div>

          {/* 4. Hành động Nạp Vào Chiến Dịch */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <SafetyCertificateOutlined className="text-emerald-400" />
              <span>Bảo vệ tài khoản: 100% các Via sẽ bình luận nội dung khác nhau.</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => onClose()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Hoàn tất &amp; Đóng
              </Button>
              <Button
                icon={<RobotOutlined spin={isAiGeneratingComments} />}
                loading={isAiGeneratingComments}
                onClick={async () => {
                  await handleGenerateAiComments();
                  onClose();
                }}
                className="bg-blue-600 hover:bg-blue-500 text-on-accent font-bold rounded-xl text-xs h-9 border-none"
              >
                Tạo bằng AI theo link bài
              </Button>

              <Button
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Sinh 10 biến thể Spintax ngẫu nhiên
                  const generated: string[] = [];
                  for (let i = 0; i < 12; i++) {
                    const t = tmpls[i % tmpls.length];
                    generated.push(resolveSpintax(t));
                  }
                  const existingLines = commentListText.split('\n').filter((s) => s.trim());
                  setCommentListText([...existingLines, ...generated].join('\n'));
                  onClose();
                  message.success(`Đã nối thêm ${generated.length} bình luận vào danh sách!`);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Thêm vào cuối
              </Button>

              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Dùng trực tiếp các câu Spintax nguyên bản để bot tự xoay ở mỗi lượt cmt
                  setCommentListText(tmpls.join('\n'));
                  onClose();
                  message.success(`Đã nạp toàn bộ kịch bản Spintax chuẩn của "${SEEDING_NICHE_PRESETS[selectedNiche]?.label}"!`);
                }}
                className="bg-blue-600 hover:bg-blue-500 border-none font-bold rounded-xl text-xs h-9"
              >
                Thay toàn bộ
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
