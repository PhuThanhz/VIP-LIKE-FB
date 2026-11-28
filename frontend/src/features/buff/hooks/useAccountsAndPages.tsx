import { type FanpageItem, type BuffLogEntry, type BuffMonitor } from '../types';
import { VIA_PAGES_STORAGE_KEY } from '../constants';
import api, { WORKER_BASE_URL } from '../../../config/axios';
import axios from 'axios';
import {
  extractCUser,
  getStoredPagesForVia,
  getViaKey,
  isPersonalCookieAccount,
  saveStoredPagesForVia,
  isDeadViaStatus,
} from '../utils';
import { getInitialSeedVias, getStoredCookieForVia, seedLocalStorageIfEmpty } from '../../../config/seedHelper';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type MessageInstance } from 'antd/es/message/interface';
import type { BuffEngagementProps } from '../../../pages/BuffEngagement';

export interface UseAccountsAndPagesDeps {
  props: BuffEngagementProps;
  queueItems: any[];
  buffLogs: BuffLogEntry[];
  monitors: BuffMonitor[];
  selectedAccountId: number | "CUSTOM" | "ALL_VIAS";
  customCookie: string;
  setSelectedAccountId: Dispatch<SetStateAction<number | "CUSTOM" | "ALL_VIAS">>;
  setScannedPages: Dispatch<SetStateAction<FanpageItem[]>>;
  setSelectedPageIds: Dispatch<SetStateAction<string[]>>;
  actorMode: "VIAS" | "FANPAGES";
  scannedPages: FanpageItem[];
  setBatchLikesPerOrder: Dispatch<SetStateAction<number>>;
  batchLinksText: string;
  buffMode: "SINGLE" | "BATCH";
  targetPostUrl: string;
  selectedPageIds: string[];
  delayMs: number;
  concurrency: number;
  message: MessageInstance;
  alreadyLikedPagesForUrl: { pageId: string; pageName: string; reactionType: string; date: string; }[];
  interactedPageIds: Set<string>;
  viaFilter: string;
  likeFilter: "ALL" | "UNLIKED" | "LIKED";
  pageSearchQuery: string;
  autoSkipAlreadyLiked: boolean;
  autoFailoverLiveVia: boolean;
  /** Remembers how many likes the user asked for when a quick-pick could only find fewer Pages */
  setLikeRequest: (req: { requested: number; picked: number } | null) => void;
}

