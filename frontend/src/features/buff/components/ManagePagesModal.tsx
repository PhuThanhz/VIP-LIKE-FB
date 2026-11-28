import { useMemo, useState } from 'react';
import { App, Button, Card, Col, Input, Modal, Row, Segmented, Tag } from 'antd';
import { CheckCircleFilled, DeleteOutlined, IdcardOutlined } from '@ant-design/icons';
import type { FanpageItem } from '../types';
import { extractCUser, extractPageId, getStoredPagesForVia, getViaKey } from '../utils';

export interface ManagePagesModalProps {
  managePagesModalOpen: boolean;
  onClose: () => void;
  fbAccounts: any[];
  targetViaForModal: number | 'CUSTOM';
  setTargetViaForModal: (v: number | 'CUSTOM') => void;
  modalViaAccount: any;
  currentModalPages: FanpageItem[];
  handleSavePagesForTargetVia: (pages: FanpageItem[]) => void;
  handleDeletePageForTargetVia: (pageId: string) => void;
  handleClearPagesForTargetVia: () => void;
}

/** Modal to declare & manage each Via's fixed i_user (Fanpage) list */
export default function ManagePagesModal({
  managePagesModalOpen,
  onClose,
  fbAccounts,
  targetViaForModal,
  setTargetViaForModal,
  modalViaAccount,
  currentModalPages,
  handleSavePagesForTargetVia,
  handleDeletePageForTargetVia,
  handleClearPagesForTargetVia,
}: ManagePagesModalProps) {
  const { modal } = App.useApp();
  const [addMode, setAddMode] = useState<'BULK' | 'SINGLE'>('BULK');
  const [newPageName, setNewPageName] = useState<string>('');
  const [newPageIdOrUrl, setNewPageIdOrUrl] = useState<string>('');
  const [bulkPagesText, setBulkPagesText] = useState<string>('');

  // Parse the Fanpage list from the bulk input box
  const parsedBulkPages = useMemo(() => {
    if (!bulkPagesText.trim()) return [];
    const lines = bulkPagesText.split('\n');
    const results: { pageName: string; platformAccountId: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let id = '';
      let name = '';
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|').map((p) => p.trim());
        const firstIsId = extractPageId(parts[0]);
        const secondIsId = extractPageId(parts[1]);
        if (firstIsId) {
          id = firstIsId;
          name = parts[1] || `Fanpage (${id.slice(-4)})`;
        } else if (secondIsId) {
          id = secondIsId;
          name = parts[0] || `Fanpage (${id.slice(-4)})`;
        }
      } else {
        const extracted = extractPageId(trimmed);
        if (extracted) {
          id = extracted;
          name = `Fanpage (${id.slice(-4)})`;
        }
      }
      if (id && !results.some((r) => r.platformAccountId === id)) {
        results.push({ pageName: name, platformAccountId: id });
      }
    }
    return results;
  }, [bulkPagesText]);

  return (
    <>
      <Modal
        open={managePagesModalOpen}
        onCancel={onClose}
        footer={null}
        width={780}
        centered
        destroyOnHidden={false}
        className="manage-iuser-modal"
        title={
          <div className="flex items-center gap-2.5 pb-2.5 border-b border-slate-800">
            <IdcardOutlined className="text-blue-400 text-xl" />
            <div>
              <div className="font-bold text-base text-slate-100">
                Danh sách Page theo tài khoản
              </div>
              <div className="text-[11px] text-slate-400 font-normal">
                Danh sách Fanpage được lưu theo từng Via, nên luôn đủ Page khi like (không bị rơi page).
              </div>
            </div>
          </div>
        }
      >
        <div className="py-2 space-y-4 text-xs">
          {/* Picker for the Via account to configure */}
          <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
            <div className="text-xs font-bold text-slate-300 mb-2 flex items-center justify-between">
              <span>Chọn tài khoản Via cần cấu hình danh sách i_user:</span>
              <span className="text-[11px] text-blue-400 font-medium">
                (Bấm vào Via để xem và quản lý)
              </span>
            </div>
            <Segmented
              className="bg-slate-900 border border-slate-800 text-xs w-full"
              block
              value={targetViaForModal}
              onChange={(val) => setTargetViaForModal(val as number | 'CUSTOM')}
              options={[
                ...fbAccounts.map((a: any) => {
                  const k = getViaKey(a);
                  const count = getStoredPagesForVia(k).length;
                  return {
                    value: a.id,
                    label: (
                      <div className="flex items-center justify-center gap-1.5 py-1">
                        <span className="font-bold text-slate-200">{a.pageName || a.platformAccountId}</span>
                        <Tag color={count > 0 ? 'blue' : 'default'} className="!m-0 text-[10px] font-mono">
                          {count} Page
                        </Tag>
                      </div>
                    ),
                  };
                }),
                {
                  value: 'CUSTOM',
                  label: (
                    <div className="flex items-center justify-center gap-1.5 py-1">
                      <span className="text-slate-300">Cookie nhập tay</span>
                      <Tag color={getStoredPagesForVia('custom_manual').length > 0 ? 'cyan' : 'default'} className="!m-0 text-[10px] font-mono">
                        {getStoredPagesForVia('custom_manual').length} Page
                      </Tag>
                    </div>
                  ),
                },
              ]}
            />
          </div>

          {/* Banner for the selected Via */}
          <div className="bg-blue-950/30 border border-blue-800/40 rounded-xl p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircleFilled className="text-emerald-400 text-base" />
              <div>
                <div className="text-xs font-bold text-slate-200">
                  Đang cấu hình: <span className="text-blue-400">{modalViaAccount?.pageName || (targetViaForModal === 'CUSTOM' ? 'Cookie nhập tay' : 'Facebook Via')}</span>
                  {modalViaAccount && (
                    <span className="font-mono text-[10px] text-slate-400 ml-2">
                      (c_user: {extractCUser(modalViaAccount.cookieString || modalViaAccount.accessToken) || 'N/A'})
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Via này hiện có <b className="font-bold text-emerald-400">{currentModalPages.length} Fanpage</b> đã lưu.
                </div>
              </div>
            </div>
          </div>

          {/* Add Page card */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 uppercase tracking-wide text-xs">
                Thêm i_user (Fanpage) cho Via này:
              </span>
              <Segmented
                size="small"
                value={addMode}
                onChange={(val) => setAddMode(val as 'BULK' | 'SINGLE')}
                options={[
                  { label: 'Dán hàng loạt', value: 'BULK' },
                  { label: 'Từng cái một', value: 'SINGLE' },
                ]}
                className="bg-slate-900 border border-slate-800 text-xs"
              />
            </div>

            {addMode === 'BULK' ? (
              <div className="space-y-2">
                <label className="block text-slate-400">
                  Dán ID i_user hoặc link Page (mỗi dòng một Page, định dạng <code className="text-blue-400 font-mono">ID | Tên Page</code>):
                </label>
                <Input.TextArea
                  rows={4}
                  value={bulkPagesText}
                  onChange={(e) => setBulkPagesText(e.target.value)}
                  placeholder={`61589245661782 | Làm Phước Hai\n467447130112806 | Làm Gì Mà Gấp\n61568697241127 | Đại Sảnh Pickleball\n61584834510803 | Làm Sen\n61594279329518 | Nexa 24h\n100091144747972 | Phú Order Hàng Nhật\n61551923480422 | Đại Sảnh Liên Minh Huyền Thoại`}
                  className="font-mono text-xs rounded-xl bg-slate-900 border-slate-800 text-slate-100 placeholder:text-slate-500"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Nhận diện được: <b className="text-emerald-400 font-bold">{parsedBulkPages.length}</b> Fanpage hợp lệ
                  </span>
                  <Button
                    type="primary"
                    size="middle"
                    disabled={parsedBulkPages.length === 0}
                    onClick={() => {
                      const pagesToAdd: FanpageItem[] = parsedBulkPages.map((p) => ({
                        id: p.platformAccountId,
                        name: p.pageName,
                        url: `https://www.facebook.com/profile.php?id=${p.platformAccountId}`,
                      }));
                      handleSavePagesForTargetVia(pagesToAdd);
                      setBulkPagesText('');
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Lưu {parsedBulkPages.length} Page vào Via này
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Row gutter={10}>
                  <Col span={10}>
                    <label className="block text-slate-400 mb-1">Tên Fanpage (không bắt buộc):</label>
                    <Input
                      placeholder="e.g. Làm Sen"
                      value={newPageName}
                      onChange={(e) => setNewPageName(e.target.value)}
                      className="rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                  <Col span={14}>
                    <label className="block text-slate-400 mb-1">ID Fanpage / i_user (hoặc link):</label>
                    <Input
                      placeholder="VD: 61584834510803 hoặc link Facebook"
                      value={newPageIdOrUrl}
                      onChange={(e) => setNewPageIdOrUrl(e.target.value)}
                      className="font-mono rounded-xl text-xs bg-slate-900 border-slate-800 text-slate-100"
                    />
                  </Col>
                </Row>
                <div className="flex justify-end">
                  <Button
                    type="primary"
                    disabled={!extractPageId(newPageIdOrUrl)}
                    onClick={() => {
                      const id = extractPageId(newPageIdOrUrl);
                      if (id) {
                        const newPage: FanpageItem = {
                          id,
                          name: newPageName.trim() || `Fanpage (${id.slice(-4)})`,
                          url: `https://www.facebook.com/profile.php?id=${id}`,
                        };
                        handleSavePagesForTargetVia([newPage]);
                        setNewPageName('');
                        setNewPageIdOrUrl('');
                      }
                    }}
                    className="bg-blue-600 hover:bg-blue-500 font-bold rounded-xl border-none"
                  >
                    Thêm Fanpage này
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* The Via's current Pages */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-slate-200">
                Fanpage đã lưu ({currentModalPages.length} Page):
              </span>
              <div className="flex items-center gap-2">
                {currentModalPages.length > 0 && (
                  <Button
                    type="link"
                    danger
                    size="small"
                    onClick={handleClearPagesForTargetVia}
                    className="text-[11px] !p-0 !h-auto"
                  >
                    Xóa hết để dán lại
                  </Button>
                )}
                <span className="text-[11px] text-slate-400">
                  (Lưu vĩnh viễn trên máy này)
                </span>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 border border-slate-800 rounded-xl p-2 bg-slate-950/60">
              {currentModalPages.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  Via này chưa có Fanpage nào. Dán danh sách ở trên để lưu!
                </div>
              ) : (
                currentModalPages.map((page, idx) => (
                  <div
                    key={page.id}
                    className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 hover:bg-slate-850 transition-colors border border-slate-800/80"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-300 grid place-items-center text-[10px] font-bold">
                        {idx + 1}
                      </span>
                      <span className="font-bold text-slate-200 truncate max-w-[280px]" title={page.name}>
                        {page.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-blue-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                        i_user: {page.id}
                      </span>
                      <Button
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeletePageForTargetVia(page.id)}
                        className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                        title="Gỡ Fanpage này khỏi Via"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
