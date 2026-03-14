// Cấu trúc một mục trong mẫu SKKN tùy chỉnh
export interface SKKNSection {
  id: string;           // ID duy nhất (1, 1.1, 1.1.1...)
  level: number;        // Cấp độ (1: Phần lớn, 2: mục con, 3: mục nhỏ)
  title: string;        // Tiêu đề gốc từ mẫu
  suggestedContent?: string; // Gợi ý nội dung (tùy chọn)
}

// Cấu trúc mẫu SKKN đầy đủ
export interface SKKNTemplate {
  name: string;         // Tên mẫu (từ tên file hoặc tiêu đề)
  sections: SKKNSection[]; // Danh sách các mục
  rawContent: string;   // Nội dung gốc đã trích xuất
}

export interface UserInfo {
  // Bắt buộc
  topic: string;
  subject: string;
  level: string; // Cấp học
  grade: string; // Khối lớp
  school: string;
  location: string; // Địa điểm
  facilities: string; // Điều kiện cơ sở vật chất

  // Bổ sung
  textbook: string;
  researchSubjects: string; // Đối tượng nghiên cứu
  timeframe: string; // Thời gian thực hiện
  applyAI: string; // Có ứng dụng AI không
  focus: string; // Trọng tâm/Đặc thù

  // Tài liệu tham khảo
  referenceDocuments: string; // Nội dung các tài liệu PDF được tải lên

  // Mẫu SKKN (tùy chọn)
  skknTemplate: string; // Nội dung mẫu SKKN nếu người dùng tải lên
  customTemplate?: string; // JSON string của SKKNTemplate - cấu trúc đã trích xuất từ mẫu

  // Yêu cầu khác
  specialRequirements: string; // Các yêu cầu đặc biệt: giới hạn trang, viết ngắn gọn, thêm bài toán...
  pageLimit: number | ''; // Số trang SKKN cần giới hạn (0 = không giới hạn)
  includePracticalExamples: boolean; // Thêm nhiều bài toán thực tế, ví dụ minh họa
  includeStatistics: boolean; // Bổ sung bảng biểu, số liệu thống kê
  requirementsConfirmed: boolean; // Đã xác nhận các yêu cầu chưa
  includeSolution4_5: boolean; // Viết thêm Giải pháp 4 và 5 (mặc định 3 GP)

}

export enum GenerationStep {
  INPUT_FORM = 0,
  OUTLINE = 1,
  // Phần 1: Đặt vấn đề (1.1, 1.2, 1.3)
  PART_1 = 2,
  // Phần 2: Thực trạng (2.1 Cơ sở lý luận, 2.2 Cơ sở thực tiễn)
  PART_2 = 3,
  // Phần 2.3: Nội dung các biện pháp
  BP1 = 4,
  BP1_REVIEW = 5,
  BP2 = 6,
  BP2_REVIEW = 7,
  BP3 = 8,
  BP3_REVIEW = 9,
  // Giải pháp 4, 5 (tùy chọn)
  BP4 = 10,
  BP4_REVIEW = 11,
  BP5 = 12,
  BP5_REVIEW = 13,
  // Phần 2.4: Tính mới, tính sáng tạo
  TINH_MOI = 14,
  TINH_MOI_REVIEW = 15,
  // Phần 3: Phạm vi ảnh hưởng, khả năng áp dụng
  PHAM_VI = 16,
  PHAM_VI_REVIEW = 17,
  // Phần 4: Kết luận và kiến nghị
  KET_LUAN = 18,
  APPENDIX = 19,
  COMPLETED = 20
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface GenerationState {
  step: GenerationStep;
  messages: ChatMessage[];
  fullDocument: string;
  isStreaming: boolean;
  error: string | null;
}

// Nội dung từng giải pháp riêng biệt
export interface SolutionContent {
  content: string;           // Nội dung giải pháp
  isApproved: boolean;       // Đã duyệt chưa
  revisionHistory: string[]; // Lịch sử các phiên bản (tùy chọn)
}

export interface SolutionsState {
  solution1: SolutionContent | null;
  solution2: SolutionContent | null;
  solution3: SolutionContent | null;
  solution4: SolutionContent | null;
  solution5: SolutionContent | null;
}

// Exam Types
export enum QuestionType {
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  TRUE_FALSE = 'TRUE_FALSE',
  SHORT_ANSWER = 'SHORT_ANSWER',
  ESSAY = 'ESSAY'
}

export interface Choice {
  id: string;
  text: string;
}

export interface Statement {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  choices?: Choice[];
  correctChoiceId?: string;
  statements?: Statement[];
  correctAnswer?: string;
  explanation?: string;
}

export interface ExamPart {
  id: string | number;
  title: string;
  description?: string;
  questions: Question[];
}

export interface Exam {
  title: string;
  topic: string;
  hasEssay: boolean;
  parts: ExamPart[];
}

export type UserAnswers = Record<string, string | Record<string, boolean>>;

/**
 * Kết quả phân tích tên đề tài SKKN
 * Theo quy trình kiểm tra 3 lớp
 */
export interface TitleAnalysisResult {
  // Cấu trúc tên đề tài
  structure: {
    action: string;      // Hành động (Ứng dụng, Thiết kế, Xây dựng...)
    tool: string;        // Công cụ (AI Gemini, Kahoot, Canva...)
    subject: string;     // Môn học/Lĩnh vực
    scope: string;       // Phạm vi (lớp, cấp học)
    purpose: string;     // Mục đích
  };

  // Mức độ trùng lặp
  duplicateLevel: 'Cao' | 'Trung bình' | 'Thấp';
  duplicateDetails: string;

  // Điểm số (tổng 100)
  scores: {
    specificity: number;   // Độ cụ thể (max 25)
    novelty: number;       // Tính mới (max 30)
    feasibility: number;   // Tính khả thi (max 25)
    clarity: number;       // Độ rõ ràng (max 20)
    total: number;         // Tổng điểm
  };

  // Chi tiết từng tiêu chí
  scoreDetails: Array<{
    category: string;
    score: number;
    maxScore: number;
    reason: string;
  }>;

  // Vấn đề cần khắc phục
  problems: string[];

  // Gợi ý 5 tên thay thế
  suggestions: Array<{
    title: string;
    strength: string;
    predictedScore: number;
  }>;

  // Đề tài mới nổi liên quan
  relatedTopics: string[];

  // Kết luận tổng quan
  overallVerdict: string;
}
