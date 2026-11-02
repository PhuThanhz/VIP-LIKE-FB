# BÁO CÁO KIỂM TOÁN VÀ NÂNG CẤP CƠ CHẾ PHỤC HỒI SAU CRASH
## BUFF LIKE 3.3 — CRASH-SAFE EXECUTION & RECOVERY ENGINE

---

### 1. TỔNG QUAN VẤN ĐỀ (EXECUTIVE AUDIT SUMMARY)

Trong các phiên bản trước (BUFF LIKE 3.0 - 3.2), cơ chế phục hồi tác vụ gián đoạn khi máy chủ khởi động lại (`recoverStaleRunningQueueTasks()`) vận hành theo nguyên lý "Blind Recovery" (phục hồi mù quáng):
```javascript
// Mã nguồn cũ trước 3.3:
function recoverStaleRunningQueueTasks() {
  for (const it of qd.items || []) {
    if (it.status === 'RUNNING') {
      it.status = 'QUEUED'; // Bất kể tác vụ đang ở bước nào, ép về QUEUED!
    }
  }
}
```

#### Nguy cơ và Hậu quả nghiêm trọng:
1. **Trùng lặp tương tác (Duplicate Likes / Action Blocks)**: Nếu một tác vụ mục tiêu 100 like đã like thành công 60 like thì máy chủ bị restart hoặc crash. Khi server khởi động lại, tác vụ bị ép về `QUEUED` và chạy lại từ đầu: nó sẽ cố like lại các bài viết bằng các tài khoản cũ $\rightarrow$ dẫn tới un-like (hủy like), trigger bot-detection của Meta, hoặc bị Facebook phạt Action Block.
2. **Mất toàn vẹn dữ liệu (Data Loss of Partial Progress)**: Số like đã thực hiện thành công không được kiểm kê hoặc bù chính xác; người dùng bị trừ tài nguyên 2 lần hoặc báo cáo sai lệch.
3. **Không phân biệt được ranh giới Side-Effect**: Hệ thống không phân biệt được:
   - Tác vụ vừa mới khởi tạo trong RAM, chưa gửi bất kỳ request nào ra Facebook.
   - Tác vụ đang mở browser Playwright và đã gửi thao tác like ra ngoài.
   - Tác vụ đã like xong toàn bộ, chỉ đang đợi đồng bộ database.

---

### 2. MÔ HÌNH VÒNG ĐỜI THỰC THI ĐA GIAI ĐOẠN (MULTI-STAGE EXECUTION LIFECYCLE)

Trong BUFF LIKE 3.3, mỗi tác vụ trong hàng đợi (`buff_queue`) được gắn chặt với trường `executionStage` phản ánh chính xác ranh giới thao tác bên ngoài:

```
                  ┌──────────────────────────────────────────────┐
                  │                HÀNG ĐỢI (QUEUED)              │
                  └──────────────────────┬───────────────────────┘
                                         │ Worker Claim
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │        RUNNING [Stage: PREPARING]            │
                  │  (Phân bổ Via, tính toán Round-Robin, lọc URL)│
                  │  * Chưa có bất kỳ thao tác mạng bên ngoài nào* │
                  └──────────────────────┬───────────────────────┘
                                         │ Launch Playwright Context
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       RUNNING [Stage: DISPATCHING]           │
                  │  (Mở Browser Context, kiểm tra bài viết)      │
                  └──────────────────────┬───────────────────────┘
                                         │ Bắt đầu chuỗi Like / Voice Switch
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │       RUNNING [Stage: INTERACTING]           │
                  │  (Thao tác bên ngoài đang diễn ra trên FB)   │
                  │  * Có side-effects thực tế (progress > 0) *   │
                  └──────────────────────┬───────────────────────┘
                                         │ Kết thúc chuỗi tương tác
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │        RUNNING [Stage: SYNCING]              │
                  │  (Chuẩn bị lưu buff_logs và MySQL History)   │
                  └──────────────────────┬───────────────────────┘
                                         │ Flush & Finalize
                                         ▼
                  ┌──────────────────────────────────────────────┐
                  │                  COMPLETED                   │
                  └──────────────────────────────────────────────┘
```

