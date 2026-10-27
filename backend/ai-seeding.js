const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Đọc API Key từ .env hoặc môi trường
let GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) {
  try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GEMINI_API_KEY=([^\r\n]+)/);
      if (match) GEMINI_API_KEY = match[1].trim();
    }
  } catch (e) {}
}

// Cập nhật 2026-10-06: gemini-2.0-* đã bị khai tử, 2.5-flash hay hết quota
const FALLBACK_MODELS = [
  'gemini-3.5-flash',
  'gemini-flash-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
];

/**
 * Mẫu bình luận dự phòng chất lượng cao theo ngành nghề khi không có mạng/API
 */
const NICHE_FALLBACKS = {
  FASHION: [
    'Mẫu này nữ cao 1m6 nặng 50kg mặc size nào vừa vặn nhất ạ shop? ✨',
    'Màu be ở ngoài có giống 100% trong hình không bạn ơi? Nhìn mê quá ❤️',
    'Chất vải có bị nhăn khi giặt máy không ạ? Tư vấn giúp mình với nha 👍',
    'Váy xinh quá, ship về Cầu Giấy Hà Nội mất tầm mấy ngày vậy shop?',
    'Cho mình hỏi mẫu này còn size L không ạ? Inbox mình với nhé 🥰',
    'Thiết kế tôn dáng thật sự, đã nhận hàng và ưng ý lắm ạ 👏',
    'Mẫu này phối với áo blazer đi làm có hợp không ad ơi? ✨',
    'Shop có hỗ trợ đổi trả nếu không vừa size không ạ? Cảm ơn shop nha 🍀',
    'Form đẹp đỉnh chóp luôn, chuẩn bị mua thêm màu đen nữa nè!',
    'Đã từng mua đồ bên shop, chất lượng vải dày dặn đường may kỹ lắm 👍',
  ],
  BEAUTY_COSMETICS: [
    'Da dầu mụn dùng dòng này có bị bí tắc lỗ chân lông không shop? 🌸',
    'Chất kem thấm nhanh không ạ? Có để lại vệt trắng trên da không bạn?',
    'Mình dùng được 2 tuần thấy da căng bóng rõ rệt luôn, 10 điểm ạ! ❤️',
    'Sản phẩm có dùng được cho mẹ bầu không ad ơi? Tư vấn mình nha ✨',
    'Đang tìm dòng dưỡng ẩm phục hồi như thế này, inbox tư vấn mình với ạ 🥰',
    'Hàng chính hãng check mã vạch chuẩn không shop? Mua tặng bạn gái nè 👍',
    'Mùi thơm dịu nhẹ rất thích, bôi lên da mát lịm luôn á 🌟',
    'Combo này dùng sáng hay tối thì hiệu quả tốt nhất vậy ad? 🍀',
  ],
  REAL_ESTATE: [
    'Dự án này vị trí quá đắc địa, kết nối giao thông rất thuận tiện 👍',
    'Pháp lý dự án đã có sổ hồng lâu dài chưa bạn? Inbox mình thông tin nhé.',
    'Giá bán đợt 1 này có kèm chính sách ân hạn nợ gốc ngân hàng không ad? 👏',
    'Khu này tiềm năng tăng giá tốt, hạ tầng xung quanh đang hoàn thiện nhanh.',
    'Căn 2 phòng ngủ view nội khu giá khoảng bao nhiêu vậy chuyên viên tư vấn?',
    'Thiết kế căn hộ tối ưu công năng, nhiều ánh sáng tự nhiên rất thích ✨',
    'Đã tham quan nhà mẫu hôm qua, không gian thực tế rất thoáng và đẹp ❤️',
    'Chính sách thanh toán giãn tiến độ này rất phù hợp với gia đình trẻ 🍀',
  ],
  FOOD_CAFE: [
    'Quán view đẹp quá, không gian này đi chụp hình sống ảo thì hết nước chấm! 📸',
    'Menu đồ uống đa dạng ghê, món trà sữa hạt dẻ có ngọt gắt không bạn? 🧋',
    'Cuối tuần này nhất định phải rủ hội bạn thân ghé quán thử mới được 🥰',
    'Đồ ăn tươi ngon nêm nếm rất vừa miệng, phục vụ nhiệt tình 10 điểm ❤️',
    'Quán có chỗ để ô tô rộng rãi không ad ơi? Mình tính ghé ăn trưa 👍',
    'Nhìn đĩa đồ ăn decor bắt mắt quá, thèm rớt nước miếng luôn á 😋',
    'Giá cả rất hợp lý so với chất lượng, sẽ quay lại ủng hộ quán dài dài! ✨',
    'Không gian yên tĩnh phù hợp làm việc và đọc sách lắm nè 🍀',
  ],
  TECH_GADGETS: [
    'Con này pin trâu không ad? Dùng tác vụ nặng liên tục trụ được mấy tiếng ạ?',
    'Bản này bộ nhớ bao nhiêu GB vậy shop? Có hỗ trợ trả góp 0% không?',
    'Cấu hình trong tầm giá này là quá ngon rồi, đáng đồng tiền bát gạo 👍',
    'Chính sách bảo hành 1 đổi 1 trong bao lâu vậy shop? Tư vấn mình nhé 📱',
    'Màn hình hiển thị sắc nét, tần số quét 120Hz mượt mà thực sự 👏',
    'Shop có chi nhánh ở HCM không để mình ghé trải nghiệm trực tiếp ạ? ✨',
    'Thiết kế sang trọng, cầm đầm tay và chắc chắn lắm bạn ơi ❤️',
    'Đặt online ship hỏa tốc trong ngày được không shop ơi? 🚀',
  ],
  GENERAL_SALE: [
    'Sản phẩm đúng như mô tả, đóng gói cẩn thận 2 lớp chống sốc rất chu đáo 👍',
    'Tư vấn nhiệt tình, ship hàng nhanh như một cơn gió, cảm ơn shop nhiều nhé! ❤️',
    'Đã nhận được hàng, chất lượng vượt ngoài mong đợi luôn ạ ✨',
    'Cho mình đặt 1 cái về địa chỉ cũ nha shop, inbox mình kiểm tra đơn nhé!',
    'Hàng xịn xò mà giá tốt quá, sẽ giới thiệu thêm cho bạn bè ủng hộ shop 🥰',
    'Ủng hộ shop dài lâu, làm ăn uy tín có tâm như này hiếm lắm 👏',
    'Có được kiểm tra hàng trước khi thanh toán không bạn ơi? 🍀',
    'Ưng ý thực sự, cho shop 5 sao chất lượng nhé 🌟',
  ],
  VIRAL_LIFE: [
    'Đọc bài viết mà thấy đồng cảm sâu sắc, cảm ơn tác giả đã chia sẻ! ❤️',
    'Chuẩn từng câu từng chữ luôn, góc nhìn rất nhân văn và tích cực 👍',
    'Cảm ơn nguồn năng lượng tuyệt vời này, chúc ad một ngày an lành nhé! 🌸',
    'Lưu lại ngay để mỗi khi nản lòng lôi ra đọc lại, giá trị thật sự ✨',
    'Cuộc sống này cần nhiều hơn những bài viết ý nghĩa như thế này 👏',
    'Chia sẻ rất chân thành và chạm đến cảm xúc, hóng phần tiếp theo của ad 🥰',
    'Đúng tâm trạng của mình lúc này luôn, cảm ơn bạn nhiều lắm! 🍀',
  ],
  ECONOMY: [
    'Phân tích rất thực tế và sát với thị trường hiện tại 👍',
    'Góc nhìn kinh tế vĩ mô rất sâu sắc, cảm ơn ad đã chia sẻ! 👏',
    'Chuẩn luôn ạ, giai đoạn này quản trị dòng tiền là quan trọng nhất.',
    'Bài viết rất bổ ích, mình đã lưu lại để tham khảo thêm ✨',
    'Nhận định rất khách quan, đúng những điều mình đang băn khoăn ❤️',
    'Cảm ơn thông tin giá trị, hóng các bài phân tích tiếp theo của page ạ!',
    'Thông tin kịp thời quá, đúng lúc thị trường đang có nhiều biến động.',
    'Góc nhìn rất đa chiều, chia sẻ thực sự hữu ích cho anh em làm ăn.',
  ],
  GENERAL: [
    'Bài viết hay và rất ý nghĩa ạ! 👍',
    'Cảm ơn bạn đã chia sẻ thông tin hữu ích này ❤️',
    'Chuẩn không cần chỉnh luôn ạ! 👏',
    'Đã lưu lại khi cần, tuyệt vời quá nè 🌟',
    'Ủng hộ nhiệt tình, chúc trang ngày càng phát triển nhé! 🍀',
    'Quá hay, chia sẻ rất thực tế và dễ hiểu 🥰',
    'Tuyệt vời quá bạn ơi, đúng điều mình đang tìm kiếm ✨',
    'Hóng thêm nhiều bài viết chất lượng như này từ trang ạ!',
  ],
};

