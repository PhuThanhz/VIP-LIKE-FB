# 📢 CHANGELOG — VIPLIKE RADIANT 2.0

Tất cả các thay đổi đáng chú ý của dự án sẽ được ghi nhận tại đây theo chuẩn Keep a Changelog.

---

## [2.0.0-evolution] - 2026-11-02

### Added
- **Multi-Via Concurrent Engine**: Chạy song song nhiều tài khoản Via mẹ đồng thời trên các browser context độc lập với isolation User-Agent và fingerprint phần cứng.
- **In-Page Fast-Switch & i_user Soft Reload**: Tối ưu đổi danh tính trực tiếp tại chỗ trên bài viết, triệt tiêu 3 lần reload toàn trang (`goto()`), rút ngắn thời gian tương tác từ **19.4s xuống ~2.5s - 3s/like** (tăng tốc 6x - 8x).
- **Intelligent Action Block Failover**: Khi 1 Fanpage/Via gặp giới hạn thao tác của Facebook, hệ thống chỉ bỏ qua page đó và tự động chuyển giao công việc cho các Via khỏe mạnh trong kho 38 Via để đạt đủ 100% KPI mục tiêu.
- **Honest Batch Status Machine**: Bổ sung trạng thái `PARTIAL` (`Đạt X/Y like`). Chỉ gắn nhãn xanh `Hoàn thành 100%` khi số like thực tế $\ge$ KPI mục tiêu.
- **1-Click Batch Refill**: Nút bấm **🚀 Bù like tự động cho toàn bộ bài còn thiếu trong Batch** giúp người dùng hoàn tất số like còn thiếu chỉ bằng 1 click.
- **Adaptive Reaction Verification**: Rút ngắn thời gian xác nhận like từ 3.2s xuống 0.7s - 1.2s, polling phản hồi tức thì mỗi 50ms.
- **SaaS 2.0 Animated Skeletons**: Thay thế toàn bộ spinner đơn điệu bằng `CardSkeleton`, `TableSkeleton`, `PageSkeleton`.
- **Smart Link Auto-Detector**: Tự động nhận diện định dạng link Facebook (Reel, Group, Video, Post cá nhân, Fanpage).
- **Covering Database Indexes**: Bổ sung 4 indexes chuyên biệt trong MySQL `viplike_radiant`, giảm chi phí truy vấn từ 193 xuống 0.273 (**706x faster**).
- **On-Demand Log Detail Fetching**: Endpoint `GET /api/buff-logs/:id` nạp chi tiết theo yêu cầu, giảm payload API lịch sử từ 2MB xuống 12KB.

### Fixed
- Sửa lỗi hiển thị "Hoàn thành" sai lệch trên các bài viết chỉ đạt một phần like (68/200, 12/200).
- Sửa lỗi 4 thẻ KPI thống kê hiển thị sai "Tổng số nick 200" và "Thành công 3" trong chế độ Batch.
- Sửa lỗi Action Block trên 1 page làm dừng ngắt toàn bộ chiến dịch trong Multi-Worker Engine.
- Sửa lỗi xung đột phiên live (`activeLiveBuffSession`) khi nhiều đơn hàng chạy song song bằng `activeLiveBuffSessions` Map.
- Sửa lỗi đọc đĩa đồng bộ (`fs.readFileSync`) trên mỗi request `/api/buff-cached-pages` bằng in-memory cache 15s.
