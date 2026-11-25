import { offerTopUpAfterCookieUpdate } from '../utils/topUp';
import React, { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
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
  Modal,
  Row,
  Col,
  Avatar,
  Segmented,
  Tabs,
  Typography,
} from 'antd';
import {
  KeyOutlined,
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
  CrownOutlined,
  ClusterOutlined,
  AppstoreOutlined,
  TeamOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import api from '../config/axios';
import {
  parseFacebookCookie,
  extractUidFromCookie as extractUidHelper,
  ParsedFacebookCookie,
} from '../utils/cookieHelper';
import {
  getInitialSeedVias,
  getInitialSeedPages,
  seedLocalStorageIfEmpty,
  saveStoredCookieForVia,
  getStoredCookieForVia,
} from '../config/seedHelper';

const { Text } = Typography;
const VIA_PAGES_STORAGE_KEY = 'buff_via_fanpages';

export interface ViaAccount {
  id: number;
  userId?: number;
  platform?: string;
  platformAccountId?: string;
  pageName?: string;
  cookieString?: string;
  accessToken?: string;
  accountType?: string;
  tokenStatus?: string;
  proxyUrl?: string;
  tokenCheckedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface FanpageItem {
  id: string;
  name: string;
  url: string;
  isProfile?: boolean;
}

export interface ChildAccountItem {
  id: number;
  platformAccountId: string;
  pageName: string;
  platform: string;
  accountType?: string;
  tokenStatus?: string;
  proxyUrl?: string;
}

export interface MotherViaAccount {
  id: number;
  uid: string;
  pageName: string;
  cookieString: string;
  proxyUrl?: string;
  tokenStatus: string;
  isProfileRow: boolean;
  rawAccounts: ViaAccount[];
  dbPages: ChildAccountItem[];
  dbGroups: ChildAccountItem[];
  scannedPages: FanpageItem[];
  totalUniquePagesCount: number;
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
    driver?: 'mysql' | 'sqlite';
    error?: string;
  };
  onCheckDb?: () => void;
  onNavigateToBuff?: () => void;
}

function extractUidFromCookie(cookieStr?: string): string {
  return extractUidHelper(cookieStr);
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

const DRAWER_PAGE_STEP = 50;
const EMPTY_PAGES: FanpageItem[] = [];
const EMPTY_CHILDREN: ChildAccountItem[] = [];

// Render long lists in batches so the Drawer opens fast for Vias with hundreds of Pages
function useIncrementalList<T>(items: T[], resetKey: string, step = DRAWER_PAGE_STEP) {
  const [limit, setLimit] = useState(step);
  useEffect(() => {
    setLimit(step);
  }, [resetKey, step]);
  const visible = useMemo(() => items.slice(0, limit), [items, limit]);
  return {
    visible,
    remaining: Math.max(0, items.length - limit),
    showMore: () => setLimit((prev) => prev + step),
  };
}

// Lazy-loaded Facebook avatar: the browser only loads it when scrolled into view
function fbAvatarSrc(id?: string) {
  if (!id || !/^[0-9]+$/.test(id)) return undefined;
  return (
    <img
      src={`https://graph.facebook.com/${id}/picture?type=normal`}
      loading="lazy"
      decoding="async"
      alt=""
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden';
      }}
    />
  );
}

const ShowMoreButton: React.FC<{ remaining: number; onClick: () => void }> = ({ remaining, onClick }) =>
  remaining > 0 ? (
    <Button
      block
      size="small"
      onClick={onClick}
      className="bg-slate-900 border-slate-700 hover:border-cyan-500 text-cyan-300 text-xs rounded-lg"
    >
      Show more ({remaining} left)
    </Button>
  ) : null;

/** Facebook Cookie fields entered separately (c_user and xs are required) */
const COOKIE_FIELDS: { key: string; label: string; required?: boolean; hint: string }[] = [
  { key: 'c_user', label: 'c_user', required: true, hint: 'UID, digits' },
  { key: 'xs', label: 'xs', required: true, hint: 'Long string with %3A' },
  { key: 'datr', label: 'datr', hint: 'Optional' },
  { key: 'sb', label: 'sb', hint: 'Optional' },
];

const parseCookieParts = (cookie: string): Record<string, string> => {
  const parsed = parseFacebookCookie(cookie);
  const out: Record<string, string> = {};
  if (parsed.c_user) out['c_user'] = parsed.c_user;
  if (parsed.xs) out['xs'] = parsed.xs;
  if (parsed.extraInfo?.datr) out['datr'] = parsed.extraInfo.datr;
  if (parsed.extraInfo?.sb) out['sb'] = parsed.extraInfo.sb;
  for (const f of COOKIE_FIELDS) {
    if (!out[f.key]) {
      const m = new RegExp(`(?:^|;\\s*)${f.key}=([^;]*)`).exec(cookie || '');
      if (m) out[f.key] = m[1].trim();
    }
  }
  return out;
};

const composeCookie = (parts: Record<string, string>) =>
  COOKIE_FIELDS.filter((f) => parts[f.key]?.trim())
    .map((f) => `${f.key}=${parts[f.key].trim()}`)
    .join('; ');

/** Cookie input usable in a Form.Item: paste the whole string or fill each box */
const CookieInput: React.FC<{
  value?: string;
  onChange?: (v: string) => void;
  mode: 'paste' | 'fields';
}> = ({ value = '', onChange, mode }) => {
  if (mode === 'paste') {
    return (
      <Input.TextArea
        rows={3}
        value={value}
        onChange={(e) => {
          const val = e.target.value;
          const parsed = parseFacebookCookie(val);
          if (parsed.isJson) {
            onChange?.(parsed.cookieString);
            message.success(`JSON Cookie detected (${parsed.cookieCount} cookies): UID ${parsed.c_user || 'N/A'}`);
          } else {
            onChange?.(val);
          }
        }}
        placeholder="Paste the Cookie here (supports c_user=...; xs=... strings or a whole Cookie-Editor JSON block)"
        className="font-mono text-xs"
      />
    );
  }
  const parts = parseCookieParts(value);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {COOKIE_FIELDS.map((f) => (
        <div key={f.key}>
          <div className="flex items-baseline justify-between mb-1">
            <label className="text-xs text-slate-300 font-mono">
              {f.label}
              {f.required && <span className="text-rose-400"> *</span>}
            </label>
            <span className="text-[11px] text-slate-500">{f.hint}</span>
          </div>
          <Input
            value={parts[f.key] || ''}
            onChange={(e) => {
              const val = e.target.value;
              const parsed = parseFacebookCookie(val);
              if (parsed.isJson) {
                onChange?.(parsed.cookieString);
                message.success(`JSON Cookie detected: UID ${parsed.c_user || 'N/A'}`);
              } else {
                onChange?.(composeCookie({ ...parts, [f.key]: val }));
              }
            }}
            placeholder={f.key}
            className="font-mono text-xs h-10"
            autoComplete="off"
          />
        </div>
      ))}
    </div>
  );
};

