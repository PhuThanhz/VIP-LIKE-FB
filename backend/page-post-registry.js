const fs = require('fs');
const path = require('path');
const store = require('./state-store');

const { DATA_DIR: dataDir } = require('./paths');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Structure: { [normalizedPostUrl]: { [pageId]: { pageName, reactionType, commentText, reactedAt, status } } }
// Saved via state-store: MySQL (app_state table) is the primary source, the JSON file is the backup.
let pruned = false;

// The single normalized key for a post: shared by the registry, the history queue and the hunter.
// Keeps the post-identifying query (story_fbid, fbid, v, id...) and only drops tracking params.
function normalizeFbPostUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (/(^|\.)facebook\.com$/i.test(parsed.hostname) || /(^|\.)fb\.com$/i.test(parsed.hostname)) {
      parsed.hostname = 'www.facebook.com';
    }
    const trackingParams = [
      'fbclid', 'mibextid', 'rdid', 'share_url', 'ref', 'ref_src', 'ref_url', 'paipv', 'eav', 'sfnsn', 'locale',
      '__cft__', '__tn__', 'notif_t', 'notif_id', 'comment_id', 'reply_comment_id', 'extid', 'idorvanity',
    ];
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (trackingParams.some((p) => key === p || key.startsWith(p))) parsed.searchParams.delete(key);
    }
    let clean = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    if (parsed.searchParams.toString()) {
      clean += '?' + parsed.searchParams.toString();
    }
    return clean;
  } catch (e) {
    return rawUrl.trim().replace(/[?&](?:mibextid|fbclid|rdid)=[^&]*/g, '').replace(/\/+$/, '');
  }
}

// Drop posts older than REGISTRY_RETENTION_DAYS days since their last engagement (old posts are almost never re-buffed)
const REGISTRY_RETENTION_DAYS = 45;
function pruneRegistry(registry) {
  const cutoff = Date.now() - REGISTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const [postUrl, pagesMap] of Object.entries(registry)) {
    let newest = 0;
    for (const entry of Object.values(pagesMap || {})) {
      const t = Date.parse(entry?.reactedAt || '') || 0;
      if (t > newest) newest = t;
    }
    if (newest && newest < cutoff) {
      delete registry[postUrl];
      removed++;
    }
  }
  if (removed > 0) console.log(`[PagePostRegistry] 🧹 Removed ${removed} posts older than ${REGISTRY_RETENTION_DAYS} days from the dedupe registry.`);
  return removed;
}

function loadRegistry() {
  let reg = store.read('page_post_registry');
  if (!reg || typeof reg !== 'object' || Array.isArray(reg)) reg = store.write('page_post_registry', {});
  if (!pruned && store.isReady()) {
    pruned = true;
    if (pruneRegistry(reg) > 0) store.write('page_post_registry', reg);
  }
  return reg;
}

// Writes are batched over time in state-store (many vias running in parallel don't rewrite the whole registry on every like)
function scheduleSaveRegistry(reg) {
  store.write('page_post_registry', reg || loadRegistry());
}

function flushRegistry() {
  store.flush().catch((err) => console.error(`[PagePostRegistry] ❌ Error flushing the dedupe registry: ${err.message}`));
}

function isFacebookShareUrl(rawUrl) {
  return /^https?:\/\/([^/]+\.)?(facebook|fb)\.com\/share\//i.test(String(rawUrl || '').trim());
}

function isValidCanonicalFbPostUrl(rawUrl) {
  const norm = normalizeFbPostUrl(rawUrl);
  if (!norm) return false;
  try {
    const parsed = new URL(norm);
    if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) return false;
    const p = parsed.pathname || '/';
    if (p === '/' || p === '') return false;
    if (/\/(share|login|checkpoint|home\.php|forced_account_switch)/i.test(p)) return false;
    if (norm.includes('forced_account_switch')) return false;
    return /(\/posts\/|\/permalink|\/reel\/|\/watch|\/videos\/|\/photo|pfbid|story_fbid=|fbid=|multi_permalinks=|v=\d+)/i.test(norm);
  } catch {
    return false;
  }
}

function loadAliases() {
  let aliases = store.read('post_url_aliases');
  if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
    aliases = store.write('post_url_aliases', {});
  }
  return aliases;
}

function scheduleSaveAliases(aliases) {
  store.write('post_url_aliases', aliases || loadAliases());
}

/**
 * Links 2 URLs that point to the same post (e.g. /share/p/... <-> canonical URL)
 */