/** Vias/accounts, Fanpage lists per Via, Fanpage selection, dedupe, run-time estimate */
export function useAccountsAndPages(deps: UseAccountsAndPagesDeps) {
  const {
    props,
    queueItems,
    buffLogs,
    monitors,
    selectedAccountId,
    customCookie,
    setSelectedAccountId,
    setScannedPages,
    setSelectedPageIds,
    actorMode,
    scannedPages,
    setBatchLikesPerOrder,
    batchLinksText,
    buffMode,
    targetPostUrl,
    selectedPageIds,
    delayMs,
    concurrency,
    message,
    alreadyLikedPagesForUrl,
    interactedPageIds,
    viaFilter,
    likeFilter,
    pageSearchQuery,
    autoSkipAlreadyLiked,
    autoFailoverLiveVia,
    setLikeRequest,
  } = deps;

  // Manage & declare extra i_user (Fanpages) per Via
  const queryClient = useQueryClient();
  const [managePagesModalOpen, setManagePagesModalOpen] = useState<boolean>(false);
  const [targetViaForModal, setTargetViaForModal] = useState<number | 'CUSTOM'>('CUSTOM');
  const [refreshViaPagesKey, setRefreshViaPagesKey] = useState<number>(0);

  // Fetch accounts from backend with staleTime 0 so newly added Vias appear instantly
  const { data: accountsData = [], isLoading: loadingAccounts, refetch: refetchAccounts } = useQuery({
    queryKey: ['socialAccounts'],
    queryFn: async () => {
      try {
        const res = await api.get('/connections');
        if (Array.isArray(res.data) && res.data.length > 0) return res.data;
      } catch (e) {}
      return getInitialSeedVias();
    },
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const accounts = accountsData && accountsData.length > 0 ? accountsData : getInitialSeedVias();

  // Deduplicate mother account by c_user
  const fbAccounts = useMemo(() => {
    const list = accounts && accounts.length > 0 ? accounts : getInitialSeedVias();
    const byCUser = new Map<string, any>();
    for (const account of list as any[]) {
      if (!isPersonalCookieAccount(account) || account.platform === 'FACEBOOK_GROUP') continue;
      const cUser = extractCUser(account.cookieString || account.accessToken) || String(account.platformAccountId || account.id);
      if (!cUser) continue;
      const savedCookie = getStoredCookieForVia(cUser);
      const effectiveAccount = {
        ...account,
        cookieString: account.cookieString || account.accessToken || savedCookie || '',
        accessToken: account.cookieString || account.accessToken || savedCookie || '',
      };
      const existing = byCUser.get(cUser);
      const accountIsProfile =
        effectiveAccount.platform === 'FACEBOOK_PROFILE' || effectiveAccount.accountType === 'PERSONAL_PROFILE_COOKIE';
      const existingIsProfile =
        existing?.platform === 'FACEBOOK_PROFILE' || existing?.accountType === 'PERSONAL_PROFILE_COOKIE';
      if (
        !existing ||
        (accountIsProfile && !existingIsProfile) ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus !== 'OK' && effectiveAccount.tokenStatus === 'OK') ||
        (accountIsProfile === existingIsProfile && existing.tokenStatus === effectiveAccount.tokenStatus && effectiveAccount.id > existing.id)
      ) {
        byCUser.set(cUser, effectiveAccount);
      }
    }

    return Array.from(byCUser.values());
  }, [accounts]);

  // Sync stats to the Ant Design Sidebar
  useEffect(() => {
    props.onStatsUpdate?.({
      queueCount: queueItems.filter((i) => i.status === 'QUEUED').length,
      historyCount: buffLogs.length,
      monitorsCount: (monitors || []).length,
      accountsCount: fbAccounts.length,
    });
  }, [queueItems, buffLogs, monitors, fbAccounts]);

  // Active Cookie string
  const activeCookie = useMemo(() => {
    if (selectedAccountId === 'CUSTOM') return customCookie.trim();
    if (selectedAccountId === 'ALL_VIAS') {
      return fbAccounts[0]?.cookieString || fbAccounts[0]?.accessToken || '';
    }
    const acc = fbAccounts.find((a: any) => a.id === selectedAccountId);
    return acc?.cookieString || acc?.accessToken || '';
  }, [selectedAccountId, customCookie, fbAccounts]);

  const currentViaAccount = useMemo(() => {
    if (selectedAccountId === 'CUSTOM' || selectedAccountId === 'ALL_VIAS') return null;
    return fbAccounts.find((a: any) => a.id === selectedAccountId) || null;
  }, [selectedAccountId, fbAccounts]);

  const modalViaAccount = useMemo(() => {
    if (targetViaForModal === 'CUSTOM') return null;
    return fbAccounts.find((a: any) => a.id === targetViaForModal) || null;
  }, [targetViaForModal, fbAccounts]);

  const targetViaKey = useMemo(() => {
    return getViaKey(modalViaAccount, customCookie);
  }, [modalViaAccount, customCookie]);

  const currentModalPages = useMemo(() => {
    void refreshViaPagesKey;
    return getStoredPagesForVia(targetViaKey);
  }, [targetViaKey, refreshViaPagesKey]);

  const handleOpenManagePages = (viaId?: number | 'CUSTOM' | 'ALL_VIAS') => {
    const id = viaId !== undefined && viaId !== 'ALL_VIAS' ? viaId : (fbAccounts[0]?.id || 'CUSTOM');
    setTargetViaForModal(id);
    setManagePagesModalOpen(true);
  };

  // Auto select ALL_VIAS if multiple accounts exist, else first account
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM' && !customCookie.trim() && fbAccounts.length > 0) {
      setSelectedAccountId(fbAccounts.length > 1 ? 'ALL_VIAS' : fbAccounts[0].id);
    }
  }, [fbAccounts, selectedAccountId, customCookie]);

  // Sync Fanpages from the backend cache into LocalStorage on startup
  useEffect(() => {
    seedLocalStorageIfEmpty();
    api.get('/buff-cached-pages').then((res) => {
      if (res.data?.success && res.data.cache) {
        const raw = localStorage.getItem(VIA_PAGES_STORAGE_KEY);
        const map = raw ? JSON.parse(raw) : {};
        let changed = false;
        for (const [uid, item] of Object.entries(res.data.cache as Record<string, any>)) {
          const key = `cuser_${uid}`;
          if (Array.isArray(item.pages) && item.pages.length > 0) {
            if (!map[key] || map[key].length < item.pages.length) {
              map[key] = item.pages;
              changed = true;
            }
          }
        }
        if (changed) {
          localStorage.setItem(VIA_PAGES_STORAGE_KEY, JSON.stringify(map));
          setRefreshViaPagesKey((prev) => prev + 1);
        }
      }
    }).catch(() => {});
  }, []);

  // Load persistent Fanpages for selected Via or ALL_VIAS
  useEffect(() => {
    if (selectedAccountId === 'CUSTOM') {
      const viaKey = getViaKey('CUSTOM', customCookie);
      const saved = getStoredPagesForVia(viaKey);
      setScannedPages(saved);
      setSelectedPageIds(saved.map((p) => p.id));
      return;
    }

    // IN PERSONAL-VIA MODE: USE EACH VIA ACCOUNT DIRECTLY
    if (actorMode === 'VIAS') {
      if (selectedAccountId === 'ALL_VIAS') {
        const viaItems: FanpageItem[] = fbAccounts.map((a: any) => {
          const cUser = extractCUser(a.cookieString || a.accessToken) || String(a.platformAccountId || a.id);
          return {
            id: cUser,
            name: a.pageName || `Via ${cUser}`,
            url: `https://www.facebook.com/profile.php?id=${cUser}`,
            viaAccountId: a.id,
            viaName: a.pageName || `Via ${cUser}`,
            viaCookie: a.cookieString || a.accessToken,
            viaStatus: a.tokenStatus || 'OK',
            isProfile: true,
          };
        });
        setScannedPages(viaItems);
        setSelectedPageIds(viaItems.map((p) => p.id));
        return;
      }

      const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
      if (sourceAccount) {
        const cUser = extractCUser(sourceAccount.cookieString || sourceAccount.accessToken) || String(sourceAccount.platformAccountId || sourceAccount.id);
        const item: FanpageItem = {
          id: cUser,
          name: sourceAccount.pageName || `Via ${cUser}`,
          url: `https://www.facebook.com/profile.php?id=${cUser}`,
          viaAccountId: sourceAccount.id,
          viaName: sourceAccount.pageName || `Via ${cUser}`,
          viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
          viaStatus: sourceAccount.tokenStatus || 'OK',
          isProfile: true,
        };
        setScannedPages([item]);
        setSelectedPageIds([item.id]);
        return;
      }
    }

    if (selectedAccountId === 'ALL_VIAS') {
      const allPages: FanpageItem[] = [];
      const seenPageIds = new Set<string>();

      // Collect every page of each via
      const viaPageMaps = new Map<number, FanpageItem[]>();

      for (const account of fbAccounts) {
        const sourceCUser = extractCUser(account?.cookieString || account?.accessToken);
        const viaKey = getViaKey(account);
        const localSaved = getStoredPagesForVia(viaKey);

        const dbPages: FanpageItem[] = (accounts as any[])
          .filter(
            (acc) =>
              acc.platform === 'FACEBOOK_PAGE' &&
              acc.accountType === 'PERSONAL_COOKIE' &&
              (sourceCUser ? extractCUser(acc.cookieString || acc.accessToken) === sourceCUser : true)
          )
          .map((acc) => ({
            id: String(acc.platformAccountId),
            name: acc.pageName || `Facebook Page ${acc.platformAccountId}`,
            url: `https://www.facebook.com/profile.php?id=${acc.platformAccountId}`,
          }));

        const map = new Map<string, FanpageItem>();
        for (const p of localSaved) {
          if (p.id) map.set(p.id, p);
        }
        for (const p of dbPages) {
          if (p.id && !map.has(p.id)) {
            map.set(p.id, p);
          }
        }
        viaPageMaps.set(account.id, Array.from(map.values()));
      }

      // SMART LOAD BALANCER:
      // Vias with smaller page pools (Hồng Phước 92, Phú 28) go first to spread the load evenly,
      // then the large Via (Thành An 514) takes the rest, reducing strain on every parent account.
      const sortedAccounts = [...fbAccounts].sort((a, b) => {
        const countA = viaPageMaps.get(a.id)?.length || 0;
        const countB = viaPageMaps.get(b.id)?.length || 0;
        return countA - countB;
      });

      for (const account of sortedAccounts) {
        const pages = viaPageMaps.get(account.id) || [];
        for (const p of pages) {
          if (!seenPageIds.has(p.id)) {
            seenPageIds.add(p.id);
            allPages.push({
              ...p,
              viaAccountId: account.id,
              viaName: account.pageName || 'Via Facebook',
              viaCookie: account.cookieString || account.accessToken,
              viaStatus: account.tokenStatus || 'OK',
            });
          }
        }
      }

      setScannedPages(allPages);
      setSelectedPageIds(allPages.map((p) => p.id));
      return;
    }

    const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
    if (!sourceAccount) return;
    const sourceCUser = extractCUser(sourceAccount?.cookieString || sourceAccount?.accessToken);
    const viaKey = getViaKey(sourceAccount);

    const localSaved = getStoredPagesForVia(viaKey);

    const dbPages: FanpageItem[] = (accounts as any[])
      .filter(
        (account) =>
          account.platform === 'FACEBOOK_PAGE' &&
          account.accountType === 'PERSONAL_COOKIE' &&
          (sourceCUser ? extractCUser(account.cookieString || account.accessToken) === sourceCUser : true)
      )
      .map((account) => ({
        id: String(account.platformAccountId),
        name: account.pageName || `Facebook Page ${account.platformAccountId}`,
        url: `https://www.facebook.com/profile.php?id=${account.platformAccountId}`,
      }));

    // Merge unique by ID: localSaved takes precedence, then dbPages
    const map = new Map<string, FanpageItem>();
    for (const p of localSaved) {
      if (p.id) map.set(p.id, p);
    }
    for (const p of dbPages) {
      if (p.id && !map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    const mergedList = Array.from(map.values())
      .map((p) => ({
        ...p,
        viaAccountId: sourceAccount.id,
        viaName: sourceAccount.pageName || 'Via Facebook',
        viaCookie: sourceAccount.cookieString || sourceAccount.accessToken,
        viaStatus: sourceAccount.tokenStatus || 'OK',
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'));

    if (mergedList.length > 0) {
      saveStoredPagesForVia(viaKey, mergedList);
    }
    setScannedPages(mergedList);
    setSelectedPageIds(mergedList.map((p) => p.id));
  }, [accounts, fbAccounts, selectedAccountId, actorMode]);

  useEffect(() => {
    if (scannedPages.length > 0) {
      setBatchLikesPerOrder((prev) => (prev === 20 || prev === 0 ? scannedPages.length : prev));
    }
  }, [scannedPages]);

  const { parsedBatchLinks, rawBatchLinesCount, invalidBatchLinesCount } = useMemo(() => {
    const rawTokens = batchLinksText
      .split(/[\r\n,;]+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const validUrls: string[] = [];
    const seen = new Set<string>();
    let invalidCount = 0;

    for (const token of rawTokens) {
      let url = token;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com')) {
          url = 'https://' + url.replace(/^\/+/, '');
        }
      }
      if (
        (url.startsWith('http://') || url.startsWith('https://')) &&
        (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.com'))
      ) {
        if (!seen.has(url)) {
          seen.add(url);
          validUrls.push(url);
        }
      } else {
        invalidCount++;
      }
    }

    return {
      parsedBatchLinks: validUrls,
      rawBatchLinesCount: rawTokens.length,
      invalidBatchLinesCount: invalidCount,
    };
  }, [batchLinksText]);

  // Run-time estimate: prefer the real speed from completed posts, otherwise use the selected delay
  const runEstimate = useMemo(() => {
    const links = buffMode === 'BATCH' ? parsedBatchLinks.length : targetPostUrl.trim() ? 1 : 0;
    const accounts = selectedPageIds.length;
    if (links === 0 || accounts === 0) return null;

    const samples = (queueItems as any[])
      .filter((t) => t.status === 'COMPLETED' && t.result?.durationSec > 0 && t.result?.total > 0)
      .slice(-20)
      .map((t) => t.result.durationSec / t.result.total)
      .sort((a, b) => a - b);

    let perPage: number;
    let basis: 'history' | 'settings';
    if (samples.length >= 3) {
      perPage = samples[Math.floor(samples.length / 2)]; // median, less affected by outlier runs
      basis = 'history';
    } else {
      perPage = delayMs / 1000 / Math.max(1, concurrency) + 3;
      basis = 'settings';
    }
    const perLink = perPage * accounts;
    return { total: perLink * links, perLink, links, basis };
  }, [buffMode, parsedBatchLinks.length, targetPostUrl, selectedPageIds.length, queueItems, delayMs, concurrency]);



  // Mutation: save new Fanpages to a Via
  const savePagesMutation = useMutation({
    mutationFn: async (pagesToAdd: { pageName: string; platformAccountId: string }[]) => {
      const motherAccount = fbAccounts.find((a: any) => a.id === (targetViaForModal !== 'CUSTOM' ? targetViaForModal : selectedAccountId));
      const motherCookie = motherAccount?.cookieString || motherAccount?.accessToken || customCookie;
      if (!motherCookie) {
        return [];
      }

      const created = [];
      for (const p of pagesToAdd) {
        try {
          const res = await api.post('/connections', {
            platform: 'FACEBOOK_PAGE',
            accountType: 'PERSONAL_COOKIE',
            platformAccountId: p.platformAccountId,
            pageName: p.pageName,
            accessToken: motherCookie,
            tokenStatus: 'OK',
          });
          created.push(res.data);
        } catch {
          // Ignore backend conflict if already exists
        }
      }
      return created;
    },
    onSuccess: (res) => {
      if (res.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
      }
    },
    onError: () => {},
  });

  // Handlers to save / remove Fanpages for a specific Via
  const handleSavePagesForTargetVia = (pagesToAdd: FanpageItem[]) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const merged = [...existing];
    for (const p of pagesToAdd) {
      const idx = merged.findIndex((m) => m.id === p.id);
      if (idx >= 0) {
        if (p.name) merged[idx] = { ...merged[idx], name: p.name };
      } else {
        merged.push(p);
      }
    }
    saveStoredPagesForVia(targetViaKey, merged);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(merged);
      setSelectedPageIds(merged.map((p) => p.id));
    }

    message.success(`Đã lưu ${pagesToAdd.length} Fanpage cho Via ${modalViaAccount?.pageName || 'này'}!`);

    savePagesMutation.mutate(pagesToAdd.map((p) => ({ pageName: p.name, platformAccountId: p.id })));
  };

  const handleDeletePageForTargetVia = (pageId: string) => {
    const existing = getStoredPagesForVia(targetViaKey);
    const updated = existing.filter((p) => p.id !== pageId);
    saveStoredPagesForVia(targetViaKey, updated);
    setRefreshViaPagesKey((prev) => prev + 1);

    if (targetViaForModal === selectedAccountId) {
      setScannedPages(updated);
      setSelectedPageIds((prev) => prev.filter((id) => id !== pageId));
    }

    message.success('Đã gỡ Fanpage khỏi danh sách của Via!');
    deletePageMutation.mutate(pageId);
  };

  const handleClearPagesForTargetVia = () => {
    saveStoredPagesForVia(targetViaKey, []);
    setRefreshViaPagesKey((prev) => prev + 1);
    if (targetViaForModal === selectedAccountId) {
      setScannedPages([]);
      setSelectedPageIds([]);
    }
    message.info('Đã xóa danh sách để bạn nhập lại.');
  };

  // Mutation: remove a Fanpage from the system
  const deletePageMutation = useMutation({
    mutationFn: async (pageId: string) => {
      const acc = (accounts as any[]).find(
        (a) => a.platform === 'FACEBOOK_PAGE' && String(a.platformAccountId) === String(pageId)
      );
      if (acc) {
        await api.delete(`/connections/${acc.id}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socialAccounts'] });
    },
    onError: () => {},
  });

  // Page counts per Via when ALL_VIAS is selected
  const viaGroupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of scannedPages) {
      const vName = p.viaName || 'Khác';
      counts[vName] = (counts[vName] || 0) + 1;
    }
    return counts;
  }, [scannedPages]);

  // O(1) lookup Sets instead of O(N*M) .includes() / .some()
  const selectedPageIdsSet = useMemo(() => new Set(selectedPageIds), [selectedPageIds]);
  const alreadyLikedPageIdsSet = useMemo(
    () => new Set(alreadyLikedPagesForUrl.map((al) => al.pageId)),
    [alreadyLikedPagesForUrl]
  );
  const combinedAlreadyLikedIds = useMemo(() => {
    const merged = new Set<string>(interactedPageIds);
    for (const id of alreadyLikedPageIdsSet) merged.add(id);
    return merged;
  }, [interactedPageIds, alreadyLikedPageIdsSet]);

  const unlikedScannedPages = useMemo(
    () => scannedPages.filter((p) => !combinedAlreadyLikedIds.has(p.id)),
    [scannedPages, combinedAlreadyLikedIds]
  );

  // Filter pages by search query, viaFilter, and likeFilter
  const filteredPages = useMemo(() => {
    let list = scannedPages;
    if (viaFilter !== 'ALL') {
      list = list.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter);
    }
    if (likeFilter === 'UNLIKED') {
      list = list.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    } else if (likeFilter === 'LIKED') {
      list = list.filter((p) => combinedAlreadyLikedIds.has(p.id));
    }
    if (!pageSearchQuery.trim()) return list;
    const q = pageSearchQuery.toLowerCase().trim();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.includes(q) ||
        (p.viaName && p.viaName.toLowerCase().includes(q))
    );
  }, [scannedPages, pageSearchQuery, viaFilter, likeFilter, combinedAlreadyLikedIds]);

  // Vias whose cookie is dead right now and how many not-yet-liked Pages that costs.
  // Those Pages are skipped when picking, so the like target silently shrinks without this summary.
  const deadViaSummary = useMemo(() => {
    const byVia = new Map<string, { viaName: string; status: string; lostPages: number }>();
    for (const p of unlikedScannedPages) {
      if (!isDeadViaStatus(p.viaStatus)) continue;
      const key = p.viaName || 'Via';
      const cur = byVia.get(key) || { viaName: key, status: String(p.viaStatus), lostPages: 0 };
      cur.lostPages++;
      byVia.set(key, cur);
    }
    return Array.from(byVia.values()).sort((a, b) => b.lostPages - a.lostPages);
  }, [unlikedScannedPages]);

  // Not-yet-liked Pages that can actually run right now (live Via) = the real like ceiling for this post
  const usableUnlikedCount = useMemo(
    () => unlikedScannedPages.filter((p) => !isDeadViaStatus(p.viaStatus)).length,
    [unlikedScannedPages]
  );

  const describeDeadVias = useCallback(
    () =>
      deadViaSummary
        .map((v) => `${v.viaName} (${v.status === 'CHECKPOINT' ? 'checkpoint' : 'cookie hết hạn'}, ${v.lostPages} Page)`)
        .join(', '),
    [deadViaSummary]
  );

  // Count selected Pages that belong to cookie-expired Vias (O(N) instead of O(N^2))
  const expiredPagesSelectedCount = useMemo(() => {
    return scannedPages.filter((p) => selectedPageIdsSet.has(p.id) && isDeadViaStatus(p.viaStatus)).length;
  }, [scannedPages, selectedPageIdsSet]);

  // Pick N Pages spread evenly across parent Vias (round-robin)
  const pickBalancedPagesFromPool = useCallback((pool: FanpageItem[], count: number): FanpageItem[] => {
    if (pool.length === 0 || count <= 0) return [];
    const targetCount = Math.min(count, pool.length);
    const pagesByVia: Record<string, FanpageItem[]> = {};
    for (const p of pool) {
      const viaKey = p.viaCookie || p.viaName || String(p.viaAccountId || 'default');
      if (!pagesByVia[viaKey]) pagesByVia[viaKey] = [];
      pagesByVia[viaKey].push(p);
    }
    Object.keys(pagesByVia).forEach((k) => {
      pagesByVia[k] = pagesByVia[k].sort(() => 0.5 - Math.random());
    });
    const selectedList: FanpageItem[] = [];
    const viaKeys = Object.keys(pagesByVia);
    let added = true;
    while (selectedList.length < targetCount && added) {
      added = false;
      for (const k of viaKeys) {
        if (selectedList.length >= targetCount) break;
        if (pagesByVia[k].length > 0) {
          selectedList.push(pagesByVia[k].shift()!);
          added = true;
        }
      }
    }
    return selectedList;
  }, []);

  // Automatically drop & swap to not-yet-liked Pages as soon as the post is found to have engagement history
  useEffect(() => {
    if (!autoSkipAlreadyLiked || combinedAlreadyLikedIds.size === 0 || selectedPageIds.length === 0) return;
    const overlapCount = selectedPageIds.filter((id) => combinedAlreadyLikedIds.has(id)).length;
    if (overlapCount === 0) return;

    const keptIds = selectedPageIds.filter((id) => !combinedAlreadyLikedIds.has(id));
    const keptSet = new Set(keptIds);
    const availableUnliked = scannedPages.filter(
      (p) =>
        !combinedAlreadyLikedIds.has(p.id) &&
        !keptSet.has(p.id) &&
        (!autoFailoverLiveVia || !isDeadViaStatus(p.viaStatus))
    );
    const fallbackUnliked =
      availableUnliked.length >= overlapCount
        ? availableUnliked
        : scannedPages.filter((p) => !combinedAlreadyLikedIds.has(p.id) && !keptSet.has(p.id));

    const replacements = pickBalancedPagesFromPool(fallbackUnliked, overlapCount);
    const nextIds = [...keptIds, ...replacements.map((p) => p.id)];
    setSelectedPageIds(nextIds);

    if (nextIds.length === 0) {
      message.warning(`Cả ${overlapCount} Fanpage đã chọn đều đã like bài này!`);
    } else if (replacements.length > 0) {
      message.info(
        `🛡️ Đã tự bỏ ${overlapCount} Page đã like và thay bằng ${replacements.length} Page chưa like!`
      );
    } else {
      message.info(`🛡️ Đã tự bỏ chọn ${overlapCount} Page đã like bài này.`);
    }
  }, [autoSkipAlreadyLiked, combinedAlreadyLikedIds, selectedPageIds, scannedPages, autoFailoverLiveVia, pickBalancedPagesFromPool]);

  // Automatically replace every Page of a cookie-expired Via with Pages from LIVE Vias
  const handleReplaceExpiredPagesWithLiveOnes = () => {
    const expiredSelected = scannedPages.filter(
      (p) => selectedPageIdsSet.has(p.id) && isDeadViaStatus(p.viaStatus)
    );
    if (expiredSelected.length === 0) {
      message.info('Không có Page nào đã chọn thuộc Via hết hạn cookie.');
      return;
    }
    const unselectedLivePages = scannedPages.filter(
      (p) =>
        !isDeadViaStatus(p.viaStatus) &&
        !selectedPageIdsSet.has(p.id) &&
        !combinedAlreadyLikedIds.has(p.id)
    );

    const needed = expiredSelected.length;
    const replacement = unselectedLivePages.slice(0, needed);
    const expiredIds = new Set(expiredSelected.map((p) => p.id));
    const newSelected = selectedPageIds
      .filter((id) => !expiredIds.has(id))
      .concat(replacement.map((p) => p.id));

    setSelectedPageIds(newSelected);
    if (replacement.length > 0) {
      message.success(
        `🛡️ [Tự dự phòng] Đã tự thay ${replacement.length}/${needed} Page từ các Via LIVE còn tốt!`
      );
    } else {
      message.warning('Không còn Page dự phòng nào trên Via live để bù.');
    }
  };

  // Select every not-yet-liked Fanpage (or all of them if dedupe is off)
  const handleSelectAllUnliked = () => {
    const currentScanned = viaFilter !== 'ALL'
      ? scannedPages.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter)
      : scannedPages;
    if (currentScanned.length === 0) return;
    const currentUnliked = currentScanned.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    const basePool = autoSkipAlreadyLiked ? currentUnliked : currentScanned;
    const livePool = basePool.filter((p) => !isDeadViaStatus(p.viaStatus));
    const finalPool = autoFailoverLiveVia && livePool.length > 0 ? livePool : basePool;

    if (finalPool.length === 0) {
      setSelectedPageIds([]);
      message.warning(`Mọi Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} đều đã like bài này!`);
      return;
    }

    setSelectedPageIds(finalPool.map((p) => p.id));
    const skippedCount = currentScanned.length - finalPool.length;
    if (skippedCount > 0) {
      message.success(
        `Đã chọn ${finalPool.length} Fanpage chưa like${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} (bỏ qua ${skippedCount} Page đã like/lỗi)!`
      );
    } else {
      message.success(`Đã chọn tất cả ${finalPool.length} Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''}!`);
    }
  };

  // Quick-pick N Fanpages balanced across parent Vias (ONLY not-yet-liked ones when dedupe is on)
  const handleSelectRandomPages = (count: number) => {
    const currentScanned = viaFilter !== 'ALL'
      ? scannedPages.filter((p) => p.viaName === viaFilter || String(p.viaAccountId) === viaFilter)
      : scannedPages;
    if (currentScanned.length === 0) return;
    const currentUnliked = currentScanned.filter((p) => !combinedAlreadyLikedIds.has(p.id));
    const freshPages = autoSkipAlreadyLiked ? currentUnliked : currentScanned;
    if (freshPages.length === 0) {
      setSelectedPageIds([]);
      message.warning(
        `Cả ${currentScanned.length} Fanpage${viaFilter !== 'ALL' ? ` của Via [${viaFilter}]` : ''} đều đã like bài này!`
      );
      return;
    }
    // AUTO-REPLACE WITH LIVE VIAS: pick 100% from LIVE Vias, dropping cookie-expired ones
    const liveFreshPages = freshPages.filter((p) => !isDeadViaStatus(p.viaStatus));
    const pool = autoFailoverLiveVia && liveFreshPages.length > 0 ? liveFreshPages : freshPages;
    const selectedList = viaFilter !== 'ALL'
      ? pool.slice(0, count)
      : pickBalancedPagesFromPool(pool, count);

    const selected = selectedList.map((p) => p.id);
    setSelectedPageIds(selected);
    setLikeRequest({ requested: count, picked: selected.length });
    const viaCount = new Set(selectedList.map((p) => p.viaName || 'Via')).size;
    const skippedAlreadyCount = currentScanned.length - currentUnliked.length;

    if (selected.length < count) {
      const deadLost = pool === liveFreshPages ? freshPages.length - liveFreshPages.length : 0;
      message.warning({
        content:
          `Bạn cần ${count} like nhưng hiện chỉ có ${selected.length} Page like được bài này` +
          ` (${skippedAlreadyCount} Page đã like rồi` +
          (deadLost > 0 ? `, ${deadLost} Page thuộc Via chết: ${describeDeadVias()}` : '') +
          '). ' +
          (deadLost > 0 ? 'Cập nhật Cookie các Via đó để dùng lại Page của chúng.' : 'Mỗi Page chỉ like được một bài một lần.'),
        duration: 10,
      });
    } else if (viaFilter !== 'ALL') {
      message.success(`Đã chọn ${selected.length} Fanpage từ Via [${viaFilter}]!`);
    } else {
      message.success(`Đã chọn ${selected.length} Fanpage chia đều trên ${viaCount} Via sẵn sàng!`);
    }
  };

  // Mutation: Scan Fanpages from Cookie (Merges & preserves pages, never drops count)
  const scanPagesMutation = useMutation({
    mutationFn: async (cookie: string) => {
      const res = await axios.post(`${WORKER_BASE_URL}/api/buff-get-pages`, {
        cookieString: cookie,
        forceRefresh: true,
      });
      return res.data;
    },
    onSuccess: (data) => {
      if (data.success && data.pages) {
        const sourceAccount = fbAccounts.find((account: any) => account.id === selectedAccountId);
        const viaKey = getViaKey(sourceAccount, customCookie);
        const existing = getStoredPagesForVia(viaKey);
        const merged = [...existing];
        let newCount = 0;
        for (const p of data.pages) {
          const idx = merged.findIndex((m) => m.id === p.id);
          if (idx >= 0) {
            if (p.name && (!merged[idx].name || merged[idx].name.includes('Fanpage ('))) {
              merged[idx] = { ...merged[idx], name: p.name };
            }
          } else {
            merged.push(p);
            newCount++;
          }
        }
        saveStoredPagesForVia(viaKey, merged);
        setRefreshViaPagesKey((prev) => prev + 1);
        setScannedPages(merged);
        setSelectedPageIds(merged.map((p: FanpageItem) => p.id));
        message.success(
          `Quét Facebook xong! Via này hiện có ${merged.length} Fanpage${
            newCount > 0 ? ` (tìm thấy ${newCount} Page mới)` : ''
          }.`
        );
      } else {
        message.warning('Không tìm thấy Fanpage nào hoặc cookie đã hết hạn.');
      }
    },
    onError: (err: any) => {
      message.error(`Lỗi quét Fanpage: ${err.response?.data?.error || err.message}`);
    },
  });


  return {
    queryClient,
    managePagesModalOpen,
    setManagePagesModalOpen,
    targetViaForModal,
    setTargetViaForModal,
    loadingAccounts,
    refetchAccounts,
    accounts,
    fbAccounts,
    activeCookie,
    currentViaAccount,
    modalViaAccount,
    currentModalPages,
    handleOpenManagePages,
    parsedBatchLinks,
    invalidBatchLinesCount,
    runEstimate,
    handleSavePagesForTargetVia,
    handleDeletePageForTargetVia,
    handleClearPagesForTargetVia,
    viaGroupCounts,
    selectedPageIdsSet,
    alreadyLikedPageIdsSet,
    combinedAlreadyLikedIds,
    unlikedScannedPages,
    deadViaSummary,
    usableUnlikedCount,
    filteredPages,
    expiredPagesSelectedCount,
    handleReplaceExpiredPagesWithLiveOnes,
    handleSelectAllUnliked,
    handleSelectRandomPages,
    scanPagesMutation,
  };
}
