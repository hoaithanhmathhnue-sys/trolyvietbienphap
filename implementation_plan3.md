## Lập Kế Hoạch 2: Xử lý Lỗi Export DOCX chứa Lệnh AI

Dựa trên yêu cầu: *"mục Xuất file word thì file tải về sẽ không có các phần lệnh như ảnh nữa"*

### Vấn Đề Hiện Tại
Khi xuất DOCX, thư viện `docxExporter` lấy toàn bộ nội dung trong `state.fullDocument`. Tuy nhiên tài liệu này đang chứa các đoạn text giao tiếp của AI (được sinh ra theo lệnh prompt như `MENU NAVIGATION` hay các checkbox xác nhận `Đồng ý nội dung Phần 1 này?`).

### Kế Hoạch Đề Xuất (Option)
Xây dựng hàm [cleanMarkdownForExport(markdown: string)](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/docxExporter.ts#268-310) bên trong [services/docxExporter.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/docxExporter.ts). Hàm này sẽ sử dụng Regex để quét và loại bỏ:
1. Các dòng chứa `MENU NAVIGATION` (và các dòng liên đới).
2. Các dòng/khung xác nhận dạng `✅ Đồng ý nội dung` hoặc `Bạn có thể CHỈNH SỬA`.
3. Toàn bộ các dòng lệnh điều hướng thừa thãi.

Hàm [exportMarkdownToDocx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/docxExporter.ts#311-381) sẽ gọi [cleanMarkdownForExport](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/docxExporter.ts#268-310) trước khi ném nội dung vào [parseMarkdown](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/docxExporter.ts#64-153).

## User Review Required
> [!IMPORTANT]
> Phương án dùng Regex để dọn dẹp các lệnh AI (`MENU NAVIGATION`, hộp thoại đồng ý) trước khi xuất Word là cách tốt nhất lúc này. Bạn thấy cách tiếp cận này đã ổn chưa? Vui lòng xác nhận để tôi bắt đầu viết mã Regex lọc nội dung.

---
## Kế hoạch 3: Loại bỏ tính năng Review tất cả các giải pháp
Theo yêu cầu mới nhất, chúng ta cần gỡ bỏ quy trình phải "Duyệt" (Review) từng giải pháp/phần bằng popup modal `SolutionReviewModal`.
**Hoạt động:**
1. Trong [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx), thay đổi logic state machine `nextStepMap`:
   - `BP1` sẽ nối thẳng sang `BP2` (thay vì `BP1_REVIEW` tiếp đó) với prompt kế tiếp được gộp hoặc gọi luôn.
   - Các `BP*_REVIEW`, `TINH_MOI_REVIEW`, `PHAM_VI_REVIEW` sẽ bị bỏ qua trong luồng. 
   - Hoặc đơn giản là chuyển prompt của các bước `REVIEW` vào chính bước `BP*` trước đó... À không, để AI viết tự nhiên: 
     - Bước `PART_1` -> `PART_2`
     - Bước `PART_2` -> Prompt sinh GP1, nextStep: `BP2` (đang gọi prompt GP2)
     - Khá phức tạp do luồng cũ tách `BP1` thành: Viết GP1 (trạng thái PART_2, next: BP1), sau đó BP1 (chỉ hiện thông báo hoàn thành), BP1_REVIEW (viết GP2).
2. Tối ưu: Xóa hẳn các trạng thái `*_REVIEW` trong [types.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/types.ts), [constants.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/constants.ts) và gỡ bỏ `SolutionReviewModal` trong UI. Xóa các hàm [handleApproveSolution](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx#1740-1770), [handleReviseSolution](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx#1771-1822).

> [!WARNING]
> Việc gỡ bỏ này sẽ thay đổi lớn tới state machine `GenerationStep`. Tôi sẽ bắt đầu code đổi cấu trúc luồng tuần tự luôn.
