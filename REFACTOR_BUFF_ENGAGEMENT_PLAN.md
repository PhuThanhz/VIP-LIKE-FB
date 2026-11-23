# Kế hoạch tách `BuffEngagement.tsx`

## Trạng thái (23/11/2026)
Đã xong trên nhánh `refactor/buff-engagement-split`: file giảm từ 8.959 xuống 5.108 dòng.

| GĐ | Nội dung | Commit |
|---|---|---|
| 0 | Hàm tiện ích, hằng số, type, `PageCardItem` sang `features/buff/` | `601e767` |
| 1a | `MonitorFormModal`, `ViaHealthModal`, `LogDetailModal` | `892587b` |
| 1b | `ManagePagesModal` | `0a1ec47` |
| 2 | Hook polling: `useBuffQueue`, `useBuffMonitors`, `useBmOverview`, `useSystemSettings` | `32afc8f` |
| 3 | `HistoryTab` | `aba8a10` |
| 4a | `RunningTab`, kèm đồng hồ 1 giây (giờ chỉ tab này render lại mỗi giây) | `71f6817` |
| 4b | `ResumeBuffModal`, `AiSeedingModal` | `8f3b98b` |
| 5a | Toàn bộ state/effect/handler sang `useBuffEngagementController`; `BuffController = ReturnType<...>` | `acfb883` |
| 5b | `CreateBuffTab` (đọc `BuffController`) | `f71f1fb` |
| 5c | Controller tách tiếp thành `useAccountsAndPages`, `useSingleRunner`, `useBatchRunner` (kiểu `Deps` do TS checker sinh) | `ac485a7` |

**Kết quả:** `pages/BuffEngagement.tsx` còn 672 dòng (từ 8.959) và chỉ lo phần giao diện. Không file nào trong `features/buff/` dài quá khoảng 1.800 dòng.

**Cần chạy buff thật để kiểm chứng trước khi merge** (khi refactor chỉ test được những thao tác không chạy):
- chạy 1 link, ngắn (khoảng 5 Page)
- dừng giữa chừng
- F5 khi đang chạy, rồi xem phiên có được khôi phục không
- chạy batch 2 link
- chạy tiếp / bù like
- thêm vào hàng đợi

**Việc có thể làm sau:**
- Phần state vẫn nằm chung trong controller, nên gõ vào form vẫn làm render lại cả trang.
- Muốn tách render thật sự thì phải cho từng hook con tự giữ state của nó. Việc này là thiết kế lại, không còn là di chuyển code.

## Vì sao tách
`frontend/src/pages/BuffEngagement.tsx` dài khoảng 8.960 dòng và có 127 `useState`, tất cả nằm trong một component. Hệ quả:
- **Render thừa:** bất kỳ state nào đổi (gõ một ký tự trong form, tiến độ stream, đồng hồ 1 giây) cũng làm cả cây render lại, kể cả những tab đang không hiện.
- **Khó sửa an toàn:** state của form, hàng đợi, Post Hunter và stream buff trộn lẫn nhau. Lỗi vòng lặp gọi `/api/buff-queue/list` vừa sửa là ví dụ điển hình.
- **Khó đọc:** mỗi lần cần sửa gì đều phải tìm trong gần 9.000 dòng.

## Cấu trúc hiện tại (vị trí dòng tham khảo)
| Vùng | Dòng | Ghi chú |
|---|---|---|
| Hàm tiện ích, hằng số, type, `PageCardItem` | 1–790 | Thuần, không phụ thuộc state |
| State và handler | 791–4000 | Fanpage/Via, stream buff, hàng đợi, Post Hunter, AI seeding, lịch sử, batch |
| Tab `buff-like` (form tạo mới) | 4191–5831 | ~1.640 dòng |
| Tab `buff-running` (tiến độ) | 5832–7285 | ~1.450 dòng, dùng `clockNow` |
| Tab `buff-history` | 7334–7723 | ~390 dòng |
| Tab queue, hunter, via, settings, license | | Đã tách thành component lazy |
| 6 modal | 7805–8960 | Log chi tiết, quản lý i_user, AI Seeding, mục tiêu Post Hunter, sức khoẻ Via, chạy tiếp/bù like |

Thư mục đích: `frontend/src/features/buff/` (gồm `components/`, `hooks/`, `utils.ts`, `constants.ts`, `types.ts`).

