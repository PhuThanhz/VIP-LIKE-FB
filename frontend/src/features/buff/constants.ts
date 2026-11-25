import type { ReactionOption, SpeedModeKey } from './types';

// History now lives in MySQL (API /buff-logs); the old key is only used for a one-time migration
export const LEGACY_BUFF_LOGS_STORAGE_KEY = 'toolzutter:buff-engagement-logs';

export const SEEDING_NICHE_PRESETS: Record<string, { label: string; icon: string; templates: string[] }> = {
  GENERAL: {
    label: 'Social Engagement & Reach',
    icon: '',
    templates: [
'{Bài viết chia sẻ rất hay|Nội dung chất lượng quá|Bổ ích ghê} {ad ơi|ạ|nha bạn} {👏|🌟|❤️}',
'{Đã lưu lại khi cần|Thả tim cho bài viết tuyệt vời này|Theo dõi page lâu rồi vẫn thích} {ạ|nhé|nè} {🥰|✨|🍀}',
'{Chuẩn luôn|Rất đồng quan điểm với bài viết|Chia sẻ chính xác quá} {ạ|nha|bạn ơi} {💯|👌|🔥}',
'{Chúc trang ngày càng phát triển|Luôn ủng hộ các bài viết của bạn|Tiếp tục phát huy nhé} {nha|ạ|nhé ad} {🚀|🎉|💖}',
'{Quá tuyệt vời luôn|Rất đáng để học hỏi|Thích cách trình bày này ghê} {ạ|nè bạn|ơi} {🍀|✨|👍}',
    ],
  },
  FASHION: {
    label: 'Fashion & Beauty',
    icon: '',
    templates: [
'{Shop ơi|Ad ơi} {check ib em|tư vấn em với} {size M|màu đen|mẫu này} {ạ|nha shop|với ạ} {❤️|✨|🛍️}',
'{Vải mặc mát không shop|Chất này có co giãn không ạ|Form áo chuẩn không ad} {ơi|nha|nhé} {🥰|🌟}',
'{Mới nhận hàng hôm qua|Vừa nhận được áo|Đồ đẹp lắm shop ơi} {ưng cái bụng ghê|chất vải mê ly|sẽ ủng hộ tiếp} {ạ|nha|💯} {👏|💖}',
'{Mẫu này nữ cao 1m6 mặc vừa không shop|Cho mình hỏi còn size L không|Ship về Hà Nội/HCM mất mấy ngày} {ạ|vậy ad} {✨|🍀}',
'{Đẹp quá|Nhìn mê chữ ê kéo dài luôn|Xinh xỉu luôn shop ơi} {nè|quá chừng|ạ} {😍|🔥|👌}',
    ],
  },
  FNB: {
    label: 'Food & Restaurants',
    icon: '',
    templates: [
'{Quán mở cửa tới mấy giờ|Menu này giá bao nhiêu|Có cần đặt bàn trước không} {vậy shop|ạ|ạ ad} {🍲|😋|✨}',
'{Nhìn hấp dẫn quá|Thèm rớt nước miếng|Món này cay nhiều không} {bạn ơi|ạ|ad ơi} {🤤|❤️|👌}',
'{Hôm trước vừa ghé ăn|Cuối tuần này phải rủ bạn ghé mới được|Đồ ăn ở đây ngon đỉnh} {nha mọi người|ạ|nè} {🌟|👍|🎉}',
'{Địa chỉ ở đâu vậy bạn|Có ship qua Now/Grab/ShopeeFood không|Quán ở quận mấy} {ạ|ơi|nhé} {🛵|🍽️}',
'{Lưu lại ngay|Cuối tuần set kèo đi thử|Trông chất lượng quá} {bạn ơi|ạ|nhé cả nhà} {👏|💯|🔥}',
    ],
  },
  SERVICES: {
    label: 'Services, Real Estate & Courses',
    icon: '',
    templates: [
'{Cho mình xin thông tin chi tiết|Dự án này pháp lý thế nào|Học phí khóa này bao nhiêu} {ạ|vậy ad|ơi shop} {🏢|📋|💡}',
'{Đã inbox ad tư vấn giúp em|Quan tâm dịch vụ bên mình|Ad check tin nhắn chờ giúp} {nhé|ạ|nha} {📩|🤝|✨}',
'{Dịch vụ uy tín chuyên nghiệp|Đã từng trải nghiệm rất hài lòng|Ủng hộ team} {nha|ạ|nhe} {🌟|👏|💯}',
'{Chính sách ưu đãi tháng này thế nào ad|Cho mình hỏi thời gian học/triển khai} {với ạ|nhé|nha} {📊|👍}',
'{Nội dung chia sẻ rất thực tế|Kiến thức bổ ích quá|Cảm ơn team nhiều} {ạ|nha|nhé} {🔥|❤️|🍀}',
    ],
  },
  TECH: {
    label: 'Tech & Devices',
    icon: '',
    templates: [
'{Mẫu này còn hàng không shop|Bản này có bảo hành chính hãng không|Có hỗ trợ ship COD không} {ạ|ad ơi|nhé} {📱|⚡|🔥}',
'{Máy dùng mượt mà|Pin trâu thật sự|Shop đóng gói rất kỹ} {nha cả nhà|ạ|luôn} {👍|✨|🔋}',
'{Giá bao gồm VAT chưa shop|Có hỗ trợ trả góp 0% không|Tặng kèm những phụ kiện gì} {ạ|vậy shop} {💳|📦}',
'{Bền đẹp|Dùng 6 tháng rồi vẫn ngon lành|Đáng đồng tiền bát gạo} {nha|luôn bạn ơi|ạ} {💯|🌟}',
    ],
  },
};

