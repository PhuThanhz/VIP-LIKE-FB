import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Card,
  Button,
  Tag,
  App,
  Row,
  Col,
  Checkbox,
  Progress,
  Modal,
  Input,
  InputNumber,
  Segmented,
  Tooltip,
  Badge,
  Table,
  Upload,
  Divider,
  Space,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PictureOutlined,
  CloudUploadOutlined,
  ScanOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  SyncOutlined,
  StopOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  UserOutlined,
  ThunderboltFilled,
  SettingOutlined,
  EyeOutlined,
  DeleteOutlined,
  PlusOutlined,
  LinkOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  CheckOutlined,
  ReloadOutlined,
  FireOutlined,
  SafetyCertificateOutlined,
  CompassOutlined,
  CrownOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import api from '../config/axios';

const WORKER_BASE_URL =
  import.meta.env.VITE_WORKER_BASE_URL ||
  `http://${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}:3100`;

interface ChildPageItem {
  id: number | string;
  platformAccountId: string;
  pageName: string;
  platform: string;
  accountType?: string;
  tokenStatus?: string;
  proxyUrl?: string;
}

interface MotherViaItem {
  uid: string;
  viaName: string;
  cookieString: string;
  proxyUrl: string;
  tokenStatus: string;
  pages: ChildPageItem[];
  rawAccountsCount: number;
}

interface AvatarPresetCategory {
  id: string;
  name: string;
  desc: string;
  icon: string;
  items: string[];
}

interface PageAvatarStatus {
  pageId: string;
  isSilhouette: boolean;
  hasAvatar: boolean;
  avatarUrl: string;
  name?: string;
  error?: string | null;
}

interface ExecutionLogItem {
  id: string;
  time: string;
  type: 'INFO' | 'SUCCESS' | 'ERROR' | 'RUNNING';
  message: string;
}

interface PageAvatarStudioProps {
  accounts: any[];
  onRefresh?: () => void;
}

