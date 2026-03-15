# Triển Khai Tính Năng: Khám & Chữa Bệnh (SKKN Cũ)

Tính năng cung cấp luồng công việc 2 bước:
1. **Khám bệnh:** Phân tích một file SKKN cũ, chấm điểm và chỉ ra lỗi sai.
2. **Chữa bệnh:** Sử dụng "Toa Thuốc" (kết quả khám) kết hợp với nội dung bài cũ để yêu cầu AI viết lại, cải thiện bài tự động theo chuẩn "10 Nguyên Tắc Vàng".

## User Review Required
> [!IMPORTANT]
> - Nút **"Khám & Chữa Bệnh"** sẽ nằm trên Header dưới dạng Tab (bên cạnh tab "Viết Mới").
> - Việc "Chữa bệnh" phụ thuộc lớn vào bộ prompt AI mới. Sẽ cần test thực tế chất lượng "Chữa" để tinh chỉnh.
> - Xin xác nhận tôi có thể tạo thêm state/context ở [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx) để truyền nội dung "Toa Thuốc" vào luồng [generateNextSection()](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx#1137-1627).

## Proposed Changes

### 1. Phân Tích & Chấm Điểm (geminiService.ts)

#### [MODIFY] [geminiService.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/geminiService.ts)
- Thêm API function `analyzeOldDocument(content: string)`: Hàm này gửi văn bản thô cho AI, yêu cầu trả về chuẩn JSON với cấu trúc điểm số (Tiêu chí: Tính mới, Sư phạm, Trình bày, Chống đạo văn, Điểm tổng) và Mảng các nhận xét chi tiết (Toa thuốc).

### 2. Giao Diện Khám Bệnh (ReviewOldDocPanel.tsx)

#### [NEW] [ReviewOldDocPanel.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/ReviewOldDocPanel.tsx)
- Component độc lập cho màn hình Khám bệnh.
- UI: Khu vực Drag/Drop Upload file DOCX/PDF. (Tái sử dụng code đọc DOCX từ `mammoth` và `pdfjs-dist`).
- State: Trạng thái `isAnalyzing`. Kết quả trả về gồm Điểm, Biểu đồ điểm, và Danh sách Góp ý.
- Nút Action: **"Chữa Bệnh Ngay (Viết Lại Báo Cáo)"** ở cuối bảng điểm. Khi bấm, trigger callback về [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx) truyền kèm nội dung file gốc và JSON toa thuốc.

### 3. Điều Phối Luồng Chữa Bệnh (App.tsx)

#### [MODIFY] [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx)
- **Header Tabs:** Header có thêm 2 nút chuyển đổi: `[📝 Viết Sáng Kiến Mới]` và `[🩺 Khám & Chữa Bệnh SKKN]`.
- **Thêm State Mới:**
  - `activeTab`: `'create' | 'heal'`
  - `healingContext`: Lưu `{ originalContent: string, analysisResult: any }`
- **Sửa Core Logic [generateNextSection()](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx#1137-1627):**
  - Cập nhật hàm `sendMessageStream` (hoặc block chứa PROMPT tạo Part 1, Part 2, v.v.). Nếu đang ở chế độ `healingContext` (Chữa bệnh), prompt sẽ được bọc lại để nhắc AI: *"Đây là phiên bản cũ: [originalContent]. Dưới đây là toa thuốc khám bệnh: [analysisResult]. Hãy VIẾT LẠI phần này sao cho khắc phục các lỗi trong toa thuốc, đồng thời giữ nguyên cấu trúc chuẩn yêu cầu dưới đây..."*
  - Luồng generate sẽ chạy qua tất cả các Step (Phần 1, Phần 2, Phần 3) giống như flow bình thường, nhưng kết quả là một bản Nâng Cấp thay vì viết mù.

### 4. Tối Giản Form Cũ (SKKNForm.tsx) - *Theo Kế Hoạch Chung*

#### [MODIFY] [SKKNForm.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/SKKNForm.tsx)
- Ẩn/Xóa bớt các field thừa (Sách giáo khoa, Cơ sở vật chất, Vị trí địa lý...) để tối giản UI. Tập trung vào 1-click.

## Verification Plan

### Automated Tests
*Dự án hiện tại không có setup Unit Tests. Việc Verify sẽ thông qua chạy dev mode kiểm tra logic React và AI Output.*

### Manual Verification
1. Mở app chạy lệnh `npm run dev`.
2. Trên Header, click chuyển qua tab **"Khám & Chữa Bệnh SKKN"**.
3. Upload một file SKKN mẫu (doc/docx). Giao diện hiển thị trạng thái đang đọc và phân tích.
4. Bảng Kết quả hiện ra kèm điểm đánh giá % và chi tiết lỗi.
5. Bấm **"Chữa Bệnh Ngay"**, theo dõi Console và Preview xem AI có tự động viết lại báo cáo dựa trên nội dung cũ và cải thiện theo góp ý không.
6. Xác nhận UI [SKKNForm.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/SKKNForm.tsx) ở Tab "Viết Mới" đã gọn gàng lại (ít form nhập liệu).