export const ENGAGEMENT_STORAGE_KEY = 'toolzutter:assisted-page-engagement';

export const REACTIONS: ReactionOption[] = [
  { key: 'LIKE', label: 'Like', shortLabel: 'Like', emoji: '👍', color: '#1877f2', isRandom: false },
  { key: 'LOVE', label: 'Love', shortLabel: 'Love', emoji: '❤️', color: '#f33e58', isRandom: false },
  { key: 'CARE', label: 'Care', shortLabel: 'Care', emoji: '🥰', color: '#f7b125', isRandom: false },
  { key: 'HAHA', label: 'Haha', shortLabel: 'Haha', emoji: '😆', color: '#f7b125', isRandom: false },
  { key: 'WOW', label: 'Wow', shortLabel: 'Wow', emoji: '😮', color: '#f7b125', isRandom: false },
  { key: 'SAD', label: 'Sad', shortLabel: 'Sad', emoji: '😢', color: '#f7b125', isRandom: false },
  { key: 'ANGRY', label: 'Angry', shortLabel: 'Angry', emoji: '😡', color: '#e9710f', isRandom: false },
  {
    key: 'RANDOM_POSITIVE',
    label: 'Natural reaction mix (like • love • care)',
    shortLabel: 'Natural mix (like/love)',
    emoji: '',
    color: '#3b82f6',
    isRandom: true,
    desc: '65% like + 25% love + 10% care (recommended for sales posts)',
  },
  {
    key: 'RANDOM_ALL',
    label: 'Diverse mix (all Facebook reactions)',
    shortLabel: 'Diverse mix',
    emoji: '',
    color: '#8b5cf6',
    isRandom: true,
    desc: 'Mixes in Haha and Wow for viral and entertainment posts',
  },
];

/** The single speed level the user picks; each level comes with a default gap and human simulation */
export const SPEED_PRESETS: { key: SpeedModeKey; name: string; delayMs: number; human: boolean }[] = [
  { key: 'TURBO', name: 'Turbo', delayMs: 1200, human: false },
  { key: 'FAST', name: 'Very fast', delayMs: 1800, human: false },
  { key: 'NORMAL', name: 'Standard', delayMs: 2200, human: true },
  { key: 'SMART', name: 'Auto', delayMs: 2500, human: true },
  { key: 'SAFE', name: 'Safe', delayMs: 4500, human: true },
];

export const VIA_PAGES_STORAGE_KEY = 'toolzutter:via_fanpages_map_v3';
