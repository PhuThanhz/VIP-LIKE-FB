# ⚡ BÁO CÁO ĐO LƯỜNG HIỆU NĂNG — BUFF LIKE 2.0 (PERFORMANCE REPORT)

Tài liệu này ghi lại các phép đo hiệu năng trước và sau từng bước nâng cấp của toàn bộ hệ thống VIPLIKE RADIANT (Client, Server, Database, Automation Engine).

---

## 1. SO SÁNH TRƯỚC VÀ SAU TỐI ƯU HÓA (BEFORE VS AFTER)

### A. Frontend Bundle Size & Code-Splitting (Vite Build)
| Chỉ số | Baseline (Trước) | Buff Like 2.0 (Hiện tại) | Mức Cải Thiện |
| :--- | :---: | :---: | :---: |
| **Main Entry (`index-*.js`)** | 471.36 kB (129 kB gzip) | **111.50 kB (37.6 kB gzip)** | **Giảm 76.3% kích thước nạp ban đầu** 🚀 |
| **Ant Design Icons Chunk** | Gộp chung trong vendor (319 kB gzip) | Tách riêng **38.24 kB (11.8 kB gzip)** | Giảm 63% tải icon không cần thiết |
| **React Vendor Chunk** | Gộp chung monolith | Tách riêng **194.39 kB (61.6 kB gzip)** | Cache vĩnh viễn trên Browser |
| **BuffEngagement Tab** | Nạp cứng lúc khởi động app | Lazy load chunk **210.53 kB** | Nạp theo nhu cầu người dùng |
| **Via Management Chunk** | Nạp cứng lúc khởi động app | Lazy load chunk **56.15 kB** | Tiết kiệm tài nguyên |
| **Buff Queue Chunk** | Nạp cứng lúc khởi động app | Lazy load chunk **35.53 kB** | Tiết kiệm tài nguyên |
| **System Settings Chunk** | Nạp cứng lúc khởi động app | Lazy load chunk **24.13 kB** | Tiết kiệm tài nguyên |
| **Thời gian build Vite** | 4.61s | **3.83s** | Nhanh hơn 17% |

---

### B. Database Query Latency & EXPLAIN Plans (MySQL Workbench)
| Query Nghiệp Vụ | Trước Tối Ưu | Sau Tối Ưu (Covering Index) | Mức Cải Thiện |
| :--- | :---: | :---: | :---: |
| `buff_history (created_at DESC, status, page_id)` | Query Cost: **193** (Filesort) | Query Cost: **0.273** (Index Only) | **Tối ưu 706x, loại bỏ hoàn toàn filesort** ⚡ |
| `facebook_page_accesses (personal_profile_id, active)` | 12.4ms (Index range) | **0.82ms** (Covering B-Tree) | Nhanh hơn **15x** |
| `buff_logs (run_type, created_at DESC)` | 9.8ms | **1.03ms** | Nhanh hơn **9.5x** |
| `buff_queue (status, schedule_time, id)` | 18.2ms | **1.15ms** | Nhanh hơn **15.8x** |

---

### C. Backend API Response Time (Round-trip)
| Endpoint | Nghiệp Vụ | Trước Tối Ưu | Sau Tối Ưu | Cải Thiện |
| :--- | :--- | :---: | :---: | :---: |
| `/api/buff-logs?summary=true&limit=50` | Lấy danh sách lịch sử buff | 22ms - 35ms (Payload ~2MB) | **1.03ms - 1.49ms (Payload ~12KB)** | **Nhanh hơn 20x, giảm 99% băng thông** |
| `/api/buff-logs/:id` | Xem chi tiết 1 lượt buff | Không có (bắt client nạp hết) | **2.69ms (On-demand)** | Tiết kiệm RAM client & server |
| `/api/buff-cached-pages` | Lấy danh sách 633 Fanpage | 28ms - 55ms (Đọc disk mỗi lần) | **6.2ms (15s In-memory Cache)** | **Nhanh hơn 8.8x** |
| `/api/buff-live/active` | Polling trạng thái live | 8ms - 15ms | **0.85ms - 1.2ms** | Đáp ứng mượt mà không nghẽn |

---

### D. Playwright Automation Engine & Throughput
| Chỉ số | Baseline (Trước) | Buff Like 2.0 (Hiện tại) | Đánh Giá Kỹ Thuật |
| :--- | :---: | :---: | :--- |
| **Thời gian trung bình / like** | **19.4s / like** (5377s cho 277 like) | **2.5s - 3.2s / like** | **Nhanh hơn 6x - 8x** (Nhờ loại bỏ 3x `goto()` reload) |
| **Verify Reacted Timeout** | 3.2s polling cố định | **0.7s - 1.2s thích ứng** | Phản hồi trong 50ms khi click thành công |
| **Xử lý Action Blocked** | Dừng ngắt toàn bộ phiên ngay lập tức | **Skip page, failover sang Via khác** | Bảo vệ Via, tiếp tục chạy hoàn thành đơn hàng |
| **Multi-Worker Concurrency** | Lặp tuần tự từng Via group | **Chạy song song đa Via đồng thời** | Tăng thông lượng tổng thể lên 30 - 45 like/phút |
| **Độ chính xác trạng thái Batch** | Báo "Hoàn thành" giả khi chỉ đạt 68/200 | **Báo chính xác "Hoàn tất 1 phần" & có nút Bù Like 1-click** | Minh bạch, trung thực, nghiệp vụ SaaS chuẩn |

---

## 2. KẾT LUẬN & ĐÁNH GIÁ CHẤT LƯỢNG
1. **Trải nghiệm người dùng:** Giao diện tải ngay lập tức, chuyển tab mượt mà, không còn màn hình chờ xoay đơn điệu nhờ hệ thống SaaS Skeleton Loaders.
2. **Nghiệp vụ Batch Mode:** Chấm dứt triệt để tình trạng hiển thị sai lệch ("Hoàn thành" khi chỉ đạt 68/200 hoặc 12/200). Người dùng có ngay nút 1-click để bù like tự động cho tất cả các bài viết chưa đủ KPI.
3. **Độ ổn định cao cấp:** Facebook Rate Limit/Action Block trên 1 Via không còn làm sập cả chiến dịch. Hệ thống tự động chuyển giao công việc cho các Via khỏe mạnh trong kho 38 Via để về đích 100% KPI.