export const ViaManagementPage: React.FC<ViaManagementPageProps> = ({
  accounts: rawAccounts = [],
  loading = false,
  onRefresh,
  dbStatus = { connected: false, loading: false },
  onCheckDb,
  onNavigateToBuff,
}) => {
  const accounts = useMemo(() => {
    const list = rawAccounts && rawAccounts.length > 0 ? rawAccounts : getInitialSeedVias();
    return list.map((a: any) => {
      const uid = a.platformAccountId || String(a.id);
      const savedCookie = getStoredCookieForVia(uid);
      if (savedCookie) {
        return {
          ...a,
          cookieString: savedCookie,
          accessToken: savedCookie,
          tokenStatus: 'OK',
        };
      }
      return a;
    });
  }, [rawAccounts]);

  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [addMode, setAddMode] = useState<'single' | 'bulk'>('single');

  // Input states
  const [isAddViaModalOpen, setIsAddViaModalOpen] = useState(false);
  const [linkOrUidInput, setLinkOrUidInput] = useState('');
  const [cookieInputVal, setCookieInputVal] = useState('');
  const [cookieMode, setCookieMode] = useState<'paste' | 'fields'>('paste');
  const [bulkInputText, setBulkInputText] = useState('');

  // Via Fanpage management
  const [cachedPagesMap, setCachedPagesMap] = useState<Record<string, FanpageItem[]>>({});
  const [scanningUids, setScanningUids] = useState<Set<string>>(new Set());
  const [testingCookieIds, setTestingCookieIds] = useState<Set<number>>(new Set());
  const [selectedMotherVia, setSelectedMotherVia] = useState<MotherViaAccount | null>(null);
  const [isPageDrawerOpen, setIsPageDrawerOpen] = useState(false);
  const [pageSearchQuery, setPageSearchQuery] = useState('');
  const [drawerActiveTab, setDrawerActiveTab] = useState<'scanned' | 'db' | 'export'>('scanned');

  // Modal to manually add Fanpages for a Via in the Drawer
  const [manualAddText, setManualAddText] = useState('');
  const [manualAddMode, setManualAddMode] = useState<'fields' | 'bulk'>('fields');
  const [manualRows, setManualRows] = useState<Array<{ id: string; name: string }>>([
    { id: '', name: '' },
  ]);
  const [isAddingManualToDrawer, setIsAddingManualToDrawer] = useState(false);

  // Fanpage health check state
  const [pageHealthMap, setPageHealthMap] = useState<Record<string, 'LIVE' | 'RESTRICTED' | 'NOT_FOUND'>>({});
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  // Proxy health check state
  const [testingProxyVias, setTestingProxyVias] = useState<Set<number>>(new Set());
  const [viaProxyHealthMap, setViaProxyHealthMap] = useState<
    Record<number, { success: boolean; latencyMs?: number; ip?: string; country?: string; error?: string }>
  >({});
  const [isTestingModalProxy, setIsTestingModalProxy] = useState(false);
  const [modalProxyTestResult, setModalProxyTestResult] = useState<{
    success: boolean;
    latencyMs?: number;
    ip?: string;
    country?: string;
    error?: string;
  } | null>(null);

  // Update / change Cookie modal for a Via (2 lines: c_user and xs)
  const [updateCookieModalVia, setUpdateCookieModalVia] = useState<MotherViaAccount | null>(null);
  const [cookieCUser, setCookieCUser] = useState('');
  const [cookieXs, setCookieXs] = useState('');
  const [rawCookieInput, setRawCookieInput] = useState('');
  const [showRawCookieInput, setShowRawCookieInput] = useState(false);
  const [newProxyInput, setNewProxyInput] = useState('');
  const [autoRescanAfterUpdate, setAutoRescanAfterUpdate] = useState(true);
  const [isUpdatingCookie, setIsUpdatingCookie] = useState(false);
  const [parsedCookieInfo, setParsedCookieInfo] = useState<ParsedFacebookCookie | null>(null);
  const [updateCookieTab, setUpdateCookieTab] = useState<'blob' | 'manual'>('blob');

  // Search filter
  const [searchText, setSearchText] = useState('');

  // Deferred values for search/input boxes: the input stays responsive, heavy filtering runs at low priority
  const deferredSearchText = useDeferredValue(searchText);
  const deferredPageQuery = useDeferredValue(pageSearchQuery);
  const deferredBulkText = useDeferredValue(bulkInputText);
  const bulkLineCount = useMemo(
    () => deferredBulkText.split('\n').filter((l) => l.trim()).length,
    [deferredBulkText]
  );

  // Auto-detect the UID from the Link or Cookie being typed
  const recognizedUid = useMemo(() => {
    const fromLink = extractUidFromLink(linkOrUidInput);
    if (fromLink) return fromLink;
    return extractUidFromCookie(cookieInputVal);
  }, [linkOrUidInput, cookieInputVal]);

  // Load cached Pages from the Backend and LocalStorage
  const loadCachedPages = async () => {
    seedLocalStorageIfEmpty();
    const seedPages = getInitialSeedPages();
    const pageMap: Record<string, FanpageItem[]> = { ...(seedPages as any) };

    // 1. Read from the Backend cache
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

    // 2. Supplement from LocalStorage
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

  // Save a Via's Pages to both the Backend and LocalStorage
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

  // =============================================================================
  // GROUP ACCOUNTS BY MAIN PARENT VIA (MOTHER ACCOUNT / PROFILE)
  // Each parent Via appears on exactly ONE ROW in the management table!
  // All of its Fanpages and Groups are nested as children inside that Via.
  // =============================================================================
  const motherVias = useMemo<MotherViaAccount[]>(() => {
    const map = new Map<
      string,
      {
        profileRow?: ViaAccount;
        allRows: ViaAccount[];
      }
    >();

    for (const acc of accounts) {
      // Skip other platforms like Threads or standalone Groups without a cookie
      if (acc.platform === 'THREADS') continue;
      if (acc.platform === 'FACEBOOK_GROUP' && !(acc.cookieString || acc.accessToken)?.includes('c_user=')) {
        continue;
      }

      const uidFromCookie = extractUidFromCookie(acc.cookieString || acc.accessToken);
      // Must have a UID from the c_user cookie or be a FACEBOOK_PROFILE account
      if (!uidFromCookie && acc.platform !== 'FACEBOOK_PROFILE' && acc.accountType !== 'PERSONAL_PROFILE_COOKIE') {
        continue;
      }

      const uid = uidFromCookie || acc.platformAccountId || `acc_${acc.id}`;
      if (!map.has(uid)) {
        map.set(uid, { allRows: [] });
      }
      const entry = map.get(uid)!;
      entry.allRows.push(acc);
      if (
        acc.platform === 'FACEBOOK_PROFILE' ||
        acc.accountType === 'PERSONAL_PROFILE_COOKIE'
      ) {
        if (!entry.profileRow) {
          entry.profileRow = acc;
        }
      }
    }

    const result: MotherViaAccount[] = [];

    for (const [uid, { profileRow, allRows }] of map.entries()) {
      // Representative: prefer the profile row, then a row with OK status, then the first row
      const rep = profileRow || allRows.find((r) => r.tokenStatus === 'OK') || allRows[0];

      // Display name: prefer the real profile name (e.g. "Thành An", "Huỳnh Thạnh Phú")
      let name = profileRow?.pageName;
      if (!name) {
        const namedRow = allRows.find(
          (r) => r.pageName && !r.pageName.startsWith('Fanpage') && !r.pageName.startsWith('id_')
        );
        name = namedRow?.pageName || `Via ${uid}`;
      }

      // Cookie string: prefer one with c_user and xs
      let cookie = profileRow?.cookieString || profileRow?.accessToken || '';
      if (!cookie || !cookie.includes('c_user=')) {
        const withCuser = allRows.find((r) =>
          (r.cookieString || r.accessToken || '').includes('c_user=')
        );
        cookie = withCuser?.cookieString || withCuser?.accessToken || rep.cookieString || rep.accessToken || '';
      }

      // Proxy
      const proxy = profileRow?.proxyUrl || allRows.find((r) => r.proxyUrl)?.proxyUrl || '';

      // Status: OK if any row is OK
      const hasOk = allRows.some((r) => r.tokenStatus === 'OK');
      const hasCheckpoint = allRows.some((r) => r.tokenStatus === 'CHECKPOINT');
      const tokenStatus = hasOk ? 'OK' : hasCheckpoint ? 'CHECKPOINT' : rep.tokenStatus || 'OK';

      // Classify child accounts in the MySQL database:
      const dbPages: ChildAccountItem[] = [];
      const dbGroups: ChildAccountItem[] = [];

      for (const row of allRows) {
        // The parent profile itself isn't listed as a child page
        if (profileRow && row.id === profileRow.id) continue;
        if (row.platform === 'FACEBOOK_PROFILE') continue;

        const item: ChildAccountItem = {
          id: row.id,
          platformAccountId: row.platformAccountId || String(row.id),
          pageName: row.pageName || `Page ${row.platformAccountId}`,
          platform: row.platform || 'FACEBOOK_PAGE',
          accountType: row.accountType,
          tokenStatus: row.tokenStatus,
          proxyUrl: row.proxyUrl,
        };

        if (row.platform === 'FACEBOOK_GROUP') {
          dbGroups.push(item);
        } else {
          dbPages.push(item);
        }
      }

      // Fanpages scanned by the Playwright browser
      const scannedPages = cachedPagesMap[uid] || [];

      // Total unique Fanpages (Scanned Pages + DB Pages merged, duplicate IDs removed)
      const pageIdSet = new Set<string>();
      for (const p of scannedPages) {
        if (p.id) pageIdSet.add(p.id);
      }
      for (const p of dbPages) {
        if (p.platformAccountId) pageIdSet.add(p.platformAccountId);
      }

      const totalUniquePagesCount =
        pageIdSet.size > 0 ? pageIdSet.size : scannedPages.length + dbPages.length;

      result.push({
        id: rep.id,
        uid,
        pageName: name,
        cookieString: cookie,
        proxyUrl: proxy,
        tokenStatus,
        isProfileRow: Boolean(profileRow),
        rawAccounts: allRows,
        dbPages,
        dbGroups,
        scannedPages,
        totalUniquePagesCount,
      });
    }

    // Sort: accounts with a real Profile and more Pages first
    return result.sort((a, b) => {
      if (a.isProfileRow && !b.isProfileRow) return -1;
      if (!a.isProfileRow && b.isProfileRow) return 1;
      return b.totalUniquePagesCount - a.totalUniquePagesCount;
    });
  }, [accounts, cachedPagesMap]);

  // Bulk health check of child Fanpages (Live / Restricted / Error)
  const handleCheckPagesHealth = async (pages: FanpageItem[]) => {
    if (!pages || pages.length === 0) {
      message.warning('No Fanpages to health-check yet!');
      return;
    }
    const pageIds = pages.map((p) => p.id);
    setIsCheckingHealth(true);
    message.loading({
      content: `Checking connection & health of ${pageIds.length} Fanpages...`,
      key: 'healthCheck',
      duration: 25,
    });
    try {
      const res = await api.post('/buff-check-pages-health', { pageIds });
      if (res.data?.success && res.data.results) {
        setPageHealthMap((prev) => ({ ...prev, ...res.data.results }));
        const liveCount = Object.values(res.data.results).filter((v) => v === 'LIVE').length;
        message.success({
          content: `Check done! ${liveCount}/${pageIds.length} Fanpages are healthy (LIVE)!`,
          key: 'healthCheck',
          duration: 4,
        });
      }
    } catch (e: any) {
      message.error({ content: 'Fanpage health check error: ' + e.message, key: 'healthCheck' });
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const [isCheckingAllVias, setIsCheckingAllVias] = useState(false);

  // Check Cookie expiry for every Via on Facebook
  const handleCheckAllViasLive = async () => {
    setIsCheckingAllVias(true);
    message.loading({
      content: 'Checking Cookie validity and expiry on Facebook for every Via...',
      key: 'checkAllViaHealth',
      duration: 30,
    });
    try {
      const res = await api.post('/buff-vias/health-check');
      if (res.data?.success) {
        message.success({
          content: `Check complete: ${res.data.liveCount}/${res.data.total} Vias are VALID (LIVE)!`,
          key: 'checkAllViaHealth',
          duration: 4,
        });
        onRefresh();
        loadCachedPages();
      } else {
        message.error({ content: res.data?.error || 'Via check error', key: 'checkAllViaHealth' });
      }
    } catch (e: any) {
      message.error({ content: 'Cookie health check error: ' + e.message, key: 'checkAllViaHealth' });
    } finally {
      setIsCheckingAllVias(false);
    }
  };

  // Test the proxy in the add / edit Via modal
  const handleTestModalProxy = async () => {
    const rawProxy = form.getFieldValue('proxyUrl');
    if (!rawProxy || !rawProxy.trim()) {
      message.warning('Please enter a Proxy string before checking!');
      return;
    }
    setIsTestingModalProxy(true);
    setModalProxyTestResult(null);
    try {
      const res = await api.post('/proxy/test', { proxyUrl: rawProxy.trim() });
      setModalProxyTestResult(res.data);
      if (res.data.success) {
        message.success(`Proxy LIVE! Ping: ${res.data.latencyMs}ms (IP: ${res.data.ip})`);
      } else {
        message.error(res.data.error || 'Proxy is not working');
      }
    } catch (e: any) {
      setModalProxyTestResult({ success: false, error: e.response?.data?.error || e.message });
      message.error('Could not check the Proxy: ' + (e.response?.data?.error || e.message));
    } finally {
      setIsTestingModalProxy(false);
    }
  };

  // Test the proxy of one Via row in the table
  const handleTestViaProxy = async (record: MotherViaAccount) => {
    if (!record.proxyUrl) {
      message.info(`Via "${record.pageName}" uses this machine's direct IP, no dedicated Proxy.`);
      return;
    }
    setTestingProxyVias((prev) => new Set(prev).add(record.id));
    try {
      const res = await api.post('/proxy/test', { proxyUrl: record.proxyUrl });
      setViaProxyHealthMap((prev) => ({ ...prev, [record.id]: res.data }));
      if (res.data.success) {
        message.success(`[${record.pageName}] Proxy LIVE! Ping: ${res.data.latencyMs}ms (${res.data.country || 'Global'} - IP: ${res.data.ip})`);
      } else {
        message.error(`[${record.pageName}] ${res.data.error || 'Could not connect to the Proxy'}`);
      }
    } catch (e: any) {
      setViaProxyHealthMap((prev) => ({
        ...prev,
        [record.id]: { success: false, error: e.response?.data?.error || e.message },
      }));
      message.error(`[${record.pageName}] Test error: ${e.response?.data?.error || e.message}`);
    } finally {
      setTestingProxyVias((prev) => {
        const next = new Set(prev);
        next.delete(record.id);
        return next;
      });
    }
  };

  // Scan every Fanpage from a Via's Cookie with Playwright
  const handleScanPagesForVia = async (via: MotherViaAccount) => {
    const uid = via.uid;
    if (!via.cookieString) {
      message.error('This account has no Facebook Cookie to scan with!');
      return;
    }

    setScanningUids((prev) => new Set(prev).add(uid));
    message.loading({
      content: `Opening a browser to scan every Fanpage from account [${via.pageName || uid}]'s Cookie...`,
      key: `scan_${uid}`,
      duration: 25,
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
          content: `Scan done! Found ${scanned.length} Fanpages for Via [${via.pageName || uid}] (now ${merged.length} Pages in total)`,
          key: `scan_${uid}`,
          duration: 4,
        });
      } else {
        message.warning({
          content: 'No Fanpages found or the Cookie needs verification.',
          key: `scan_${uid}`,
        });
      }
    } catch (err: any) {
      message.error({
        content: `Fanpage scan error: ${err.response?.data?.error || err.message}`,
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

  // 1. ADD 1 NEW PARENT VIA (CLEAR FIELD-BY-FIELD INPUT)
  const handleAddSingleVia = async (values: any) => {
    try {
      setSubmitting(true);
      const rawCookieStr = (values.cookieString || '').trim();
      if (!rawCookieStr) {
        message.error('Please paste the Via\'s Facebook Cookie string!');
        return;
      }

      const parsed = parseFacebookCookie(rawCookieStr);
      const finalCookieStr = parsed.cookieString || rawCookieStr;

      // Extract the UID from the Link/UID input or the Cookie
      const uidFromLink = extractUidFromLink(values.profileUrl);
      const uidFromCookie = parsed.c_user || extractUidFromCookie(rawCookieStr);
      const finalUid = uidFromLink || uidFromCookie || `via_${Date.now()}`;

      // Parent Via name
      const finalPageName = values.pageName?.trim() || `Via ${finalUid}`;

      const addRes = await api.post('/connections', {
        pageName: finalPageName,
        platformAccountId: finalUid,
        cookieString: finalCookieStr,
        proxyUrl: values.proxyUrl ? values.proxyUrl.trim() : '',
        platform: 'FACEBOOK_PROFILE',
        accountType: 'PERSONAL_PROFILE_COOKIE',
      });

      message.success(`Added Via ${finalPageName} (UID: ${finalUid})`);
      if (addRes.data?.warning) message.warning({ content: addRes.data.warning, duration: 8 });
      form.resetFields();
      setLinkOrUidInput('');
      setCookieInputVal('');
      setIsAddViaModalOpen(false);
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // 2. BULK-ADD MANY PARENT VIAS (BULK IMPORT)
  const handleAddBulkVias = async () => {
    const rawAll = bulkInputText.trim();
    if (!rawAll) {
      message.warning('Please paste the Via list into the box below!');
      return;
    }

    // Check whether the user pasted a whole JSON block (Cookie-Editor / J2TEAM)
    const wholeParsed = parseFacebookCookie(rawAll);
    if (wholeParsed.valid && wholeParsed.isJson) {
      try {
        setSubmitting(true);
        message.loading({ content: 'Importing Via from JSON Cookie...', key: 'bulkAdd' });
        const uid = wholeParsed.c_user;
        const name = `Via ${uid}`;
        const bulkRes = await api.post('/connections', {
          pageName: name,
          platformAccountId: uid || `via_${Date.now()}`,
          cookieString: wholeParsed.cookieString,
          proxyUrl: '',
          platform: 'FACEBOOK_PROFILE',
          accountType: 'PERSONAL_PROFILE_COOKIE',
        });
        setSubmitting(false);
        setBulkInputText('');
        setIsAddViaModalOpen(false);
        onRefresh();
        message.success({
          content: `Imported Via [${name}] from JSON Cookie (${wholeParsed.cookieCount} cookies)!`,
          key: 'bulkAdd',
          duration: 4,
        });
        if (bulkRes.data?.warning) {
          message.warning({
            content: 'Could not save to MySQL; the new data is only stored temporarily on this machine.',
            duration: 8,
          });
        }
        return;
      } catch (e: any) {
        setSubmitting(false);
        if (e?.response?.status === 409) {
          message.info({ content: 'This Via already exists in the system; nothing added.', key: 'bulkAdd' });
        } else {
          message.error({ content: e?.response?.data?.error || e.message || 'Error adding Via', key: 'bulkAdd' });
        }
        return;
      }
    }

    const lines = bulkInputText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      message.warning('No valid Via rows!');
      return;
    }

    setSubmitting(true);
    message.loading({ content: `Importing ${lines.length} Vias into the system...`, key: 'bulkAdd' });

    let successCount = 0;
    let duplicateCount = 0;
    let dbWarning = false;
    let failCount = 0;

    for (const line of lines) {
      try {
        let name = '';
        let cookie = '';
        let proxy = '';
        let uid = '';

        const parsedLine = parseFacebookCookie(line);
        if (parsedLine.valid) {
          cookie = parsedLine.cookieString;
          uid = parsedLine.c_user;
          name = `Via ${uid}`;
        } else if (line.includes('|')) {
          const parts = line.split('|').map((p) => p.trim());
          const cookieIdx = parts.findIndex((p) => p.includes('c_user=') || p.startsWith('{') || p.startsWith('['));
          if (cookieIdx !== -1) {
            const pCookie = parseFacebookCookie(parts[cookieIdx]);
            cookie = pCookie.cookieString || parts[cookieIdx];
            uid = pCookie.c_user || extractUidFromCookie(cookie) || parts[0];
            name = parts[1] && !parts[1].includes('=') && !parts[1].includes('http') ? parts[1] : `Via ${uid}`;
            const proxyPart = parts.find((p) => p.includes(':') && (p.includes('.') || p.includes('http')));
            if (proxyPart && proxyPart !== cookie) proxy = proxyPart;
          } else {
            // Format UID/Link | Name | Cookie | Proxy
            uid = extractUidFromLink(parts[0]) || parts[0];
            name = parts[1] || `Via ${uid}`;
            cookie = parts[2] || line;
            proxy = parts[3] || '';
          }
        } else {
          // Cookie only
          const pCookie = parseFacebookCookie(line);
          cookie = pCookie.cookieString || line;
          uid = pCookie.c_user || extractUidFromCookie(line);
          name = uid ? `Via ${uid}` : 'Via Facebook';
        }

        if (!cookie) continue;

        const bulkRes = await api.post('/connections', {
          pageName: name,
          platformAccountId: uid || `via_${Date.now()}`,
          cookieString: cookie,
          proxyUrl: proxy,
          platform: 'FACEBOOK_PROFILE',
          accountType: 'PERSONAL_PROFILE_COOKIE',
        });
        successCount++;
        if (bulkRes.data?.warning) dbWarning = true;
      } catch (e: any) {
        if (e?.response?.status === 409) duplicateCount++;
        else failCount++;
      }
    }

    setSubmitting(false);
    setBulkInputText('');
    onRefresh();

    if (successCount > 0) {
      setIsAddViaModalOpen(false);
      message.success({
        content: `Imported ${successCount} Vias into the system!${duplicateCount > 0 ? ` ${duplicateCount} Vias already existed and were skipped.` : ''}${failCount > 0 ? ` (${failCount} errors)` : ''}`,
        key: 'bulkAdd',
        duration: 4,
      });
    } else if (duplicateCount > 0 && failCount === 0) {
      message.info({ content: `All ${duplicateCount} Vias already exist in the system; nothing added.`, key: 'bulkAdd' });
    } else {
      message.error({ content: 'No Vias were added. Check the Cookie format (needs both c_user and xs)!', key: 'bulkAdd' });
    }
    if (dbWarning) message.warning({ content: 'Could not save to MySQL; the new data is only stored temporarily on this machine. Check the MySQL connection.', duration: 8 });
  };

  // Check whether each parent Via's Cookie is alive
  const handleTestViaLive = async (via: MotherViaAccount) => {
    setTestingCookieIds((prev) => new Set(prev).add(via.id));
    try {
      const res = await api.post('/buff-like/test-cookie', {
        cookieString: via.cookieString,
        proxyUrl: via.proxyUrl || '',
      });
      if (res.data?.live) {
        message.success(`Cookie for account [${via.pageName}] is LIVE and healthy!`);
        await api.put(`/connections/${via.id}`, { tokenStatus: 'OK' });
        onRefresh();
      } else {
        message.error(`Cookie for account [${via.pageName}] is CHECKPOINTED or expired!`);
        await api.put(`/connections/${via.id}`, { tokenStatus: 'CHECKPOINT' });
        onRefresh();
      }
    } catch (e: any) {
      if (via.cookieString?.includes('c_user=') && via.cookieString?.includes('xs=')) {
        message.info(`Cookie for account [${via.pageName}] has a valid structure (c_user + xs).`);
      } else {
        message.warning(`Cookie for account [${via.pageName}] is missing c_user or xs.`);
      }
    } finally {
      setTestingCookieIds((prev) => {
        const next = new Set(prev);
        next.delete(via.id);
        return next;
      });
    }
  };

  // Delete a parent Via
  const handleDeleteVia = async (via: MotherViaAccount) => {
    try {
      const delRes = await api.delete(`/connections/${via.id}`);
      message.success(`Removed Via account [${via.pageName}] from the system`);
      if (delRes.data?.warning) message.warning({ content: delRes.data.warning, duration: 8 });
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  // Delete a child Fanpage / Group from the MySQL database
  const handleDeleteChildDbAccount = async (childId: number) => {
    try {
      await api.delete(`/connections/${childId}`);
      message.success('Child Page/Group deleted from the database');
      onRefresh();
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message);
    }
  };

  // Manually add Pages to the Via open in the Drawer (supports individual fields & bulk paste)
  const handleSaveManualToDrawer = async () => {
    if (!selectedMotherVia) return;
    const uid = selectedMotherVia.uid;
    let parsed: FanpageItem[] = [];

    if (manualAddMode === 'fields') {
      const validRows = manualRows.filter((r) => r.id && r.id.trim());
      if (validRows.length === 0) {
        message.warning('Please fill in at least 1 Fanpage ID or Page link!');
        return;
      }
      for (const r of validRows) {
        let cleanId = r.id.trim();
        const name = r.name.trim();
        let url = '';
        if (cleanId.includes('facebook.com')) {
          url = cleanId;
          const idMatch = cleanId.match(/(?:id=|\/profile\.php\?id=|\/pages\/[^/]+\/|\/)([0-9]{8,})/);
          if (idMatch) cleanId = idMatch[1];
          else {
            const vanityMatch = cleanId.match(/facebook\.com\/([a-zA-Z0-9._-]+)/);
            cleanId = vanityMatch ? vanityMatch[1] : cleanId;
          }
        }
        cleanId = cleanId.replace(/[^0-9a-zA-Z._-]/g, '');
        if (cleanId) {
          parsed.push({
            id: cleanId,
            name: name || `Fanpage ${cleanId}`,
            url: url || `https://www.facebook.com/${cleanId}`,
          });
        }
      }
    } else {
      if (!manualAddText.trim()) {
        message.warning('Please enter at least 1 line of PAGE_ID | Page Name or a Facebook link!');
        return;
      }
      parsed = parseFanpagesInput(manualAddText);
    }

    if (parsed.length === 0) {
      message.error('No valid Fanpage ID found in what you entered!');
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

    await persistPagesForVia(uid, merged, selectedMotherVia.pageName || `Via ${uid}`);
    message.success(`Added ${newCount} new Fanpages to Via [${selectedMotherVia.pageName}]!`);
    setManualAddText('');
    setManualRows([{ id: '', name: '' }]);
    setIsAddingManualToDrawer(false);
  };

  // Remove 1 Page from the Via's scan list
  const handleDeletePageFromVia = async (pageId: string) => {
    if (!selectedMotherVia) return;
    const uid = selectedMotherVia.uid;
    const existing = cachedPagesMap[uid] || [];
    const updated = existing.filter((p) => p.id !== pageId);
    await persistPagesForVia(uid, updated, selectedMotherVia.pageName);
    message.success('Fanpage removed from this Via');
  };

  // Remove every Page from the Via's scan list
  const handleClearAllPagesFromVia = async () => {
    if (!selectedMotherVia) return;
    const uid = selectedMotherVia.uid;
    await persistPagesForVia(uid, [], selectedMotherVia.pageName);
    message.info('Cleared this Via\'s whole scanned Fanpage list');
  };

  // Open the update-Cookie modal for a specific Via (c_user & xs pre-split)
  const handleOpenUpdateCookieModal = (record: MotherViaAccount) => {
    setUpdateCookieModalVia(record);
    const existingCookie = record.cookieString || '';
    const parsed = parseFacebookCookie(existingCookie);
    const matchCUser = parsed.c_user || record.uid || '';
    const matchXs = parsed.xs || '';

    // IF THE VIA IS EXPIRED OR CHECKPOINTED: CLEAR THE XS FIELD SO THE USER CAN PASTE A NEW COOKIE RIGHT AWAY
    const isDead = record.tokenStatus === 'EXPIRED' || record.tokenStatus === 'CHECKPOINT' || record.tokenStatus === 'INVALID';
    setCookieCUser(matchCUser);
    setCookieXs(isDead ? '' : matchXs);
    setRawCookieInput(isDead ? '' : existingCookie);
    setParsedCookieInfo(isDead ? null : (parsed.valid ? parsed : null));
    setShowRawCookieInput(false);
    setNewProxyInput(record.proxyUrl || '');
    setAutoRescanAfterUpdate(true);
    setUpdateCookieTab('blob');
  };

  // Shared handler when the user pastes or types into any field (c_user, xs, raw or quick JSON paste)
  const applyParsedCookie = (val: string, source: 'c_user' | 'xs' | 'raw') => {
    const trimmed = val.trim();
    if (!trimmed) {
      if (source === 'c_user') setCookieCUser('');
      if (source === 'xs') setCookieXs('');
      if (source === 'raw') {
        setRawCookieInput('');
        setParsedCookieInfo(null);
      }
      return;
    }

    const parsed = parseFacebookCookie(trimmed);

    // 1. JSON format (Cookie-Editor, J2TEAM, DevTools export...)
    if (parsed.isJson) {
      if (parsed.c_user) setCookieCUser(parsed.c_user);
      if (parsed.xs) setCookieXs(parsed.xs);
      setRawCookieInput(parsed.cookieString);
      setParsedCookieInfo(parsed);
      message.success(`⚡ JSON Cookie detected automatically (${parsed.cookieCount} cookies): UID ${parsed.c_user || 'N/A'}`);
      return;
    }

    // 2. Combined cookie string containing both c_user and xs (or pipe format UID|PASS|2FA|COOKIE)
    if (parsed.valid || (trimmed.includes('c_user=') && trimmed.includes('xs='))) {
      if (parsed.c_user) setCookieCUser(parsed.c_user);
      if (parsed.xs) setCookieXs(parsed.xs);
      setRawCookieInput(parsed.cookieString || trimmed);
      setParsedCookieInfo(parsed);
      message.info(`✨ Automatically split c_user (${parsed.c_user}) and xs!`);
      return;
    }

    // 3. c_user field entered on its own
    if (source === 'c_user') {
      if (trimmed.includes('xs=')) {
        const xsMatch = trimmed.match(/(?:^|;\s*)xs=([^;]+)/)?.[1];
        if (xsMatch) setCookieXs(xsMatch);
      }
      const cleanC = trimmed.replace(/^c_user=/i, '').replace(/;$/, '').trim();
      setCookieCUser(cleanC);
      return;
    }

    // 4. xs field entered on its own
    if (source === 'xs') {
      if (trimmed.includes('c_user=')) {
        const cMatch = trimmed.match(/(?:^|;\s*)c_user=([^;]+)/)?.[1];
        if (cMatch) setCookieCUser(cMatch);
      }
      const cleanX = trimmed.replace(/^xs=/i, '').replace(/;$/, '').trim();
      setCookieXs(cleanX);
      return;
    }

    // 5. Raw/combined string field
    setRawCookieInput(trimmed);
    if (parsed.c_user) setCookieCUser(parsed.c_user);
    if (parsed.xs) setCookieXs(parsed.xs);
    if (parsed.valid) setParsedCookieInfo(parsed);
  };

  // Save the new Cookie for the Via (joined from the c_user & xs lines, keeping every cookie)
  const handleSaveNewCookie = async (forceOverwriteUid = false) => {
    if (!updateCookieModalVia) return;

    let finalCookie = '';
    const cleanCUser = cookieCUser.trim() || updateCookieModalVia.uid || '';
    const cleanXs = cookieXs.trim();

    if (!cleanXs) {
      message.error('Please fill in the xs session token!');
      return;
    }

    // Prefer the full cookie string if available (keeps sb, datr, pas, locale, fr, ...)
    if (rawCookieInput.trim() && (rawCookieInput.includes('c_user=') || rawCookieInput.includes('xs='))) {
      let updated = rawCookieInput.trim();
      if (cleanCUser) {
        if (/c_user=/.test(updated)) {
          updated = updated.replace(/(?:^|;\s*)c_user=([^;]+)/, `; c_user=${cleanCUser}`);
        } else {
          updated = `c_user=${cleanCUser}; ${updated}`;
        }
      }
      if (cleanXs) {
        if (/xs=/.test(updated)) {
          updated = updated.replace(/(?:^|;\s*)xs=([^;]+)/, `; xs=${cleanXs}`);
        } else {
          updated = `${updated}; xs=${cleanXs}`;
        }
      }
      finalCookie = updated.replace(/^;\s*/, '').replace(/;\s*$/, '') + ';';
    } else {
      finalCookie = `c_user=${cleanCUser}; xs=${cleanXs};`;
    }

    // Check whether the UID in the cookie differs from the current Via's UID
    const targetUid = cleanCUser || updateCookieModalVia.uid;
    if (updateCookieModalVia.uid && cleanCUser && updateCookieModalVia.uid !== cleanCUser && !forceOverwriteUid) {
      Modal.confirm({
        title: 'Confirm Cookie update for a new UID',
        icon: <SyncOutlined className="text-amber-400" />,
        content: (
          <div className="space-y-2 text-xs text-slate-300">
            <p>
              The UID extracted from the pasted Cookie is <code className="text-cyan-300 font-bold">{cleanCUser}</code>,{' '}
              which differs from the Via's current UID <code className="text-amber-300 font-bold">{updateCookieModalVia.uid}</code>.
            </p>
            <p>Are you sure you want to update this Via's Cookie: <b className="text-white">{updateCookieModalVia.pageName}</b>?</p>
          </div>
        ),
        okText: 'Yes, update',
        cancelText: 'Review',
        onOk: () => handleSaveNewCookie(true),
      });
      return;
    }

    try {
      setIsUpdatingCookie(true);
      // Remember the Cookie in this machine's LocalStorage so the app is always ready
      saveStoredCookieForVia(targetUid, finalCookie);

      let apiSuccess = false;
      let warningMsg = '';
      try {
        const res = await api.post('/vias/update-cookie', {
          uid: targetUid,
          cookieString: finalCookie,
          proxyUrl: newProxyInput.trim(),
          force: true,
        });
        apiSuccess = Boolean(res.data?.success);
        warningMsg = res.data?.warning || '';
      } catch (backendErr) {
        // The backend may be offline or not set up on a new machine; LocalStorage still keeps it
        apiSuccess = true;
      }

      if (apiSuccess) {
        message.success(`New Cookie saved for Via [${updateCookieModalVia.pageName}]!`);
        if (warningMsg) message.warning({ content: warningMsg, duration: 8 });
        offerTopUpAfterCookieUpdate();

        // Rescan Fanpages if the user chose to and the backend is running
        if (autoRescanAfterUpdate) {
          handleScanPagesForVia({
            ...updateCookieModalVia,
            uid: targetUid,
            cookieString: finalCookie,
            proxyUrl: newProxyInput.trim(),
          });
        }

        setUpdateCookieModalVia(null);
        setCookieCUser('');
        setCookieXs('');
        setRawCookieInput('');
        setNewProxyInput('');
        setParsedCookieInfo(null);
        onRefresh();
      } else {
        message.error('Could not update the Cookie');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || err.message || 'Error updating the Cookie');
    } finally {
      setIsUpdatingCookie(false);
    }
  };

  // Total Fanpage stats across the whole system
  const { totalPagesCount, totalDbPagesCount, totalDbGroupsCount, liveViaCount } = useMemo(() => {
    let pagesSum = 0;
    let liveSum = 0;
    let dbPagesSum = 0;
    let dbGroupsSum = 0;

    for (const v of motherVias) {
      pagesSum += v.totalUniquePagesCount;
      dbPagesSum += v.dbPages.length;
      dbGroupsSum += v.dbGroups.length;
      if (v.tokenStatus === 'OK') liveSum++;
    }

    return {
      totalPagesCount: pagesSum,
      totalDbPagesCount: dbPagesSum,
      totalDbGroupsCount: dbGroupsSum,
      liveViaCount: liveSum,
    };
  }, [motherVias]);

  // Vias filtered by the search
  const filteredMotherVias = useMemo(() => {
    const q = deferredSearchText.toLowerCase().trim();
    if (!q) return motherVias;

    return motherVias.filter((v) => {
      // Search by Via name, UID or Proxy
      if (
        (v.pageName || '').toLowerCase().includes(q) ||
        v.uid.toLowerCase().includes(q) ||
        (v.proxyUrl || '').toLowerCase().includes(q)
      ) {
        return true;
      }
      // Also search inside this Via's child Pages
      const hasPageMatch = v.scannedPages.some(
        (p) => p.name.toLowerCase().includes(q) || p.id.includes(q)
      );
      if (hasPageMatch) return true;

      const hasDbMatch = v.dbPages.some(
        (p) => p.pageName.toLowerCase().includes(q) || p.platformAccountId.includes(q)
      );
      return hasDbMatch;
    });
  }, [motherVias, deferredSearchText]);

  // Update selectedMotherVia when motherVias changes
  const activeDrawerVia = useMemo(() => {
    if (!selectedMotherVia) return null;
    return motherVias.find((v) => v.uid === selectedMotherVia.uid) || selectedMotherVia;
  }, [motherVias, selectedMotherVia]);

  // Scanned Fanpages of the Via selected in the Drawer
  const currentScannedPages = activeDrawerVia?.scannedPages ?? EMPTY_PAGES;
  const filteredScannedPages = useMemo(() => {
    if (!deferredPageQuery.trim()) return currentScannedPages;
    const q = deferredPageQuery.toLowerCase().trim();
    return currentScannedPages.filter(
      (p) => (p.name || '').toLowerCase().includes(q) || p.id.includes(q)
    );
  }, [currentScannedPages, deferredPageQuery]);

  // DB Pages / Groups of the selected Via
  const currentDbPages = activeDrawerVia?.dbPages ?? EMPTY_CHILDREN;
  const currentDbGroups = activeDrawerVia?.dbGroups ?? EMPTY_CHILDREN;
  const filteredDbPages = useMemo(() => {
    if (!deferredPageQuery.trim()) return currentDbPages;
    const q = deferredPageQuery.toLowerCase().trim();
    return currentDbPages.filter(
      (p) => (p.pageName || '').toLowerCase().includes(q) || p.platformAccountId.includes(q)
    );
  }, [currentDbPages, deferredPageQuery]);

  const filteredDbGroups = useMemo(() => {
    if (!deferredPageQuery.trim()) return currentDbGroups;
    const q = deferredPageQuery.toLowerCase().trim();
    return currentDbGroups.filter(
      (p) => (p.pageName || '').toLowerCase().includes(q) || p.platformAccountId.includes(q)
    );
  }, [currentDbGroups, deferredPageQuery]);

  // Progressively render the Drawer list, reset when the Via / tab / keyword changes
  const drawerListKey = `${activeDrawerVia?.uid ?? ''}|${drawerActiveTab}|${deferredPageQuery}`;
  const scannedList = useIncrementalList(filteredScannedPages, drawerListKey);
  const dbPagesList = useIncrementalList(filteredDbPages, drawerListKey);
  const dbGroupsList = useIncrementalList(filteredDbGroups, drawerListKey);

  // IDs to export: computed once, deduped with a Set instead of nested scans
  const exportLines = useMemo(() => {
    const all: string[] = [];
    const scannedIds = new Set<string>();
    for (const p of currentScannedPages) {
      scannedIds.add(p.id);
      all.push(`${p.id} | ${p.name || ''}`);
    }
    for (const p of currentDbPages) {
      if (!scannedIds.has(p.platformAccountId)) {
        all.push(`${p.platformAccountId} | ${p.pageName || ''}`);
      }
    }
    return all;
  }, [currentScannedPages, currentDbPages]);

  // Latest handlers for the table buttons, so columns don't need to be recreated on every render
  const rowHandlersRef = useRef({ handleScanPagesForVia, handleTestViaProxy, handleTestViaLive, handleDeleteVia, handleOpenUpdateCookieModal });
  rowHandlersRef.current = { handleScanPagesForVia, handleTestViaProxy, handleTestViaLive, handleDeleteVia, handleOpenUpdateCookieModal };

  const viaColumns = useMemo<ColumnsType<MotherViaAccount>>(
    () => [
    {
      title: 'Via',
      key: 'accountInfo',
      render: (_: any, record: MotherViaAccount) => {
        const uid = record.uid;
        const hasProfile = uid && /^[0-9]+$/.test(uid);
        return (
          <div className="flex items-center gap-3 py-0.5 min-w-0">
            <Avatar
              src={fbAvatarSrc(uid)}
              icon={<UserOutlined />}
              size={40}
              className="shrink-0 bg-slate-800 border border-slate-700"
            />
            <div className="min-w-0">
              {hasProfile ? (
                <a
                  href={`https://www.facebook.com/${uid}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the profile on Facebook"
                  className="block text-sm font-medium text-slate-100 hover:text-blue-400 truncate max-w-[200px]"
                >
                  {record.pageName || `Via ${uid}`}
                </a>
              ) : (
                <span className="block text-sm font-medium text-slate-100 truncate max-w-[200px]">
                  {record.pageName || `Via ${uid}`}
                </span>
              )}
              <button
                type="button"
                title="Copy UID"
                onClick={() => {
                  navigator.clipboard.writeText(uid);
                  message.success(`Copied UID: ${uid}`);
                }}
                className="text-xs text-slate-500 hover:text-slate-300 tabular-nums bg-transparent border-0 p-0 cursor-pointer"
              >
                {uid}
              </button>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Fanpage',
      key: 'pages',
      render: (_: any, record: MotherViaAccount) => {
        const uid = record.uid;
        const isScanning = scanningUids.has(uid);
        const totalCount = record.totalUniquePagesCount || record.scannedPages.length;
        const parts = [
          `${record.scannedPages.length} scanned`,
          record.dbPages.length > 0 ? `${record.dbPages.length} saved` : '',
          record.dbGroups.length > 0 ? `${record.dbGroups.length} groups` : '',
        ].filter(Boolean);

        return (
          <div className="space-y-1.5 py-0.5">
            <div className="text-sm text-slate-300 tabular-nums">{parts.join(' · ')}</div>
            <div className="flex items-center gap-1">
              <Tooltip title="Open a browser to scan the Fanpages this Via manages">
                <Button
                  size="small"
                  type="primary"
                  loading={isScanning}
                  onClick={() => rowHandlersRef.current.handleScanPagesForVia(record)}
                >
                  {isScanning ? 'Scanning...' : 'Scan Pages'}
                </Button>
              </Tooltip>
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setSelectedMotherVia(record);
                  setIsPageDrawerOpen(true);
                  setDrawerActiveTab('scanned');
                }}
                className="text-slate-300"
              >
                Xem ({totalCount})
              </Button>
              <Tooltip title="Paste a Fanpage ID / link list manually for this Via only">
                <Button
                  size="small"
                  type="text"
                  onClick={() => {
                    setSelectedMotherVia(record);
                    setIsPageDrawerOpen(true);
                    setIsAddingManualToDrawer(true);
                  }}
                  className="text-slate-300"
                >
                  Add
                </Button>
              </Tooltip>
            </div>
          </div>
        );
      },
    },
    {
      title: 'Proxy',
      key: 'proxyUrl',
      width: 190,
      render: (_: any, record: MotherViaAccount) => {
        const val = record.proxyUrl;
        const health = viaProxyHealthMap[record.id];
        const isTesting = testingProxyVias.has(record.id);

        if (!val) return <span className="text-sm text-slate-500">Machine network</span>;
        return (
          <div className="leading-tight">
            <div className="flex items-center gap-2">
              <Tooltip title={val}>
                <span className="text-sm text-slate-300 truncate max-w-[120px] tabular-nums">
                  {val.replace(/:[^:]+@/, ':***@').replace(/^[a-z0-9]+:\/\//i, '').slice(0, 18)}
                </span>
              </Tooltip>
              <Button
                size="small"
                type="link"
                loading={isTesting}
                onClick={() => rowHandlersRef.current.handleTestViaProxy(record)}
                className="p-0 h-auto text-xs"
              >
                Check
              </Button>
            </div>
            {health && (
              <div className={`text-xs mt-1 ${health.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                {health.success ? `Working · ${health.latencyMs}ms${health.country ? ` · ${health.country}` : ''}` : 'Could not connect'}
              </div>
            )}
          </div>
        );
      },
    },
    {
      title: 'Status',
      key: 'tokenStatus',
      width: 150,
      render: (_: any, record: MotherViaAccount) => {
        const isLive = record.tokenStatus === 'OK';
        const isTesting = testingCookieIds.has(record.id);
        const statusText = isLive
          ? 'Active'
          : record.tokenStatus === 'CHECKPOINT'
          ? 'Checkpoint'
          : 'Expired';
        return (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-sm ${isLive ? 'text-emerald-400' : 'text-rose-400'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              {statusText}
            </span>
            <Tooltip title="Check whether this Via's Cookie is still alive">
              <Button
                size="small"
                type="dashed"
                icon={<SafetyCertificateOutlined className="text-cyan-400" />}
                loading={isTesting}
                onClick={() => rowHandlersRef.current.handleTestViaLive(record)}
                className="!text-[11px] !h-6 !px-2 text-cyan-300 border-cyan-800/80 bg-cyan-950/20 hover:border-cyan-500 hover:text-cyan-200"
              >
                Check expiry
              </Button>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: '',
      key: 'actions',
      align: 'right',
      width: 150,
      render: (_: any, record: MotherViaAccount) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="small" onClick={() => rowHandlersRef.current.handleOpenUpdateCookieModal(record)}>
            Change Cookie
          </Button>
          <Popconfirm
            title={`Delete Via account [${record.pageName}]?`}
            description="The Via and its linked Fanpages will be removed from the system."
            onConfirm={() => rowHandlersRef.current.handleDeleteVia(record)}
            okText="Delete"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title="Delete Via">
              <Button
                size="small"
                type="text"
                icon={<DeleteOutlined />}
                className="text-slate-500 hover:!text-rose-400"
                aria-label="Delete Via"
              />
            </Tooltip>
          </Popconfirm>
        </div>
      ),
    },
    ],
    [scanningUids, testingCookieIds, testingProxyVias, viaProxyHealthMap]
  );

  return (
    <div className="space-y-6 max-w-[1440px] mx-auto pb-20">
      {/* Title + quick actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 m-0">Via Accounts</h2>
          <p className="text-xs text-slate-400 m-0 mt-1">
            Add a Via's Cookie and the system automatically scans the Fanpages it manages.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <Button
            type="primary"
            icon={<SafetyCertificateOutlined className="text-cyan-200" />}
            loading={isCheckingAllVias}
            onClick={handleCheckAllViasLive}
            className="!bg-cyan-600 hover:!bg-cyan-500 font-semibold shadow-md"
            title="Check whether every Via account's Cookie is still valid"
          >
            🩺 Check Cookie expiry (All Vias)
          </Button>
          <Button
            loading={loading}
            onClick={() => {
              onRefresh();
              loadCachedPages();
              message.success('Via list refreshed');
            }}
          >
            Refresh
          </Button>
          {onNavigateToBuff && <Button onClick={onNavigateToBuff}>Sang Buff Like</Button>}
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsAddViaModalOpen(true)}
          >
            Add Via
          </Button>
        </div>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="app-surface p-4 rounded-xl">
          <div className="text-xs text-slate-400">Via</div>
          <div className="text-2xl font-semibold text-slate-100 mt-1 tabular-nums">{motherVias.length}</div>
          <div className="text-xs text-slate-500 mt-1">
            <span className="text-emerald-400">{liveViaCount}</span> active
          </div>
        </div>

        <div className="app-surface p-4 rounded-xl">
          <div className="text-xs text-slate-400">Fanpage</div>
          <div className="text-2xl font-semibold text-slate-100 mt-1 tabular-nums">{totalPagesCount}</div>
          <div className="text-xs text-slate-500 mt-1 tabular-nums">
            {totalDbPagesCount} saved{totalDbGroupsCount > 0 ? ` · ${totalDbGroupsCount} groups` : ''}
          </div>
        </div>

        <button
          type="button"
          onClick={onCheckDb}
          title="Click to recheck"
          className="app-surface p-4 rounded-xl text-left cursor-pointer hover:border-slate-600 transition-colors"
        >
          <div className="text-xs text-slate-400">Storage</div>
          <div className="text-base font-semibold text-slate-100 mt-1.5 flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                dbStatus.connected ? 'bg-emerald-400' : dbStatus.usingCache ? 'bg-amber-400' : 'bg-rose-500'
              }`}
            />
            {dbStatus.connected ? (dbStatus.driver === 'sqlite' ? 'Saved on this machine' : 'Synced') : dbStatus.usingCache ? 'Using cache' : 'Disconnected'}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {dbStatus.usingCache && !dbStatus.connected ? `${accounts.length} temporary profiles` : 'Click to recheck'}
          </div>
        </button>
      </div>

      {/* 2. MODAL: ENTER & ACTIVATE A NEW VIA (ONLY SHOWN WHEN "ADD VIA" IS CLICKED) */}
      <Modal
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6 pb-3 border-b border-slate-800/80">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-slate-100 m-0">Add Via</h3>
              {recognizedUid && (
                <span className="text-xs text-slate-400 tabular-nums">UID: <span className="text-cyan-400 font-mono font-bold">{recognizedUid}</span></span>
              )}
            </div>

            {/* Mode: single Via vs bulk import */}
            <Segmented
              value={addMode}
              onChange={(val) => setAddMode(val as 'single' | 'bulk')}
              options={[
                { label: 'One account', value: 'single' },
                { label: 'Bulk', value: 'bulk' },
              ]}
            />
          </div>
        }
        open={isAddViaModalOpen}
        onCancel={() => {
          setIsAddViaModalOpen(false);
          form.resetFields();
          setLinkOrUidInput('');
          setCookieInputVal('');
        }}
        footer={null}
        width={780}
        destroyOnClose={false}
      >
        <div className="pt-3">

        {/* MODE 1: ENTER ONE VIA FIELD BY FIELD */}
        {addMode === 'single' ? (
          <Form
            form={form}
            layout="vertical"
            onFinish={handleAddSingleVia}
            onValuesChange={(changed) => {
              if ('cookieString' in changed) setCookieInputVal(changed.cookieString || '');
            }}
          >
            <Row gutter={16}>
              {/* Column 1: nickname */}
              <Col xs={24} sm={12} lg={6}>
                <Form.Item
                  label={<span className="text-xs text-slate-300">Nickname <span className="text-slate-500">(optional)</span></span>}
                  name="pageName"
                  className="mb-3"
                >
                  <Input
                    placeholder="VD: Via 01"
                    className="h-10"
                  />
                </Form.Item>
              </Col>

              {/* Column 2: Facebook link or UID */}
              <Col xs={24} sm={12} lg={6}>
                <Form.Item
                  label={<span className="text-xs text-slate-300">Link or UID <span className="text-slate-500">(optional)</span></span>}
                  name="profileUrl"
                  className="mb-3"
                >
                  <Input
                    value={linkOrUidInput}
                    onChange={(e) => setLinkOrUidInput(e.target.value)}
                    placeholder="facebook.com/... or UID"
                    className="h-10"
                  />
                </Form.Item>
              </Col>

              {/* Column 3: dedicated Proxy */}
              <Col xs={24} sm={12} lg={12}>
                <Form.Item
                  label={
                    <div className="flex items-center justify-between w-full">
                      <span className="text-xs text-slate-300">Proxy <span className="text-slate-500">(optional)</span></span>
                      <Button
                        type="link"
                        size="small"
                        loading={isTestingModalProxy}
                        onClick={handleTestModalProxy}
                        className="p-0 text-xs h-auto"
                      >
                        Check
                      </Button>
                    </div>
                  }
                  name="proxyUrl"
                  className="mb-1"
                >
                  <Input
                    placeholder="Leave empty to use this machine's IP · ip:port:user:pass or socks5://..."
                    className="h-10"
                  />
                </Form.Item>
                {modalProxyTestResult && (
                  <div className={`mb-3 text-xs px-2.5 py-1.5 rounded-xl border flex items-center justify-between transition-all ${
                    modalProxyTestResult.success
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-rose-950/40 border-rose-500/40 text-rose-300'
                  }`}>
                    {modalProxyTestResult.success ? (
                      <span>Working · IP: <span className="font-mono">{modalProxyTestResult.ip}</span> ({modalProxyTestResult.country || 'Global'}) · {modalProxyTestResult.latencyMs}ms</span>
                    ) : (
                      <span>Error · {modalProxyTestResult.error}</span>
                    )}
                  </div>
                )}
              </Col>

              {/* Facebook Cookie (required): paste the whole string or fill each field */}
              <Col xs={24}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-300">
                    <span className="text-rose-400">* </span>Cookie
                  </span>
                  <Segmented
                    size="small"
                    value={cookieMode}
                    onChange={(v) => setCookieMode(v as 'paste' | 'fields')}
                    options={[
                      { label: 'Paste whole string', value: 'paste' },
                      { label: 'Field by field', value: 'fields' },
                    ]}
                  />
                </div>
                <Form.Item
                  name="cookieString"
                  rules={[
                    { required: true, message: 'Please enter the Facebook Cookie!' },
                    {
                      validator: (_, v) =>
                        cookieMode === 'fields' && v && !(/c_user=/.test(v) && /xs=/.test(v))
                          ? Promise.reject(new Error('Both c_user and xs are required'))
                          : Promise.resolve(),
                    },
                  ]}
                  extra={
                    cookieMode === 'paste' ? (
                      <span className="text-[11px] text-slate-500">
                        Format <code>c_user=...; xs=...</code> or <code>UID|PASS|2FA|COOKIE</code>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        Get these values from your browser (F12 → Application → Cookies → facebook.com).
                      </span>
                    )
                  }
                  className="mb-3"
                >
                  <CookieInput mode={cookieMode} />
                </Form.Item>
              </Col>
            </Row>

            <div className="flex items-center justify-between pt-2">
              <div className="text-xs text-slate-500">After adding, click “Scan Pages” in the list below to fetch Fanpages.</div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={() => {
                    form.resetFields();
                    setLinkOrUidInput('');
                    setCookieInputVal('');
                  }}
                  type="text"
                >
                  Clear
                </Button>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                  className="px-5"
                >
                  Add Via
                </Button>
              </div>
            </div>
          </Form>
        ) : (
          /* MODE 2: BULK-IMPORT MANY VIAS (COLUMN FORMAT) */
          <div className="space-y-3">
            <div className="text-xs text-slate-300">
              Paste many accounts at once (one per line). 3 common formats are supported:
              <div className="mt-1 font-mono text-[11px] text-cyan-300 bg-slate-950 p-2.5 rounded-xl border border-slate-800 space-y-0.5">
                <div>• Format 1: <span className="text-slate-200">UID/Link | Via Name | Cookie | Proxy</span></div>
                <div>• Format 2 (purchased Via string): <span className="text-slate-200">UID | Password | 2FA | Cookie | Proxy</span></div>
                <div>• Format 3: <span className="text-slate-200">Cookie string only (1 cookie per line)</span></div>
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
                Entered: {bulkLineCount} account lines
              </span>

              <div className="flex items-center gap-2">
                <Button
                  onClick={() => setBulkInputText('')}
                  className="rounded-xl border-slate-700 text-slate-400 text-xs px-3 h-9"
                >
                  Clear
                </Button>
                <Button
                  type="primary"
                  loading={submitting}
                  onClick={handleAddBulkVias}
                  icon={<UploadOutlined />}
                  className="bg-cyan-600 hover:bg-cyan-500 text-on-accent font-bold text-xs rounded-xl px-5 h-9 border-0"
                >
                  Import All Vias Into The System
                </Button>
              </div>
            </div>
          </div>
        )}
        </div>
      </Modal>

      {/* 3. PARENT VIA TABLE & THEIR FANPAGES */}
      <div className="app-surface p-5 space-y-4 rounded-2xl shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-slate-100 m-0">Vias</h3>
            <span className="text-xs text-slate-500 tabular-nums">{filteredMotherVias.length}</span>
          </div>

          {/* Search box & Refresh */}
          <div className="flex items-center gap-2.5">
            <Input
              placeholder="Search by Via name, UID or Fanpage..."
              prefix={<SearchOutlined className="text-slate-400" />}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-72 bg-slate-950 border-slate-700/80 text-slate-100 text-xs rounded-xl h-9 hover:border-slate-600"
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
              Refresh
            </Button>
          </div>
        </div>

        {/* Parent Via table */}
        <Table
          dataSource={filteredMotherVias}
          rowKey="uid"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          className="border border-slate-800/80 rounded-xl overflow-hidden"
          locale={{
            emptyText: (
              <div className="py-12 flex flex-col items-center justify-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-900/80 border border-slate-800 flex items-center justify-center text-slate-500 text-2xl">
                  <UserOutlined />
                </div>
                <div className="text-slate-300 font-bold text-sm">No Via accounts yet</div>
                <p className="text-slate-500 text-xs max-w-sm text-center">
                  Click <b>"Add Via"</b> at the top to load accounts into the system!
                </p>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setIsAddViaModalOpen(true)}
                  className="mt-1"
                >
                  Add Via now
                </Button>
              </div>
            ),
          }}
          columns={viaColumns}
        />
      </div>

      {/* 4. DRAWER: VIEW & MANAGE ALL FANPAGES AND CHILD GROUPS OF A PARENT VIA */}
      <Drawer
        title={
          <div className="flex items-center justify-between w-full pr-6">
            <div className="flex items-center gap-2.5 text-slate-100 font-bold text-base min-w-0">
              <CrownOutlined className="text-amber-400 text-lg" />
              <div className="truncate">
                Via Fanpages: <span className="text-cyan-300">{activeDrawerVia?.pageName}</span>
              </div>
            </div>
            <Tag color="cyan" className="font-mono text-xs font-bold rounded-full px-2.5 py-0.5 border-0">
              {activeDrawerVia ? activeDrawerVia.totalUniquePagesCount || currentScannedPages.length : 0} Page
            </Tag>
          </div>
        }
        placement="right"
        width={620}
        open={isPageDrawerOpen}
        destroyOnHidden
        onClose={() => {
          setIsPageDrawerOpen(false);
          setIsAddingManualToDrawer(false);
        }}
        className="dark-drawer"
        styles={{
          body: { backgroundColor: 'var(--bg-primary)', padding: '16px' },
          header: { backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' },
        }}
      >
        {activeDrawerVia && (
          <div className="space-y-4">
            {/* Parent Via summary card */}
            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  src={fbAvatarSrc(activeDrawerVia.uid)}
                  icon={<UserOutlined />}
                  size={42}
                  className="bg-slate-800 border border-slate-700 shrink-0"
                />
                <div className="min-w-0">
                  <div className="font-bold text-white text-sm truncate flex items-center gap-2">
                    <span>{activeDrawerVia.pageName}</span>
                    <Tag color="gold" className="text-[10px] px-1 py-0 border-0 leading-tight">
                      Via
                    </Tag>
                  </div>
                  <div className="text-xs text-slate-400 font-mono flex items-center gap-2 mt-0.5">
                    <span>UID: {activeDrawerVia.uid}</span>
                    {activeDrawerVia.uid && (
                      <a
                        href={`https://facebook.com/${activeDrawerVia.uid}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline flex items-center gap-1"
                      >
                        <FacebookFilled /> Xem FB
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  loading={scanningUids.has(activeDrawerVia.uid)}
                  onClick={() => handleScanPagesForVia(activeDrawerVia)}
                  className="bg-cyan-600 hover:bg-cyan-500 text-xs rounded-lg font-semibold"
                >
                  Rescan Pages
                </Button>
              </div>
            </div>

            {/* Search bar & tab switch */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <Input
                placeholder="Search Pages / Groups by name or ID..."
                prefix={<SearchOutlined className="text-slate-400" />}
                value={pageSearchQuery}
                onChange={(e) => setPageSearchQuery(e.target.value)}
                className="w-56 bg-slate-900 border-slate-700 text-slate-200 text-xs rounded-xl h-8"
                allowClear
              />

              <div className="flex items-center gap-2">
                <Button
                  size="small"
                  icon={<SafetyCertificateOutlined className="text-emerald-400" />}
                  loading={isCheckingHealth}
                  onClick={() => handleCheckPagesHealth(currentScannedPages)}
                  className="bg-slate-900 border-slate-700 hover:border-emerald-500 text-slate-200 text-xs rounded-lg"
                >
                  Health check ({currentScannedPages.length})
                </Button>

                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setIsAddingManualToDrawer(!isAddingManualToDrawer);
                    if (!isAddingManualToDrawer && manualRows.length === 0) {
                      setManualRows([{ id: '', name: '' }]);
                    }
                  }}
                  className="bg-slate-800 border-slate-700 text-slate-200 text-xs rounded-lg hover:border-cyan-500 hover:text-cyan-400"
                >
                  {isAddingManualToDrawer ? 'Close add box' : '+ Add Fanpage'}
                </Button>
              </div>
            </div>

            {/* Manual Page form: separate fields or bulk paste */}
            {isAddingManualToDrawer && (
              <div className="p-4 rounded-xl bg-slate-900/95 border border-cyan-500/40 space-y-3 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                    <PlusCircleFilled className="text-cyan-400" />
                    <span>Add child Fanpages for this Via only:</span>
                  </div>
                  <Segmented
                    size="small"
                    value={manualAddMode}
                    onChange={(val) => setManualAddMode(val as 'fields' | 'bulk')}
                    options={[
                      { label: 'Separate fields', value: 'fields' },
                      { label: 'Bulk paste', value: 'bulk' },
                    ]}
                    className="bg-slate-950 border border-slate-800 text-xs"
                  />
                </div>

                {manualAddMode === 'fields' ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-300 px-1">
                      <div className="col-span-6 flex items-center gap-1">
                        <span>1. ID Fanpage / Link Page</span>
                        <span className="text-rose-400">*</span>
                      </div>
                      <div className="col-span-5">2. Fanpage nickname <span className="text-slate-500">(optional)</span></div>
                      <div className="col-span-1 text-center">Delete</div>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {manualRows.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                          <div className="col-span-6">
                            <Input
                              placeholder="e.g. 61586984840264 or a Facebook link"
                              value={row.id}
                              onChange={(e) => {
                                const next = [...manualRows];
                                next[idx].id = e.target.value;
                                setManualRows(next);
                              }}
                              className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl h-9 hover:border-cyan-500 focus:border-cyan-500"
                            />
                          </div>
                          <div className="col-span-5">
                            <Input
                              placeholder="e.g. Làm Sen, Clothing Shop..."
                              value={row.name}
                              onChange={(e) => {
                                const next = [...manualRows];
                                next[idx].name = e.target.value;
                                setManualRows(next);
                              }}
                              className="bg-slate-950 border-slate-700 text-slate-100 text-xs rounded-xl h-9 hover:border-cyan-500 focus:border-cyan-500"
                            />
                          </div>
                          <div className="col-span-1 text-center">
                            {manualRows.length > 1 && (
                              <Button
                                type="text"
                                danger
                                size="small"
                                icon={<DeleteOutlined />}
                                onClick={() => {
                                  setManualRows(manualRows.filter((_, i) => i !== idx));
                                }}
                                className="text-rose-400 hover:text-rose-300 hover:bg-rose-950/40"
                              />
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <Button
                        type="dashed"
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => setManualRows([...manualRows, { id: '', name: '' }])}
                        className="text-cyan-400 border-cyan-800/80 bg-slate-950/70 hover:bg-slate-900 rounded-lg text-xs"
                      >
                        + Add another row
                      </Button>
                      <span className="text-[11px] text-slate-400">
                        Entering: <b className="text-cyan-300">{manualRows.filter((r) => r.id.trim()).length}</b> valid pages
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-[11px] text-slate-400">
                      Format: <code className="text-cyan-300 font-mono">PAGE_ID | Page Name</code> or paste a Facebook URL (1 page per line):
                    </div>
                    <Input.TextArea
                      rows={4}
                      value={manualAddText}
                      onChange={(e) => setManualAddText(e.target.value)}
                      placeholder={`61586984840264 | My Cat Page\n10008765432198 | Sales Fanpage\nhttps://www.facebook.com/10009876543210`}
                      className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl"
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1 border-t border-slate-800/80">
                  <Button
                    size="small"
                    onClick={() => {
                      setManualAddText('');
                      setManualRows([{ id: '', name: '' }]);
                      setIsAddingManualToDrawer(false);
                    }}
                    className="rounded-lg text-xs bg-slate-800 border-slate-700 text-slate-300"
                  >
                    Cancel
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={handleSaveManualToDrawer}
                    className="bg-cyan-600 hover:bg-cyan-500 rounded-lg text-xs font-semibold shadow-md shadow-cyan-900/30"
                  >
                    Save Fanpages to Via
                  </Button>
                </div>
              </div>
            )}

            {/* Category tabs: auto-scanned Fanpages vs Pages & Groups in the MySQL database */}
            <Tabs
              activeKey={drawerActiveTab}
              onChange={(k) => setDrawerActiveTab(k as any)}
              className="custom-dark-tabs"
              items={[
                {
                  key: 'scanned',
                  label: (
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <ThunderboltOutlined className="text-cyan-400" />
                      <span>Auto-scanned Fanpages ({currentScannedPages.length})</span>
                    </span>
                  ),
                  children: (
                    <div className="space-y-2 mt-2">
                      {filteredScannedPages.length === 0 ? (
                        <div className="py-12 text-center text-slate-500 text-xs">
                          {currentScannedPages.length === 0
                            ? 'No Fanpages auto-scanned yet. Click "Rescan Pages" above so Playwright scans every Fanpage from this account\'s Cookie!'
                            : 'No Fanpages match the search keyword.'}
                        </div>
                      ) : (
                        scannedList.visible.map((page) => (
                          <div
                            key={page.id}
                            className="p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <Avatar
                                src={fbAvatarSrc(page.id)}
                                icon={<ThunderboltOutlined />}
                                size={36}
                                className="shrink-0 bg-cyan-950 border border-cyan-800/60 text-cyan-400"
                              />
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-200 text-xs truncate flex items-center gap-2">
                                  <span>{page.name || `Fanpage ${page.id}`}</span>
                                  {pageHealthMap[page.id] && (
                                    <Tag
                                      color={
                                        pageHealthMap[page.id] === 'LIVE'
                                          ? 'success'
                                          : pageHealthMap[page.id] === 'RESTRICTED'
                                          ? 'warning'
                                          : 'error'
                                      }
                                      className="text-[9px] font-semibold border-0 rounded px-1.5 py-0 leading-tight"
                                    >
                                      {pageHealthMap[page.id] === 'LIVE'
                                        ? '● LIVE'
                                        : pageHealthMap[page.id] === 'RESTRICTED'
                                        ? '● RESTRICTED'
                                        : '● CHECK FAILED'}
                                    </Tag>
                                  )}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono flex items-center gap-1.5 mt-0.5">
                                  <span>ID: {page.id}</span>
                                  <Tooltip title="Copy Page ID">
                                    <Button
                                      type="text"
                                      size="small"
                                      icon={<CopyOutlined className="text-[10px]" />}
                                      onClick={() => {
                                        navigator.clipboard.writeText(page.id);
                                        message.success(`Copied ID: ${page.id}`);
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
                                      <LinkOutlined /> Open Page
                                    </a>
                                  )}
                                </div>
                              </div>
                            </div>

                            <Popconfirm
                              title="Remove this Fanpage from the Via?"
                              onConfirm={() => handleDeletePageFromVia(page.id)}
                              okText="Delete"
                              cancelText="Cancel"
                              okButtonProps={{ danger: true }}
                            >
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined className="text-xs" />}
                                className="hover:bg-rose-950/40 rounded-lg text-slate-500 hover:text-rose-400"
                              />
                            </Popconfirm>
                          </div>
                        ))
                      )}

                      <ShowMoreButton remaining={scannedList.remaining} onClick={scannedList.showMore} />

                      {currentScannedPages.length > 0 && (
                        <div className="pt-3 border-t border-slate-800/80 flex justify-between items-center text-xs text-slate-500">
                          <span>Total: {currentScannedPages.length} scanned Fanpages</span>
                          <Popconfirm
                            title="Remove every scanned Fanpage from this Via?"
                            description="The list will be wiped from the cache."
                            onConfirm={handleClearAllPagesFromVia}
                            okText="Delete all"
                            cancelText="Cancel"
                            okButtonProps={{ danger: true }}
                          >
                            <Button size="small" type="link" danger className="p-0 text-xs">
                              Delete all scanned Pages
                            </Button>
                          </Popconfirm>
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'db',
                  label: (
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <DatabaseOutlined className="text-purple-400" />
                      <span>Synced Pages & Groups ({currentDbPages.length + currentDbGroups.length})</span>
                    </span>
                  ),
                  children: (
                    <div className="space-y-3 mt-2">
                      <div className="text-[11px] text-slate-400 bg-slate-900/90 p-2.5 rounded-xl border border-slate-800 flex items-start gap-1.5">
                        <InfoCircleOutlined className="text-cyan-400 mt-0.5 shrink-0" />
                        <span>The Pages &amp; Groups under this Via are synced and stored safely. You can manage or remove each child item without affecting the Via.</span>
                      </div>

                      {/* Pages in the DB */}
                      {filteredDbPages.length > 0 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <AppstoreOutlined className="text-purple-400" />
                            <span>Fanpage ({filteredDbPages.length})</span>
                          </div>
                          {dbPagesList.visible.map((item) => (
                            <div
                              key={item.id}
                              className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-200 truncate flex items-center gap-1.5">
                                  <span>{item.pageName}</span>
                                  <Tag color="purple" className="text-[10px] px-1 py-0 border-0 leading-tight">
                                    Page
                                  </Tag>
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                                  <span>ID: {item.platformAccountId}</span>
                                  <span className="text-slate-600">|</span>
                                  <span>Record: #{item.id}</span>
                                </div>
                              </div>

                              <Popconfirm
                                title="Delete this Page from the Database?"
                                description="The record in the social_accounts table will be deleted."
                                onConfirm={() => handleDeleteChildDbAccount(item.id)}
                                okText="Delete"
                                cancelText="Cancel"
                                okButtonProps={{ danger: true }}
                              >
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined className="text-xs" />}
                                  className="hover:bg-rose-950/40 rounded-lg text-slate-500 hover:text-rose-400"
                                />
                              </Popconfirm>
                            </div>
                          ))}
                          <ShowMoreButton remaining={dbPagesList.remaining} onClick={dbPagesList.showMore} />
                        </div>
                      )}

                      {/* Groups in the DB */}
                      {filteredDbGroups.length > 0 && (
                        <div className="space-y-1.5 pt-2">
                          <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                            <TeamOutlined className="text-blue-400" />
                            <span>Facebook Groups ({filteredDbGroups.length})</span>
                          </div>
                          {dbGroupsList.visible.map((item) => (
                            <div
                              key={item.id}
                              className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-semibold text-slate-200 truncate flex items-center gap-1.5">
                                  <span>{item.pageName}</span>
                                  <Tag color="blue" className="text-[10px] px-1 py-0 border-0 leading-tight">
                                    Group
                                  </Tag>
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono mt-0.5 flex items-center gap-1.5">
                                  <span>ID: {item.platformAccountId}</span>
                                  <span className="text-slate-600">|</span>
                                  <span>Record: #{item.id}</span>
                                </div>
                              </div>

                              <Popconfirm
                                title="Delete this Group from the Database?"
                                description="The record in the social_accounts table will be deleted."
                                onConfirm={() => handleDeleteChildDbAccount(item.id)}
                                okText="Delete"
                                cancelText="Cancel"
                                okButtonProps={{ danger: true }}
                              >
                                <Button
                                  size="small"
                                  type="text"
                                  danger
                                  icon={<DeleteOutlined className="text-xs" />}
                                  className="hover:bg-rose-950/40 rounded-lg text-slate-500 hover:text-rose-400"
                                />
                              </Popconfirm>
                            </div>
                          ))}
                          <ShowMoreButton remaining={dbGroupsList.remaining} onClick={dbGroupsList.showMore} />
                        </div>
                      )}

                      {currentDbPages.length === 0 && currentDbGroups.length === 0 && (
                        <div className="py-10 text-center text-slate-500 text-xs">
                          No child Pages or Groups are saved in the Database for this Via.
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'export',
                  label: (
                    <span className="flex items-center gap-1.5 text-xs font-semibold">
                      <FileTextOutlined className="text-emerald-400" />
                      <span>Export ID List</span>
                    </span>
                  ),
                  children: (
                    <div className="space-y-3 mt-2">
                      <div className="text-xs text-slate-300">
                        Copy every Fanpage ID under this Via to paste into another tool or keep:
                      </div>

                      <Input.TextArea
                        rows={10}
                        readOnly
                        value={exportLines.join('\n')}
                        className="bg-slate-950 border-slate-700 text-slate-200 font-mono text-xs rounded-xl"
                      />

                      <Button
                        type="primary"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          navigator.clipboard.writeText(exportLines.join('\n'));
                          message.success(`Copied ${exportLines.length} Fanpage ID lines!`);
                        }}
                        className="bg-cyan-600 hover:bg-cyan-500 text-xs font-semibold rounded-xl"
                      >
                        Copy All Page IDs
                      </Button>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
      </Drawer>

      {/* 5. MODAL: UPDATE / CHANGE A PARENT VIA'S COOKIE */}
      <Modal
        title={
          <div className="flex items-center gap-2.5 text-white">
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400">
              <KeyOutlined />
            </div>
            <div>
              <div className="font-bold text-sm">Update Facebook Cookie For Via</div>
              <div className="text-xs text-slate-400 font-normal">
                Nick: <span className="text-cyan-300 font-semibold">{updateCookieModalVia?.pageName}</span> (UID:{' '}
                <span className="font-mono text-slate-300">{updateCookieModalVia?.uid}</span>)
              </div>
            </div>
          </div>
        }
        open={Boolean(updateCookieModalVia)}
        width={760}
        centered
        onCancel={() => {
          if (!isUpdatingCookie) {
            setUpdateCookieModalVia(null);
            setCookieCUser('');
            setCookieXs('');
            setRawCookieInput('');
            setNewProxyInput('');
            setParsedCookieInfo(null);
          }
        }}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setUpdateCookieModalVia(null);
              setCookieCUser('');
              setCookieXs('');
              setRawCookieInput('');
              setNewProxyInput('');
              setParsedCookieInfo(null);
            }}
            disabled={isUpdatingCookie}
            className="bg-slate-900 border-slate-700 text-slate-300 rounded-xl"
          >
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            icon={<SyncOutlined spin={isUpdatingCookie} />}
            loading={isUpdatingCookie}
            onClick={() => handleSaveNewCookie(false)}
            className="bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl"
          >
            Save & Reactivate
          </Button>,
        ]}
        className="dark-modal"
      >
        <div className="space-y-3 pt-1">
          {/* 2 TABS: ONE FOR PASTING A WHOLE BLOCK, ONE FOR MANUAL ENTRY */}
          <Tabs
            activeKey={updateCookieTab}
            onChange={(k) => setUpdateCookieTab(k as 'blob' | 'manual')}
            items={[
              {
                key: 'blob',
                label: (
                  <span className="flex items-center gap-1.5 font-semibold text-xs px-1">
                    <ThunderboltOutlined className="text-amber-400" />
                    Paste the whole thing (JSON Cookie / combined string)
                  </span>
                ),
                children: (
                  <div className="space-y-2 pt-1">
                    <div className="p-3.5 rounded-xl bg-gradient-to-r from-sky-950/60 via-slate-900 to-indigo-950/60 border border-sky-500/40 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-sky-300">
                          Drop a JSON blob or Cookie string here:
                        </span>
                        {parsedCookieInfo && (
                          <Tag color={parsedCookieInfo.isJson ? 'cyan' : 'blue'} className="font-mono text-[11px] !m-0">
                            {parsedCookieInfo.isJson ? `JSON (${parsedCookieInfo.cookieCount} cookies)` : 'Cookie string'}
                          </Tag>
                        )}
                      </div>
                      <Input.TextArea
                        rows={4}
                        allowClear
                        placeholder={`Drop a {"url":"...","cookies":[...]} or [{name:"c_user",...}] or a c_user=...; xs=... string here...`}
                        value={rawCookieInput}
                        onChange={(e) => applyParsedCookie(e.target.value, 'raw')}
                        className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl hover:border-cyan-500 focus:border-cyan-500"
                      />
                      {parsedCookieInfo && parsedCookieInfo.valid && (
                        <div className="text-[11px] text-emerald-400 flex items-center gap-2 bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-lg">
                          <CheckCircleFilled />
                          <span>
                            Parsed successfully: <b>c_user = {parsedCookieInfo.c_user}</b> | <b>xs = {parsedCookieInfo.xs.slice(0, 18)}...</b>
                          </span>
                        </div>
                      )}
                      {updateCookieModalVia?.uid && parsedCookieInfo?.c_user && updateCookieModalVia.uid !== parsedCookieInfo.c_user && (
                        <div className="text-[11px] text-amber-300 flex items-center gap-1.5 bg-amber-950/40 border border-amber-800/40 px-2.5 py-1 rounded-lg">
                          <ExclamationCircleOutlined className="text-amber-400 shrink-0" />
                          <span>
                            Note: the UID in the Cookie (<b>{parsedCookieInfo.c_user}</b>) differs from the Via's UID (<b>{updateCookieModalVia.uid}</b>). When you click Save, the system will sync to this new UID!
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 px-1">
                      <InfoCircleOutlined className="text-sky-400 shrink-0" />
                      <span>Supports Cookie-Editor JSON, J2TEAM, cookie arrays or <code>c_user=...; xs=...</code> strings. The system automatically parses and syncs to the manual tab!</span>
                    </div>
                  </div>
                ),
              },
              {
                key: 'manual',
                label: (
                  <span className="flex items-center gap-1.5 font-semibold text-xs px-1">
                    <KeyOutlined className="text-cyan-400" />
                    Enter manually (c_user & xs)
                  </span>
                ),
                children: (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {/* LINE 1: c_user */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs font-semibold text-slate-200">
                            1. Line 1: <code className="text-cyan-300 font-bold">c_user</code> (UID) <span className="text-rose-400">*</span>
                          </label>
                          <span className="text-[11px] text-slate-400 font-mono">Account UID digits</span>
                        </div>
                        <Input
                          placeholder="e.g. 100023403136194"
                          value={cookieCUser}
                          onChange={(e) => applyParsedCookie(e.target.value, 'c_user')}
                          prefix={<UserOutlined className="text-slate-500" />}
                          className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-cyan-500 focus:border-cyan-500"
                        />
                        <div className="mt-1 text-[11px] text-slate-400 flex items-center gap-1">
                          <InfoCircleOutlined className="text-slate-500" />
                          <span>Filled automatically from the Via's UID or extracted from the paste tab.</span>
                        </div>
                      </div>

                      {/* LINE 2: xs */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                          <label className="text-xs font-semibold text-slate-200">
                            2. Line 2: <code className="text-cyan-300 font-bold">xs</code> (session token) <span className="text-rose-400">*</span>
                          </label>
                          <div className="flex items-center gap-2">
                            {cookieXs && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCookieXs('');
                                  setRawCookieInput('');
                                  setParsedCookieInfo(null);
                                }}
                                className="text-[11px] text-rose-400 hover:text-rose-300 bg-rose-950/40 border border-rose-800/50 px-2 py-0.5 rounded cursor-pointer transition-colors"
                              >
                                Clear xs
                              </button>
                            )}
                            <span className="text-[11px] text-cyan-400 font-mono">Only xs needed</span>
                          </div>
                        </div>
                        <Input
                          placeholder="Paste the new xs here (e.g. 2%3A0UeZEJylLU5ccA%3A2...)"
                          value={cookieXs}
                          onChange={(e) => applyParsedCookie(e.target.value, 'xs')}
                          className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl h-10 hover:border-cyan-500 focus:border-cyan-500"
                        />
                        <div className="mt-1 text-[11px] text-slate-400">
                          Just copy the new <b className="text-slate-300">xs</b> value, paste it here and click Save.
                        </div>
                      </div>
                    </div>
                  </div>
                ),
              },
            ]}
          />

          {/* SHARED BOTTOM ROW: PROXY AND RESCAN OPTION (2 COLUMNS) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-end pt-2 border-t border-slate-800/80">
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                Dedicated Proxy for this Via <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <Input
                placeholder="ip:port:user:pass or http://user:pass@ip:port"
                value={newProxyInput}
                onChange={(e) => setNewProxyInput(e.target.value)}
                prefix={<GlobalOutlined className="text-slate-500" />}
                className="bg-slate-950 border-slate-700 text-slate-100 font-mono text-xs rounded-xl h-10 focus:border-cyan-500"
              />
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center h-10">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300 m-0">
                <input
                  type="checkbox"
                  checked={autoRescanAfterUpdate}
                  onChange={(e) => setAutoRescanAfterUpdate(e.target.checked)}
                  className="rounded border-slate-700 text-cyan-600 focus:ring-cyan-500"
                />
                <span className="font-medium">Automatically rescan child Fanpages after saving</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default ViaManagementPage;
