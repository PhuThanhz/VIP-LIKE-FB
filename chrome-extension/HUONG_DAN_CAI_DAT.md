# 🚀 HƯỚNG DẪN CÀI ĐẶT & SỬ DỤNG CHROME EXTENSION
## VIPLIKE AVATAR FAST UPLOADER (v1.0.0)

Tiện ích mở rộng chính chủ được thiết kế chuyên biệt để tự động cập nhật ảnh đại diện hàng loạt cho dàn Fanpage Facebook trực tiếp trên trình duyệt Chrome thật của bạn.

---

### ⭐ ƯU ĐIỂM VƯỢT TRỘI SO VỚI TOOL TỰ ĐỘNG THÔNG THƯỜNG
1. **Chạy trên Chrome thật:** Dùng trực tiếp phiên đăng nhập, Cookie, IP và vân tay trình duyệt sẵn có của bạn – **Facebook hoàn toàn không nghi ngờ bot**, giảm thiểu 100% rủi ro Checkpoint.
2. **Cơ chế bảo vệ 2 lớp (Tuyệt đối không đổi bậy các nick đã có Avatar):**
   - **Lớp 1 (Kiểm duyệt trực quan):** Bảng danh sách Fanpage hiển thị rõ ràng từng Page kèm ảnh đại diện thu nhỏ và nhãn (`🔴 Chưa có Avatar` vs `🟢 Đã có Avatar`). Tiện ích **mặc định chỉ tích chọn các Page chưa có Avatar**, các nick đã có ảnh sẽ được bỏ chọn để bảo vệ an toàn.
   - **Lớp 2 (Safety Guard trên Facebook):** Trước khi bấm tải ảnh lên, tiện ích kiểm tra lại ảnh đại diện thực tế trên Facebook; nếu nick đã có ảnh thật sẽ tự động bỏ qua và ghi log an toàn.
3. **Bảng điều khiển nổi (Floating HUD):** Tự động hiển thị ở góc dưới bên phải Facebook, hiển thị thanh % tiến độ, số Page thành công, có nút **Tạm dừng / Tiếp tục / Dừng** bất cứ lúc nào.
4. **Bền bỉ tuyệt đối:** Nhờ cơ chế lưu trạng thái tự động (`chrome.storage.local`), ngay cả khi Facebook chuyển trang (Profile Switch) hoặc F5 lại trang, tiến trình vẫn tiếp tục chạy mượt mà không bị ngắt quãng.
5. **Kho 220+ ảnh mẫu HD:** Tích hợp sẵn ảnh chân dung AI Nam, Nữ, Doanh nhân sắc nét chuẩn tỷ lệ vuông Facebook.

---

### 🛠️ CÁCH CÀI ĐẶT LÊN CHROME (CHỈ 3 BƯỚC)

#### **Bước 1: Mở trang Quản lý tiện ích**
- Mở trình duyệt Google Chrome (nơi bạn đang đăng nhập nick Facebook).
- Nhập vào thanh địa chỉ: `chrome://extensions/` rồi nhấn **Enter**.

#### **Bước 2: Bật "Chế độ dành cho nhà phát triển" (Developer mode)**
- Nhìn lên góc trên cùng bên phải màn hình, gạt công tắc **"Developer mode"** (hoặc **Chế độ dành cho nhà phát triển**) sang màu xanh.

#### **Bước 3: Nạp Extension vào Chrome**
- Nhìn sang góc trên cùng bên trái, bấm vào nút: **"Load unpacked"** (hoặc **Tải tiện ích đã giải nén**).
- Cửa sổ chọn thư mục hiện lên, bạn trỏ đến đúng thư mục sau:
  ```text
  /Users/huynhthanhphu/Documents/VIPLIKE-RADIANT/chrome-extension
  ```
- Bấm **Select** (hoặc **Chọn**).
*(Nếu đã nạp từ trước, bạn chỉ cần bấm nút biểu tượng 🔄 Xoay vòng để nạp lại phiên bản mới).*

🎉 **HOÀN TẤT!** Bạn sẽ thấy thẻ tiện ích **"VIPLIKE Avatar Fast Uploader"** xuất hiện trên Chrome.  
*(Mẹo nhỏ: Hãy bấm vào biểu tượng Mảnh ghép 🧩 trên góc phải Chrome và Ghim 📌 tiện ích ra ngoài thanh công cụ để dễ dùng).*

---

### 📖 HƯỚNG DẪN SỬ DỤNG AN TOÀN

1. **Mở tab Facebook:** Mở trang `https://www.facebook.com` trên Chrome này (đảm bảo nick của bạn đã đăng nhập và có quyền quản trị dàn Fanpage).
2. **Mở Extension:** Bấm vào icon tia sét ⚡ của VIPLIKE trên thanh tiện ích.
3. **Kiểm tra danh sách Fanpage (Rất quan trọng):**
   - Tiện ích sẽ tải và hiển thị danh sách các Fanpage của bạn kèm theo trạng thái:
     - `🔴 Chưa có Avatar`: **Được tự động tích chọn sẵn**.
     - `🟢 Đã có Avatar`: **Được bỏ chọn mặc định để giữ nguyên ảnh cũ**.
   - Bạn có thể thoải mái tích chọn hoặc bỏ chọn bất kỳ Page nào bạn muốn.
   - Có sẵn các nút bấm nhanh: `🔴 Chỉ chọn chưa có`, `Chọn tất cả`, `Bỏ chọn`, và ô tìm kiếm Page.
4. **Bấm "🚀 Bắt đầu đổi Avatar (X Page đã chọn)"**:
   - Extension sẽ CHỈ thực hiện đổi ảnh cho những Fanpage mà bạn đã tích chọn.
   - Bảng điều khiển nổi (Floating HUD) ở góc dưới phải màn hình Facebook sẽ tự động chạy: hiển thị tên Page đang đổi, thanh tiến độ %, số lượng thành công / lỗi.
   - Bạn có thể bấm **Tạm dừng** hoặc **Dừng** bất cứ lúc nào!