export const PageAvatarStudio: React.FC<PageAvatarStudioProps> = ({ accounts, onRefresh }) => {
  const { message: antMessage, modal } = App.useApp();

  // Cache danh sách Fanpage từ trình duyệt (Thành An: 512 page, Huỳnh Thạnh Phú: 25 page)
  const [cachedPagesMap, setCachedPagesMap] = useState<Record<string, any[]>>({});
  const [scanningViaPages, setScanningViaPages] = useState<boolean>(false);

  // 1. Phân nhóm Dàn Nick Mẹ (Thành An & Huỳnh Thạnh Phú)
  const motherVias = useMemo<MotherViaItem[]>(() => {
    if (!Array.isArray(accounts) || accounts.length === 0) return [];

    const map = new Map<string, { profileRow?: any; allRows: any[] }>();

    for (const acc of accounts) {
      if (acc.platform === 'THREADS') continue;

      const cookieStr = acc.cookieString || acc.accessToken || '';
      const cUserMatch = cookieStr.match(/(?:^|;\s*)c_user=([^;]+)/);
      const uidFromCookie = cUserMatch ? cUserMatch[1] : null;

      if (!uidFromCookie && acc.platform !== 'FACEBOOK_PROFILE' && acc.accountType !== 'PERSONAL_PROFILE_COOKIE') {
        continue;
      }

      const uid = uidFromCookie || acc.platformAccountId || `acc_${acc.id}`;
      if (!map.has(uid)) {
        map.set(uid, { allRows: [] });
      }
      const entry = map.get(uid)!;
      entry.allRows.push(acc);

      if (acc.platform === 'FACEBOOK_PROFILE' || acc.accountType === 'PERSONAL_PROFILE_COOKIE') {
        if (!entry.profileRow) {
          entry.profileRow = acc;
        }
      }
    }

    const result: MotherViaItem[] = [];

    for (const [uid, { profileRow, allRows }] of map.entries()) {
      let viaName = profileRow?.pageName;
      if (!viaName) {
        const namedRow = allRows.find(
          (r) => r.pageName && !r.pageName.startsWith('Fanpage') && !r.pageName.startsWith('id_')
        );
        viaName = namedRow?.pageName || `Via ${uid}`;
      }

      let cookieString = profileRow?.cookieString || profileRow?.accessToken || '';
      if (!cookieString || !cookieString.includes('c_user=')) {
        const withCuser = allRows.find((r) => (r.cookieString || r.accessToken || '').includes('c_user='));
        cookieString = withCuser?.cookieString || withCuser?.accessToken || allRows[0]?.cookieString || '';
      }

      const proxyUrl = profileRow?.proxyUrl || allRows.find((r) => r.proxyUrl)?.proxyUrl || '';
      const hasOk = allRows.some((r) => r.tokenStatus === 'OK');
      const tokenStatus = hasOk ? 'OK' : profileRow?.tokenStatus || allRows[0]?.tokenStatus || 'OK';

      // Lọc danh sách Fanpage con (Loại bỏ profile mẹ và các nhóm FACEBOOK_GROUP)
      const pages: ChildPageItem[] = [];
      const seenPageIds = new Set<string>();

      for (const row of allRows) {
        if (profileRow && row.id === profileRow.id) continue;
        if (row.platform === 'FACEBOOK_PROFILE') continue;
        if (row.platform === 'FACEBOOK_GROUP') continue; // LỌC BỎ NHÓM

        const pageId = row.platformAccountId || String(row.id);
        if (seenPageIds.has(pageId)) continue;
        seenPageIds.add(pageId);

        pages.push({
          id: row.id,
          platformAccountId: pageId,
          pageName: row.pageName || `Fanpage ${pageId}`,
          platform: 'FACEBOOK_PAGE',
          accountType: row.accountType,
          tokenStatus: row.tokenStatus || 'OK',
          proxyUrl: row.proxyUrl || proxyUrl,
        });
      }

      // Gộp thêm danh sách Fanpage từ bộ nhớ Cache quét Playwright
      const scannedList = cachedPagesMap[uid] || [];
      for (const sp of scannedList) {
        const pid = sp.id || sp.platformAccountId;
        if (!pid || seenPageIds.has(String(pid))) continue;
        seenPageIds.add(String(pid));

        pages.push({
          id: pid,
          platformAccountId: String(pid),
          pageName: sp.name || sp.pageName || `Fanpage ${pid}`,
          platform: 'FACEBOOK_PAGE',
          accountType: 'PERSONAL_COOKIE',
          tokenStatus: 'OK',
          proxyUrl: proxyUrl,
        });
      }

      result.push({
        uid,
        viaName,
        cookieString,
        proxyUrl,
        tokenStatus,
        pages,
        rawAccountsCount: allRows.length,
      });
    }

    // Ưu tiên via có nhiều page nhất (Thành An) lên trước
    return result.sort((a, b) => b.pages.length - a.pages.length);
  }, [accounts, cachedPagesMap]);

  // Selected Mother Via (Mặc định chọn Thành An)
  const [selectedMotherUid, setSelectedMotherUid] = useState<string>('');

  useEffect(() => {
    if (motherVias.length > 0 && !selectedMotherUid) {
      setSelectedMotherUid(motherVias[0].uid);
    }
  }, [motherVias, selectedMotherUid]);

  const currentMotherVia = useMemo(() => {
    return motherVias.find((v) => v.uid === selectedMotherUid) || motherVias[0] || null;
  }, [motherVias, selectedMotherUid]);

  // Danh sách Page thuộc Via đang chọn
  const currentPages = useMemo(() => {
    return currentMotherVia?.pages || [];
  }, [currentMotherVia]);

  // 2. Avatar Status (Trạng thái Avatar thực tế từ Facebook)
  const [avatarStatusMap, setAvatarStatusMap] = useState<Record<string, PageAvatarStatus>>({});
  const [scanningStatus, setScanningStatus] = useState(false);

  // 3. Preset categories
  const [presets, setPresets] = useState<AvatarPresetCategory[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('RANDOM_MIX');
  const [selectedPresetCategory, setSelectedPresetCategory] = useState<string>('preset');

  // Custom uploaded images & URLs
  const [customImageUrls, setCustomImageUrls] = useState<string[]>([]);
  const [customUrlInput, setCustomUrlInput] = useState<string>('');

  // 4. Multi-selection
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');
  const [filterMode, setFilterMode] = useState<'MISSING' | 'HAS' | 'ALL' | 'SELECTED'>('MISSING');

  // Execution options
  const [delaySeconds, setDelaySeconds] = useState<number>(4);

  // Execution modal & state
  const [isExecuting, setIsExecuting] = useState(false);
  const [execProgress, setExecProgress] = useState<{
    total: number;
    completed: number;
    success: number;
    failed: number;
    currentName?: string;
    currentId?: string;
  }>({ total: 0, completed: 0, success: 0, failed: 0 });
  const [executionLogs, setExecutionLogs] = useState<ExecutionLogItem[]>([]);
  const [isExecutionModalOpen, setIsExecutionModalOpen] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Khởi động: Tải presets, cached pages & cached avatar status
  useEffect(() => {
    api
      .get('/avatars/presets')
      .then((res) => {
        if (res.data?.categories) {
          setPresets(res.data.categories);
        }
      })
      .catch(() => {});

    // Tải danh sách Fanpage từ cache (512 page của Thành An, 25 page của Huỳnh Thạnh Phú)
    api
      .get('/buff-cached-pages')
      .then((res) => {
        if (res.data?.cache) {
          setCachedPagesMap(res.data.cache);
        }
      })
      .catch(() => {});

    // Tải cache trạng thái Avatar thực tế (138 trang có avatar thật, 307 trang chưa có)
    api
      .get('/avatars/cached-status')
      .then((res) => {
        if (res.data?.results) {
          setAvatarStatusMap(res.data.results);
        }
      })
      .catch(() => {});
  }, []);

  // Cuộn log tự động
  useEffect(() => {
    if (isExecutionModalOpen) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [executionLogs, isExecutionModalOpen]);

  // Quét lại toàn bộ Fanpage từ trình duyệt Playwright cho Via đang chọn
  const handleScanPagesForVia = async (via: MotherViaItem) => {
    if (!via.cookieString) {
      antMessage.error('Nick này không có Cookie Facebook để quét!');
      return;
    }

    setScanningViaPages(true);
    antMessage.loading({
      content: `Đang mở trình duyệt quét toàn bộ Fanpage từ nick [${via.viaName}]...`,
      key: 'scan_pages_browser',
      duration: 35,
    });

    try {
      const res = await api.post('/buff-get-pages', {
        cookieString: via.cookieString,
        forceRefresh: true,
        viaName: via.viaName,
        proxyUrl: via.proxyUrl || '',
      });

      if (res.data?.success && Array.isArray(res.data.pages)) {
        setCachedPagesMap((prev) => ({
          ...prev,
          [via.uid]: res.data.pages,
        }));
        antMessage.success({
          content: `Quét thành công! Đã lấy được ${res.data.pages.length} Fanpage cho nick [${via.viaName}].`,
          key: 'scan_pages_browser',
        });
        onRefresh?.();
      }
    } catch (err: any) {
      antMessage.error({
        content: `Lỗi quét Fanpage: ${err.message}`,
        key: 'scan_pages_browser',
      });
    } finally {
      setScanningViaPages(false);
    }
  };

  // Quét trạng thái Avatar (Quét Nhanh từ Cache hoặc Quét Sâu trực tiếp từ Facebook)
  const handleScanAvatarStatus = async (deepScan: boolean = false) => {
    if (currentPages.length === 0) {
      antMessage.warning('Không có Fanpage nào để quét');
      return;
    }

    setScanningStatus(true);
    antMessage.loading({
      content: deepScan
        ? `Đang mở trình duyệt quét sâu avatar cho dàn Page của nick [${currentMotherVia?.viaName}]...`
        : `Đang kiểm tra và phân loại trạng thái Avatar cho ${currentPages.length} Fanpage...`,
      key: 'scanning_avatar',
      duration: deepScan ? 45 : 10,
    });

    try {
      const pageList = currentPages.map((p) => ({ id: p.platformAccountId, name: p.pageName }));
      const res = await api.post('/avatars/check-status', {
        pageIds: pageList,
        motherViaId: currentMotherVia?.uid,
        deepScan,
      });

      if (res.data?.results) {
        setAvatarStatusMap(res.data.results);
        const stats = res.data.stats;

        // Tự động chọn các trang THỰC SỰ chưa có avatar (hasAvatar === false)
        const missingIds = currentPages
          .filter((p) => {
            const st = res.data.results[p.platformAccountId];
            return st ? !st.hasAvatar : true;
          })
          .map((p) => p.platformAccountId);

        setSelectedPageIds(missingIds);

        antMessage.success({
          content: `Đã quét xong! Phát hiện: ${stats.hasAvatar} trang ĐÃ CÓ avatar thật, ${stats.missingAvatar} trang CHƯA CÓ avatar.`,
          key: 'scanning_avatar',
          duration: 5,
        });
      }
    } catch (err: any) {
      antMessage.error({
        content: `Lỗi khi quét trạng thái Avatar: ${err.message}`,
        key: 'scanning_avatar',
      });
    } finally {
      setScanningStatus(false);
    }
  };

  // Thống kê nhanh theo Via đang chọn
  const stats = useMemo(() => {
    const total = currentPages.length;
    let missing = 0;
    let has = 0;
    let uninspected = 0;

    for (const p of currentPages) {
      const st = avatarStatusMap[p.platformAccountId];
      if (!st) {
        uninspected++;
      } else if (st.hasAvatar) {
        has++;
      } else {
        missing++;
      }
    }

    return { total, missing, has, uninspected };
  }, [currentPages, avatarStatusMap]);

  // Lọc trang hiển thị trên bảng
  const filteredPages = useMemo(() => {
    let list = currentPages;

    // Lọc theo search text
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (p) => p.pageName.toLowerCase().includes(q) || p.platformAccountId.includes(q)
      );
    }

    // Lọc theo filter mode chuẩn xác
    if (filterMode === 'MISSING') {
      list = list.filter((p) => {
        const st = avatarStatusMap[p.platformAccountId];
        return st ? !st.hasAvatar : true;
      });
    } else if (filterMode === 'HAS') {
      list = list.filter((p) => {
        const st = avatarStatusMap[p.platformAccountId];
        return st && st.hasAvatar;
      });
    } else if (filterMode === 'SELECTED') {
      const selSet = new Set(selectedPageIds);
      list = list.filter((p) => selSet.has(p.platformAccountId));
    }

    return list;
  }, [currentPages, searchText, filterMode, avatarStatusMap, selectedPageIds]);

  // Hành động chọn nhanh chuẩn xác
  const handleSelectAllMissing = () => {
    const missing = currentPages
      .filter((p) => {
        const st = avatarStatusMap[p.platformAccountId];
        return st ? !st.hasAvatar : true;
      })
      .map((p) => p.platformAccountId);

    setSelectedPageIds(missing);
    antMessage.info(
      `Đã chọn ${missing.length} trang chưa có ảnh đại diện (đã tự động bỏ qua các trang đã có ảnh thật)`
    );
  };

  const handleSelectCount = (count: number) => {
    const pool = filteredPages.map((p) => p.platformAccountId);
    const chosen = pool.slice(0, count);
    setSelectedPageIds(chosen);
    antMessage.info(`Đã chọn ${chosen.length} trang`);
  };

  const handleDeselectAll = () => {
    setSelectedPageIds([]);
  };

  // Preset đang chọn
  const activePreset = useMemo(() => {
    return presets.find((p) => p.id === selectedPresetId) || presets[0] || null;
  }, [presets, selectedPresetId]);

  // Thêm ảnh custom qua URL
  const handleAddCustomUrls = () => {
    if (!customUrlInput.trim()) return;
    const lines = customUrlInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http'));

    if (lines.length === 0) {
      antMessage.warning('Vui lòng nhập các đường dẫn ảnh bắt đầu bằng http:// hoặc https://');
      return;
    }

    setCustomImageUrls((prev) => [...prev, ...lines]);
    setCustomUrlInput('');
    antMessage.success(`Đã thêm ${lines.length} link ảnh tùy chỉnh`);
  };

  // Upload file custom ảnh từ máy
  const handleCustomFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setCustomImageUrls((prev) => [...prev, base64]);
      antMessage.success(`Đã tải lên ảnh "${file.name}"`);
    };
    reader.readAsDataURL(file);
    return false;
  };

  // Bắt đầu cập nhật Avatar hàng loạt (SSE Stream)
  const handleStartUpdate = async () => {
    if (selectedPageIds.length === 0) {
      antMessage.warning('Vui lòng chọn ít nhất 1 Fanpage cần cập nhật Avatar!');
      return;
    }

    if (!currentMotherVia?.cookieString) {
      antMessage.error('Nick Mẹ đang chọn không có Cookie hợp lệ!');
      return;
    }

    const pagesToUpdate = currentPages
      .filter((p) => selectedPageIds.includes(p.platformAccountId))
      .map((p, idx) => {
        let assignedImage: string | undefined = undefined;
        if (selectedPresetCategory === 'custom' && customImageUrls.length > 0) {
          assignedImage = customImageUrls[idx % customImageUrls.length];
        } else if (activePreset && activePreset.items.length > 0) {
          assignedImage = activePreset.items[idx % activePreset.items.length];
        }
        return {
          id: p.platformAccountId,
          name: p.pageName,
          imageUrl: assignedImage,
        };
      });

    modal.confirm({
      title: 'Xác nhận Bắt đầu Cập Nhật Avatar Hàng Loạt?',
      icon: <FireOutlined className="text-pink-500 text-xl" />,
      content: (
        <div className="space-y-2 text-sm text-slate-300">
          <p>
            Bạn sắp tự động đổi ảnh đại diện cho{' '}
            <strong className="text-pink-400 font-bold">{pagesToUpdate.length} Fanpage</strong> thuộc nick Mẹ{' '}
            <strong className="text-cyan-400 font-bold">"{currentMotherVia.viaName}"</strong>.
          </p>
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 text-xs text-slate-400 space-y-1">
            <div>
              • Nguồn ảnh:{' '}
              <span className="text-white font-medium">
                {selectedPresetCategory === 'custom' ? `Tùy chỉnh (${customImageUrls.length} ảnh)` : activePreset?.name}
              </span>
            </div>
            <div>
              • Giãn cách an toàn: <span className="text-emerald-400 font-medium">{delaySeconds} giây/page</span>
            </div>
            <div>
              • Proxy:{' '}
              <span className="text-white font-mono">
                {currentMotherVia.proxyUrl ? 'Có cấu hình' : 'Dùng IP máy chủ'}
              </span>
            </div>
          </div>
          <p className="text-xs text-amber-400/90 italic">
            * Hệ thống tự động chuyển danh tính sang từng Page, upload ảnh, bấm lưu và chuyển tiếp an toàn.
          </p>
        </div>
      ),
      okText: '🚀 Bắt Đầu Ngay',
      cancelText: 'Hủy',
      okButtonProps: {
        className: 'bg-gradient-to-r from-pink-500 to-rose-600 hover:from-pink-400 hover:to-rose-500 font-bold border-0',
      },
      onOk: () => runAvatarStream(pagesToUpdate),
    });
  };

  // Chạy cập nhật qua SSE Stream
  const runAvatarStream = async (pagesToUpdate: { id: string; name: string; imageUrl?: string }[]) => {
    setIsExecuting(true);
    setIsExecutionModalOpen(true);
    setExecProgress({
      total: pagesToUpdate.length,
      completed: 0,
      success: 0,
      failed: 0,
    });
    setExecutionLogs([
      {
        id: `init_${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        type: 'INFO',
        message: `Khởi tạo tiến trình cập nhật Avatar cho ${pagesToUpdate.length} Fanpage thuộc nick "${currentMotherVia?.viaName}"...`,
      },
    ]);

    try {
      const response = await fetch(`${WORKER_BASE_URL}/api/avatars/update-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motherViaId: currentMotherVia?.uid,
          cookieString: currentMotherVia?.cookieString,
          proxyUrl: currentMotherVia?.proxyUrl,
          pages: pagesToUpdate,
          presetCategory: selectedPresetId,
          customImages: selectedPresetCategory === 'custom' ? customImageUrls : [],
          delaySeconds,
        }),
      });

      if (!response.body) {
        throw new Error('Trình duyệt không hỗ trợ stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.replace('data: ', '').trim();
            if (!raw) continue;

            try {
              const evt = JSON.parse(raw);

              if (evt.type === 'PAGE_START') {
                setExecProgress((prev) => ({
                  ...prev,
                  currentName: evt.pageName,
                  currentId: evt.pageId,
                }));
                setExecutionLogs((prev) => [
                  ...prev,
                  {
                    id: `log_${Date.now()}_${Math.random()}`,
                    time: new Date().toLocaleTimeString(),
                    type: 'RUNNING',
                    message: evt.message || `Đang xử lý Page: "${evt.pageName}"...`,
                  },
                ]);
              } else if (evt.type === 'PAGE_FINISH') {
                const isSuccess = evt.status === 'SUCCESS';
                setExecProgress((prev) => ({
                  ...prev,
                  completed: prev.completed + 1,
                  success: isSuccess ? prev.success + 1 : prev.success,
                  failed: isSuccess ? prev.failed : prev.failed + 1,
                }));

                // Cập nhật trạng thái avatar của page vừa xong
                if (isSuccess) {
                  setAvatarStatusMap((prev) => ({
                    ...prev,
                    [evt.pageId]: {
                      pageId: evt.pageId,
                      isSilhouette: false,
                      hasAvatar: true,
                      avatarUrl: `https://graph.facebook.com/${evt.pageId}/picture?type=large&t=${Date.now()}`,
                    },
                  }));
                }

                setExecutionLogs((prev) => [
                  ...prev,
                  {
                    id: `log_${Date.now()}_${Math.random()}`,
                    time: new Date().toLocaleTimeString(),
                    type: isSuccess ? 'SUCCESS' : 'ERROR',
                    message: `[${evt.index}/${evt.total}] "${evt.pageName}": ${evt.message || (isSuccess ? 'Thành công' : 'Thất bại')}`,
                  },
                ]);
              } else if (evt.type === 'STOPPED') {
                setExecutionLogs((prev) => [
                  ...prev,
                  {
                    id: `log_${Date.now()}`,
                    time: new Date().toLocaleTimeString(),
                    type: 'INFO',
                    message: '🛑 Tác vụ đã được dừng theo yêu cầu của bạn.',
                  },
                ]);
              } else if (evt.type === 'DONE') {
                setExecutionLogs((prev) => [
                  ...prev,
                  {
                    id: `log_${Date.now()}`,
                    time: new Date().toLocaleTimeString(),
                    type: 'SUCCESS',
                    message: `🏁 Hoàn thành toàn bộ: Thành công ${evt.updatedCount}/${evt.total} Fanpage!`,
                  },
                ]);
                antMessage.success(`Hoàn thành! Đã cập nhật Avatar cho ${evt.updatedCount}/${evt.total} Fanpage!`);
              } else if (evt.type === 'ERROR') {
                setExecutionLogs((prev) => [
                  ...prev,
                  {
                    id: `log_${Date.now()}`,
                    time: new Date().toLocaleTimeString(),
                    type: 'ERROR',
                    message: `Lỗi hệ thống: ${evt.error}`,
                  },
                ]);
              }
            } catch (jsonErr) {}
          }
        }
      }
    } catch (err: any) {
      antMessage.error(`Lỗi cập nhật Avatar: ${err.message}`);
      setExecutionLogs((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: 'ERROR',
          message: `Lỗi kết nối Stream: ${err.message}`,
        },
      ]);
    } finally {
      setIsExecuting(false);
    }
  };

  // Dừng tác vụ đang chạy
  const handleStopExecution = async () => {
    try {
      await api.post('/avatars/stop');
      antMessage.info('Đang gửi tín hiệu dừng khẩn cấp...');
    } catch (err) {
      console.warn('Lỗi gửi stop:', err);
    }
  };

  // Table columns definition
  const columns: ColumnsType<ChildPageItem> = [
    {
      title: 'Ảnh Hiện Tại (Facebook)',
      key: 'currentAvatar',
      width: 150,
      render: (_, record) => {
        const status = avatarStatusMap[record.platformAccountId];
        const avatarSrc =
          status?.avatarUrl ||
          `https://graph.facebook.com/${record.platformAccountId}/picture?type=large`;

        return (
          <div className="flex items-center gap-2">
            <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-slate-800 border border-slate-700/80 flex items-center justify-center shrink-0 shadow-sm">
              <img
                src={avatarSrc}
                alt={record.pageName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    'https://static.xx.fbcdn.net/rsrc.php/yN/r/Gjnonzr2XE5.webp';
                }}
              />
              <div className="absolute inset-0 bg-black/10 hover:bg-transparent transition-colors" />
            </div>
            <div>
              {status ? (
                status.hasAvatar ? (
                  <Tag color="success" className="text-[10px] rounded-md px-1 py-0 border-0 font-medium leading-tight">
                    Đã có
                  </Tag>
                ) : (
                  <Tag color="error" className="text-[10px] rounded-md px-1 py-0 border-0 font-medium leading-tight">
                    Chưa có
                  </Tag>
                )
              ) : (
                <Tag color="default" className="text-[10px] rounded-md px-1 py-0 border-0 text-slate-400 leading-tight">
                  Chưa quét
                </Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: 'Tên Trang Fanpage',
      dataIndex: 'pageName',
      key: 'pageName',
      render: (name, record) => (
        <div>
          <div className="font-semibold text-slate-200 text-sm hover:text-cyan-400 transition-colors flex items-center gap-1.5">
            <span>{name}</span>
            <a
              href={`https://facebook.com/${record.platformAccountId}`}
              target="_blank"
              rel="noreferrer"
              className="text-slate-500 hover:text-cyan-400 text-xs"
              title="Mở trên Facebook"
            >
              <LinkOutlined />
            </a>
          </div>
          <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1 mt-0.5">
            <span>ID: {record.platformAccountId}</span>
            <Tooltip title="Sao chép ID">
              <button
                type="button"
                className="hover:text-cyan-300 text-slate-500"
                onClick={() => {
                  navigator.clipboard.writeText(record.platformAccountId);
                  antMessage.success('Đã sao chép ID');
                }}
              >
                <CopyOutlined className="text-[10px]" />
              </button>
            </Tooltip>
          </div>
        </div>
      ),
    },
    {
      title: 'Ảnh Mới Sẽ Áp Dụng',
      key: 'newAvatarPreview',
      width: 140,
      render: (_, record) => {
        const isSelected = selectedPageIds.includes(record.platformAccountId);
        if (!isSelected) {
          return <span className="text-xs text-slate-600 italic">Chưa chọn</span>;
        }

        const idx = selectedPageIds.indexOf(record.platformAccountId);
        let previewUrl = '';
        if (selectedPresetCategory === 'custom' && customImageUrls.length > 0) {
          previewUrl = customImageUrls[idx % customImageUrls.length];
        } else if (activePreset && activePreset.items.length > 0) {
          previewUrl = activePreset.items[idx % activePreset.items.length];
        }

        return (
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl overflow-hidden bg-pink-950/40 border border-pink-500/40 flex items-center justify-center shrink-0 shadow-sm">
              {previewUrl ? (
                <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              ) : (
                <PictureOutlined className="text-pink-400 text-sm" />
              )}
            </div>
            <span className="text-[11px] text-pink-400/90 font-medium">#{idx + 1}</span>
          </div>
        );
      },
    },
    {
      title: 'Hành Động',
      key: 'action',
      width: 130,
      render: (_, record) => (
        <Button
          size="small"
          type="text"
          className="text-pink-400 hover:text-pink-300 hover:bg-pink-500/10 text-xs rounded-lg flex items-center gap-1 border border-pink-500/20"
          onClick={() => {
            setSelectedPageIds([record.platformAccountId]);
            handleStartUpdate();
          }}
        >
          <PictureOutlined /> Đổi Riêng
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* 1. Header Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-[#0f172a] to-pink-950/40 p-6 border border-pink-500/20 shadow-2xl backdrop-blur-xl">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-72 h-72 bg-gradient-to-br from-pink-500/10 via-purple-500/10 to-transparent rounded-full blur-3xl pointer-events-none" />

        <div className="space-y-1.5 relative z-10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-pink-500 to-rose-600 flex items-center justify-center shadow-lg shadow-pink-500/30">
              <PictureOutlined className="text-white text-xl" />
            </div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-pink-300 tracking-tight">
              Studio Cập Nhật Avatar Fanpage
            </h1>
            <Tag color="magenta" className="rounded-full px-2 py-0.5 text-[10px] font-bold border-0 tracking-wider">
              PRO 2026
            </Tag>
          </div>
          <p className="text-sm text-slate-400 max-w-3xl">
            Chọn Via chính (Thành An hoặc Huỳnh Thạnh Phú) để nạp toàn bộ dàn Fanpage con. Hệ thống tự động phát hiện
            chính xác 100% trang nào đã có avatar và trang nào chưa có để bạn đổi ảnh hàng loạt an toàn.
          </p>
        </div>
      </div>

      {/* 2. BƯỚC 1: CHỌN VIA CHÍNH (THÀNH AN HOẶC HUỲNH THẠNH PHÚ) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-black text-slate-200 uppercase tracking-wider">
            <CrownOutlined className="text-amber-400 text-base" />
            <span>BƯỚC 1: CHỌN VIA MẸ SỞ HỮU DÀN FANPAGE</span>
          </div>
          <span className="text-xs text-slate-400">
            Bấm chọn để nạp toàn bộ Fanpage của nick đó vào studio
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {motherVias.map((via) => {
            const isSelected = via.uid === selectedMotherUid;
            return (
              <div
                key={via.uid}
                onClick={() => {
                  setSelectedMotherUid(via.uid);
                  setSelectedPageIds([]);
                }}
                className={`p-4 rounded-2xl cursor-pointer transition-all border relative overflow-hidden group ${
                  isSelected
                    ? 'bg-gradient-to-r from-cyan-950/40 via-slate-900 to-pink-950/30 border-cyan-400 ring-2 ring-cyan-500/30 shadow-xl shadow-cyan-500/10'
                    : 'bg-[#0c1220] border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                }`}
              >
                {/* Active checkmark */}
                {isSelected && (
                  <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-500 text-slate-950 font-bold text-xs shadow-md">
                    <CheckOutlined /> ĐANG CHỌN
                  </div>
                )}

                <div className="flex items-center gap-3.5">
                  <div className="relative w-14 h-14 rounded-2xl overflow-hidden bg-slate-800 border border-slate-700 shrink-0 shadow-md">
                    <img
                      src={`https://graph.facebook.com/${via.uid}/picture?type=large`}
                      alt={via.viaName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src =
                          'https://static.xx.fbcdn.net/rsrc.php/yN/r/Gjnonzr2XE5.webp';
                      }}
                    />
                  </div>

                  <div className="space-y-1 flex-1 pr-24">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-white hover:text-cyan-300 transition-colors">
                        {via.viaName}
                      </span>
                      <Tag
                        color={via.tokenStatus === 'OK' ? 'cyan' : 'error'}
                        className="rounded-full px-2 text-[10px] font-mono border-0"
                      >
                        {via.tokenStatus === 'OK' ? 'Live OK' : 'Checkpoint'}
                      </Tag>
                    </div>

                    <div className="text-xs text-slate-400 font-mono flex items-center gap-2">
                      <span>UID: {via.uid}</span>
                      <span>•</span>
                      <span className="text-cyan-400 font-bold">{via.pages.length} Fanpage con</span>
                    </div>

                    <div className="text-[11px] text-slate-500 truncate max-w-xs">
                      Proxy: {via.proxyUrl || 'IP Trực tiếp (Không proxy)'}
                    </div>
                  </div>
                </div>

                <div className="mt-3.5 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    Đã nạp: <strong className="text-white font-mono">{via.pages.length}</strong> Fanpage vào studio
                  </span>
                  <Button
                    size="small"
                    icon={<SyncOutlined spin={scanningViaPages} />}
                    loading={scanningViaPages && isSelected}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScanPagesForVia(via);
                    }}
                    className="rounded-lg text-xs border-slate-700 text-slate-300 hover:text-white bg-slate-800/80"
                  >
                    Quét Lại Fanpage
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3. BƯỚC 2: QUÉT TRẠNG THÁI AVATAR & THỐNG KÊ NHANH */}
      <div className="p-5 rounded-2xl bg-[#0c1220] border border-slate-800/90 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-black text-slate-200 uppercase tracking-wider">
              <ScanOutlined className="text-cyan-400 text-base" />
              <span>BƯỚC 2: QUÉT & PHÂN LOẠI AVATAR (NICK "{currentMotherVia?.viaName}")</span>
            </div>
            <p className="text-xs text-slate-400">
              Kiểm tra toàn bộ dàn Fanpage để nhận diện chính xác trang nào đã có avatar và trang nào đang thiếu
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="primary"
              size="large"
              icon={<ScanOutlined />}
              loading={scanningStatus}
              onClick={() => handleScanAvatarStatus(false)}
              className="bg-cyan-600 hover:bg-cyan-500 font-bold rounded-xl shadow-lg shadow-cyan-600/20 border-0"
            >
              Quét Nhanh Trạng Thái
            </Button>

            <Button
              size="large"
              icon={<CompassOutlined />}
              loading={scanningStatus}
              onClick={() => handleScanAvatarStatus(true)}
              className="rounded-xl border-pink-500/40 text-pink-300 hover:text-white hover:bg-pink-600/20 bg-pink-950/40 font-semibold"
              title="Mở trình duyệt Playwright quét sâu và cập nhật 100% chính xác từ Facebook Switcher"
            >
              Quét Sâu Trình Duyệt
            </Button>
          </div>
        </div>

        {/* 4 Cards Thống Kê Nhanh */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 pt-2">
          <div className="p-3.5 bg-slate-900/80 rounded-xl border border-slate-800">
            <div className="text-xs text-slate-400 font-medium">Tổng Fanpage Đang Quản Lý</div>
            <div className="text-2xl font-black text-white mt-1">{stats.total}</div>
          </div>
          <div className="p-3.5 bg-rose-950/20 rounded-xl border border-rose-500/30">
            <div className="text-xs text-rose-300 font-medium flex items-center justify-between">
              <span>Chưa Có Avatar</span>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            </div>
            <div className="text-2xl font-black text-rose-400 mt-1">{stats.missing}</div>
          </div>
          <div className="p-3.5 bg-emerald-950/20 rounded-xl border border-emerald-500/30">
            <div className="text-xs text-emerald-300 font-medium">Đã Có Avatar Thật</div>
            <div className="text-2xl font-black text-emerald-400 mt-1">{stats.has}</div>
          </div>
          <div className="p-3.5 bg-cyan-950/20 rounded-xl border border-cyan-500/30">
            <div className="text-xs text-cyan-300 font-medium">Đang Chọn Để Cập Nhật</div>
            <div className="text-2xl font-black text-cyan-400 mt-1">{selectedPageIds.length}</div>
          </div>
        </div>
      </div>

      {/* 4. BƯỚC 3: CẤU HÌNH KHO ẢNH & DANH SÁCH BẢNG */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cột Trái: Kho Ảnh & Thực Thi (5 Cols) */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="!bg-[#0c1220] !border-slate-800/90 rounded-2xl shadow-xl">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
                  <PictureOutlined className="text-pink-400" /> BƯỚC 3: Nguồn Ảnh Mới
                </span>
                <Segmented
                  value={selectedPresetCategory}
                  onChange={(val) => setSelectedPresetCategory(val as string)}
                  options={[
                    { label: 'Kho AI Mẫu', value: 'preset' },
                    { label: 'Tùy Chỉnh', value: 'custom' },
                  ]}
                  className="bg-slate-900 p-0.5 rounded-xl border border-slate-800 text-xs"
                />
              </div>

              {selectedPresetCategory === 'preset' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    {presets.map((cat) => {
                      const isChosen = cat.id === selectedPresetId;
                      return (
                        <div
                          key={cat.id}
                          onClick={() => setSelectedPresetId(cat.id)}
                          className={`p-3 rounded-xl cursor-pointer transition-all border flex items-center justify-between ${
                            isChosen
                              ? 'bg-gradient-to-r from-pink-950/40 to-rose-900/30 border-pink-500 shadow-md shadow-pink-500/10'
                              : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">{cat.icon}</span>
                            <div>
                              <div
                                className={`text-sm font-bold ${isChosen ? 'text-pink-300' : 'text-slate-300'}`}
                              >
                                {cat.name}
                              </div>
                              <div className="text-[11px] text-slate-400 line-clamp-1">{cat.desc}</div>
                            </div>
                          </div>
                          <Tag
                            color={isChosen ? 'magenta' : 'default'}
                            className="text-[10px] font-mono rounded-full border-0"
                          >
                            {cat.items.length} ảnh
                          </Tag>
                        </div>
                      );
                    })}
                  </div>

                  {/* Thumbnail Preview Grid */}
                  {activePreset && (
                    <div className="pt-2">
                      <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center justify-between">
                        <span>Xem trước kho ảnh ({activePreset.name}):</span>
                        <span className="text-[10px] text-pink-400">Tự động phân phối mỗi Page 1 ảnh</span>
                      </div>
                      <div className="grid grid-cols-6 gap-2 p-2 bg-slate-900/90 rounded-xl border border-slate-800/90 max-h-48 overflow-y-auto">
                        {activePreset.items.slice(0, 18).map((imgUrl, i) => (
                          <div
                            key={i}
                            className="aspect-square rounded-lg overflow-hidden bg-slate-800 border border-slate-700/80 group relative hover:border-pink-400 transition-all"
                          >
                            <img src={imgUrl} alt="Preset preview" className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] text-white font-mono">
                              #{i + 1}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-800/80">
                    <div className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                      <CloudUploadOutlined className="text-pink-400" /> Tải ảnh từ máy tính:
                    </div>
                    <Upload
                      beforeUpload={handleCustomFileUpload}
                      multiple
                      showUploadList={false}
                      accept="image/*"
                    >
                      <Button
                        icon={<PlusOutlined />}
                        className="w-full rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 border-dashed"
                      >
                        Chọn nhiều ảnh từ máy tính...
                      </Button>
                    </Upload>
                  </div>

                  <div className="p-3 bg-slate-900/70 rounded-xl border border-slate-800/80 space-y-2">
                    <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                      <LinkOutlined className="text-cyan-400" /> Hoặc dán danh sách link ảnh trực tiếp:
                    </div>
                    <Input.TextArea
                      rows={3}
                      placeholder={`https://example.com/photo1.jpg\nhttps://example.com/photo2.jpg`}
                      value={customUrlInput}
                      onChange={(e) => setCustomUrlInput(e.target.value)}
                      className="text-xs font-mono rounded-xl bg-slate-950 border-slate-800"
                    />
                    <Button
                      size="small"
                      type="primary"
                      onClick={handleAddCustomUrls}
                      className="bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs"
                    >
                      Thêm vào danh sách
                    </Button>
                  </div>

                  {customImageUrls.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>Đã nạp {customImageUrls.length} ảnh tùy chỉnh:</span>
                        <Button
                          size="small"
                          type="text"
                          danger
                          onClick={() => setCustomImageUrls([])}
                          className="text-xs p-0 h-auto"
                        >
                          Xóa tất cả
                        </Button>
                      </div>
                      <div className="grid grid-cols-6 gap-2 p-2 bg-slate-900/90 rounded-xl border border-slate-800/90 max-h-40 overflow-y-auto">
                        {customImageUrls.map((img, i) => (
                          <div
                            key={i}
                            className="aspect-square rounded-lg overflow-hidden bg-slate-800 border border-slate-700 group relative"
                          >
                            <img src={img} alt="Custom" className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={() => setCustomImageUrls((prev) => prev.filter((_, idx) => idx !== i))}
                              className="absolute inset-0 bg-red-950/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-red-300 text-xs"
                            >
                              <DeleteOutlined />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Giãn cách & Thực thi */}
          <Card className="!bg-[#0c1220] !border-slate-800/90 rounded-2xl shadow-xl">
            <div className="space-y-4">
              <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <SettingOutlined className="text-amber-400" /> Tốc Độ & Bắt Đầu
              </span>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-200">Giãn cách an toàn giữa các Page:</div>
                  <div className="text-[11px] text-slate-400">Nghỉ để chống thuật toán checkpoint của Facebook</div>
                </div>
                <div className="flex items-center gap-2">
                  <InputNumber
                    min={2}
                    max={30}
                    value={delaySeconds}
                    onChange={(v) => setDelaySeconds(v || 4)}
                    className="w-20 rounded-lg text-center font-bold"
                  />
                  <span className="text-xs text-slate-400 font-medium">giây</span>
                </div>
              </div>

              <Button
                type="primary"
                size="large"
                block
                disabled={selectedPageIds.length === 0}
                onClick={handleStartUpdate}
                className="h-12 bg-gradient-to-r from-pink-500 via-rose-600 to-purple-600 hover:from-pink-400 hover:to-rose-500 text-white font-black text-base rounded-xl shadow-xl shadow-pink-600/25 border-0 tracking-wide"
              >
                🚀 BẮT ĐẦU CẬP NHẬT ({selectedPageIds.length} FANPAGE)
              </Button>
            </div>
          </Card>
        </div>

        {/* Cột Phải: Bảng Danh Sách Fanpage Của Via Đang Chọn (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <Card className="!bg-[#0c1220] !border-slate-800/90 rounded-2xl shadow-xl">
            <div className="space-y-4">
              {/* Header Action Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <Segmented
                  value={filterMode}
                  onChange={(v) => setFilterMode(v as any)}
                  options={[
                    { label: `Chưa có Avatar (${stats.missing})`, value: 'MISSING' },
                    { label: `Đã có Avatar (${stats.has})`, value: 'HAS' },
                    { label: `Tất cả (${stats.total})`, value: 'ALL' },
                    { label: `Đang chọn (${selectedPageIds.length})`, value: 'SELECTED' },
                  ]}
                  className="bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs"
                />

                <Input
                  prefix={<SearchOutlined className="text-slate-500" />}
                  placeholder="Tìm tên hoặc ID Page..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full sm:w-56 rounded-xl bg-slate-950 border-slate-800 text-xs"
                  allowClear
                />
              </div>

              {/* Quick Select Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-slate-400 text-[11px] font-medium mr-1">Chọn nhanh:</span>
                  <Button
                    size="small"
                    onClick={handleSelectAllMissing}
                    className="rounded-lg text-xs bg-rose-950/40 border-rose-500/30 text-rose-300 hover:bg-rose-900/50"
                  >
                    ⚡ Tất cả chưa có ({stats.missing})
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleSelectCount(20)}
                    className="rounded-lg text-xs bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                  >
                    20 trang
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleSelectCount(50)}
                    className="rounded-lg text-xs bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                  >
                    50 trang
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleSelectCount(100)}
                    className="rounded-lg text-xs bg-slate-800 border-slate-700 text-slate-300 hover:text-white"
                  >
                    100 trang
                  </Button>
                </div>

                {selectedPageIds.length > 0 && (
                  <Button
                    size="small"
                    type="link"
                    danger
                    onClick={handleDeselectAll}
                    className="text-xs p-0 h-auto"
                  >
                    Bỏ chọn ({selectedPageIds.length})
                  </Button>
                )}
              </div>

              {/* Table of Fanpages */}
              <Table
                rowKey="platformAccountId"
                dataSource={filteredPages}
                columns={columns}
                rowSelection={{
                  selectedRowKeys: selectedPageIds,
                  onChange: (keys) => setSelectedPageIds(keys as string[]),
                }}
                pagination={{
                  pageSize: 15,
                  showSizeChanger: true,
                  pageSizeOptions: ['15', '30', '50', '100'],
                  className: '!text-xs',
                }}
                size="middle"
                className="custom-dark-table"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* 5. Realtime Execution Progress Modal */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-base font-bold text-white">
            <ThunderboltFilled className="text-pink-500" />
            <span>Tiến Trình Cập Nhật Avatar Fanpage</span>
            {isExecuting && (
              <Tag color="processing" className="ml-2 font-normal text-xs rounded-full border-0 animate-pulse">
                Đang chạy tự động
              </Tag>
            )}
          </div>
        }
        open={isExecutionModalOpen}
        onCancel={() => {
          if (isExecuting) {
            antMessage.warning('Tác vụ đang chạy! Hãy bấm nút Dừng Khẩn Cấp trước khi đóng modal.');
          } else {
            setIsExecutionModalOpen(false);
          }
        }}
        footer={[
          isExecuting ? (
            <Button
              key="stop"
              danger
              type="primary"
              icon={<StopOutlined />}
              onClick={handleStopExecution}
              className="rounded-xl font-bold"
            >
              Dừng Khẩn Cấp
            </Button>
          ) : (
            <Button
              key="close"
              type="primary"
              onClick={() => {
                setIsExecutionModalOpen(false);
                api.get('/avatars/cached-status').then((res) => {
                  if (res.data?.results) setAvatarStatusMap(res.data.results);
                });
              }}
              className="bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold"
            >
              Đóng
            </Button>
          ),
        ]}
        width={720}
        destroyOnClose={false}
        className="custom-modal"
      >
        <div className="space-y-4 py-2">
          {/* Progress Bar & Counters */}
          <div className="p-4 bg-slate-900/90 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Tiến độ tổng thể:</span>
              <span className="font-mono font-bold text-pink-400">
                {execProgress.completed} / {execProgress.total} Trang (
                {execProgress.total > 0 ? Math.round((execProgress.completed / execProgress.total) * 100) : 0}%)
              </span>
            </div>

            <Progress
              percent={execProgress.total > 0 ? Math.round((execProgress.completed / execProgress.total) * 100) : 0}
              strokeColor={{
                '0%': '#ec4899',
                '100%': '#06b6d4',
              }}
              status={isExecuting ? 'active' : 'normal'}
              className="!m-0"
            />

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-center">
              <div className="p-2 rounded-xl bg-slate-950">
                <div className="text-[10px] text-slate-400">Đang Xử Lý</div>
                <div className="text-sm font-bold text-slate-200 truncate px-1">
                  {execProgress.currentName || 'Chờ...'}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-emerald-950/30 border border-emerald-500/20">
                <div className="text-[10px] text-emerald-400">Thành Công</div>
                <div className="text-base font-black text-emerald-400">{execProgress.success}</div>
              </div>
              <div className="p-2 rounded-xl bg-rose-950/30 border border-rose-500/20">
                <div className="text-[10px] text-rose-400">Thất Bại</div>
                <div className="text-base font-black text-rose-400">{execProgress.failed}</div>
              </div>
            </div>
          </div>

          {/* Terminal Realtime Log Console */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Nhật ký tự động Playwright
                (Realtime):
              </span>
              <span className="text-[10px] font-mono text-slate-500">{executionLogs.length} sự kiện</span>
            </div>

            <div className="p-3 bg-black/90 rounded-2xl border border-slate-800 font-mono text-xs max-h-64 overflow-y-auto space-y-1 shadow-inner">
              {executionLogs.map((log) => {
                let colorClass = 'text-slate-300';
                if (log.type === 'SUCCESS') colorClass = 'text-emerald-400';
                else if (log.type === 'ERROR') colorClass = 'text-rose-400';
                else if (log.type === 'RUNNING') colorClass = 'text-cyan-400';

                return (
                  <div key={log.id} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-slate-600 shrink-0 text-[10px]">[{log.time}]</span>
                    <span className={colorClass}>{log.message}</span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default PageAvatarStudio;
