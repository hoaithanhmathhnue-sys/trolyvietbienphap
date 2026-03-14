# Kế Hoạch Triển Khai: Trợ Lý Viết Biện Pháp GVG/GVCN Giỏi

## Mục tiêu
Dự án nhằm tái cấu trúc app `skkn-master-ai` thành một công cụ tối giản (1-click) dành cho giáo viên phổ thông thi GVG/GVCN giỏi. Điểm nhấn là giao diện thân thiện, luồng tạo nội dung "trọn bộ" (Báo cáo, Slide, Đề kiểm tra) và tích hợp các nguyên tắc viết tự nhiên, chống đạo văn. Thêm tính năng "Khám/Chữa" biện pháp cũ.

## User Review Required
> [!IMPORTANT]
> **Thay đổi UI Flow Sinh Nội Dung:** Thay vì tạo từng mục SKKN rời rạc, app sẽ tạo liên hoàn 3 tài liệu: Báo cáo, Slide, Đề kiểm tra. Việc gộp này có thể mất nhiều thời gian sinh râu hơn (hoặc cần chia step trên UI nhưng tự động chuyển).
> **Xóa Form Cũ:** Sẽ xóa rất nhiều field nhập liệu không cần thiết trong [SKKNForm.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/SKKNForm.tsx) để UI đạt chuẩn "sự đơn giản cực độ". Nếu bạn cần giữ lại field nào, vui lòng cho biết.

---

## Proposed Changes

### 1. Giao Diện & Form (UI/UX)
- Giao diện thân thiện, bỏ bớt form nhập lằng nhằng.
#### [MODIFY] [SKKNForm.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/SKKNForm.tsx)
- Giữ lại chỉ 3-4 fields: Môn học, Cấp học, Tên đề tài, Giới hạn trang (tùy chọn).
- Đổi các icon/label cho phù hợp với "Giáo viên giỏi", "GVCN".
#### [MODIFY] [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx)
- Đổi Title, Banner, Slogan của app.

### 2. Logic Sinh "Trọn Bộ" & Prompt Engineering
- Cập nhật luồng tạo để sinh 3 thứ liên tiếp.
#### [MODIFY] [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx)
- Cập nhật state list (thay vì các phần I, II, III của SKKN thì đổi thành logic mới: Mở Đầu, Thực Trạng, Biện Pháp, Kết Quả -> Slide -> Đề Kiểm Tra).
- Sửa đổi hàm [startGeneration](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx#538-1117) để thêm chỉ thị cứng về 10 Nguyên Tắc Vàng (không copy-paste, số liệu lẻ `17.8%`, bối cảnh lớp `10A3`, v.v...).
#### [MODIFY] [geminiService.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/geminiService.ts)
- Sửa System Instruction hoặc Prompt trong hàm tạo văn bản để nó học theo `giọng văn tự nhiên.txt` và [nguyentac.txt](file:///c:/Users/admin/Desktop/BIENPHAPGVG/nguyentac.txt).

### 3. Tính Năng "Khám & Chữa Bệnh" (Chấm điểm BIỆN PHÁP cũ)
- Tái sử dụng/chỉnh sửa logic phân tích hiện tại để chấm điểm báo cáo.
#### [NEW] [ReviewOldDocPanel.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/components/ReviewOldDocPanel.tsx)
- Component mới cho phép upload file docx, gửi cho AI qua hàm phân tích, show điểm (0-100) tiêu chí "Chống đạo văn, Tính mới, Cấu trúc".
#### [MODIFY] [geminiService.ts](file:///c:/Users/admin/Desktop/BIENPHAPGVG/services/geminiService.ts)
- Viết API helper mới: `analyzeOldDocument(content: string, ...)` trả về JSON điểm và đề xuất sửa.
#### [MODIFY] [App.tsx](file:///c:/Users/admin/Desktop/BIENPHAPGVG/App.tsx)
- Tích hợp thêm tab "Viết Mới" và tab "Khám Bệnh Biện Pháp Cũ" lên Header/Main Layout.

---

## Verification Plan

### Manual Verification
1. **Kiểm tra UI Mới:**
   - [ ] Mở ứng dụng, kiểm tra các input xem đã được lược bỏ đúng chưa (chỉ còn Tên đề tài, Môn, Cấp học).
   - [ ] Màu sắc, slogan có hiển thị đúng "Trợ Lý Viết Biện Pháp GVG/GVCN" không.
2. **Kiểm tra Luồng 1-Click:**
   - [ ] Bấm Nút Tạo -> App sinh ra đúng cấu trúc Báo cáo -> Chuyển sang sinh Outline Slide -> Sinh tiếp Đề kiểm tra.
3. **Kiểm tra Giọng Văn AI:**
   - [ ] Đọc thử kết quả xem có chứa số liệu lẻ (VD 12.5%), có đề cập đến một lớp giả định (VD 10A2), và văn phong bớt mùi robot đi chưa.
4. **Kiểm tra Khám Bệnh:**
   - [ ] Upload một nội dung SKKN cũ, xem AI có chấm điểm và đưa ra nhận xét hợp lý không.
