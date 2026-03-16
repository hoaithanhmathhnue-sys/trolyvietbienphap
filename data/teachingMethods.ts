// Danh sách Phương pháp / Kỹ thuật dạy học tích cực
// Nguồn: TongHop_KyThuat_DayHoc_v4.docx (46 kỹ thuật, 6 nhóm A-F)

// NHÓM A — KỸ THUẬT TƯƠNG TÁC NHÓM TRUYỀN THỐNG
// NHÓM B — KỸ THUẬT TƯ DUY
// NHÓM C — KỸ THUẬT ĐÁNH GIÁ & HỆ THỐNG HÓA
// NHÓM D — KỸ THUẬT QUỐC TẾ
// NHÓM E — PHƯƠNG PHÁP MỚI NHẤT 2025
// NHÓM F — PHƯƠNG PHÁP AI THỰC CHIẾN

export const TEACHING_METHODS = [
  // ─── NHÓM A: Tương tác nhóm truyền thống ───
  "Khăn trải bàn (Tablecloth Technique)",
  "Các mảnh ghép (Jigsaw Method)",
  "Lẩu băng chuyền (Station Rotation / Carousel)",
  "Bể cá (Fishbowl Discussion)",
  "Ổ bi (Inside-Outside Circle)",
  "World Café (World Café)",

  // ─── NHÓM B: Kỹ thuật tư duy ───
  "Động não (Brainstorming)",
  "Kỹ thuật XYZ (Brainwriting 635) (Brainwriting 635 / XYZ Technique)",
  "Kỹ thuật Tia chớp (Lightning Round)",
  "Kỹ thuật 3 lần 3 (Three-Three Technique)",

  // ─── NHÓM C: Đánh giá & Hệ thống hóa ───
  "Lược đồ tư duy (Mind Map)",
  "Sơ đồ KWL (KWL Chart)",
  "Kỹ thuật Kipling 5W1H (Kipling Method)",
  "Exit Ticket (Phiếu phản hồi cuối tiết)",
  "Dạy học theo góc (Learning Corners)",

  // ─── NHÓM D: Kỹ thuật quốc tế ───
  "Nghĩ–Đôi–Chia sẻ (Think–Pair–Share)",
  "Lớp học đảo ngược (Flipped Classroom)",
  "Đặt câu hỏi Socrates (Socratic Questioning)",
  "Kỹ thuật đánh giá trong lớp (Classroom Assessment Techniques (CATs))",
  "Phỏng vấn ba bước (Three-Step Interview)",
  "Học tập trải nghiệm (Experiential Learning)",
  "Điểm khó hiểu nhất (Muddiest Point)",
  "Bài viết 1 phút (One-Minute Paper)",
  "Bản đồ khái niệm (Concept Mapping)",
  "Tranh luận học thuật có cấu trúc (Structured Academic Controversy)",
  "Bốn góc lớp học (Four Corners)",
  "Đường quan điểm (Continuum Line)",
  "Đánh giá và dạy học đồng đẳng (Peer Review / Peer Teaching)",
  "Phương pháp tình huống (Case Study Method)",

  // ─── NHÓM E: Phương pháp mới nhất 2025 ───
  "Tư duy thiết kế (Design Thinking)",
  "Dạy học dựa trên vấn đề (PBL) (Problem-Based Learning)",
  "Dạy học theo dự án (PjBL) (Project-Based Learning)",
  "Dạy học dựa trên truy vấn (IBL) (Inquiry-Based Learning)",
  "POGIL (Process Oriented Guided Inquiry Learning)",
  "Mô hình 5E (STEM) (5E Instructional Model)",
  "Gamification (Trò chơi hóa học tập)",
  "Metacognition (Siêu nhận thức — Học cách học)",

  // ─── NHÓM F: Phương pháp AI thực chiến ───
  "Bài tập phân hóa AI (Differentiated Instruction)",
  "Flashcard AI (Spaced Repetition)",
  "Podcast học tập (NotebookLM) (AI Audio Learning)",
  "Nhập vai nhân vật lịch sử/khoa học với AI (AI Roleplay)",
  "Bệnh viện tri thức (AI chẩn đoán lỗi học tập) (AI Learning Clinic)",
  "Thám tử AI (Phá án tri thức) (AI Knowledge Detective)",
  "Phiên tòa tri thức (AI thẩm phán) (AI Knowledge Court)",
  "Curipod (Bài giảng tương tác AI)",
  "Magic School AI (60+ công cụ AI cho GV)",
  "Thẩm định SKKN với AI (AI SKKN Review)"
];

// Metadata gợi ý nhanh theo tình huống (dùng cho AI gợi ý)
export const METHOD_SUGGESTION_RULES = `
QUY TẮC ĐỀ XUẤT PHƯƠNG PHÁP/KỸ THUẬT:
- Lớp nhỏ (<20 HS): Fishbowl, SAC, Socratic Questioning, Three-Step Interview
- Lớp 20-35 HS: Khăn trải bàn, Jigsaw, Think-Pair-Share, Design Thinking
- Lớp lớn (>35 HS): World Café, Four Corners, Curipod, Gamification
- Không thiết bị: TPS, Brainstorming, Continuum Line, Experiential Learning
- Có internet: Curipod, Magic School AI, NotebookLM, Flashcard AI
- Ôn thi: Flashcard AI + Bài tập phân hóa + Bệnh viện tri thức + Muddiest Point
- STEM/Khoa học: 5E Model + Design Thinking + IBL + POGIL
- Môn KHXH: Roleplay + SAC + Socratic + Case Study
- Tiểu học: Four Corners + Experiential Learning + Gamification
`;
