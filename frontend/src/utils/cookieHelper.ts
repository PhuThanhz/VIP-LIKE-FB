/**
 * cookieHelper.ts - Tiện ích phân tích và chuẩn hoá Cookie Facebook
 * Hỗ trợ các định dạng:
 * 1. JSON từ Cookie-Editor ({"url": "...", "cookies": [...]})
 * 2. Mảng JSON Cookie ([{ name: "...", value: "..." }])
 * 3. JSON Object ({ "cookies": [...] } hoặc { c_user: "...", xs: "..." })
 * 4. Chuỗi chuẩn: "c_user=...; xs=...; sb=...; fr=...; datr=..."
 * 5. Định dạng VIA gộp: UID|PASS|2FA|COOKIE...
 * 6. Chỉ mã phiên xs: "8%3A..."
 */

export interface CookieItem {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  expirationDate?: number;
}

export interface ParsedFacebookCookie {
  valid: boolean;
  c_user: string;
  xs: string;
  cookieString: string;
  isJson: boolean;
  cookieCount: number;
  sourceFormat:
    | 'JSON_OBJECT_WITH_COOKIES'
    | 'JSON_ARRAY'
    | 'JSON_KV'
    | 'PIPE_DELIMITED'
    | 'STANDARD_STRING'
    | 'XS_ONLY'
    | 'UNKNOWN';
  cookies: CookieItem[];
  extraInfo?: {
    sb?: string;
    datr?: string;
    fr?: string;
    pas?: string;
    locale?: string;
    wd?: string;
  };
}

export function parseFacebookCookie(input?: string): ParsedFacebookCookie {
  if (!input) {
    return {
      valid: false,
      c_user: '',
      xs: '',
      cookieString: '',
      isJson: false,
      cookieCount: 0,
      sourceFormat: 'UNKNOWN',
      cookies: [],
    };
  }

  let str = String(input).trim();
  // Loại bỏ markdown code block nếu copy từ chat
  str = str.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // 1. Kiểm tra nếu là dạng JSON (Object hoặc Array)
  if ((str.startsWith('{') && str.endsWith('}')) || (str.startsWith('[') && str.endsWith(']'))) {
    try {
      const parsed = JSON.parse(str);
      let list: CookieItem[] = [];
      let format: ParsedFacebookCookie['sourceFormat'] = 'JSON_ARRAY';

      if (Array.isArray(parsed)) {
        list = parsed;
        format = 'JSON_ARRAY';
      } else if (parsed && Array.isArray(parsed.cookies)) {
        list = parsed.cookies;
        format = 'JSON_OBJECT_WITH_COOKIES';
      } else if (parsed && typeof parsed === 'object') {
        format = 'JSON_KV';
        list = Object.entries(parsed).map(([name, value]) => ({
          name,
          value: String(value),
        }));
      }

      if (list.length > 0) {
        let cUser = '';
        let xs = '';
        const extra: Record<string, string> = {};
        const pairs: string[] = [];

        for (const item of list) {
          if (!item || !item.name) continue;
          const name = String(item.name).trim();
          const val = item.value != null ? String(item.value).trim() : '';
          const lowerName = name.toLowerCase();

          if (lowerName === 'c_user') cUser = val;
          if (lowerName === 'xs') xs = val;
          if (['sb', 'datr', 'fr', 'pas', 'locale', 'wd'].includes(lowerName)) {
            extra[lowerName] = val;
          }
          pairs.push(`${name}=${val}`);
        }

        // Nếu không có c_user trực tiếp, thử tìm trong trường pas
        if (!cUser && extra.pas) {
          const pasMatch = extra.pas.match(/([0-9]{6,})/);
          if (pasMatch) cUser = pasMatch[1];
        }

        const cookieString = pairs.join('; ') + ';';
        return {
          valid: Boolean(cUser && xs),
          c_user: cUser,
          xs,
          cookieString,
          isJson: true,
          cookieCount: list.length,
          sourceFormat: format,
          cookies: list,
          extraInfo: extra,
        };
      }
    } catch (_) {
      // JSON không hợp lệ, tiếp tục xử lý các dạng khác
    }
  }

  // 2. Kiểm tra nếu có dấu gạch đứng pipe | (UID|PASS|2FA|COOKIE)
  if (str.includes('|')) {
    const parts = str.split('|').map((p) => p.trim());
    const cookiePart = parts.find(
      (p) =>
        p.startsWith('{') ||
        p.startsWith('[') ||
        /c_user=/.test(p) ||
        /(?:^|;\s*)xs=/.test(p)
    );
    const uidPart = /^[0-9]{6,}$/.test(parts[0]) ? parts[0] : '';

    if (cookiePart) {
      const parsedPart = parseFacebookCookie(cookiePart);
      if (parsedPart.valid) {
        if (!parsedPart.c_user && uidPart) {
          parsedPart.c_user = uidPart;
          parsedPart.cookieString = `c_user=${uidPart}; ${parsedPart.cookieString}`;
        }
        parsedPart.sourceFormat = 'PIPE_DELIMITED';
        return parsedPart;
      }
    }
  }

  // 3. Chuỗi chuẩn c_user=...; xs=...
  const cUserMatch = str.match(/(?:^|;\s*)c_user=([^;\s]+)/i);
  const xsMatch = str.match(/(?:^|;\s*)xs=([^;\s]+)/i);
  const c_user = cUserMatch ? cUserMatch[1].trim() : '';
  const xs = xsMatch ? xsMatch[1].trim() : '';

  // 4. Nếu chỉ có mã phiên xs (vd: 8%3APksdsIDht4Xb8Q%3A2%3A1795319272...)
  if (!c_user && !xs && (str.includes('%3A') || str.length > 20) && !str.includes(';') && !str.includes('=')) {
    return {
      valid: false,
      c_user: '',
      xs: str,
      cookieString: `xs=${str};`,
      isJson: false,
      cookieCount: 1,
      sourceFormat: 'XS_ONLY',
      cookies: [{ name: 'xs', value: str }],
    };
  }

  return {
    valid: Boolean(c_user && xs),
    c_user,
    xs,
    cookieString: str,
    isJson: false,
    cookieCount: str.split(';').filter((s) => s.includes('=')).length,
    sourceFormat: 'STANDARD_STRING',
    cookies: [],
  };
}

export function extractUidFromCookie(cookieStr?: string): string {
  if (!cookieStr) return '';
  const parsed = parseFacebookCookie(cookieStr);
  if (parsed.c_user) return parsed.c_user;

  // Fallback: match UID|...
  if (cookieStr.includes('|')) {
    const parts = cookieStr.split('|');
    if (/^[0-9]{6,}$/.test(parts[0].trim())) {
      return parts[0].trim();
    }
  }
  return '';
}