## Nguyên tắc
- **Chỉ di chuyển code:** mỗi giai đoạn chỉ chuyển code đi chỗ khác, không sửa logic và không đổi giao diện. Lỗi nào phát hiện trong lúc tách thì ghi lại và sửa ở một commit riêng.
- **Mỗi giai đoạn một commit:** app phải chạy được sau từng commit.
- **Kiểm tra sau mỗi giai đoạn:**
  - `npx tsc --noEmit` và `npm run build`.
  - Tự bấm thử đúng tab hoặc modal vừa tách.
- **Trước khi bắt đầu:** commit các thay đổi giao diện đang dở, để diff refactor sạch.

## Các giai đoạn (thứ tự từ ít rủi ro đến nhiều rủi ro)

### GĐ 0: Code thuần, không có state (~700 dòng)
- Chuyển các hàm và hằng số tiện ích:
  - Xử lý URL và ID: `normalizeFbPostUrlClient`, `isFacebookPostUrl`, `extractPageId`, `extractCUser`.
  - Spintax và preset bình luận: `resolveSpintax`, `SEEDING_NICHE_PRESETS`.
  - Reaction và tốc độ: `REACTIONS`, `SPEED_PRESETS`, `getSpeedLabel`.
  - Lưu trữ Fanpage: `getStoredPagesForVia` và `saveStoredPagesForVia`.
  - Lịch sử và nhóm theo Via: `mergeBuffLogs`, `groupPagesByVia`.
- Chuyển các type `BuffMonitor`, `BatchOrder`, `BuffLogEntry` sang `types.ts`.
- Chuyển `PageCardItem` sang `components/PageCardItem.tsx`.
- Tuỳ chọn: thêm vitest với vài test cho `normalizeFbPostUrlClient` và `resolveSpintax`.

### GĐ 1: Các modal tự quản lý state của mình
- **`MonitorFormModal`:** chuyển 17 state `mon*`, `handleSaveMonitor` và `handleTestSpintaxInForm` vào trong modal. Component cha chỉ truyền `open`, `editing`, `onSaved`.
- **`ViaHealthModal`, `LogDetailModal`:** chỉ hiển thị, nhận dữ liệu qua props.
- **`ResumeBuffModal`, `ManagePagesModal`, `AiSeedingModal`:** tách sau cùng trong nhóm này vì đụng nhiều state chung.
- **Lợi ích:** gõ trong form modal không còn làm render lại cả trang.

### GĐ 2: Hook dữ liệu (polling)
- `useBuffQueue()`: trả về `queueItems` và `refresh`, polling bằng `useVisibleInterval`.
- `useBuffMonitors()`: trả về `monitors`, `postHunterPaused` và các hành động toggle/delete/scan.
- `useBmOverview()` và `useSystemSettings()`.
- **Lợi ích:** logic polling nằm một chỗ, không lặp lại lỗi vòng lặp effect.

### GĐ 3: Tab Lịch sử
- Tạo `HistoryTab` và chuyển vào đó state lịch sử (dòng ~1861–1996), xuất CSV và modal Log chi tiết.

### GĐ 4: Bộ chạy buff và hai tab lớn (rủi ro cao nhất)
- **`useBuffRunner()`:** nắm stream SSE (dòng ~2911–3383), `autoBuffProgress`, `runTiming`, batch và dừng/chạy tiếp. Dùng chung qua `BuffRunContext`.
- **`RunningTab`:**
  - Đọc dữ liệu từ context.
  - Sở hữu đồng hồ `clockNow`, nên chỉ riêng tab này render mỗi giây (giải quyết luôn điểm 3 lần trước).
- **`CreateBuffTab`:**
  - Form link, reaction, bình luận, chọn Fanpage.
  - State chọn Fanpage và Via chuyển vào `useFanpageSelection()`.
- **Kiểm tra kỹ:**
  - Chạy thật một lượt buff ngắn.
  - Dừng giữa chừng.
  - F5 rồi khôi phục phiên đang chạy.
  - Chạy batch nhiều bài.
  - Chạy tiếp/bù like.

## Kết quả mong đợi
- `BuffEngagement.tsx` còn khoảng dưới 800 dòng: chỉ điều phối tab, banner và context.
- Mỗi file mới dưới khoảng 1.000 dòng, trách nhiệm rõ ràng.
- Gõ trong form, đồng hồ hay tiến độ stream chỉ làm render lại phần liên quan.

## Ước lượng
| GĐ | Rủi ro | Khối lượng |
|---|---|---|
| 0 | Rất thấp | Nhỏ |
| 1 | Thấp | Vừa |
| 2 | Thấp | Nhỏ |
| 3 | Thấp | Nhỏ |
| 4 | Cao | Lớn, nên chia nhỏ thành 2–3 commit |