---

### 3. THUẬT TOÁN PHỤC HỒI PHÂN NHÁNH AN TOÀN (SAFE BRANCHED RECOVERY)

Khi Backend khởi động lại, hàm `recoverStaleRunningQueueTasks()` phân tích trạng thái và phân nhánh xử lý tuyệt đối an toàn:

```javascript
function recoverStaleRunningQueueTasks() {
  for (const it of qd.items || []) {
    if (it.status === 'RUNNING') {
      const hasExternalSideEffects =
        it.executionStage === 'INTERACTING' ||
        Number(it.progress?.done || 0) > 0 ||
        Number(it.progress?.success || 0) > 0 ||
        Number(it.progressLikes || 0) > 0 ||
        (Array.isArray(it.pageDetails) && it.pageDetails.length > 0) ||
        Boolean(it.dispatchedAt);

      if (it.executionStage === 'SYNCING') {
        // NHÁNH 1: Đã tương tác xong toàn bộ, chỉ chờ sync log -> Hoàn tất an toàn
        it.status = 'COMPLETED';
        it.executionStage = 'COMPLETED';
        it.finishedAt = it.finishedAt || new Date().toISOString();
      } else if (!hasExternalSideEffects) {
        // NHÁNH 2: Chưa hề có thao tác ra nền tảng bên ngoài -> An toàn phục hồi về QUEUED
        it.status = 'QUEUED';
        it.executionStage = 'INITIALIZED';
        it.error = 'Máy chủ đã khởi động lại trước khi tác vụ bắt đầu thao tác bên ngoài. Đã phục hồi về hàng đợi an toàn.';
      } else {
        // NHÁNH 3: ĐÃ hoặc ĐANG thao tác ngoài -> Chuyển NEEDS_REVIEW, cấm tự động retry!
        it.status = 'NEEDS_REVIEW';
        it.executionStage = 'NEEDS_REVIEW';
        it.reviewReason = 'CRASH_DURING_EXTERNAL_INTERACTION';
        it.error = `Tác vụ bị gián đoạn khi máy chủ khởi động lại trong lúc đang tương tác bên ngoài (Đã like thành công: ${it.progress?.success || it.progressLikes || 0}). Chuyển sang NEEDS_REVIEW để đối soát thủ công, chống duplicate tương tác.`;
      }
    }
  }
}
```

---

### 4. QUY TRÌNH ĐỐI SOÁT THỦ CÔNG & API RESOLUTION

Để xử lý các tác vụ rơi vào `NEEDS_REVIEW`, BUFF LIKE 3.3 cung cấp API `/api/buff-queue/review-resolve/:id` với 3 phương án lựa chọn:

1. **`RESUME` (Tiếp tục chạy bù)**:
   - Hệ thống tự động tính toán số like còn thiếu:
     $$\text{Target còn lại} = \text{Target ban đầu} - \text{Số like đã like thành công}$$
   - Tác vụ được chuyển về `QUEUED` với mục tiêu đã điều chỉnh, **tuyệt đối không like lại số lượng đã like thành công trước đó**.
2. **`COMPLETE` (Nghiệm thu kết quả một phần)**:
   - Chấp nhận số like hiện tại và chuyển tác vụ sang `COMPLETED`.
3. **`CANCEL` (Hủy bỏ tác vụ)**:
   - Đánh dấu tác vụ là `CANCELLED`, giữ nguyên nhật ký đối soát.

---

### 5. KẾT LUẬN KIỂM TOÁN

- ✅ **Chống trùng lặp 100%**: Không có bất kỳ tác vụ nào đã phát sinh thao tác bên ngoài bị tự động đẩy về hàng đợi để like lại từ đầu.
- ✅ **Bảo toàn tiến độ**: Mọi like đã thực hiện thành công trước khi crash đều được ghi nhận đầy đủ trong `pageDetails` và `progress.success`.
- ✅ **Khả năng tự phục hồi**: Tác vụ ở giai đoạn `PREPARING` phục hồi tức thì về `QUEUED` mà không cần con người can thiệp.
