# ✨ VIPLIKE RADIANT - BỘ PHẦN MỀM BUFF LIKE & TƯƠNG TÁC FACEBOOK

**VIPLIKE RADIANT** là phần mềm tự động hóa tăng tương tác (Buff Like, Reaction, Comment, View Reels/Video) độc lập, chuyên nghiệp, kết nối trực tiếp với cơ sở dữ liệu **MySQL Workbench (`autopost_saas`)** và hệ thống điều khiển trình duyệt ẩn danh **Playwright**.

---

## 🚀 KHỞI ĐỘNG NHANH (1-CLICK)

### Cách 1: Chạy bằng file script tiện lợi (Khuyên dùng)
Chỉ cần nhấp đúp hoặc mở Terminal gõ:
```bash
./start.sh
```
*Script sẽ tự động khởi động Backend (:3100), Frontend (:5174) và tự động mở trình duyệt cho bạn.*

### Cách 2: Chạy bằng lệnh npm
```bash
# Cài đặt tất cả thư viện (chỉ cần chạy lần đầu)
npm run setup

# Chạy cả Backend & Frontend cùng lúc
npm run dev
```

Truy cập phần mềm tại: **`http://localhost:5174`**  
Backend API & Engine Playwright chạy tại: **`http://localhost:3100`**

---

## 🗄️ KẾT NỐI MYSQL WORKBENCH

Phần mềm kết nối trực tiếp với MySQL Workbench theo cấu hình trong file `.env`:
- **Host**: `localhost`
- **Port**: `3306`
- **User**: `root`
- **Password**: `26082003`
- **Database**: `autopost_saas`
- **Bảng dữ liệu**: `social_accounts`

Toàn bộ **51+ tài khoản Via, Fanpage và Cookie** bạn đang quản lý trên MySQL Workbench đều được phần mềm tải tự động, hiển thị trạng thái Live / Checkpoint, và đồng bộ 2 chiều (thêm mới, chỉnh sửa, xóa).

---

## 💎 CÁC TÍNH NĂNG CHÍNH

### 1. Like & Bình luận (Buff Tương Tác)
- **Hỗ trợ mọi định dạng**: Bài viết Group (kín/công khai), Fanpage, Profile cá nhân, Video Reels.
- **Chế độ 1 link hoặc Hàng loạt link**: Xử lý nhiều bài viết cùng lúc với thanh tiến trình thời gian thực (SSE Stream).
- **Đầy đủ 7 loại cảm xúc**: Like (Thích), Love (Yêu thích), Care (Thương thương), Haha, Wow, Sad, Angry, hoặc Ngẫu nhiên tự nhiên.
- **Bình luận Seeding**: Dán danh sách comment hoặc dùng AI Gemini sinh tự động theo ngữ cảnh bài viết.
- **Cơ chế chống phát hiện**: Giả lập phần cứng độc lập (Device Fingerprint), đổi User-Agent, ngắt tải ảnh/video để tối ưu tốc độ và RAM.

### 2. Tăng View Video & Reels
- Buff lượt xem cho Video và Reels Facebook không cần đăng nhập.
- Tùy chỉnh số luồng chạy song song (1 - 5 luồng) và thời gian xem mỗi lượt (5s - 20s).

### 3. Tự Săn Bài Mới (Post Hunter)
- Theo dõi các Fanpage, Nhóm mục tiêu theo chu kỳ (ví dụ mỗi 5-10 phút).
- Khi có bài mới xuất hiện, hệ thống tự động ghi nhận và nạp vào hàng đợi buff.
- Cơ chế lấy mốc an toàn: Lần quét đầu chỉ ghi nhận bài hiện tại, không buff bài cũ.

### 4. Hàng Đợi Tự Động (Auto-Buff Queue)
- Xếp lịch chạy ngầm với độ trễ tự nhiên (delay 2-5 phút sau khi đăng bài để giống người dùng thật).
- Chia tải đều cho toàn bộ dàn Via và Fanpage, xoay vòng page chống kiệt sức tài khoản.

### 5. Sổ Chống Trùng Lặp (Anti-Overlap Registry)
- Tự động ghi nhớ từng Fanpage đã like bài viết nào.
- Ngăn chặn hoàn toàn tình trạng 1 Fanpage bấm like lại bài cũ (gây hủy like / unlike).

### 6. Quản Lý Dàn Via & Cookie
- Giao diện trực quan ngay trên thanh điều hướng để xem danh sách Via trong MySQL.
- Thêm nhanh Via mới bằng Cookie (tự động trích xuất UID `c_user`).
- Kiểm tra sức khỏe dàn Via (Health-Check) một chạm, tự động phân loại Live / Checkpoint / Hết hạn.

---

## 📁 CẤU TRÚC THƯ MỤC
```
VIPLIKE-RADIANT/
├── backend/                  # Server Node.js Express + Engine Playwright
│   ├── server.js             # API REST & SSE Stream
│   ├── db.js                 # Module kết nối MySQL Workbench
│   ├── fb-buff-tool.js       # Tự động hóa Facebook bằng Playwright
│   ├── device-fingerprints.js # Giả lập phần cứng & UA
│   ├── page-post-registry.js # Sổ ghi nhớ chống trùng
│   ├── ai-seeding.js         # Tích hợp Gemini AI sinh comment
│   ├── telegram-alert.js     # Thông báo Telegram
│   └── data/                 # Bộ nhớ đệm & hàng đợi cục bộ
├── frontend/                 # Giao diện người dùng React 18 + Vite + Tailwind + AntD
│   ├── src/pages/BuffEngagement.tsx
│   ├── src/components/Header.tsx
│   ├── src/components/ViaManagementModal.tsx
│   └── src/components/buff/PostHunterTab.tsx
├── start.sh                  # File khởi động 1-click
├── .env                      # File cấu hình môi trường
└── package.json              # Quản lý script khởi chạy toàn hệ thống
```
