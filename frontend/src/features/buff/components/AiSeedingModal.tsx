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

/** AI Seeding & Spintax studio: pick an industry script, generate comments with AI */
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
              <div>AI SEEDING STUDIO & SPINTAX MIXER</div>
              <div className="text-[11px] font-normal text-slate-400">
                Tạo bình luận tự nhiên theo ngành, tránh trùng lặp và tránh bị Meta quét bot.
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
          {/* 1. Choose industry / niche */}
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

          {/* 1.1 Post context & AI tone */}
          <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2.5">
            <div>
              <label className="font-bold text-slate-300 block mb-1">
                Nội dung / tóm tắt bài (AI đọc ngữ cảnh):
              </label>
              <Input.TextArea
                rows={2}
                placeholder="Dán tiêu đề, giá hoặc chi tiết bài (VD: Áo polo nam cotton 199k, freeship toàn quốc)..."
                value={aiPostPrompt}
                onChange={(e) => setAiPostPrompt(e.target.value)}
                className="bg-slate-950/70 border-slate-700 text-slate-100 text-xs rounded-xl"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Giọng bình luận:
                </label>
                <Select
                  size="small"
                  value={aiTone}
                  onChange={setAiTone}
                  className="w-full text-xs"
                  options={[
                    { value: 'customer_inquiry', label: 'Hỏi mua / Tư vấn (size, ship, giá)' },
                    { value: 'enthusiastic', label: 'Khen / Đánh giá 5 sao (đẹp, hài lòng)' },
                    { value: 'expert', label: 'Hào hứng / Thảo luận (đồng tình, chia sẻ)' },
                    { value: 'natural', label: 'Trộn tự nhiên (nhiều góc nhìn)' },
                  ]}
                />
              </div>
              <div>
                <label className="font-semibold text-slate-400 block mb-1 text-xs">
                  Số bình luận cần tạo:
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

          {/* 2. Base Spintax template */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">
                Spintax gốc cho ngành "{SEEDING_NICHE_PRESETS[selectedNiche]?.label}":
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
                Kết quả thực tế khi bot bình luận (Spintax trộn ngẫu nhiên):
              </span>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  setPreviewSamples(tmpls.map(resolveSpintax));
                  message.info('Đã trộn ra biến thể Spintax mới!');
                }}
                className="text-[11px] bg-slate-900 border-slate-700 text-slate-300 hover:text-white"
              >
                Trộn lại
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

          {/* 3.5. Edit & list of comments actually used */}
          <div className="space-y-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <EditOutlined className="text-cyan-400" />
                Bình luận đang dùng ({parsedCommentLines.length}):
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">Mỗi dòng một bình luận</span>
                {commentListText.trim() && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={() => {
                      setCommentListText('');
                      message.info('Đã xóa danh sách bình luận');
                    }}
                    className="text-[11px] p-0 h-auto"
                  >
                    Xóa
                  </Button>
                )}
              </div>
            </div>
            <Input.TextArea
              rows={4}
              value={commentListText}
              onChange={(e) => setCommentListText(e.target.value)}
              placeholder="Bạn có thể dán hoặc gõ bình luận của mình ở đây (mỗi dòng một bình luận)..."
              className="font-sans text-xs bg-slate-900 border-slate-700 text-slate-100 rounded-xl placeholder:text-slate-500"
            />
          </div>

          {/* 4. Load into campaign actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <SafetyCertificateOutlined className="text-emerald-400" />
              <span>Bảo vệ tài khoản: mỗi Via sẽ đăng một bình luận khác nhau.</span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                onClick={() => onClose()}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Xong &amp; Đóng
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
                Tạo bằng AI từ link bài viết
              </Button>

              <Button
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Generate 10 random Spintax variants
                  const generated: string[] = [];
                  for (let i = 0; i < 12; i++) {
                    const t = tmpls[i % tmpls.length];
                    generated.push(resolveSpintax(t));
                  }
                  const existingLines = commentListText.split('\n').filter((s) => s.trim());
                  setCommentListText([...existingLines, ...generated].join('\n'));
                  onClose();
                  message.success(`Đã thêm ${generated.length} bình luận vào danh sách!`);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 font-semibold rounded-xl text-xs h-9"
              >
                Thêm vào
              </Button>

              <Button
                type="primary"
                icon={<ThunderboltFilled />}
                onClick={() => {
                  const tmpls = SEEDING_NICHE_PRESETS[selectedNiche]?.templates || [];
                  // Use the raw Spintax lines so the bot spins them on every comment
                  setCommentListText(tmpls.join('\n'));
                  onClose();
                  message.success(`Đã nạp kịch bản Spintax chuẩn cho "${SEEDING_NICHE_PRESETS[selectedNiche]?.label}"!`);
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