function registerPostUrlAlias(rawUrlA, rawUrlB) {
  const normA = normalizeFbPostUrl(rawUrlA);
  const normB = normalizeFbPostUrl(rawUrlB);
  if (!normA || !normB || normA === normB) return normA || normB || '';

  const aliases = loadAliases();
  const mappedA = aliases[normA];
  const mappedB = aliases[normB];

  let canonical = '';
  if (isValidCanonicalFbPostUrl(normB) && !isFacebookShareUrl(normB)) {
    canonical = normB;
  } else if (isValidCanonicalFbPostUrl(normA) && !isFacebookShareUrl(normA)) {
    canonical = normA;
  } else if (mappedB && isValidCanonicalFbPostUrl(mappedB)) {
    canonical = mappedB;
  } else if (mappedA && isValidCanonicalFbPostUrl(mappedA)) {
    canonical = mappedA;
  }

  if (!canonical) return normA;

  let changed = false;
  for (const key of [normA, normB, mappedA, mappedB]) {
    if (key && key !== canonical && aliases[key] !== canonical) {
      aliases[key] = canonical;
      changed = true;
    }
  }
  // Update old keys pointing to normA/normB if any
  for (const [k, v] of Object.entries(aliases)) {
    if ((v === normA || v === normB) && v !== canonical) {
      aliases[k] = canonical;
      changed = true;
    }
  }

  if (changed) scheduleSaveAliases(aliases);
  return canonical;
}

/**
 * Returns the set of every equivalent URL (itself + canonical + share aliases pointing to the canonical)
 */
function getEquivalentPostUrls(normalizedPostUrl) {
  const urls = new Set();
  if (!normalizedPostUrl) return urls;
  const key = normalizeFbPostUrl(normalizedPostUrl) || normalizedPostUrl;
  urls.add(key);
  if (normalizedPostUrl !== key) urls.add(normalizedPostUrl);

  const aliases = loadAliases();
  const canonical = aliases[key] || (isValidCanonicalFbPostUrl(key) ? key : '');
  if (canonical) {
    urls.add(canonical);
    for (const [aliasUrl, targetCanon] of Object.entries(aliases)) {
      if (targetCanon === canonical) {
        urls.add(aliasUrl);
      }
    }
  }
  return urls;
}

/**
 * Quickly resolves a /share/... link to the canonical post URL via HTTP redirect (no browser needed)
 */
