import { Tooltip } from 'antd';

interface CapacityVia {
  uid: string;
  viaName?: string;
  displayName?: string;
  tokenStatus?: string;
  usablePages?: number;
  quarantinedPages?: number;
  recentTried?: number;
  recentSuccess?: number;
}

/**
 * Năng lực like của dàn Via: mỗi bài tối đa like được bao nhiêu.
 * Số Page dùng được lấy từ bộ nhớ Page của backend (đã loại Page bị cách ly);
 * ước tính like thật = Page dùng được × tỉ lệ thành công 7 ngày gần nhất của Via đó.
 */
export default function LikeCapacityCard({ bmOverview }: { bmOverview: any }) {
  const vias: CapacityVia[] = bmOverview?.vias || [];
  if (vias.length === 0) return null;
  const maxPerPost: number = Number(bmOverview?.system?.maxPagesPerPost) || 0;

  const rows = vias.map((v) => {
    const live = v.tokenStatus !== 'EXPIRED' && v.tokenStatus !== 'CHECKPOINT';
    const usable = v.usablePages || 0;
    const rate = v.recentTried && v.recentTried >= 5 ? (v.recentSuccess || 0) / v.recentTried : null;
    const estimate = live ? Math.round(usable * (rate ?? 1)) : 0;
    return { ...v, live, usable, rate, estimate };
  });
  const liveUsable = rows.filter((r) => r.live).reduce((s, r) => s + r.usable, 0);
  const estimateTotal = rows.reduce((s, r) => s + r.estimate, 0);
  const perPost = maxPerPost > 0 ? Math.min(estimateTotal, maxPerPost) : estimateTotal;

  return (
    <div className="app-surface p-4 sm:p-5 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-semibold text-slate-100">Năng lực like</div>
        <Tooltip
          title={`Ước tính = Page dùng được × tỉ lệ thành công 7 ngày của từng Via${
            maxPerPost > 0 ? `, tối đa ${maxPerPost} Page/bài theo Cài đặt` : ''
          }. Page đã like bài trước đó sẽ bị trừ khi chạy.`}
        >
          <span className="text-xs text-slate-500 underline decoration-dotted cursor-help">Cách tính</span>
        </Tooltip>
      </div>

      <div>
        <div className="text-2xl font-semibold text-slate-100 leading-none">~{perPost}</div>
        <div className="text-xs text-slate-500 mt-1.5">
          like/bài ước tính · {liveUsable} Page dùng được
          {maxPerPost > 0 && estimateTotal > maxPerPost ? ` · giới hạn ${maxPerPost}` : ''}
        </div>
      </div>

      <div className="divide-y divide-slate-800/80 border-t border-slate-800/80">
        {rows.map((r) => (
          <div key={r.uid} className="py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.live ? 'bg-emerald-400' : 'bg-rose-400'}`} />
              <span className="min-w-0 flex-1 truncate text-slate-200">{r.displayName || r.viaName || r.uid}</span>
              {r.live ? (
                <span className="font-semibold text-slate-100 tabular-nums">~{r.estimate}</span>
              ) : (
                <span className="text-rose-300">Hết cookie</span>
              )}
            </div>
            {r.live && (
              <div className="pl-3.5 mt-0.5 text-[11px] text-slate-500 tabular-nums">
                {r.usable} Page
                {r.quarantinedPages ? ` · ${r.quarantinedPages} cách ly` : ''}
                {' · '}
                <Tooltip
                  title={
                    r.rate === null
                      ? 'Chưa đủ dữ liệu 7 ngày, tạm tính 100%'
                      : `${r.recentSuccess}/${r.recentTried} lượt thành công trong 7 ngày`
                  }
                >
                  <span className={r.rate !== null && r.rate < 0.7 ? 'text-amber-300' : ''}>
                    {r.rate === null ? 'chưa có dữ liệu' : `${Math.round(r.rate * 100)}% thành công`}
                  </span>
                </Tooltip>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
