import { Modal, message } from 'antd';
import api from '../config/axios';

interface ShortPost {
  url: string;
  requested: number;
  achieved: number;
  available: number;
  missing: number;
}

/**
 * After a Via's Cookie is fixed, its Pages can like again. If any post from today ended up short
 * (typically because that Via was dead while it ran), offer to queue the missing likes right away.
 * Silent when nothing is short or the backend doesn't have the top-up API yet.
 */
export async function offerTopUpAfterCookieUpdate(): Promise<void> {
  let posts: ShortPost[] = [];
  let totalMissing = 0;
  try {
    const res = await api.get('/buff-topup/candidates');
    if (!res.data?.success) return;
    posts = res.data.posts || [];
    totalMissing = res.data.totalMissing || 0;
  } catch {
    return;
  }
  if (posts.length === 0 || totalMissing <= 0) return;

  const preview = posts
    .slice(0, 5)
    .map((p) => `• ${p.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 48)}: ${p.achieved}/${p.requested} → +${p.missing}`)
    .join('\n');

  Modal.confirm({
    title: `${posts.length} bài hôm nay còn thiếu ${totalMissing} like`,
    content: `Via này đã hoạt động lại, các Page của nó có thể bù like cho:\n${preview}${posts.length > 5 ? `\n… và ${posts.length - 5} bài khác` : ''}`,
    okText: `Bù ${totalMissing} like`,
    cancelText: 'Để sau',
    styles: { body: { whiteSpace: 'pre-line' } },
    onOk: async () => {
      try {
        const res = await api.post('/buff-topup/run', { urls: posts.map((p) => p.url) });
        const queued = res.data?.queued || [];
        if (queued.length > 0) {
          message.success(`Đã xếp hàng bù like cho ${queued.length} bài. Theo dõi ở tab Hàng đợi.`);
        } else {
          message.info('Không còn bài nào cần bù.');
        }
      } catch (err: any) {
        message.error(err.response?.data?.error || err.message || 'Không xếp hàng bù like được');
      }
    },
  });
}
