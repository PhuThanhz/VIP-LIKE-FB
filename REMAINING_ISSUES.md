# BÁO CÁO CÁC VẤN ĐỀ TỒN ĐỌNG VÀ KHUYẾN NGHỊ VẬN HÀNH (REMAINING ISSUES & ROADMAP)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.1
**Mục tiêu:** Nhìn thẳng vào thực tế, liệt kê các giới hạn kỹ thuật tự nhiên của môi trường trình duyệt, các kịch bản ngoại lệ hiếm gặp và khuyến nghị cho đội ngũ vận hành duy trì hệ thống lâu dài.

---

### 1. CÁC ĐIỂM GIỚI HẠN VÀ KHUYẾN CÁO VẬN HÀNH HIỆN TẠI

Mặc dù BUFF LIKE 3.1 đã giải quyết triệt để các vấn đề cốt lõi về tốc độ, khoá làn và phân trang, hệ thống vẫn có một số đặc thù kỹ thuật cần lưu ý trong thực tế:

#### 1. Giới hạn tài nguyên phần cứng khi chạy nhiều phiên Playwright đồng thời
- **Hiện tượng**: Mỗi phiên trình duyệt Playwright (Chromium Profile) tiêu tốn từ 150MB đến 350MB RAM hệ điều hành.
- **Khuyến nghị**: Trên máy chủ có RAM $\le 8\text{ GB}$, cấu hình số luồng Via song song (`BUFF_PARALLEL_VIAS`) tối đa từ 2 đến 4 luồng. Không nên ép lên 10-20 luồng trình duyệt cùng lúc trên máy cấu hình yếu để tránh kích hoạt cơ chế OOM Killer của hệ điều hành.

#### 2. Phụ thuộc vào chất lượng mạng và Proxy của từng Via
- **Hiện tượng**: Tốc độ like trung bình đạt 2.5s - 3.2s là trong điều kiện kết nối mạng ổn định. Nếu người dùng sử dụng Proxy xoay IPv6 hoặc Proxy dân cư chất lượng kém với ping cao (> 800ms), thời gian tải DOM Facebook có thể bị kéo dài do độ trễ mạng ngoại vi.
- **Khuyến nghị**: Sử dụng Proxy tĩnh IPv4 hoặc mạng cáp quang ổn định để đạt tốc độ cao nhất.

#### 3. Chính sách cập nhật giao diện của Facebook (DOM Mutation)
- **Hiện tượng**: Facebook thường xuyên A/B test các selector DOM (nút Like, menu chuyển profile, vị trí avatar).
- **Khuyến nghị**: Bộ chọn dự phòng đa tầng (Multi-selector fallback strategy) trong `backend/fb-buff-tool.js` đã bao phủ hơn 6 biến thể DOM khác nhau của Facebook (mobile, mbasic, desktop new, desktop classic). Đội ngũ vận hành nên định kỳ kiểm tra các ảnh chụp màn hình nghiệm thu tại `backend/data/screenshots/` khi Facebook có đợt cập nhật giao diện lớn.

#### 4. Dọn dẹp dữ liệu lịch sử định kỳ (Data Retention Policy)
- **Hiện tượng**: Mặc dù Keyset Cursor Pagination giải quyết được độ trễ $O(1)$, nhưng theo thời gian sau nhiều tháng vận hành, bảng `buff_logs` và `buff_history` có thể lên tới hàng triệu dòng làm phình dung lượng ổ cứng.
- **Khuyến nghị**: Kích hoạt tác vụ dọn dẹp (Housekeeping Cronjob) để lưu trữ (archive) hoặc xoá các log cũ hơn 60 ngày không còn nhu cầu tra cứu.

---

### 2. KẾ HOẠCH BẢO TRÌ VÀ KHUYẾN NGHỊ ĐỊNH HƯỚNG

- **Quan điểm nhất quán**: Không vội vã nâng cấp lên Buff Like 4.0 khi chưa có nhu cầu kinh doanh mới.
- **Nhiệm vụ trọng tâm giai đoạn này**: Duy trì sự ổn định của BUFF LIKE 3.1, liên tục theo dõi bảng điều khiển Telemetry (`⚡ Telemetry` trên thanh header) để phát hiện sớm các dấu hiệu bất thường của Event Loop hoặc Connection Pool.