/**
 * Gọi Gemini AI tạo danh sách bình luận seeding tự nhiên theo ngữ cảnh
 */
async function generateSeedingComments({
  topic = 'GENERAL',
  postContent = '',
  postUrl = '',
  count = 8,
  tone = 'natural',
} = {}) {
  const safeCount = Math.max(3, Math.min(25, Number(count) || 8));

  if (!GEMINI_API_KEY) {
    console.warn('[AI Seeding] ⚠️ Chưa có GEMINI_API_KEY, sử dụng bộ bình luận tự nhiên dự phòng.');
    const pool = NICHE_FALLBACKS[topic.toUpperCase()] || NICHE_FALLBACKS.GENERAL;
    return pool.slice(0, safeCount);
  }

  const prompt = `Bạn là chuyên gia Seeding mạng xã hội Facebook tại Việt Nam.
Nhiệm vụ của bạn là viết ${safeCount} bình luận (comments) tiếng Việt CỰC KỲ TỰ NHIÊN, chân thực như người dùng thật 100% để tương tác cho bài viết Facebook sau:

${postContent ? `[Nội dung bài viết]:\n${postContent.slice(0, 1500)}\n` : ''}
${postUrl ? `[Link bài viết]: ${postUrl}\n` : ''}
[Chủ đề / Ngành nghề]: ${topic}
[Phong cách]: ${tone} (tự nhiên, đa dạng góc nhìn, có câu hỏi han, có câu đồng tình, có câu khen ngợi, có câu chia sẻ kinh nghiệm).

YÊU CẦU NGHIÊM NGẶT:
1. Đa dạng hóa độ dài: có câu ngắn 5-8 từ, có câu vừa 10-20 từ.
2. Dùng từ ngữ tự nhiên đời thường của người Việt (ạ, nha, nè, nhé, đúng thật, chuẩn luôn, cảm ơn bác, hóng...). Thêm emoji phù hợp nhưng không lạm dụng (1-2 emoji mỗi comment).
3. TUYỆT ĐỐI KHÔNG dùng các từ cấm hay từ của bot: "test", "bot", "tool", "tự động", "auto", "seeding".
4. TUYỆT ĐỐI KHÔNG để số thứ tự, gạch đầu dòng, dấu ngoặc kép hay lời dẫn.
5. Mỗi bình luận nằm trên MỘT DÒNG riêng biệt. CHỈ trả về đúng ${safeCount} dòng bình luận.`;

  for (const model of FALLBACK_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const resp = await axios.post(
        url,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.85,
            topP: 0.95,
          },
        },
        { timeout: 25000 }
      );

      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text.trim()) {
        const lines = text
          .split('\n')
          .map((line) => line.replace(/^[\d+.\-•*"\s]+|["\s]+$/g, '').trim())
          .filter((line) => line.length > 3 && !line.toLowerCase().includes('dưới đây'));

        if (lines.length > 0) {
          console.log(`[AI Seeding] ✅ Đã sinh thành công ${lines.length} bình luận bằng model ${model}!`);
          return lines.slice(0, safeCount);
        }
      }
    } catch (err) {
      console.warn(`[AI Seeding] ⚠️ Model ${model} gặp lỗi: ${err.response?.data?.error?.message || err.message}`);
    }
  }

  // Fallback nếu các model đều lỗi
  const pool = NICHE_FALLBACKS[topic.toUpperCase()] || NICHE_FALLBACKS.GENERAL;
  return pool.slice(0, safeCount);
}

module.exports = {
  generateSeedingComments,
};
