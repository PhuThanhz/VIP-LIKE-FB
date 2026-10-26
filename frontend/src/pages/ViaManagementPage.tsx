import React, { useState, useEffect, useMemo } from 'react';
import {
  Table,
  Button,
  Input,
  Tag,
  Space,
  Form,
  message,
  Popconfirm,
  Badge,
  Tooltip,
  Drawer,
  Row,
  Col,
  Avatar,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  GlobalOutlined,
  DatabaseOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  CopyOutlined,
  CheckCircleFilled,
  UserOutlined,
  PlusCircleFilled,
  CompassOutlined,
  SafetyCertificateOutlined,
  LinkOutlined,
  SendOutlined,
  SyncOutlined,
  FacebookFilled,
  UploadOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import api from '../config/axios';

const VIA_PAGES_STORAGE_KEY = 'buff_via_fanpages';

export interface ViaAccount {
  id: number;
  userId?: number;
  platform?: string;
  platformAccountId?: string;
  pageName?: string;
  cookieString?: string;
  accountType?: string;
  tokenStatus?: string;
  proxyUrl?: string;
  tokenCheckedAt?: string;
  createdAt?: string;
}

export interface FanpageItem {
  id: string;
  name: string;
  url: string;
  isProfile?: boolean;
}

export interface ViaManagementPageProps {
  accounts: ViaAccount[];
  loading: boolean;
  onRefresh: () => void;
  dbStatus?: {
    connected: boolean;
    usingCache?: boolean;
    cachedCount?: number;
    database?: string;
    error?: string;
  };
  onCheckDb?: () => void;
  onNavigateToBuff?: () => void;
}

function extractUidFromCookie(cookieStr?: string): string {
  if (!cookieStr) return '';
  const match = cookieStr.match(/(?:^|;\s*)c_user=([^;]+)/);
  if (match) return match[1];

  // Hỗ trợ chuỗi UID|PASS|2FA|COOKIE...
  if (cookieStr.includes('|')) {
    const parts = cookieStr.split('|');
    if (/^[0-9]{6,}$/.test(parts[0].trim())) {
      return parts[0].trim();
    }
  }
  return '';
}

function extractUidFromLink(inputStr?: string): string {
  if (!inputStr) return '';
  const str = inputStr.trim();
  if (/^[0-9]{6,}$/.test(str)) return str;

  const idMatch = str.match(/(?:id=|\/profile\.php\?id=|\/user\/|\/)([0-9]{6,})/);
  if (idMatch) return idMatch[1];

  const vanityMatch = str.match(/facebook\.com\/([a-zA-Z0-9._-]+)/);
  if (vanityMatch && !['profile.php', 'groups', 'pages'].includes(vanityMatch[1])) {
    return vanityMatch[1];
  }
  return '';
}

function parseFanpagesInput(text: string): FanpageItem[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: FanpageItem[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    let id = '';
    let name = '';
    let url = '';

    if (line.includes('|')) {
      const parts = line.split('|').map((p) => p.trim());
      id = parts[0].replace(/^https?:\/\/[^/]+\//, '').replace(/profile\.php\?id=/, '');
      name = parts[1] || '';
    } else if (line.includes('facebook.com')) {
      url = line;
      const idMatch = line.match(/(?:id=|\/profile\.php\?id=|\/pages\/[^/]+\/|\/)([0-9]{8,})/);
      if (idMatch) {
        id = idMatch[1];
      } else {
        const vanityMatch = line.match(/facebook\.com\/([a-zA-Z0-9._-]+)/);
        id = vanityMatch ? vanityMatch[1] : '';
      }
      name = name || `Fanpage ${id}`;
    } else {
      id = line.replace(/[^0-9a-zA-Z._-]/g, '');
      name = `Fanpage ${id}`;
    }

    if (id && !seen.has(id)) {
      seen.add(id);
      results.push({
        id,
        name: name || `Fanpage ${id}`,
        url: url || `https://www.facebook.com/${id}`,
      });
    }
  }

  return results;
}

export const ViaManagementPage: React.FC<ViaManagementPageProps> = ({
  accounts = [],
  loading = false,
  onRefresh,
  dbStatus = { connected: false, loading: false },
  onCheckDb,
  onNavigateToBuff,
}) => {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');

  // Input states
  const [linkOrUidInput, setLinkOrUidInput] = useState('');
  const [cookieInputVal, setCookieInputVal] = useState('');
  const [bulkInputText, setBulkInputText] = useState('');

  // Quản lý Fanpage của Via
  const [cachedPagesMap, setCachedPagesMap] = useState<Record<string, FanpageItem[]>>({});
  const [scanningUids, setScanningUids] = useState<Set<string>>(new Set());
  const [testingCookieIds, setTestingCookieIds] = useState<Set<number>>(new Set());
  const [selectedViaForPages, setSelectedViaForPages] = useState<ViaAccount | null>(null);
  const [isPageDrawerOpen, setIsPageDrawerOpen] = useState(false);
  const [pageSearchQuery, setPageSearchQuery] = useState('');

  // Modal Thêm thủ công Fanpage cho một Via trong Drawer
  const [manualAddText, setManualAddText] = useState('');
  const [isAddingManualToDrawer, setIsAddingManualToDrawer] = useState(false);

  // Search filter
  const [searchText, setSearchText] = useState('');

  // Tự động nhận diện UID từ Link hoặc Cookie đang nhập
  const recognizedUid = useMemo(() => {
    const fromLink = extractUidFromLink(linkOrUidInput);
    if (fromLink) return fromLink;
    return extractUidFromCookie(cookieInputVal);
  }, [linkOrUidInput, cookieInputVal]);

  // Tải danh sách Page đã cache từ Backend và LocalStorage
  const loadCachedPages = async () => {
    const pageMap: Record<string, FanpageItem[]> = {};

    // 1. Đọc từ Backend Cache
    try {
      const res = await api.get('/buff-cached-pages');
      if (res.data?.success && res.data.cache) {
        for (const [uid, item] of Object.entries(res.data.cache as Record<string, any>)) {
          if (Array.isArray(item.pages)) {
            pageMap[uid] = item.pages;
          }
        }
      }
    } catch (e) {}

    // 2. Đọc bổ sung từ LocalStorage
    try {
      const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
      if (raw) {
        const localMap = JSON.parse(raw);
        for (const [key, pages] of Object.entries(localMap as Record<string, any>)) {
          const uid = key.replace(/^cuser_/, '');
          if (Array.isArray(pages) && pages.length > 0) {
            if (!pageMap[uid] || pageMap[uid].length < pages.length) {
              pageMap[uid] = pages;
            }
          }
        }
      }
    } catch (e) {}

    setCachedPagesMap(pageMap);
  };

  useEffect(() => {
    loadCachedPages();
  }, []);

  // Lưu Pages cho một Via vào cả Backend và LocalStorage
  const persistPagesForVia = async (uid: string, pages: FanpageItem[], viaName: string = '') => {
    setCachedPagesMap((prev) => ({ ...prev, [uid]: pages }));

    try {
      const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
      const localMap = raw ? JSON.parse(raw) : {};
      localMap[`cuser_${uid}`] = pages;
      localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(localMap));
    } catch (e) {}

    try {
      await api.post('/buff-cache-pages', {
        uid,
        pages,
        viaName,
      });
    } catch (e) {}
  };

  // Quét toàn bộ Fanpage từ Cookie của Via bằng Playwright (LÀM SAU KHI ĐÃ CÓ VIA)
  const handleScanPagesForVia = async (via: ViaAccount) => {
    const uid = extractUidFromCookie(via.cookieString) || via.platformAccountId || String(via.id);
    if (!via.cookieString) {
      message.error('Tài khoản này không có Cookie Facebook để quét!');
      return;
    }

    setScanningUids((prev) => new Set(prev).add(uid));
    message.loading({
      content: `Đang mở trình duyệt quét toàn bộ Fanpage từ Cookie nick [${via.pageName || uid}]...`,
      key: `scan_${uid}`,
      duration: 20,
    });

    try {
      const res = await api.post('/buff-get-pages', {
        cookieString: via.cookieString,
        forceRefresh: true,
        viaName: via.pageName,
        proxyUrl: via.proxyUrl || '',
      });

      if (res.data?.success && Array.isArray(res.data.pages)) {
        const scanned = res.data.pages as FanpageItem[];
        const existing = cachedPagesMap[uid] || [];
        const merged = [...existing];
        let addedCount = 0;

        for (const p of scanned) {
          const idx = merged.findIndex((m) => m.id === p.id);
          if (idx !== -1) {
            if (p.name && (!merged[idx].name || merged[idx].name.includes('Fanpage ('))) {
              merged[idx] = { ...merged[idx], name: p.name };
            }
          } else {
            merged.push(p);
            addedCount++;
          }
        }

        await persistPagesForVia(uid, merged, via.pageName || `Via ${uid}`);
        message.success({
          content: `Quét xong! Tìm thấy ${scanned.length} Fanpage cho Via ${via.pageName || uid} (Tổng hiện có: ${merged.length} Page)`,
          key: `scan_${uid}`,
          duration: 4,
        });
      } else {
        message.warning({
          content: 'Không tìm thấy Fanpage nào hoặc Cookie cần xác minh.',
          key: `scan_${uid}`,
        });
      }
    } catch (err: any) {
      message.error({
        content: `Lỗi quét Fanpage: ${err.response?.data?.error || err.message}`,
        key: `scan_${uid}`,
      });
    } finally {
      setScanningUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  // 1. THÊM 1 VIA (NHẬP TỪNG Ô RÕ RÀNG)
  const handleAddSingleVia = async (values: any) => {
    try {
      setSubmitting(true);
      const cookieStr = (values.cookieString || '').trim();
      if (!cookieStr) {
        message.error('Vui lòng dán chuỗi Cookie Facebook của Via!');
        return;
      }

      // Trích xuất UID từ Link/UID input hoặc từ Cookie
      const uidFromLink = extractUidFromLink(values.profileUrl);
      const uidFromCookie = extractUidFromCookie(cookieStr);
      const finalUid = uidFromLink || uidFromCookie || `via_${Date.now()}`;

      // Tên Via
      const finalPageName = values.pageName?.trim() || `Via ${finalUid}`;

      await api.post('/connections', {
        pageName: finalPageName,
        platformAccountId: finalUid,
        cookieString: cookieStr,
        proxyUrl: values.proxyUrl ? values.proxyUrl.trim() : '',
        platform: 'FACEBOOK_PROFILE',
        accountType: 'PERSONAL_PROFILE_COOKIE',
      });

      message.success(`Đã thêm thành công Via: [${finalPageName}] (UID: ${finalUid})!`);
      form.resetFields();
      setLinkOrUidInput('');
      setCookieInputVal('');
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 2. THÊM HÀNG LOẠT NHIỀU VIA (BULK IMPORT)
  const handleAddBulkVias = async () => {
    if (!bulkInputText.trim()) {
      message.warning('Vui lòng dán danh sách Via vào ô bên dưới!');
      return;
    }

    const lines = bulkInputText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      message.warning('Không có dòng dữ liệu Via hợp lệ!');
      return;
    }

    setSubmitting(true);
    message.loading({ content: `Đang xử lý nạp ${lines.length} Via vào hệ thống...`, key: 'bulkAdd' });

    let successCount = 0;
    let failCount = 0;

    for (const line of lines) {
      try {
        let name = '';
        let cookie = '';
        let proxy = '';
        let uid = '';

        if (line.includes('|')) {
          const parts = line.split('|').map((p) => p.trim());
          const cookieIdx = parts.findIndex((p) => p.includes('c_user='));
          if (cookieIdx !== -1) {
            cookie = parts[cookieIdx];
            uid = extractUidFromCookie(cookie) || parts[0];
            name = parts[1] && !parts[1].includes('=') && !parts[1].includes('http') ? parts[1] : `Via ${uid}`;
            const proxyPart = parts.find((p) => p.includes(':') && (p.includes('.') || p.includes('http')));
            if (proxyPart && proxyPart !== cookie) proxy = proxyPart;
          } else {
            // Định dạng UID/Link | Tên | Cookie | Proxy
            uid = extractUidFromLink(parts[0]) || parts[0];
            name = parts[1] || `Via ${uid}`;
            cookie = parts[2] || line;
            proxy = parts[3] || '';
          }
        } else {
          // Chỉ có cookie
          cookie = line;
          uid = extractUidFromCookie(line);
          name = uid ? `Via ${uid}` : 'Via Facebook';
        }

        if (!cookie) continue;

        await api.post('/connections', {
          pageName: name,
          platformAccountId: uid || `via_${Date.now()}`,
          cookieString: cookie,
          proxyUrl: proxy,
          platform: 'FACEBOOK_PROFILE',
          accountType: 'PERSONAL_PROFILE_COOKIE',
        });
        successCount++;
      } catch (e) {
        failCount++;
      }
    }

    setSubmitting(false);
    setBulkInputText('');
    onRefresh();

    if (successCount > 0) {
      message.success({
        content: `Đã nạp thành công ${successCount} Via vào hệ thống!${failCount > 0 ? ` (${failCount} lỗi)` : ''}`,
        key: 'bulkAdd',
        duration: 4,
      });
    } else {
      message.error({ content: 'Không thêm được Via nào. Vui lòng kiểm tra định dạng Cookie!', key: 'bulkAdd' });
    }
  };

  // Kiểm tra sống/chết của Cookie riêng từng nick
  const handleTestViaLive = async (via: ViaAccount) => {
    setTestingCookieIds((prev) => new Set(prev).add(via.id));
    try {
      const res = await api.post('/buff-like/test-cookie', {
        cookieString: via.cookieString,
        proxyUrl: via.proxyUrl || '',
      });
      if (res.data?.live) {
        message.success(`Cookie nick [${via.pageName}] còn LIVE hoạt động tốt!`);
        await api.put(`/connections/${via.id}`, { tokenStatus: 'OK' });
        onRefresh();
      } else {
        message.error(`Cookie nick [${via.pageName}] đã CHECKPOINT hoặc hết hạn!`);
        await api.put(`/connections/${via.id}`, { tokenStatus: 'CHECKPOINT' });
        onRefresh();
      }
    } catch (e: any) {
      if (via.cookieString?.includes('c_user=') && via.cookieString?.includes('xs=')) {
        message.info(`Cookie nick [${via.pageName}] có cấu trúc hợp lệ (c_user + xs).`);
      } else {
        message.warning(`Cookie nick [${via.pageName}] thiếu c_user hoặc xs.`);
      }
    } finally {
      setTestingCookieIds((prev) => {
        const next = new Set(prev);
        next.delete(via.id);
        return next;
      });
    }
  };

  // Xóa Via
  const handleDeleteVia = async (id: number) => {
    try {
      await api.delete(`/connections/${id}`);
      message.success('Đã xóa tài khoản Via khỏi hệ thống');
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  // Thêm Page thủ công vào Via đang mở Drawer
  const handleSaveManualToDrawer = async () => {
    if (!selectedViaForPages || !manualAddText.trim()) {
      message.warning('Vui lòng nhập ít nhất 1 dòng ID_PAGE | Tên Page hoặc link Facebook!');
      return;
    }
    const uid = extractUidFromCookie(selectedViaForPages.cookieString) || selectedViaForPages.platformAccountId || String(selectedViaForPages.id);
    const parsed = parseFanpagesInput(manualAddText);
    if (parsed.length === 0) {
      message.error('Không tìm thấy ID Fanpage hợp lệ trong nội dung đã nhập!');
      return;
    }

    const existing = cachedPagesMap[uid] || [];
    const merged = [...existing];
    let newCount = 0;
    for (const p of parsed) {
      const idx = merged.findIndex((m) => m.id === p.id);
      if (idx !== -1) {
        if (p.name) merged[idx].name = p.name;
      } else {
        merged.push(p);
        newCount++;
      }
    }

    await persistPagesForVia(uid, merged, selectedViaForPages.pageName || `Via ${uid}`);
    message.success(`Đã thêm ${newCount} Fanpage mới vào Via [${selectedViaForPages.pageName}]!`);
    setManualAddText('');
    setIsAddingManualToDrawer(false);
  };

  // Xóa 1 Page khỏi Via
  const handleDeletePageFromVia = async (pageId: string) => {
    if (!selectedViaForPages) return;
    const uid = extractUidFromCookie(selectedViaForPages.cookieString) || selectedViaForPages.platformAccountId || String(selectedViaForPages.id);
    const existing = cachedPagesMap[uid] || [];
    const updated = existing.filter((p) => p.id !== pageId);
    await persistPagesForVia(uid, updated, selectedViaForPages.pageName);
    message.success('Đã xóa Fanpage khỏi Via này');
  };

  // Xóa toàn bộ Page khỏi Via
  const handleClearAllPagesFromVia = async () => {
    if (!selectedViaForPages) return;
    const uid = extractUidFromCookie(selectedViaForPages.cookieString) || selectedViaForPages.platformAccountId || String(selectedViaForPages.id);
    await persistPagesForVia(uid, [], selectedViaForPages.pageName);
    message.info('Đã xóa toàn bộ danh sách Fanpage của Via này');
  };

  // Tính tổng số Fanpage trên toàn bộ hệ thống
  const totalFanpagesCount = useMemo(() => {
    let count = 0;
    for (const pages of Object.values(cachedPagesMap)) {
      count += pages.length;
    }
    return count;
  }, [cachedPagesMap]);

  // Danh sách tài khoản đã lọc theo tìm kiếm
  const filteredAccounts = useMemo(() => {
    return accounts.filter((acc) => {
      const q = searchText.toLowerCase().trim();
      if (!q) return true;
      const uid = extractUidFromCookie(acc.cookieString) || acc.platformAccountId || '';
      return (
        (acc.pageName || '').toLowerCase().includes(q) ||
        uid.toLowerCase().includes(q) ||
        (acc.proxyUrl || '').toLowerCase().includes(q)
      );
    });
  }, [accounts, searchText]);

  // Danh sách Fanpage của Via đang chọn xem chi tiết trong Drawer
  const currentViaUid = selectedViaForPages
    ? extractUidFromCookie(selectedViaForPages.cookieString) || selectedViaForPages.platformAccountId || String(selectedViaForPages.id)
    : '';
  const currentViaPages = cachedPagesMap[currentViaUid] || [];
  const filteredCurrentViaPages = useMemo(() => {
    if (!pageSearchQuery.trim()) return currentViaPages;
    const q = pageSearchQuery.toLowerCase().trim();
    return currentViaPages.filter((p) => p.name.toLowerCase().includes(q) || p.id.includes(q));
  }, [currentViaPages, pageSearchQuery]);

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-20">
      {/* 1. TOP STATS OVERVIEW CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Tổng số Via */}
        <div className="app-surface p-4 flex items-center justify-between border-l-4 border-sky-500">
          <div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Tổng Số Via Facebook</div>
            <div className="text-2xl font-black text-white mt-1 flex items-baseline gap-2">
              <span>{accounts.length}</span>
              <span className="text-xs font-normal text-slate-400">nick</span>
            </div>
            <div className="text-[11px] text-emerald-400 mt-1 font-semibold flex items-center gap-1">
              <CheckCircleFilled /> {accounts.filter((a) => a.tokenStatus !== 'EXPIRED' && a.tokenStatus !== 'CHECKPOINT').length} Nick Live
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-sky-950/80 border border-sky-800/60 flex items-center justify-center text-sky-400 text-xl">
            <UserOutlined />
          </div>
        </div>

        {/* Card 2: Tổng số Fanpage */}
        <div className="app-surface p-4 flex items-center justify-between border-l-4 border-cyan-500">
          <div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Fanpage Trực Thuộc</div>
            <div className="text-2xl font-black text-cyan-300 mt-1 flex items-baseline gap-2">
              <span>{totalFanpagesCount}</span>
              <span className="text-xs font-normal text-slate-400">Page</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Sẵn sàng xoay vòng tương tác
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center text-cyan-400 text-xl">
            <ThunderboltOutlined />
          </div>
        </div>

        {/* Card 3: Trạng thái Database */}
        <div className="app-surface p-4 flex items-center justify-between border-l-4 border-emerald-500">
          <div className="min-w-0">
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Cơ Sở Dữ Liệu MySQL</div>
            <div className="text-base font-bold text-slate-100 mt-1 truncate">
              {dbStatus.connected ? 'MySQL Workbench' : dbStatus.usingCache ? 'Bộ Nhớ Đệm Cache' : 'Ngoại tuyến'}
            </div>
            <div className="text-[11px] mt-1 font-mono">
              {dbStatus.connected ? (
                <span className="text-emerald-400 font-bold">● ONLINE: {dbStatus.database || 'autopost_saas'}</span>
              ) : dbStatus.usingCache ? (
                <span className="text-amber-400 font-semibold">● CACHE ({dbStatus.cachedCount || accounts.length} Nick)</span>
              ) : (
                <span className="text-rose-400 font-semibold">● OFFLINE</span>
              )}
            </div>
          </div>
          <div
            onClick={onCheckDb}
            className="w-11 h-11 rounded-xl bg-slate-900 border border-slate-700/80 hover:border-slate-500 flex items-center justify-center text-slate-300 text-lg cursor-pointer"
            title="Nhấp để kiểm tra kết nối MySQL"
          >
            <DatabaseOutlined />
          </div>
        </div>

        {/* Card 4: Thao tác & Đồng bộ */}
        <div className="app-surface p-4 flex items-center justify-between border-l-4 border-indigo-500">
          <div>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Đồng Bộ & Điều Hướng</div>
            <div className="text-xs text-slate-300 mt-1.5 flex flex-wrap gap-2">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => {
                  onRefresh();
                  loadCachedPages();
                  message.success('Đã làm mới danh sách dàn Via');
                }}
                className="bg-slate-900 border-slate-700 text-slate-200 text-xs rounded-lg hover:border-slate-500"
              >
                Làm mới
              </Button>
              {onNavigateToBuff && (
                <Button
                  size="small"
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={onNavigateToBuff}
                  className="bg-cyan-600 hover:bg-cyan-500 text-xs rounded-lg font-semibold"
                >
                  Sang Buff Like
                </Button>
              )}
            </div>
          </div>
          <div className="w-11 h-11 rounded-xl bg-indigo-950/80 border border-indigo-800/60 flex items-center justify-center text-indigo-400 text-xl">
            <SafetyCertificateOutlined />
          </div>
        </div>
      </div>

      {/* 2. BƯỚC 1: NHẬP & KÍCH HOẠT VIA MỚI (CHUYÊN BIỆT ADD VIA - KHÔNG LẪN LỘN FANPAGE) */}
      <div className="app-surface p-5 border border-cyan-500/30 shadow-xl shadow-cyan-950/20 rounded-2xl relative overflow-hidden">
        {/* Glow accent */}
        <div className="absolute top-0 right-0 w-80 h-36 bg-gradient-to-bl from-cyan-500/10 via-blue-500/5 to-transparent blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-600 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-cyan-500/20">
              1
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 m-0 flex items-center gap-2">
                <span>Nhập & Thêm Via Mới Vào Hệ Thống</span>
                {recognizedUid && (
                  <Tag color="cyan" className="font-mono text-xs font-bold rounded-full px-2 border-0">
                    UID Nhận Diện: {recognizedUid}
                  </Tag>
                )}
              </h3>
              <p className="text-xs text-slate-400 m-0 mt-0.5">
                Chỉ cần nhập Via trước (Link Facebook, Tên gợi nhớ, Cookie, Proxy). Sau khi thêm vào danh sách, bạn có thể Quét hoặc Dán Fanpage sau.
              </p>
            </div>
          </div>

          {/* Chọn chế độ: Nhập 1 Via vs Nhập Hàng Loạt */}
          <Segmented
            value={addMode}
            onChange={(val) => setAddMode(val as 'single' | 'bulk')}
            options={[
              { label: '📝 Nhập từng Via (Từng ô rõ ràng)', value: 'single' },
              { label: '📋 Nhập hàng loạt nhiều Via (Dán cột)', value: 'bulk' },
            ]}
            className="bg-slate-950 border border-slate-700/80 p-1 text-xs font-bold text-slate-200"
          />
        </div>

        {/* CHẾ ĐỘ 1: NHẬP TỪNG VIA THEO TỪNG CỘT RÕ RÀNG */}
        {addMode === 'single' ? (
          <Form form={form} layout="vertical" onFinish={handleAddSingleVia}>
            <Row gutter={16}>
              {/* Cột 1: Tên gợi nhớ */}
              <Col xs={24} sm={12} lg={6}>
                <Form.Item
                  label={
                    <span className="text-xs font-semibold text-slate-200">
                      1. Tên gợi nhớ Via <span className="text-slate-500 font-normal">(Tùy chọn)</span>
                    </span>
                  }
                  name="pageName"
                  className="mb-3"
                >
                  <Input
                    placeholder="Ví dụ: ThanhAn, Nick Nuôi 01"
                    className="bg-slate-950 border-slate-700/80 text-slate-100 text-xs rounded-xl h-10 hover:border-cyan-500 focus:border-cyan-500"
                  />
                </Form.Item>
              </Col>

              {/* Cột 2: Link Facebook hoặc UID */}
              <Col xs={24} sm={12} lg={6}>
                <Form.Item
                  label={
                    <span className="text-xs font-semibold text-slate-200">
                      2. Link Facebook / UID Via <span className="text-slate-500 font-normal">(Tùy chọn)</span>
                    </span>
                  }
                  name="profileUrl"
                  className="mb-3"
                >
                  <Input
                    value={linkOrUidInput}
                    onChange={(e) => setLinkOrUidInput(e.target.value)}
                    placeholder="https://facebook.com/1000... hoặc 1000898..."
                    prefix={<FacebookFilled className="text-blue-400" />}
                    className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-cyan-500 focus:border-cyan-500"
                  />
                </Form.Item>
              </Col>

              {/* Cột 3: Proxy riêng */}
              <Col xs={24} sm={12} lg={12}>
                <Form.Item
                  label={
                    <span className="text-xs font-semibold text-slate-200">
                      3. Proxy riêng cho Via này <span className="text-slate-500 font-normal">(Tùy chọn, để trống dùng IP máy)</span>
                    </span>
                  }
                  name="proxyUrl"
                  className="mb-3"
                >
                  <Input
                    placeholder="http://user:pass@ip:port hoặc socks5://... (Nếu có)"
                    prefix={<GlobalOutlined className="text-slate-400" />}
                    className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-cyan-500 focus:border-cyan-500"
                  />
                </Form.Item>
              </Col>

              {/* Cột 4: Chuỗi Cookie Facebook (Bắt buộc) */}
              <Col xs={24}>
                <Form.Item
                  label={
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs font-semibold text-slate-200">
                        4. Chuỗi Cookie Facebook <span className="text-rose-400">*</span>
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Hỗ trợ cả chuỗi Cookie riêng lẻ (<code className="text-cyan-300">c_user=...; xs=...</code>) hoặc chuỗi full (<code className="text-cyan-300">UID|PASS|2FA|COOKIE...</code>)
                      </span>
                    </div>
                  }
                  name="cookieString"
                  rules={[{ required: true, message: 'Vui lòng dán chuỗi Cookie Facebook!' }]}
                  className="mb-3"
                >
                  <Input.TextArea
                    rows={3}
                    value={cookieInputVal}
                    onChange={(e) => setCookieInputVal(e.target.value)}
                    placeholder="Dán Cookie vào đây: c_user=1000...; xs=...; sb=... hoặc chuỗi UID|Pass|2FA|c_user=...; xs=..."
                    className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl hover:border-cyan-500 focus:border-cyan-500"
                  />
                </Form.Item>
              </Col>
            </Row>

            <div className="flex items-center justify-between pt-2">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <span className="text-cyan-400 font-bold">Lưu ý:</span> Khi lưu xong, Via sẽ xuất hiện ngay trong danh sách bên dưới. Bạn có thể bấm nút <b>"Quét Page"</b> hoặc <b>"Thêm Page"</b> bất cứ lúc nào!
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => {
                    form.resetFields();
                    setLinkOrUidInput('');
                    setCookieInputVal('');
                  }}
                  className="rounded-xl border-slate-700 text-slate-400 hover:text-slate-200 text-xs px-4 h-10"
                >
                  Làm trống ô
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                  icon={<PlusCircleFilled />}
                  className="bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 hover:from-cyan-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl px-6 h-10 shadow-lg shadow-cyan-500/20 border-0 flex items-center gap-2"
                >
                  Lưu & Thêm Via Ngay
                </Button>
              </div>
            </div>
          </Form>
        ) : (
          /* CHẾ ĐỘ 2: NHẬP HÀNG LOẠT NHIỀU VIA (BULK IMPORT DẠNG CỘT) */
          <div className="space-y-3">
            <div className="text-xs text-slate-300">
              Dán danh sách nhiều nick cùng lúc (Mỗi dòng một nick). Hệ thống hỗ trợ 2 định dạng phổ biến:
              <div className="mt-1 font-mono text-[11px] text-cyan-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <div>• Định dạng 1: <span className="text-slate-200">UID/Link | Tên Via | Cookie | Proxy</span></div>
                <div>• Định dạng 2 (Chuỗi mua Via): <span className="text-slate-200">UID | Password | 2FA | Cookie | Proxy</span></div>
                <div>• Định dạng 3: <span className="text-slate-200">Chỉ dán chuỗi Cookie (mỗi dòng 1 cookie)</span></div>
              </div>
            </div>

            <Input.TextArea
              rows={6}
              value={bulkInputText}
              onChange={(e) => setBulkInputText(e.target.value)}
              placeholder={`100089876543210 | ThanhAn | c_user=100089876543210; xs=... | http://user:pass@1.2.3.4:8080\n100098765432100 | NickNuoi02 | c_user=100098765432100; xs=... |\nhttps://facebook.com/100076543210987 | Nick03 | c_user=100076543210987; xs=...`}
              className="bg-slate-950 border-slate-700/80 text-slate-100 font-mono text-xs rounded-xl hover:border-cyan-500 focus:border-cyan-500"
            />

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                Đã nhập: {bulkInputText.split('\n').filter((l) => l.trim()).length} dòng nick
              </span>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setBulkInputText('')}
                  className="rounded-xl border-slate-700 text-slate-400 text-xs px-3 h-9"
                >
                  Xoá nội dung
                </Button>
                <Button
                  type="primary"
                  loading={submitting}
                  onClick={handleAddBulkVias}
                  icon={<UploadOutlined />}
                  className="bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-xl px-5 h-9 border-0"
                >
                  Nạp Tất Cả Via Vào Hệ Thống
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. BƯỚC 2: DANH SÁCH DÀN VIA & THAO TÁC FANPAGE */}
      <div className="app-surface p-5 space-y-4 rounded-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-sm">
              2
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-100 m-0 flex items-center gap-2">
                <span>Danh Sách Dàn Via Đã Kích Hoạt</span>
                <Tag color="cyan" className="font-mono text-xs font-bold rounded-full px-2 border-0">
                  {filteredAccounts.length} Nick
                </Tag>
              </h3>
              <p className="text-xs text-slate-400 m-0 mt-0.5">
                Tại đây bạn có thể bấm <b>"Quét Page"</b> để mở Playwright quét tự động Fanpage, hoặc bấm <b>"Thêm Page"</b> để dán danh sách Fanpage cho riêng nick đó.
              </p>
            </div>
          </div>

          {/* Search box & Refresh */}
          <div className="flex items-center gap-2.5">
            <Input
              placeholder="Tìm theo tên Via, UID hoặc Proxy..."
              prefix={<SearchOutlined className="text-slate-400" />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-64 bg-slate-950 border-slate-700/80 text-slate-100 text-xs rounded-xl h-9 hover:border-slate-600"
              allowClear
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                onRefresh();
                loadCachedPages();
              }}
              loading={loading}
              className="bg-slate-900 border-slate-700 text-slate-200 text-xs rounded-xl h-9 hover:border-slate-500"
            >
              Làm mới
            </Button>
          </div>
        </div>

        {/* Bảng danh sách Via */}
        <Table
          dataSource={filteredAccounts}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          className="border border-slate-800/80 rounded-xl overflow-hidden"
          locale={{
            emptyText: (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-center text-slate-500 text-2xl">
                  <UserOutlined />
                </div>
                <div className="text-slate-300 font-bold text-sm">Chưa có tài khoản Via nào</div>
                <p className="text-slate-500 text-xs max-w-sm text-center">
                  Hãy nhập Cookie hoặc dán danh sách nick vào khung <b>"1. Nhập & Thêm Via Mới"</b> ở trên để bắt đầu!
                </p>
              </div>
            ),
          }}
          columns={[
            {
              title: 'Tài khoản / Via',
              key: 'accountInfo',
              render: (_: any, record: ViaAccount) => {
                const uid = extractUidFromCookie(record.cookieString) || record.platformAccountId || String(record.id);
                return (
                  <div className="flex items-center gap-3 py-1">
                    <Avatar
                      src={uid ? `https://graph.facebook.com/${uid}/picture?type=normal` : undefined}
                      icon={<UserOutlined />}
                      size={40}
                      className="shrink-0 bg-slate-800 border border-slate-700"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-100 text-sm flex items-center gap-2">
                        <span className="truncate">{record.pageName || `Via ${uid}`}</span>
                        <Tag color="purple" className="text-[10px] font-mono rounded px-1.5 py-0 border-0 leading-tight">
                          Profile
                        </Tag>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        ID: #{record.id}
                      </div>
                    </div>
                  </div>
                );
              },
            },
            {
              title: 'Link Facebook & UID',
              key: 'facebookLink',
              render: (_: any, record: ViaAccount) => {
                const uid = extractUidFromCookie(record.cookieString) || record.platformAccountId || String(record.id);
                const fbUrl = `https://www.facebook.com/${uid}`;
                return (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 font-mono text-xs text-slate-200">
                      <span className="text-cyan-400 font-semibold">{uid}</span>
                      <Tooltip title="Sao chép UID">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined className="text-[11px] text-slate-400 hover:text-cyan-300" />}
                          onClick={() => {
                            navigator.clipboard.writeText(uid);
                            message.success(`Đã sao chép UID: ${uid}`);
                          }}
                          className="p-0 h-4 w-4"
                        />
                      </Tooltip>
                    </div>
                    {uid && (
                      <a
                        href={fbUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
                      >
                        <FacebookFilled /> Mở Profile Facebook
                      </a>
                    )}
                  </div>
                );
              },
            },
            {
              title: 'Dàn Fanpage Trực Thuộc',
              key: 'pages',
              render: (_: any, record: ViaAccount) => {
                const uid = extractUidFromCookie(record.cookieString) || record.platformAccountId || String(record.id);
                const pages = cachedPagesMap[uid] || [];
                const isScanning = scanningUids.has(uid);

                return (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Tag
                        color={pages.length > 0 ? 'cyan' : 'default'}
                        className="font-mono text-xs font-bold rounded-lg px-2.5 py-0.5 border-0"
                      >
                        {pages.length > 0 ? `${pages.length} Fanpage` : '0 Page (Chưa quét)'}
                      </Tag>

                      {pages.length > 0 && (
                        <Button
                          size="small"
                          icon={<EyeOutlined />}
                          onClick={() => {
                            setSelectedViaForPages(record);
                            setIsPageDrawerOpen(true);
                          }}
                          className="bg-slate-900 border-slate-700 hover:border-cyan-500 text-cyan-300 text-xs rounded-lg font-medium h-6 px-2"
                        >
                          Xem ({pages.length})
                        </Button>
                      )}
                    </div>

                    {/* Các nút hành động riêng cho Fanpage của Via này */}
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Tooltip title="Mở Playwright quét toàn bộ Fanpage từ Cookie của nick này">
                        <Button
                          size="small"
                          type="primary"
                          loading={isScanning}
                          icon={<ThunderboltOutlined />}
                          onClick={() => handleScanPagesForVia(record)}
                          className="bg-cyan-600 hover:bg-cyan-500 text-[11px] rounded-lg font-semibold border-0 h-6 px-2"
                        >
                          {isScanning ? 'Đang quét...' : 'Quét Page'}
                        </Button>
                      </Tooltip>

                      <Tooltip title="Dán danh sách ID/Link Fanpage thủ công cho riêng Via này">
                        <Button
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => {
                            setSelectedViaForPages(record);
                            setIsPageDrawerOpen(true);
                            setIsAddingManualToDrawer(true);
                          }}
                          className="bg-slate-800 border-slate-700 text-slate-300 text-[11px] rounded-lg h-6 px-2"
                        >
                          + Thêm Page
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                );
              },
            },
            {
              title: 'Proxy Riêng',
              key: 'proxyUrl',
              render: (_: any, record: ViaAccount) => {
                const val = record.proxyUrl;
                return val ? (
                  <Tooltip title={val}>
                    <Tag color="blue" className="font-mono text-xs rounded-lg px-2 py-0.5 border-0 flex items-center gap-1 max-w-[160px] truncate">
                      <GlobalOutlined /> {val.replace(/:[^:]+@/, ':***@').slice(0, 18)}...
                    </Tag>
                  </Tooltip>
                ) : (
                  <span className="text-slate-500 text-xs italic flex items-center gap-1">
                    <CompassOutlined /> Direct (Mạng máy)
                  </span>
                );
              },
            },
            {
              title: 'Trạng thái Cookie',
              key: 'tokenStatus',
              render: (_: any, record: ViaAccount) => {
                const isLive = record.tokenStatus !== 'EXPIRED' && record.tokenStatus !== 'CHECKPOINT';
                const isTesting = testingCookieIds.has(record.id);
                return (
                  <div className="flex items-center gap-2">
                    {isLive ? (
                      <Badge
                        status="success"
                        text={<span className="text-emerald-400 font-bold text-xs">LIVE</span>}
                      />
                    ) : (
                      <Badge
                        status="error"
                        text={<span className="text-rose-400 font-bold text-xs">{record.tokenStatus || 'CHECKPOINT'}</span>}
                      />
                    )}

                    <Tooltip title="Kiểm tra Cookie còn sống hay đã checkpoint">
                      <Button
                        size="small"
                        type="text"
                        loading={isTesting}
                        icon={<SyncOutlined className="text-[11px]" />}
                        onClick={() => handleTestViaLive(record)}
                        className="text-slate-400 hover:text-cyan-300 text-[11px] p-0 h-5"
                      >
                        Check
                      </Button>
                    </Tooltip>
                  </div>
                );
              },
            },
            {
              title: 'Thao Tác',
              key: 'actions',
              align: 'right',
              render: (_: any, record: ViaAccount) => {
                return (
                  <Popconfirm
                    title="Xóa tài khoản Via này?"
                    description="Tài khoản và liên kết dàn Page sẽ bị xóa khỏi hệ thống."
                    onConfirm={() => handleDeleteVia(record.id)}
                    okText="Xóa luôn"
                    cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      className="hover:bg-rose-950/40 rounded-lg text-slate-400 hover:text-rose-400"
                    >
                      Xóa
                    </Button>
                  </Popconfirm>
                );
              },
            },
          ]}
        />
      </div>

      {/* 4. DRAWER: XEM & QUẢN LÝ DANH SÁCH FANPAGE CHI TIẾT CỦA MỘT VIA */}
      <Drawer
        title={
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 text-slate-100 font-bold text-base">
              <ThunderboltOutlined className="text-cyan-400" />
              <span>Dàn Fanpage Của Via: {selectedViaForPages?.pageName}</span>
            </div>
            <Tag color="cyan" className="font-mono text-xs font-bold rounded-full px-2.5 py-0.5 border-0">
              {currentViaPages.length} Fanpage
            </Tag>
          </div>
        }
        placement="right"
        width={560}
        open={isPageDrawerOpen}
        onClose={() => {
          setIsPageDrawerOpen(false);
          setIsAddingManualToDrawer(false);
        }}
        className="dark-drawer"
        styles={{
          body: { backgroundColor: '#070b13', padding: '16px' },
          header: { backgroundColor: '#0c1220', borderBottom: '1px solid rgba(255,255,255,0.08)' },
        }}
      >
        {selectedViaForPages && (
          <div className="space-y-4">
            {/* Action Bar */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Input
                placeholder="Tìm Page theo tên hoặc ID..."
                prefix={<SearchOutlined className="text-slate-400" />}
                value={pageSearchQuery}
                onChange={(e) => setPageSearchQuery(e.target.value)}
                className="w-60 bg-slate-900 border-slate-700 text-slate-200 text-xs rounded-xl h-8"
                allowClear
              />

              <Space>
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={scanningUids.has(currentViaUid)}
                  onClick={() => handleScanPagesForVia(selectedViaForPages)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-xs rounded-lg font-semibold"
                >
                  Quét tự động lại
                </Button>

                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => setIsAddingManualToDrawer(!isAddingManualToDrawer)}
                  className="bg-slate-800 border-slate-700 text-slate-200 text-xs rounded-lg"
                >
                  {isAddingManualToDrawer ? 'Đóng form' : '+ Dán thêm Page'}
                </Button>
              </Space>
            </div>

            {/* Form dán thêm Page thủ công */}
            {isAddingManualToDrawer && (
              <div className="p-3.5 rounded-xl bg-slate-900/90 border border-cyan-500/30 space-y-2.5">
                <div className="text-xs font-semibold text-cyan-300">
                  Dán thêm danh sách Fanpage cho riêng Via này:
                </div>
                <div className="text-[11px] text-slate-400">
                  Định dạng: <code className="text-cyan-300">ID_PAGE | Tên Page</code> hoặc dán URL Facebook (mỗi dòng 1 page):
                </div>
                <Input.TextArea
                  rows={4}
                  value={manualAddText}
                  onChange={(e) => setManualAddText(e.target.value)}
                  placeholder={`61586984840264 | Làm con mèo\n10008765432198 | Fanpage Bán Hàng\nhttps://www.facebook.com/10009876543210`}
                  className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="small"
                    onClick={() => {
                      setManualAddText('');
                      setIsAddingManualToDrawer(false);
                    }}
                    className="rounded-lg text-xs"
                  >
                    Hủy
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={handleSaveManualToDrawer}
                    className="bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-semibold"
                  >
                    Lưu danh sách Page
                  </Button>
                </div>
              </div>
            )}

            {/* Danh sách Fanpage */}
            <div className="space-y-2">
              {filteredCurrentViaPages.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  {currentViaPages.length === 0
                    ? 'Chưa có Fanpage nào được liên kết. Hãy bấm "Quét tự động lại" hoặc "+ Dán thêm Page" ở trên!'
                    : 'Không tìm thấy Page nào phù hợp với từ khóa tìm kiếm.'}
                </div>
              ) : (
                filteredCurrentViaPages.map((page) => (
                  <div
                    key={page.id}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar
                        src={`https://graph.facebook.com/${page.id}/picture?type=normal`}
                        icon={<ThunderboltOutlined />}
                        size={36}
                        className="shrink-0 bg-cyan-950 border border-cyan-800/60 text-cyan-400"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-200 text-xs truncate">
                          {page.name || `Fanpage ${page.id}`}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                          <span>ID: {page.id}</span>
                          <Tooltip title="Sao chép ID Page">
                            <Button
                              type="text"
                              size="small"
                              icon={<CopyOutlined className="text-[10px]" />}
                              onClick={() => {
                                navigator.clipboard.writeText(page.id);
                                message.success(`Đã chép ID: ${page.id}`);
                              }}
                              className="p-0 h-4 w-4 text-slate-400 hover:text-cyan-300"
                            />
                          </Tooltip>
                          {page.url && (
                            <a
                              href={page.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:underline flex items-center gap-0.5 ml-1"
                            >
                              <LinkOutlined /> Mở Page
                            </a>
                          )}
                        </div>
                      </div>
                    </div>

                    <Popconfirm
                      title="Xóa Fanpage này khỏi Via?"
                      onConfirm={() => handleDeletePageFromVia(page.id)}
                      okText="Xóa"
                      cancelText="Hủy"
                      okButtonProps={{ danger: true }}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined className="text-xs" />}
                        className="hover:bg-rose-950/40 rounded-lg"
                      />
                    </Popconfirm>
                  </div>
                ))
              )}
            </div>

            {/* Clear all pages button */}
            {currentViaPages.length > 0 && (
              <div className="pt-3 border-t border-slate-800/80 flex justify-between items-center text-xs text-slate-500">
                <span>Tổng cộng: {currentViaPages.length} Fanpage</span>
                <Popconfirm
                  title="Xóa toàn bộ Fanpage của Via này?"
                  description="Danh sách sẽ bị xóa sạch khỏi bộ nhớ."
                  onConfirm={handleClearAllPagesFromVia}
                  okText="Xóa hết"
                  cancelText="Hủy"
                  okButtonProps={{ danger: true }}
                >
                  <Button size="small" type="link" danger className="p-0 text-xs">
                    Xóa tất cả Page của Via này
                  </Button>
                </Popconfirm>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
};

export default ViaManagementPage;
