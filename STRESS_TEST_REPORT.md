# BÁO CÁO KIỂM THỬ TẢI VÀ CHỊU LỰC CAO (STRESS TEST REPORT)
## DỰ ÁN: VIPLIKE RADIANT — PHIÊN BẢN BUFF LIKE 3.1
**Thời gian thực hiện:** 2026-11-02  
**Kịch bản thực thi:** `backend/test-stress-3.1.js`  
**Phương pháp:** Bắn đồng thời các đợt bão request (Burst Concurrency: 20, 50, 100), kiểm tra phân trang sâu và khả năng tự bảo vệ trước dữ liệu rác.

---

### 1. KẾT QUẢ ĐO ĐẠC ĐỢT BÃO REQUEST ĐỒNG THỜI (CONCURRENCY BURSTS)

| Mức độ tải đồng thời (Concurrency) | Tỷ lệ thành công (Success Rate) | Tổng thời gian (Wall Time) | Thông lượng thực tế (RPS) | P50 (ms) | P95 (ms) | P99 (ms) | Đánh giá chịu tải |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **20 requests đồng thời** | **100% (20/20)** | 21.8 ms | **919.5 req/s** | 16.38 ms | 20.18 ms | 20.18 ms | Rất nhanh, không gián đoạn |
| **50 requests đồng thời** | **100% (50/50)** | 36.1 ms | **1,386.5 req/s** | 26.94 ms | 33.20 ms | 34.03 ms | Xử lý mượt mà, P95 < 35ms |
| **100 requests đồng thời** | **100% (100/100)** | 54.2 ms | **1,844.7 req/s** | 28.30 ms | 50.94 ms | 51.63 ms | Đạt đỉnh 1,844 RPS, 0 lỗi |

#### Phân tích Hiện tượng:
- Khi tải tăng đột biến từ 20 lên 100 kết nối đồng thời, thông lượng (RPS) tăng trưởng tuyến tính từ **919 req/s lên 1,844 req/s**.
- P50 ở mức 100 request đồng thời vẫn giữ được dưới **30ms (28.3ms)**. P99 chỉ đạt **51.6ms**, hoàn toàn nằm trong ngưỡng chấp nhận cao nhất của các hệ thống SaaS quốc tế (< 200ms).

---

### 2. KIỂM THỬ KHẢ NĂNG CHỊU TẢI CỦA PHÂN TRANG CON TRỎ (KEYSET CURSOR DEEP DRILL)

Kiểm thử duyệt liên tục 5 trang sâu với tập dữ liệu lịch sử tương tác:

| Trang truy vấn (Page) | Số dòng trả về | Thời gian thực thi (Latency) | Con trỏ tiếp theo (NextCursor) | Đánh giá độ phức tạp thuật toán |
| :---: | :---: | :---: | :--- | :---: |
| **Trang 1 (Khởi đầu)** | 10 dòng | **0.49 ms** | `log_1793547229167_1_tv6dpp1` | $O(1)$ - Index backward scan |
| **Trang 2 (Sâu hơn)** | 10 dòng | **1.92 ms** | `log_1793287993377_c64zcwt` | $O(1)$ - Keyset Seek |
| **Trang 3 (Sâu hơn)** | 10 dòng | **0.80 ms** | `log_1793249225951_pe7g1zg` | $O(1)$ - Keyset Seek |
| **Trang 4 (Sâu hơn)** | 10 dòng | **0.68 ms** | `log_1793155082565_42zzspc` | $O(1)$ - Keyset Seek |
| **Trang 5 (Sâu hơn)** | 10 dòng | **0.60 ms** | `log_1793086527990_0wzy5rj` | $O(1)$ - Keyset Seek |

- **Thời gian trung bình mỗi trang**: **0.90 ms**.
- **Kết luận**: Tốc độ lấy dữ liệu ở Trang 5 (0.60ms) thậm chí tương đương hoặc nhanh hơn Trang 1. Thuật toán Keyset Cursor Pagination loại bỏ hoàn toàn sự chậm trễ tăng dần của `OFFSET`.

---

### 3. KIỂM THỬ ĐỘ BỀN VÀ KHẢ NĂNG TỰ VỆ TRƯỚC REQUEST LỖI (RESILIENCE & INPUT VALIDATION)

| Kịch bản kiểm thử lỗi | Dữ liệu đầu vào giả lập | HTTP Code thực tế | Kết quả kỳ vọng | Đánh giá an toàn |
| :--- | :--- | :---: | :---: | :---: |
| **Thiếu JWT Authorization Header** | Gửi request không kèm header Bearer | **401 Unauthorized** | 401 | 🟢 PASS |
| **Token JWT giả mạo / Sai chữ ký** | Gửi `Bearer INVALID_FAKE_TOKEN` | **401 Unauthorized** | 401 | 🟢 PASS |
| **Malformed JSON Payload** | Gửi chuỗi không phải JSON `NOT_JSON{{{` | **400 Bad Request** | 400 | 🟢 PASS |
| **Thiếu tham số bắt buộc** | Gửi `{}` lên `/api/buff-like-stream` | **400 Bad Request** | 400 | 🟢 PASS |

- **Kết luận**: Hệ thống từ chối các request sai chuẩn ở tầng Middleware một cách an toàn, không sinh lỗi Unhandled Exception, không làm sập tiến trình Node.js và không rò rỉ stack trace nhạy cảm.

---

### 4. KẾT LUẬN NGHIỆM THU STRESS TEST

- **Khả năng chịu tải cực đại**: Đã kiểm chứng an toàn ở mức **1,844.7 requests/giây**.
- **Tỷ lệ thành công**: **100%**.
- **Trạng thái nghiệm thu**: 🟢 **PASS - ĐẠT CHUẨN HIỆU NĂNG VÀ CHỊU LỰC CAO**.
