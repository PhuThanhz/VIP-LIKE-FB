# KIẾN TRÚC HỆ THỐNG BUFF LIKE 3.0 ENTERPRISE (ARCHITECTURE V3)
## DỰ ÁN: VIPLIKE RADIANT

---

### 1. SƠ ĐỒ TỔNG THỂ KIẾN TRÚC HỆ THỐNG (SYSTEM OVERVIEW)

```mermaid
flowchart TD
    Client["Trình duyệt Client (React 19 + Vite)"]
    SSE["SSE Live Stream (HTTP/1.1 chunked)"]
    REST["RESTful API (JSON JWT)"]
    TelemetryMod["System Telemetry Modal"]
    
    SubGraph_Backend["Node.js Express Backend Engine (Port 3100)"]
    AuthMid["JWT Auth Middleware & License Guard"]
    TeleMid["Telemetry Middleware (Sliding Window & Event Loop Lag)"]
    LaneManager["Lane Concurrency Engine (Lease Lock & Watchdog)"]
    QueueWorker["Priority Queue Worker (Exponential Backoff & DLQ)"]
    PlaywrightPool["Playwright Browser Automation Pool"]
    StateStore["StateStore (In-Memory + Dual Sync)"]
    
    SubGraph_Storage["Lớp Lưu trữ Bền vững (Persistence Layer)"]
    MySQL["MySQL Workbench 8.0 (viplike_radiant)"]
    JSONFallback["Data JSON Fallback Storage"]

    Client -->|Xác thực JWT| REST
    Client -->|Theo dõi tiến trình trực tiếp| SSE
    Client -->|Giám sát hiệu năng| TelemetryMod
    
    REST --> AuthMid
    SSE --> AuthMid
    AuthMid --> TeleMid
    TeleMid --> LaneManager
    
    LaneManager -->|Cấp quyền truy cập Via| PlaywrightPool
    QueueWorker -->|Lấy tác vụ theo độ ưu tiên| LaneManager
    
    LaneManager --> StateStore
    PlaywrightPool --> StateStore
    
    StateStore -->|Nguồn chính / Covering Indexes| MySQL
    StateStore -.->|Dự phòng khi mất kết nối| JSONFallback
```

---

### 2. CƠ CHẾ KHOÁ LÀN ĐỒNG THỜI & CHỐNG BẾ TẮC (CONCURRENCY & LEASE LOCKING)

Mỗi Via Facebook chỉ được phép phục vụ một tác vụ tương tác tại một thời điểm để đảm bảo an toàn tài khoản và tránh bị nền tảng phát hiện hành vi bất thường.

```mermaid
sequenceDiagram
    autonumber
    actor Task as Tác vụ Buff (Queue / Stream)
    participant LM as Lane Manager (withBuffLane)
    participant Watchdog as Deadlock Watchdog Timer
    participant PW as Playwright Automation Session
    participant DB as MySQL Database

    Task->>LM: Yêu cầu truy cập làn cho Via UID
    alt Via đang rảnh (busyBuffLanes không chứa UID)
        LM->>LM: busyBuffLanes.add(UID)
        LM->>Watchdog: Kích hoạt Lease Timer (8 phút)
        LM-->>Task: Cấp quyền chạy ngay
    else Via đang bận
        LM->>LM: Đưa vào hàng chờ (buffLaneWaiters)
        LM->>Watchdog: Kích hoạt Waiter Timeout (60 giây)
        Note over LM: Chờ Via trước đó giải phóng...
    end

    Task->>PW: Thực thi chuỗi tương tác (In-Page Identity Switch)
    PW->>DB: Ghi nhận lịch sử thành công (Covering Index)
    
    alt Tác vụ hoàn thành bình thường
        Task->>LM: Gọi khối finally / release()
        LM->>Watchdog: Huỷ bỏ Lease Timer
        LM->>LM: busyBuffLanes.delete(UID)
        LM->>LM: Đánh thức waiter tiếp theo trong hàng chờ
    else Playwright bị crash đột ngột
        Watchdog-->>LM: Hết hạn 8 phút (Lease Timeout Fired)
        LM->>LM: Tự động thu hồi làn (busyBuffLanes.delete)
        LM->>LM: Báo động Telegram & giải phóng cho waiter tiếp theo
    end
```

---

### 3. MÁY TRẠNG THÁI TÁC VỤ HÀNG ĐỢI & XỬ LÝ LỖI (QUEUE & FAULT-TOLERANCE STATE MACHINE)

```mermaid
stateDiagram-v2
    [*] --> QUEUED: Người dùng tạo đơn hàng
    QUEUED --> RUNNING: Đến giờ chạy & có slot trống
    
    state RUNNING {
        [*] --> ExecutingLike
        ExecutingLike --> InPageSwitch
        InPageSwitch --> ExecutingLike: Tiếp tục page tiếp theo
    }

    RUNNING --> COMPLETED: Đạt 100% KPI mục tiêu
    RUNNING --> PARTIAL: Hết Page khả dụng nhưng chưa đủ KPI
    RUNNING --> RETRY_DELAY: Gặp lỗi mạng hoặc rate-limit tạm thời
    
    RETRY_DELAY --> QUEUED: Hết thời gian chờ Exponential Backoff (2^n x 30s)
    RETRY_DELAY --> DEAD_LETTER: Thất bại liên tiếp quá 3 lần
    
    RUNNING --> DEAD_LETTER: Tài khoản bị Checkpoint / Sai mật khẩu
    
    PARTIAL --> QUEUED: Người dùng bấm 'Bù like' (1-Click Batch Refill)
    COMPLETED --> [*]
    DEAD_LETTER --> [*]
```

---

### 4. ĐỘC LẬP TÀI NGUYÊN & GIÁM SÁT THỜI GIAN THỰC (TELEMETRY ENGINE)

TelemetryEngine hoạt động độc lập bên trong tiến trình Node.js:
- **Event Loop Monitor**: Sử dụng `perf_hooks.monitorEventLoopDelay({ resolution: 20 })` để theo dõi độ trễ của microtask queue ở cấp độ nano-giây.
- **Sliding Window**: Duy trì cửa sổ trượt 1,000 mẫu gần nhất để tính toán các chỉ số phân vị P50, P95, P99 mà không làm tăng tải RAM.
- **Health & Readiness Probes**: Cung cấp các điểm cuối chuẩn hoá `/api/health` và `/api/readiness` phục vụ kiểm tra sức khoẻ tự động trong các môi trường triển khai container hoá.