async function resolvePostUrlCanonical(rawUrl, { timeoutMs = 2500 } = {}) {
  const normUrl = normalizeFbPostUrl(rawUrl);
  if (!normUrl) return '';
  const aliases = loadAliases();
  if (aliases[normUrl]) return aliases[normUrl];
  if (!isFacebookShareUrl(normUrl)) return normUrl;

  const tryFetch = async (method, customUa) => {
    const headers = customUa ? { 'User-Agent': customUa } : undefined;
    const res = await fetch(normUrl, {
      method,
      redirect: 'manual',
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const loc = res.headers.get('location');
    if (res.body && typeof res.body.cancel === 'function') {
      res.body.cancel().catch(() => {});
    }
    return { status: res.status, location: loc };
  };

  try {
    // Note: do NOT send a fake Chrome User-Agent (Facebook returns 400 without sec-ch-ua/cookies);
    // Facebook answers Node/curl's default UA with a direct 302 Location.
    let result = await tryFetch('HEAD');
    if (!result.location && (result.status === 405 || result.status === 403 || result.status === 400)) {
      result = await tryFetch('GET');
    }
    if (!result.location) {
      result = await tryFetch('HEAD', 'curl/8.7.1');
    }
    if (result.location) {
      const resolved = new URL(result.location, normUrl).toString();
      const canonNorm = normalizeFbPostUrl(resolved);
      if (isValidCanonicalFbPostUrl(canonNorm)) {
        registerPostUrlAlias(normUrl, canonNorm);
        return canonNorm;
      }
    }
  } catch (_) {}

  return normUrl;
}

/**
 * Background-syncs old /share/ links already in the registry to their canonical URL
 */
async function backfillShareAliases({ concurrency = 4 } = {}) {
  const reg = loadRegistry();
  const aliases = loadAliases();
  const shareKeys = Object.keys(reg).filter((k) => isFacebookShareUrl(k) && !aliases[k]);
  if (shareKeys.length === 0) return 0;

  let resolvedCount = 0;
  let idx = 0;
  const worker = async () => {
    while (idx < shareKeys.length) {
      const key = shareKeys[idx++];
      const canon = await resolvePostUrlCanonical(key, { timeoutMs: 3000 });
      if (canon && canon !== key) resolvedCount++;
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, shareKeys.length) }, () => worker());
  await Promise.all(workers);

  if (resolvedCount > 0) {
    console.log(`[PagePostRegistry] 🔗 Linked ${resolvedCount}/${shareKeys.length} /share/ links to the original post URL.`);
    flushRegistry();
  }
  return resolvedCount;
}

/**
 * Checks whether this Page has ever Liked/Commented on this post (including aliases)
 */
function hasPageInteractedWithPost(normalizedPostUrl, pageId) {
  if (!normalizedPostUrl || !pageId) return false;
  const reg = loadRegistry();
  const pid = String(pageId);
  for (const urlKey of getEquivalentPostUrls(normalizedPostUrl)) {
    const postRecord = reg[urlKey];
    if (postRecord && postRecord[pid]) return true;
  }
  return false;
}

/**
 * Records a Page's engagement on a post
 */
function recordPagePostInteraction(normalizedPostUrl, pageId, details = {}) {
  if (!normalizedPostUrl || !pageId) return;
  const reg = loadRegistry();
  if (!reg[normalizedPostUrl]) {
    reg[normalizedPostUrl] = {};
  }
  reg[normalizedPostUrl][String(pageId)] = {
    pageName: details.pageName || '',
    reactionType: details.reactionType || 'LIKE',
    commentText: details.commentText || '',
    status: details.status || 'SUCCESS',
    reactedAt: new Date().toISOString(),
  };
  if (details.canonicalUrl) {
    const canonNorm = normalizeFbPostUrl(details.canonicalUrl);
    if (isValidCanonicalFbPostUrl(canonNorm) && canonNorm !== normalizedPostUrl) {
      registerPostUrlAlias(normalizedPostUrl, canonNorm);
    }
  }
  scheduleSaveRegistry(reg);
}

/**
 * Filters the Fanpage list: ONLY KEEPS pages that have NEVER engaged with this post.
 * Guarantees a second click never UN-LIKES the post or spams duplicates!
 */
function filterAvailablePagesForPost(normalizedPostUrl, pages = []) {
  if (!normalizedPostUrl || !Array.isArray(pages)) return pages;
  const interactedIds = getPostInteractedPageIds(normalizedPostUrl);

  const available = [];
  let skippedCount = 0;

  for (const page of pages) {
    if (page && page.id && interactedIds.has(String(page.id))) {
      skippedCount++;
    } else {
      available.push(page);
    }
  }

  if (skippedCount > 0) {
    console.log(
      `[Anti-Overlap] 🛡️ Automatically removed ${skippedCount} Fanpages that already engaged with post "${normalizedPostUrl}" to AVOID UN-LIKING. ${available.length} new Fanpages remain.`
    );
  }

  return available;
}

/**
 * Gets the IDs of Pages that already engaged with the post (merging alias URLs of the same post)
 */
function getPostInteractedPageIds(normalizedPostUrl) {
  const result = new Set();
  if (!normalizedPostUrl) return result;
  const reg = loadRegistry();
  for (const urlKey of getEquivalentPostUrls(normalizedPostUrl)) {
    const postRecord = reg[urlKey] || {};
    for (const pid of Object.keys(postRecord)) {
      result.add(pid);
    }
  }
  return result;
}

/**
 * Registry overview stats
 */
function getGlobalRegistryStats() {
  const reg = loadRegistry();
  const posts = Object.keys(reg);
  let totalInteractions = 0;
  for (const p of posts) {
    totalInteractions += Object.keys(reg[p] || {}).length;
  }
  return {
    totalTrackedPosts: posts.length,
    totalProtectedInteractions: totalInteractions,
  };
}

/**
 * Deletes a post's engagement history (if an admin wants to reset)
 */
function clearPostInteractions(normalizedPostUrl) {
  const reg = loadRegistry();
  let deleted = false;
  for (const urlKey of getEquivalentPostUrls(normalizedPostUrl)) {
    if (reg[urlKey]) {
      delete reg[urlKey];
      deleted = true;
    }
  }
  if (deleted) {
    scheduleSaveRegistry(reg);
    flushRegistry();
    return true;
  }
  return false;
}


/**
 * Counts Pages that successfully liked a post since `sinceMs` (merging every alias URL of the post).
 * Used to tell how many likes a post really got today when deciding a top-up.
 */
function countPostSuccessSince(normalizedPostUrl, sinceMs) {
  if (!normalizedPostUrl) return 0;
  const reg = loadRegistry();
  const counted = new Set();
  for (const urlKey of getEquivalentPostUrls(normalizedPostUrl)) {
    for (const [pid, rec] of Object.entries(reg[urlKey] || {})) {
      if (rec?.status !== 'SUCCESS') continue;
      if (Date.parse(rec.reactedAt || '') >= sinceMs) counted.add(pid);
    }
  }
  return counted.size;
}

module.exports = {
  countPostSuccessSince,
  normalizeFbPostUrl,
  isFacebookShareUrl,
  isValidCanonicalFbPostUrl,
  registerPostUrlAlias,
  getEquivalentPostUrls,
  resolvePostUrlCanonical,
  backfillShareAliases,
  hasPageInteractedWithPost,
  recordPagePostInteraction,
  filterAvailablePagesForPost,
  getPostInteractedPageIds,
  getGlobalRegistryStats,
  clearPostInteractions,
  flushRegistry,
};
