# BÁO CÁO ĐÁNH GIÁ AN TOÀN VÀ TOÀN VẸN DỮ LIỆU (SECURITY & DATA INTEGRITY REVIEW)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.1
**Chuyên gia đánh giá:** Security & Compliance Architect  
**Mục tiêu:** Rà soát toàn diện cơ chế xác thực, phân quyền, quản lý bí mật, chống tiêm nhiễm mã độc (Injection) và tính hợp lệ khi tích hợp nền tảng bên ngoài.

---

### 1. BẢNG TỔNG HỢP KIỂM TOÁN AN TOÀN THÔNG TIN (SECURITY AUDIT MATRIX)

| Tiêu chuẩn an toàn | Cơ chế triển khai thực tế | Mức độ rủi ro | Kết quả kiểm toán |
| :--- | :--- | :---: | :---: |
| **Xác thực API (Authentication)** | Bắt buộc JSON Web Token (JWT) cho 100% API nghiệp vụ qua middleware `authenticateJwt` | Thấp | 🟢 PASS |
| **Phân quyền truy cập (RBAC)** | Phân quyền vai trò nghiêm ngặt (`ADMIN` vs `USER`). Các thao tác nhạy cảm yêu cầu `requireAdmin` | Thấp | 🟢 PASS |
| **Bảo vệ Bí mật (Secret Management)** | `JWT_SECRET` lưu tại `data/.jwt_secret` với quyền truy cập `0o600`. Không lộ trong log/API | Thấp | 🟢 PASS |
| **Mật khẩu người dùng** | Mã hóa bằng thuật toán `bcrypt` với muối băm an toàn, không bao giờ lưu plain text | Thấp | 🟢 PASS |
| **Chống SQL Injection** | 100% câu lệnh truy vấn động dùng Prepared Statements với tham số ràng buộc (`?`) | Rất thấp | 🟢 PASS |
| **Toàn vẹn Dữ liệu Trạng thái** | Cơ chế lưu trữ kép (`StateStore`): MySQL Workbench làm nguồn chính + JSON làm dự phòng | Rất thấp | 🟢 PASS |
| **Tương thích Nền tảng Bên ngoài** | Tuân thủ cơ chế bảo vệ của Facebook: Tự động hạ nhiệt, không ép vượt checkpoint | Rất thấp | 🟢 PASS |

---

### 2. CHI TIẾT CÁC CƠ CHẾ BẢO MẬT ĐÃ KIỂM CHỨNG

#### 2.1. Kiểm tra Middleware Xác thực JWT (`authenticateJwt`)
- Middleware chặn mọi yêu cầu truy cập các tài nguyên bảo vệ nếu thiếu header `Authorization: Bearer <token>`.
- Token được giải mã và kiểm tra chữ ký với thuật toán HMAC SHA-256. Nếu token hết hạn hoặc bị can thiệp thay đổi payload, hệ thống lập tức trả về mã lỗi `401 Unauthorized` và ngắt request.
- Danh sách tuyến đường công khai (`publicPaths`) được thu hẹp tối đa, chỉ bao gồm:
  - Tuyến đăng nhập: `/api/auth/login`.
  - Tuyến kiểm tra sức khoẻ: `/api/health`, `/api/readiness`, `/api/system/observability`.
  - Tuyến kiểm tra bản quyền: `/api/license/status`, `/api/license/activate`.

#### 2.2. Phòng Chống Tấn Công SQL Injection
- Trong tệp `backend/db.js`, toàn bộ các hàm tương tác cơ sở dữ liệu (`getBuffLogs`, `saveBuffLogs`, `getTelegramNotifications`, `ensureBuffHistoryTable`) đều sử dụng cơ chế Parameterized Query của thư viện `mysql2/promise`.
- Ngay cả với Keyset Cursor Pagination, các giá trị con trỏ thời gian và ID được truyền qua mảng tham số:
  ```javascript
  sql += ` WHERE created_at < ? OR (created_at = ? AND id < ?)`;
  params.push(cursorCreatedAt, cursorCreatedAt, cursorId);
  await p.query(sql, params);
  ```
- Không có bất kỳ đoạn mã nào nối chuỗi trực tiếp (`string concatenation`) dữ liệu đầu vào của người dùng vào câu lệnh SQL.

#### 2.3. Tính Toàn Vẹn Giao Dịch & Trạng Thái Hàng Đợi (StateStore Dual Sync)
- Mô hình lưu trữ `StateStore` đảm bảo khi MySQL Workbench đang hoạt động, mọi cập nhật trạng thái đơn hàng (`buff_queue`, `buff_monitors`) đều được ghi vào MySQL trước, đồng thời ghi bất đồng bộ ra bộ đệm an toàn.
- Nếu xảy ra sự cố mất điện hoặc crash máy chủ, khi khởi động lại, hệ thống sẽ nạp lại trạng thái từ bảng `app_state` trong MySQL và tự động đưa các tác vụ đang chạy dở dang về hàng đợi chờ xử lý tiếp, không làm mất mát dữ liệu của khách hàng.

#### 2.4. Đạo Đức Vận Hành Tự Động Hoá & Bảo Vệ Tài Khoản
- Hệ thống áp dụng triết lý bảo vệ tài nguyên (Safe Automation):
  - Khi một Fanpage gặp cảnh báo giới hạn (Action Block) hoặc Via bị yêu cầu xác thực lại (Checkpoint), hệ thống tuyệt đối không thực hiện các hành vi gian lận (như cố tình bypass, can thiệp mã độc vào session, hoặc spam request dồn dập).
  - Thay vào đó, hệ thống lập tức dừng thao tác trên tài khoản đó, kích hoạt thời gian hạ nhiệt (cooldown) và báo cáo minh bạch cho người dùng qua giao diện và Telegram.

---

### 3. KẾT LUẬN KIỂM TOÁN AN TOÀN

Hệ thống BUFF LIKE 3.1 đáp ứng xuất sắc các tiêu chuẩn bảo mật cho ứng dụng web hiện đại. Không phát hiện bất kỳ lỗ hổng bảo mật nghiêm trọng (Critical/High Severity) nào trong mã nguồn và cơ chế lưu trữ.
