import React from 'react';
import { Input, Button, App, Tag, Modal } from 'antd';
import {
  LinkOutlined,
  CopyOutlined,
  CloseCircleFilled,
  CheckCircleOutlined,
  FacebookOutlined,
  TikTokOutlined,
} from '@ant-design/icons';

interface PasteLinkInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  size?: 'small' | 'middle' | 'large';
  className?: string;
  disabled?: boolean;
  autoCleanParams?: boolean;
  showPlatformBadge?: boolean;
  addonAfter?: React.ReactNode;
  inputId?: string;
  autoFocus?: boolean;
}

export const cleanSocialUrl = (rawUrl: string): string => {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  try {
    // Normalize mobile domains to www.facebook.com
    url = url.replace(/^https?:\/\/(?:m|mobile|touch|web)\.facebook\.com/i, 'https://www.facebook.com');

    const parsed = new URL(url);

    // Facebook multi_permalinks in a Group: normalize to the direct post URL
    const multiPermalinks = parsed.searchParams.get('multi_permalinks');
    const matchGroup = parsed.pathname.match(/\/groups\/([^/?#]+)/);
    if (multiPermalinks && matchGroup) {
      return `https://www.facebook.com/groups/${matchGroup[1]}/posts/${multiPermalinks}/`;
    }

    // Normalize /permalink/ to /posts/ in groups
    if (matchGroup && parsed.pathname.includes('/permalink/')) {
      parsed.pathname = parsed.pathname.replace('/permalink/', '/posts/');
    }

    // Strip all tracking, comment and notification params from Facebook, TikTok, Threads, UTM...
    const paramsToClean = [
      'fbclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term',
      'utm_content', 'is_from_webapp', 'sender_device', 'share_id',
      '_r', 'sfnsn', 'mibextid', '__cft__[0]', '__cft__', '__tn__',
      'ref', 'set', 'rdid', 'comment_id', 'reply_comment_id', 'reply_comment_ids',
      'notif_id', 'notif_t', 'paipv', 'idorvanity', 'source', 'refsrc',
      '__eep__', 'locale', 'hc_location', 'substory_index'
    ];
    paramsToClean.forEach((p) => parsed.searchParams.delete(p));

    return parsed.toString().replace(/[?&]$/, '');
  } catch {
    return url;
  }
};

export interface ContentTypeInfo {
  type: 'REEL' | 'GROUP' | 'PAGE_POST' | 'VIDEO' | 'PHOTO' | 'STANDARD_POST';
  label: string;
  color: string;
  icon: string;
}

export const detectContentType = (url?: string): ContentTypeInfo | null => {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('/reel/') || lower.includes('/share/r/')) {
    return { type: 'REEL', label: 'Facebook Reel', color: 'purple', icon: '🎬' };
  }
  if (lower.includes('/groups/')) {
    return { type: 'GROUP', label: 'Bài trong Group', color: 'blue', icon: '👥' };
  }
  if (lower.includes('/videos/') || lower.includes('fb.watch') || lower.includes('/watch')) {
    return { type: 'VIDEO', label: 'Video Facebook', color: 'volcano', icon: '📺' };
  }
  if (lower.includes('/photos/') || lower.includes('/photo/')) {
    return { type: 'PHOTO', label: 'Ảnh Facebook', color: 'green', icon: '🖼️' };
  }
  if (lower.includes('/posts/') || lower.includes('/share/p/') || lower.includes('permalink') || lower.includes('fbid=')) {
    return { type: 'PAGE_POST', label: 'Bài Fanpage/Feed', color: 'cyan', icon: '📄' };
  }
  if (lower.includes('facebook.com') || lower.includes('fb.com')) {
    return { type: 'STANDARD_POST', label: 'Link Facebook', color: 'blue', icon: '🌐' };
  }
  return null;
};

export const detectPlatform = (url?: string): { name: string; color: string; icon?: React.ReactNode } | null => {
  if (!url) return null;
  const lower = url.toLowerCase();
  if (lower.includes('tiktok.com')) return { name: 'TikTok', color: 'magenta', icon: <TikTokOutlined /> };
  if (lower.includes('facebook.com') || lower.includes('fb.watch') || lower.includes('fb.com')) return { name: 'Facebook', color: 'blue', icon: <FacebookOutlined /> };
  if (lower.includes('threads.net')) return { name: 'Threads', color: 'purple' };
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return { name: 'YouTube', color: 'red' };
  if (lower.startsWith('http://') || lower.startsWith('https://')) return { name: 'Link web', color: 'cyan', icon: <LinkOutlined /> };
  return null;
};

const PasteLinkInput: React.FC<PasteLinkInputProps> = ({
  value = '',
  onChange,
  placeholder = 'Dán link vào đây...',
  size = 'large',
  className = '',
  disabled = false,
  autoCleanParams = true,
  showPlatformBadge = true,
  addonAfter,
  inputId,
  autoFocus = false,
}) => {
  const { message } = App.useApp();
  const inputRef = React.useRef<any>(null);
  const [modalVisible, setModalVisible] = React.useState(false);
  const [modalText, setModalText] = React.useState('');
  const platform = showPlatformBadge ? detectPlatform(value) : null;
  const contentType = showPlatformBadge ? detectContentType(value) : null;

  const handlePasteFromClipboard = async () => {
    // Try the Clipboard API first
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          const cleaned = autoCleanParams ? cleanSocialUrl(text) : text.trim();
          onChange?.(cleaned);
          message.success('📋 Đã dán link!');
          return;
        }
      } catch {
        // Browser blocks it over plain HTTP (IP 192.168.x.x) -> fall back to the quick-paste popup
      }
    }

    // Open the quick-paste modal, which isn't limited by Safari's HTTP permissions
    setModalText('');
    setModalVisible(true);
  };

  const handleClear = () => {
    onChange?.('');
  };

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center gap-2 w-full">
        <Input
          id={inputId}
          ref={inputRef}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            const val = e.target.value;
            onChange?.(autoCleanParams && val.startsWith('http') ? cleanSocialUrl(val) : val);
          }}
          placeholder={placeholder}
          size={size}
          disabled={disabled}
          prefix={<LinkOutlined className="text-blue-500 text-base" />}
          suffix={
            value ? (
              <Button
                type="text"
                size="small"
                icon={<CloseCircleFilled className="text-slate-400 hover:text-slate-600 text-base" />}
                onClick={handleClear}
                className="p-0 h-6 min-w-[24px] flex items-center justify-center"
              />
            ) : null
          }
          className={`rounded-xl flex-1 font-medium bg-slate-900/80 border-slate-700/80 text-slate-100 placeholder:text-slate-500 shadow-inner ${className}`}
        />

        <Button
          type="primary"
          size={size}
          icon={<CopyOutlined />}
          onClick={handlePasteFromClipboard}
          disabled={disabled}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-on-accent font-bold rounded-xl shrink-0 px-4 flex items-center gap-1.5 text-xs sm:text-sm shadow-md shadow-indigo-950/40 border border-blue-400/30 transition-all hover:scale-[1.02] active:scale-[0.98] h-10"
        >
          <span>Dán link</span>
        </Button>

        {addonAfter}
      </div>

      {showPlatformBadge && Boolean(value) && (platform || contentType) && (
        <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
          {platform && (
            <Tag color={platform.color} icon={platform.icon} className="text-xs font-semibold rounded-md border-0 m-0 shadow-sm">
              {platform.name}
            </Tag>
          )}
          {contentType && (
            <Tag color={contentType.color} className="text-xs font-semibold rounded-md border-0 m-0 shadow-sm">
              {contentType.icon} {contentType.label}
            </Tag>
          )}
          {platform && (
            <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1">
              <CheckCircleOutlined /> Link hợp lệ
            </span>
          )}
        </div>
      )}

      {/* QUICK-PASTE MODAL, NOT BLOCKED BY SAFARI OVER HTTP */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-slate-100 font-bold text-sm">
            <CopyOutlined className="text-blue-400 text-base" />
            <span>Dán link bài viết</span>
          </div>
        }
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={() => {
          if (modalText.trim()) {
            const cleaned = autoCleanParams ? cleanSocialUrl(modalText) : modalText.trim();
            onChange?.(cleaned);
            message.success('📋 Đã dán link!');
          }
          setModalVisible(false);
        }}
        okText="Dán"
        cancelText="Hủy"
        centered
        width={520}
        className="max-w-[calc(100vw-24px)]"
        destroyOnHidden
      >
        <div className="space-y-3 py-2">
          <div className="text-xs text-slate-300">
            Nhấn giữ ô bên dưới và chọn <b>"Dán"</b>:
          </div>
          <Input.TextArea
            rows={3}
            autoFocus
            value={modalText}
            onChange={(e) => setModalText(e.target.value)}
            placeholder="Dán link Facebook, TikTok hoặc Threads vào đây..."
            className="rounded-xl font-mono text-xs p-3"
          />
        </div>
      </Modal>

    </div>
  );
};

export default PasteLinkInput;
