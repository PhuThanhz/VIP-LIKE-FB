# 🎨 KẾ HOẠCH NÂNG CẤP GIAO DIỆN & TRẢI NGHIỆM NGƯỜI DÙNG — UI/UX 2.0 (SAAS GRADE)

Mục tiêu: Đưa trải nghiệm sử dụng VIPLIKE RADIANT đạt chuẩn **Enterprise SaaS** — Tinh giản thao tác, hiện đại, thẩm mỹ tối giản sang trọng, không giật lag và loại bỏ hoàn toàn các màn hình chờ đơ cứng.

---

## 💎 NGUYÊN TẮC THIẾT KẾ 2.0 (ĐÃ ÁP DỤNG THÀNH CÔNG)

1. **Aesthetic Minimalism (Tối giản cao cấp):** Tông màu than chì sâu (Deep Charcoal `#090d16` / `#0b1120`), viền siêu mảnh kính mờ (Frosted Slate `#1e293b`), điểm nhấn Cyan (`#06b6d4`) và Emerald (`#10b981`), tuyệt đối không lạm dụng dải gradient lòe loẹt hay hiệu ứng bóng đổ nặng nề.
2. **Instant Feedback (Phản hồi tức thì):** Mọi hành động click (nhập link, nạp cấu hình, chọn Fanpage, ấn bắt đầu) đều có micro-interaction rõ ràng dưới 100ms.
3. **No Blind Waiting (Loại bỏ màn hình chờ đơn điệu):** 100% các bảng biểu và thẻ chỉ số khi nạp dữ liệu chuyển sang dùng **Animated Skeleton Loaders** (`SaaSLoadingSkeleton.tsx`) thay vì spinner quay đơ.
4. **Actionable Empty States (Trạng thái rỗng có hướng dẫn):** Khi chưa có đơn hàng, chưa có logs hoặc chưa có Page, hiển thị minh họa trực quan kèm nút hành động 1-click thay vì dòng chữ "Không có dữ liệu".
5. **Honest & Actionable Batch Tracking (Minh bạch & Trung thực):** 
   - Đơn hàng chỉ được gắn nhãn `Hoàn thành 100%` (xanh lá) khi thực sự đạt đủ số like mục tiêu.
   - Các đơn hàng chỉ đạt một phần like (do hết nick hoặc bị rate limit) được hiển thị rõ ràng nhãn cảnh báo màu hổ phách: `⚠️ Đạt X/Y like` kèm nút bấm trực tiếp **🚀 Bù like**.
   - Hộp tóm tắt cuối chiến dịch cung cấp nút **🚀 Bù like tự động cho toàn bộ bài còn thiếu trong Batch** bằng 1 click.
6. **Ergonomic Workflows (Công thái học thao tác):** Rút gọn tối đa số bước để tạo và chạy đơn từ 4 bước xuống còn **1 bước thông minh** (Paste link $\rightarrow$ Tự nhận diện $\rightarrow$ Chọn mẫu like $\rightarrow$ Khởi chạy ngay).

---

## 📋 CÁC MODULE ĐÃ TRIỂN KHAI

### Module 1: Smart Post Input & Link Auto-Detective (`PasteLinkInput.tsx`)
- Tự động nhận diện định dạng link Facebook khi paste:
  - `🎬 Facebook Reel` cho `facebook.com/reel/...` và `/share/r/...`.
  - `👥 Bài viết Nhóm (Group)` cho các link group.
  - `📺 Video Facebook` cho các link video.
  - `🖼️ Hình ảnh` cho các link photo.
  - `📄 Bài viết Fanpage / Feed` cho các bài post chuẩn.

### Module 2: Dashboard Command Center & Live Progress Bar
- Hiển thị Speedometer thời gian thực: `X like/phút • ~Ys/lượt`.
- Bộ đếm thời gian thực hiện, thời gian ước tính còn lại và thanh tiến độ phát sáng chuyển màu Cyan $\rightarrow$ Emerald.
- 4 Thẻ KPI Metric hiển thị chuẩn xác trong chế độ Batch:
  - **Tổng like mục tiêu** (Hiển thị tổng like của toàn bộ chiến dịch, ví dụ 600 like).
  - **Thành công** (Hiển thị tổng số like thực tế đã buff, ví dụ 277 like - 46%).
  - **Đã like trước** (Số tài khoản đã like bài viết trước đó).
  - **Còn thiếu / Cần bù** (Số like còn thiếu để đạt 100% KPI).

### Module 3: Skeleton Loaders & Lazy-Loading Architecture
- Tạo mới `SaaSLoadingSkeleton.tsx` cung cấp `CardSkeleton`, `TableSkeleton`, `PageSkeleton`.
- Tách toàn bộ các trang con vào `React.lazy()` kết hợp `<Suspense fallback={<TableSkeleton />}>`.
- Giảm dung lượng nạp ban đầu từ **471 kB xuống 111 kB** (giảm 76.3%).

### Module 4: 1-Click Refill Workflows
- Tích hợp nút `🚀 Bù X like` trên từng dòng bài viết chưa đạt 100% KPI.
- Tích hợp nút `🚀 Bù like cho các bài còn thiếu (X like)` trong Summary Banner khi hoàn thành Batch.
