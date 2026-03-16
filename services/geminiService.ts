
import { GoogleGenAI, Chat } from "@google/genai";
import { SYSTEM_INSTRUCTION, FALLBACK_MODELS } from "../constants";
import { TEACHING_METHODS, METHOD_SUGGESTION_RULES } from "../data/teachingMethods";
import { TitleAnalysisResult } from '../types';

// Hàm phân tích và trả về thông báo lỗi thân thiện
export const parseApiError = (error: any): string => {
  const errorMessage = error?.message || error?.toString() || '';
  const errorString = JSON.stringify(error);

  // Kiểm tra lỗi quota exceeded (429)
  if (errorString.includes('429') ||
    errorMessage.includes('quota') ||
    errorMessage.includes('RESOURCE_EXHAUSTED') ||
    errorMessage.includes('exceeded')) {
    return 'QUOTA_EXCEEDED';
  }

  // Kiểm tra lỗi rate limit
  if (errorMessage.includes('rate') || errorMessage.includes('limit')) {
    return 'RATE_LIMIT';
  }

  // Kiểm tra lỗi API key không hợp lệ
  if (errorMessage.includes('API_KEY_INVALID') ||
    errorMessage.includes('401') ||
    errorMessage.includes('unauthorized') ||
    errorMessage.includes('PERMISSION_DENIED')) {
    return 'INVALID_API_KEY';
  }

  // Kiểm tra lỗi kết nối
  if (errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('connection')) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN';
};

// Hàm tạo thông báo lỗi thân thiện
export const getFriendlyErrorMessage = (error: any): { type: string; title: string; message: string; suggestions: string[] } => {
  const errorType = parseApiError(error);

  switch (errorType) {
    case 'QUOTA_EXCEEDED':
      return {
        type: 'quota',
        title: '⚠️ Đã vượt quá giới hạn sử dụng',
        message: 'Bạn đã sử dụng hết lượt gọi API miễn phí trong ngày. Đây là giới hạn từ phía Google, không phải lỗi của ứng dụng.',
        suggestions: [
          '⏰ Đợi khoảng 1-2 phút rồi thử lại',
          '🔑 Sử dụng API Key khác nếu có',
          '📅 Đợi đến ngày hôm sau khi quota được reset',
          '💳 Nâng cấp tài khoản Google AI Studio để có thêm quota'
        ]
      };

    case 'RATE_LIMIT':
      return {
        type: 'rate_limit',
        title: '🚦 Đang gửi yêu cầu quá nhanh',
        message: 'Bạn đang gửi quá nhiều yêu cầu trong thời gian ngắn. Hãy chờ một chút rồi thử lại.',
        suggestions: [
          '⏳ Đợi 30-60 giây rồi thử lại',
          '🔄 Không bấm nút nhiều lần liên tiếp'
        ]
      };

    case 'INVALID_API_KEY':
      return {
        type: 'auth',
        title: '🔐 API Key không hợp lệ',
        message: 'API Key bạn đang sử dụng không đúng hoặc đã hết hạn.',
        suggestions: [
          '🔑 Kiểm tra lại API Key đã nhập',
          '🆕 Tạo API Key mới tại Google AI Studio',
          '📋 Đảm bảo copy đầy đủ API Key (không thừa/thiếu ký tự)'
        ]
      };

    case 'NETWORK_ERROR':
      return {
        type: 'network',
        title: '🌐 Lỗi kết nối mạng',
        message: 'Không thể kết nối đến máy chủ Google AI. Hãy kiểm tra kết nối internet của bạn.',
        suggestions: [
          '📶 Kiểm tra kết nối WiFi/Internet',
          '🔄 Thử làm mới trang (F5)',
          '🌍 Thử sử dụng mạng khác'
        ]
      };

    default:
      return {
        type: 'unknown',
        title: '❌ Đã xảy ra lỗi',
        message: error?.message || 'Có lỗi không xác định xảy ra khi gọi AI.',
        suggestions: [
          '🔄 Thử làm mới trang và thực hiện lại',
          '🔑 Kiểm tra API Key',
          '⏰ Đợi một lúc rồi thử lại'
        ]
      };
  }
};

let chatSession: Chat | null = null;
let currentApiKey: string | null = null;
let currentSelectedModel: string | null = null;
let history: any[] = []; // Store history to restore when switching models

export const initializeGeminiChat = (apiKey: string, selectedModel?: string) => {
  currentApiKey = apiKey;
  currentSelectedModel = selectedModel || FALLBACK_MODELS[0];
  chatSession = null;
  history = []; // Reset history on new initialization
};

// Lấy lịch sử chat để lưu phiên làm việc
export const getChatHistory = (): any[] => {
  return [...history];
};

// Khôi phục lịch sử chat từ phiên đã lưu
export const setChatHistory = (savedHistory: any[]) => {
  history = savedHistory || [];
};

const createChatSession = (model: string) => {
  if (!currentApiKey) throw new Error("API Key not found");

  const ai = new GoogleGenAI({ apiKey: currentApiKey });

  return ai.chats.create({
    model: model,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.7,
      topK: 64,
      topP: 0.95,
      maxOutputTokens: 65536,
      thinkingConfig: { thinkingBudget: 2048 },
      tools: [{ googleSearch: {} }]
    },
    history: history
  });
};

// Sắp xếp models với model được chọn đầu tiên
const getOrderedModels = (): string[] => {
  if (!currentSelectedModel || !FALLBACK_MODELS.includes(currentSelectedModel)) {
    return FALLBACK_MODELS;
  }

  // Đưa model được chọn lên đầu, giữ nguyên thứ tự các model còn lại
  const orderedModels = [currentSelectedModel];
  for (const model of FALLBACK_MODELS) {
    if (model !== currentSelectedModel) {
      orderedModels.push(model);
    }
  }
  return orderedModels;
};

export const sendMessageStream = async (message: string, onChunk: (text: string) => void) => {
  // Sử dụng API key từ localStorage (đã được khởi tạo qua initializeGeminiChat)
  if (!currentApiKey) {
    throw new Error("Không có API Key. Vui lòng nhập API key trong phần Cài đặt.");
  }

  let lastError: any = null;
  const modelsToTry = getOrderedModels();

  console.log(`🚀 Bắt đầu gửi tin nhắn. Sẽ thử ${modelsToTry.length} model theo thứ tự: ${modelsToTry.join(' → ')}`);

  // Thử lần lượt các model theo thứ tự fallback
  for (const model of modelsToTry) {
    try {
      console.log(`🤖 Đang thử model: ${model}`);

      // Tạo session với model hiện tại
      const ai = new GoogleGenAI({ apiKey: currentApiKey });
      chatSession = ai.chats.create({
        model: model,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.7,
          topK: 64,
          topP: 0.95,
          maxOutputTokens: 65536,
          thinkingConfig: { thinkingBudget: 2048 },
          tools: [{ googleSearch: {} }]
        },
        history: history
      });

      const responseStream = await chatSession.sendMessageStream({ message });

      let fullResponse = "";
      for await (const chunk of responseStream) {
        if (chunk.text) {
          onChunk(chunk.text);
          fullResponse += chunk.text;
        }
      }

      // Thành công - cập nhật history và return
      history.push({ role: 'user', parts: [{ text: message }] });
      history.push({ role: 'model', parts: [{ text: fullResponse }] });
      console.log(`✅ Thành công với model ${model}`);
      return;

    } catch (error: any) {
      console.error(`❌ Model ${model} thất bại:`, error.message || error);
      lastError = error;

      const errorType = parseApiError(error);
      console.log(`⏭️ Lỗi ${errorType}, thử model tiếp theo...`);

      // Tiếp tục thử model tiếp theo
      continue;
    }
  }

  // Tất cả models đều thất bại
  console.error(`💀 Tất cả ${modelsToTry.length} models đều thất bại.`);
  throw lastError || new Error("Tất cả models đều thất bại. Vui lòng kiểm tra API key hoặc thử lại sau.");
};

// Phân tích tài liệu để trích xuất thông tin cho SKKN (không dùng chat session)
export const analyzeDocumentForSKKN = async (
  apiKey: string,
  documentContent: string,
  documentType: 'reference' | 'template',
  selectedModel?: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey });

  // Giới hạn nội dung để tránh vượt token limit
  const truncatedContent = documentContent.substring(0, 20000);

  const prompt = documentType === 'reference'
    ? `Bạn là chuyên gia phân tích tài liệu giáo dục. Hãy phân tích TÀI LIỆU THAM KHẢO sau và trích xuất thông tin hữu ích cho việc viết SKKN (Sáng kiến Kinh nghiệm):

📚 **TÀI LIỆU THAM KHẢO:**
${truncatedContent}

---

Hãy phân tích và trả về kết quả theo format sau:

## 📖 1. NỘI DUNG CHÍNH
- Liệt kê các chủ đề, khái niệm, kiến thức quan trọng
- Tóm tắt ý chính của tài liệu

## 🔧 2. PHƯƠNG PHÁP / KỸ THUẬT (nếu có)
- Các phương pháp dạy học được đề cập
- Kỹ thuật, chiến lược giảng dạy

## 📊 3. SỐ LIỆU / DỮ LIỆU QUAN TRỌNG (nếu có)
- Thống kê, bảng biểu
- Kết quả nghiên cứu, khảo sát

## 💡 4. GỢI Ý ÁP DỤNG CHO SKKN
- Cách tận dụng tài liệu này vào đề tài SKKN
- Các điểm có thể tham khảo, trích dẫn
- Ý tưởng phát triển giải pháp

⚠️ Lưu ý: Trả lời ngắn gọn, súc tích, tập trung vào thông tin hữu ích nhất.`
    : `Bạn là chuyên gia về quy trình viết SKKN. Hãy phân tích MẪU YÊU CẦU SKKN sau và trích xuất thông tin quan trọng:

📋 **MẪU YÊU CẦU SKKN:**
${truncatedContent}

---

Hãy phân tích và trả về kết quả theo format sau:

## 📝 1. CẤU TRÚC YÊU CẦU
- Các phần bắt buộc phải có
- Thứ tự các mục
- Quy định về format

## ⭐ 2. TIÊU CHÍ ĐÁNH GIÁ (nếu có)
- Các tiêu chí chấm điểm
- Thang điểm
- Trọng số các phần

## 📏 3. YÊU CẦU ĐẶC BIỆT
- Độ dài tối thiểu/tối đa
- Font chữ, cỡ chữ, căn lề
- Quy định về trích dẫn, tài liệu tham khảo

## ⚠️ 4. LƯU Ý QUAN TRỌNG
- Các điểm cần tuân thủ nghiêm ngặt
- Lỗi thường gặp cần tránh
- Điểm khác biệt so với mẫu chuẩn (nếu có)

⚠️ Lưu ý: Trả lời ngắn gọn, súc tích, tập trung vào thông tin cần thiết nhất.`;

  const model = selectedModel || FALLBACK_MODELS[0];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt
    });

    return response.text || 'Không thể phân tích tài liệu. Vui lòng thử lại.';
  } catch (error: any) {
    console.error('Lỗi phân tích tài liệu:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};

// Interface cho cấu trúc mục SKKN (import từ types.ts nếu cần)
interface SKKNSection {
  id: string;
  level: number;
  title: string;
  suggestedContent?: string;
}

// Trích xuất cấu trúc mục từ mẫu SKKN
export const extractSKKNStructure = async (
  apiKey: string,
  templateContent: string,
  selectedModel?: string
): Promise<SKKNSection[]> => {
  const ai = new GoogleGenAI({ apiKey });

  // Giới hạn nội dung để tránh vượt token limit
  const truncatedContent = templateContent.substring(0, 25000);

  const prompt = `Bạn là chuyên gia phân tích cấu trúc tài liệu SKKN (Sáng kiến Kinh nghiệm).

NHIỆM VỤ: Phân tích MẪU YÊU CẦU SKKN sau và TRÍCH XUẤT CHÍNH XÁC cấu trúc các mục/phần.

═══════════════════════════════════════════════════════════════
MẪU SKKN CẦN PHÂN TÍCH:
═══════════════════════════════════════════════════════════════
${truncatedContent}
═══════════════════════════════════════════════════════════════

TRẢ VỀ JSON ARRAY với format CHÍNH XÁC sau (KHÔNG có text khác, CHỈ JSON):

[
  {"id": "1", "level": 1, "title": "PHẦN I: ĐẶT VẤN ĐỀ"},
  {"id": "1.1", "level": 2, "title": "1. Lý do chọn đề tài"},
  {"id": "1.2", "level": 2, "title": "2. Mục đích nghiên cứu"},
  {"id": "2", "level": 1, "title": "PHẦN II: NỘI DUNG"},
  {"id": "2.1", "level": 2, "title": "1. Cơ sở lý luận"},
  {"id": "2.1.1", "level": 3, "title": "1.1. Khái niệm"},
  ...
]

QUY TẮC QUAN TRỌNG:
1. level 1: Phần lớn nhất (PHẦN I, PHẦN II, CHƯƠNG 1, MỤC A...)
2. level 2: Mục con (1., 2., I.1., 1.1...)  
3. level 3: Mục nhỏ hơn (a., b., 1.1.1., 1.1.2...)
4. Giữ NGUYÊN tiêu đề gốc trong mẫu (không dịch, không sửa)
5. Trích xuất TẤT CẢ các mục có trong mẫu
6. CHỈ TRẢ VỀ JSON ARRAY, KHÔNG giải thích, KHÔNG markdown code block

BẮT ĐẦU JSON NGAY:`;

  const model = selectedModel || FALLBACK_MODELS[0];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt
    });

    const responseText = response.text || '[]';

    // Cố gắng parse JSON từ response
    // Xử lý trường hợp AI trả về có markdown code block
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Find JSON array in response
    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const sections: SKKNSection[] = JSON.parse(jsonText);

    // Validate và clean up
    return sections.filter(s => s.id && s.title && typeof s.level === 'number');

  } catch (error: any) {
    console.error('Lỗi trích xuất cấu trúc SKKN:', error);
    // Trả về array rỗng nếu không parse được - sẽ fallback về mẫu chuẩn
    return [];
  }
};

/**
 * Phân tích tên đề tài SKKN
 * Theo quy trình kiểm tra 3 lớp từ quy trinh kiem tra.txt
 */
export const analyzeTitleSKKN = async (
  apiKey: string,
  title: string,
  subject?: string,
  level?: string,
  selectedModel?: string,
  teachingMethod?: string
): Promise<TitleAnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Bạn là chuyên gia phân tích tên đề tài Sáng kiến kinh nghiệm (SKKN) với 20 năm kinh nghiệm.

## THÔNG TIN ĐỀ TÀI CẦN PHÂN TÍCH:
- Tên đề tài: "${title}"
${subject ? `- Môn học/Lĩnh vực: ${subject}` : ''}
${level ? `- Cấp học: ${level}` : ''}
${teachingMethod ? `- Phương pháp dạy học dự định áp dụng: ${teachingMethod}` : ''}

${teachingMethod ? `
## YÊU CẦU ĐẶC BIỆT VỀ KẾT HỢP PHƯƠNG PHÁP CỤ THỂ:
Người dùng đã chọn một phương pháp dạy học là "${teachingMethod}".
Nhiệm vụ của bạn là:
1. Đánh giá sự logic, phù hợp giữa Tên đề tài và Phương pháp dạy học này.
2. Nếu phù hợp: Đề xuất các Tên thay thế (ở phần suggestions) sao cho bao hàm TRỰC TIẾP HOẶC GIÁN TIẾP phương pháp này, giúp tên đề tài sắc bén và mang tính thực chiến hơn.
3. Nếu KHÔNG phù hợp (Ví dụ môn Thể dục nhưng dùng Phỏng vấn nhân vật AI): Hãy chỉ ra sự bất hợp lý ở phần "overallVerdict" hoặc "problems" và mớm một tên/phương pháp thay thế phù hợp hơn.
` : ''}

## QUY TRÌNH KIỂM TRA 3 LỚP:

### LỚP 1: DATABASE NỘI BỘ (Đề tài phổ biến)
So sánh với database đề tài tích hợp:

🔴 TRÙNG LẶP CAO (80-90%):
- "Ứng dụng AI trong dạy học môn [X]"
- "Sử dụng ChatGPT hỗ trợ [công việc Y]"
- "Ứng dụng Canva thiết kế bài giảng"
- "Sử dụng Kahoot/Quizizz tăng tính tương tác"
- "Dạy học trực tuyến qua Google Meet/Zoom"
- "Ứng dụng Google Classroom quản lý lớp học"

🟡 TRÙNG LẶP TRUNG BÌNH (60-70%):
- "Dạy học theo dự án (PBL) môn [X]"
- "Phương pháp dạy học tích cực môn [X]"
- "Dạy học theo nhóm hiệu quả"
- "Phát triển năng lực tự học của học sinh"

🟢 TRÙNG LẶP THẤP (20-40%):
- "Kết hợp AI và PBL trong dạy STEM lớp 8"
- Các đề tài kết hợp nhiều phương pháp
- Đề tài có đối tượng đặc biệt (HS khuyết tật, vùng cao)

### LỚP 2: TÌM KIẾM ONLINE (Mô phỏng)
Ước tính số lượng đề tài tương tự trên:
- Cổng SKKN Bộ GD&ĐT
- Sở GD&ĐT các tỉnh
- Tạp chí Giáo dục
- Google Scholar

### LỚP 3: WEBSITE CHUYÊN NGÀNH
- violet.vn, tailieu.vn, 123doc.net
- thuvienvatly.com, giaoducthoidai.vn

## CHẤM ĐIỂM (TỔNG 100 ĐIỂM):

1. **Độ cụ thể (max 25đ)**:
   - 25: Có đầy đủ: môn học, cấp học, công cụ, phạm vi cụ thể
   - 20: Có 3/4 yếu tố
   - 15: Có 2/4 yếu tố
   - 10: Chỉ có 1 yếu tố cụ thể
   - 5: Quá chung chung

2. **Tính mới (max 30đ)**:
   - 30: Chưa ai làm, hoàn toàn mới
   - 25: Kết hợp 2-3 yếu tố mới
   - 20: Có 1 điểm mới rõ ràng
   - 15: Cải tiến từ đề tài cũ
   - 10: Đã có nhiều người làm
   - 5: Trùng lặp hoàn toàn

3. **Tính khả thi (max 25đ)**:
   - 25: Rất dễ thực hiện, nguồn lực sẵn có
   - 20: Khả thi, cần chuẩn bị ít
   - 15: Khả thi nhưng cần thời gian/chi phí
   - 10: Khó khăn, cần nhiều nguồn lực
   - 5: Không khả thi

4. **Độ rõ ràng (max 20đ)**:
   - 20: Tên ngắn gọn, dễ hiểu, có từ khóa rõ
   - 15: Rõ ràng nhưng hơi dài
   - 10: Có thể hiểu nhưng chưa tối ưu
   - 5: Khó hiểu, rườm rà

## PHÁT HIỆN VẤN ĐỀ:
- Từ ngữ chung chung: "ứng dụng công nghệ", "nâng cao chất lượng", "một số biện pháp"
- Từ quá tham vọng: "toàn diện", "cách mạng hóa", "đột phá"
- Công cụ lỗi thời: "băng hình", "đĩa CD", "máy chiếu overhead"
- Công cụ quá phổ biến: "ChatGPT", "Kahoot", "Google Classroom"

## ĐỀ XUẤT 5 TÊN THAY THẾ (Công thức):
1. Cụ thể hóa: Thêm [Cấp học] + [Bối cảnh đặc biệt]
2. Kết hợp: [Công nghệ A] + [Phương pháp B] + [Môn học C]
3. Đối tượng đặc biệt: [Phương pháp] + [HS đặc thù] + [Mục tiêu]
4. Bài học cụ thể: [Phương pháp] + [Bài/Chương cụ thể] + [Công cụ]
5. Tạo công cụ mới: Thiết kế [Công cụ tự tạo] + [Mục đích]

TRẢ VỀ JSON (KHÔNG có markdown code block, CHỈ JSON thuần):
{
  "structure": {
    "action": "Từ khóa hành động (hoặc rỗng)",
    "tool": "Công cụ/Phương tiện (hoặc rỗng)",
    "subject": "Môn học/Lĩnh vực",
    "scope": "Phạm vi (lớp, cấp học)",
    "purpose": "Mục đích"
  },
  "duplicateLevel": "Cao|Trung bình|Thấp",
  "duplicateDetails": "Giải thích chi tiết về mức độ trùng lặp",
  "scores": {
    "specificity": <điểm>,
    "novelty": <điểm>,
    "feasibility": <điểm>,
    "clarity": <điểm>,
    "total": <tổng điểm>
  },
  "scoreDetails": [
    { "category": "Độ cụ thể", "score": <điểm>, "maxScore": 25, "reason": "lý do" },
    { "category": "Tính mới", "score": <điểm>, "maxScore": 30, "reason": "lý do" },
    { "category": "Tính khả thi", "score": <điểm>, "maxScore": 25, "reason": "lý do" },
    { "category": "Độ rõ ràng", "score": <điểm>, "maxScore": 20, "reason": "lý do" }
  ],
  "problems": ["Vấn đề 1", "Vấn đề 2"],
  "suggestions": [
    { "title": "Tên đề tài thay thế 1", "strength": "Điểm mạnh", "predictedScore": <điểm dự kiến> },
    { "title": "Tên đề tài thay thế 2", "strength": "Điểm mạnh", "predictedScore": <điểm dự kiến> },
    { "title": "Tên đề tài thay thế 3", "strength": "Điểm mạnh", "predictedScore": <điểm dự kiến> },
    { "title": "Tên đề tài thay thế 4", "strength": "Điểm mạnh", "predictedScore": <điểm dự kiến> },
    { "title": "Tên đề tài thay thế 5", "strength": "Điểm mạnh", "predictedScore": <điểm dự kiến> }
  ],
  "relatedTopics": ["Đề tài mới nổi 1", "Đề tài mới nổi 2", "Đề tài mới nổi 3"],
  "overallVerdict": "Kết luận tổng quan và lời khuyên"
}

BẮT ĐẦU JSON NGAY:`;

  const model = selectedModel || FALLBACK_MODELS[0];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt
    });

    const responseText = response.text || '{}';

    // Xử lý response để lấy JSON
    let jsonText = responseText.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Find JSON object in response
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result: TitleAnalysisResult = JSON.parse(jsonText);
    return result;

  } catch (error: any) {
    console.error('Lỗi phân tích đề tài:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};

// ====== PHÂN TÍCH BIỆN PHÁP CŨ (THẨM ĐỊNH & CẢI THIỆN) ======
// Return type cho kết quả thẩm định nâng cao
export interface EnhancedAnalysisResult {
  totalScore: number;
  summary: string;
  // Cấu trúc phát hiện tự động (linh hoạt theo biện pháp)
  detectedSections: Array<{
    name: string;
    status: 'pass' | 'warn' | 'fail';
    comment: string;
  }>;
  // Tiêu chí chất lượng linh hoạt (AI tự quyết theo cấu trúc)
  qualityCriteria: Array<{
    name: string;
    score: number;
    maxScore: number;
    comment: string;
  }>;
  // Đạo văn
  plagiarismPercent: number;
  plagiarismLevel: string;
  plagiarismSegments: Array<{ segment: string; source: string; similarity: number }>;
  // AI risk
  aiRiskPercent: number;
  aiRiskLevel: string;
  aiRiskDetails: {
    perplexity: number;
    burstiness: number;
    patternDensity: number;
    suspiciousPatterns: string[];
    recommendations: string[];
  };
  suggestions: string[];
  // Legacy compatibility
  criteria: Array<{ name: string; score: number; maxScore: number; details: string }>;
}

export const analyzeOldDocument = async (
  apiKey: string,
  content: string,
  selectedModel?: string
): Promise<EnhancedAnalysisResult> => {
  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = selectedModel || 'gemini-2.5-flash';

    // Truncate content if too long (keep first 20000 chars)
    const truncatedContent = content.length > 20000
      ? content.substring(0, 20000) + '\n\n[... nội dung còn lại đã được cắt bớt ...]'
      : content;

    const prompt = `
Bạn là CHUYÊN GIA THẨM ĐỊNH SKKN/Biện pháp GVG/GVCN hàng đầu Việt Nam, kiêm chuyên gia phát hiện đạo văn và nội dung AI.

NHIỆM VỤ: Phân tích TOÀN DIỆN biện pháp/SKKN sau. 
⚠️ QUAN TRỌNG: Mỗi đơn vị/sở có cấu trúc biện pháp KHÁC NHAU → Bạn phải TỰ NHẬN DIỆN cấu trúc thực tế của văn bản, KHÔNG áp đặt cấu trúc cố định.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 NỘI DUNG CẦN PHÂN TÍCH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${truncatedContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 YÊU CẦU PHÂN TÍCH (4 MẢNG CHÍNH):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## A. NHẬN DIỆN CẤU TRÚC (detectedSections)
- Đọc kỹ văn bản và liệt kê TẤT CẢ các phần/mục thực tế có trong biện pháp
- Đánh giá mỗi phần: "pass" (đạt), "warn" (cần cải thiện), "fail" (yếu/thiếu)
- KHÔNG cố định — tùy theo cấu trúc thực tế (có biện pháp chia Phần I-VI, có cái chia Chương 1-5, có cái dùng mục A-B-C...)

## B. TIÊU CHÍ CHẤT LƯỢNG LINH HOẠT (qualityCriteria)
Tạo 6-8 tiêu chí phù hợp VỚI CẤU TRÚC ĐÃ PHÁT HIỆN. Gợi ý: Cấu trúc, Lý luận, Số liệu, Khả thi, Tính mới, Ngôn ngữ, Thực tiễn, Hình thức... (chọn phù hợp). Mỗi tiêu chí chấm 0-10.

## C. PHÂN TÍCH ĐẠO VĂN (plagiarism)
- Ước lượng % trùng lặp tổng thể (0-100%)
- Xác định mức độ: "Thấp" (<15%), "Trung bình" (15-30%), "Cao" (30-50%), "Rất cao" (>50%)
- Liệt kê 3-5 đoạn nghi ngờ đạo văn cao nhất (nếu có), kèm nguồn gốc tương tự và % giống

## D. PHÂN TÍCH NGUY CƠ AI (aiRisk)
Kiểm tra xem văn bản có dấu hiệu được viết bởi AI không:

### Các chỉ số:
1. **Perplexity (0-100)**: AI thường 20-40, người viết 40-80+
2. **Burstiness (0-100)**: AI viết câu đều (thấp), người viết xen kẽ câu ngắn-dài (cao)
3. **Pattern Density (0-100)**: Tỷ lệ mẫu câu đặc trưng AI: "trong bối cảnh... hiện nay", "tuy nhiên, thực tế cho thấy", "không chỉ... mà còn", "qua đó... học sinh", "do đó... là rất cần thiết"

### Ngưỡng đánh giá aiRiskPercent:
- <15%: "An toàn" (Thấp)
- 15-35%: "Trung bình"  
- 35-60%: "Nguy hiểm" (Cao)
- >60%: "Rất nguy hiểm" (Rất cao)

### Mẫu câu đặc trưng AI cần kiểm tra:
- ChatGPT: "trong bối cảnh... hiện nay", "theo định hướng... chương trình", "việc... là yêu cầu cấp thiết"
- Gemini: "điều này cho thấy... rằng", "một cách... hiệu quả", "đáng chú ý là"
- Claude: "điều đáng chú ý là", "một điểm đáng xem xét"

⚠️ LƯU Ý KHI CHẤM AI:
- KHÔNG đánh đồng "văn bản trơn tru" với "văn bản AI"
- Dấu hiệu cốt lõi AI thô: vô hồn, thiếu ví dụ thực tiễn cá nhân, lạm dụng từ nối
- Nếu có cấu trúc câu đa dạng, từ vựng giản dị, diễn đạt đời thường → NGƯỜI VIẾT → AI Score THẤP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ TRẢ VỀ ĐÚNG FORMAT JSON (KHÔNG CÓ GÌ KHÁC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "totalScore": <tổng điểm 0-100 dựa trên qualityCriteria>,
  "summary": "<tóm tắt tổng quan 3-5 câu>",
  "detectedSections": [
    {"name": "<tên phần>", "status": "pass|warn|fail", "comment": "<nhận xét ngắn>"},
    ...
  ],
  "qualityCriteria": [
    {"name": "<tên tiêu chí>", "score": <0-10>, "maxScore": 10, "comment": "<nhận xét>"},
    ...6-8 tiêu chí
  ],
  "plagiarismPercent": <0-100>,
  "plagiarismLevel": "Thấp|Trung bình|Cao|Rất cao",
  "plagiarismSegments": [
    {"segment": "<đoạn văn nghi ngờ ~50 ký tự>", "source": "<nguồn tương tự>", "similarity": <0-100>},
    ...tối đa 5
  ],
  "aiRiskPercent": <0-100>,
  "aiRiskLevel": "An toàn|Trung bình|Nguy hiểm|Rất nguy hiểm",
  "aiRiskDetails": {
    "perplexity": <0-100>,
    "burstiness": <0-100>,
    "patternDensity": <0-100>,
    "suspiciousPatterns": ["<mẫu câu AI 1>", "<mẫu câu AI 2>", ...tối đa 5],
    "recommendations": ["<gợi ý giảm AI 1>", "<gợi ý giảm AI 2>", ...tối đa 3]
  },
  "suggestions": ["<gợi ý cải thiện 1>", ...<5-7 gợi ý>]
}

CHỈ TRẢ VỀ JSON THUẦN, KHÔNG GIẢI THÍCH, KHÔNG MARKDOWN CODE BLOCK.`;

    const response = await genAI.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    let jsonText = response.text || '';

    // Clean up response
    if (jsonText.includes('```json')) {
      jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    // Find JSON object in response
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result = JSON.parse(jsonText);

    // Build qualityCriteria with validation
    const qualityCriteria = (result.qualityCriteria || []).map((c: any) => ({
      name: c.name || 'Không rõ',
      score: Math.min(10, Math.max(0, Number(c.score) || 0)),
      maxScore: 10,
      comment: c.comment || '',
    }));

    // Build legacy criteria from qualityCriteria for backward compatibility
    const legacyCriteria = qualityCriteria.map((c: any) => ({
      name: c.name,
      score: c.score,
      maxScore: c.maxScore,
      details: c.comment,
    }));

    // Validate and sanitize result
    return {
      totalScore: Math.min(100, Math.max(0, Number(result.totalScore) || 0)),
      summary: result.summary || 'Không có tóm tắt.',
      detectedSections: (result.detectedSections || []).map((s: any) => ({
        name: s.name || '',
        status: (['pass', 'warn', 'fail'].includes(s.status) ? s.status : 'warn') as 'pass' | 'warn' | 'fail',
        comment: s.comment || '',
      })),
      qualityCriteria,
      plagiarismPercent: Math.min(100, Math.max(0, Number(result.plagiarismPercent) || 0)),
      plagiarismLevel: result.plagiarismLevel || 'Thấp',
      plagiarismSegments: (result.plagiarismSegments || []).slice(0, 5).map((p: any) => ({
        segment: p.segment || '',
        source: p.source || '',
        similarity: Math.min(100, Math.max(0, Number(p.similarity) || 0)),
      })),
      aiRiskPercent: Math.min(100, Math.max(0, Number(result.aiRiskPercent) || 0)),
      aiRiskLevel: result.aiRiskLevel || 'An toàn',
      aiRiskDetails: {
        perplexity: Math.min(100, Math.max(0, Number(result.aiRiskDetails?.perplexity) || 50)),
        burstiness: Math.min(100, Math.max(0, Number(result.aiRiskDetails?.burstiness) || 50)),
        patternDensity: Math.min(100, Math.max(0, Number(result.aiRiskDetails?.patternDensity) || 0)),
        suspiciousPatterns: (result.aiRiskDetails?.suspiciousPatterns || []).slice(0, 5),
        recommendations: (result.aiRiskDetails?.recommendations || []).slice(0, 3),
      },
      suggestions: result.suggestions || [],
      criteria: legacyCriteria,
    };

  } catch (error: any) {
    console.error('Lỗi phân tích biện pháp cũ:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};

/**
 * Đề xuất tên đề tài (Brainstorm) thông qua AI
 */
export const brainstormTopicNames = async (
  apiKey: string,
  inputs: {
    subject: string;
    level: string;
    grade: string;
    topicArea: string;
    chapter: string;
    targetCompetence: string;
    otherRequirements: string;
    selectedMethods: string[];
  },
  selectedModel?: string
): Promise<Array<{ title: string; rationale: string }>> => {
  const ai = new GoogleGenAI({ apiKey });
  
  const prompt = `Bạn là chuyên gia thiết kế Sáng kiến kinh nghiệm (SKKN) và Biện pháp giáo viên giỏi xuất sắc nhất Việt Nam.
Hãy đề xuất 5 tên đề tài Biện pháp/SKKN siêu sáng tạo, độc đáo và đúng chuẩn cấu trúc khoa học dựa trên các thông tin sau:
- Môn học: ${inputs.subject}
- Khối lớp: ${inputs.grade} (Cấp: ${inputs.level})
- Chuyên đề: ${inputs.topicArea}
- Chương/Bài: ${inputs.chapter}
- Mục tiêu/Năng lực cần đạt: ${inputs.targetCompetence}
- Yêu cầu khác (AI, ý tưởng trò chơi...): ${inputs.otherRequirements || 'Không có'}
- Phương pháp / Kỹ thuật mong muốn tích hợp: ${inputs.selectedMethods.join(', ')}

ĐÁNH GIÁ VÀ ĐỀ XUẤT:
- Tạo 5 tên đề tài Biện pháp thật CỤ THỂ, rõ ràng.
- Gắn chặt với Tên Chương/Bài và Chuyên đề người dùng nhập.
- Kết hợp mượt mà các Phương pháp/Kỹ thuật đã chọn vào tên đề tài.
- Tránh các tên quá cũ kỹ như "Sử dụng PowerPoint...", "Một số biện pháp nâng cao..."
- Cấu trúc tiêu chuẩn của một tên đề tài hay: [Hành động] + [Công cụ/Phương pháp/Kỹ thuật] + [Mục đích/Năng lực] + [Khách thể]. 
  => Ví dụ: "Tích hợp mô hình Lớp học đảo ngược qua trạm học tập nhằm phát triển năng lực tự học môn Toán lớp 10" hoặc "Vận dụng kỹ thuật Khăn trải bàn và Sơ đồ KWL trong thiết kế bài giảng Sinh học 11 nhằm nâng cao tính chủ động".

TRẢ VỀ JSON ARRAY DƯỚI ĐÂY (CHỈ TRẢ VỀ JSON THUẦN, KHÔNG FORMAT MARKDOWN CODE BLOCK):
[
  { "title": "Tên đề tài 1", "rationale": "Lý do vì sao tên này hay và phù hợp" },
  { "title": "Tên đề tài 2", "rationale": "Lý do..." },
  { "title": "Tên đề tài 3", "rationale": "Lý do..." },
  { "title": "Tên đề tài 4", "rationale": "Lý do..." },
  { "title": "Tên đề tài 5", "rationale": "Lý do..." }
]
CHỈ OUTPUT JSON KHÔNG DIỄN GIẢI THÊM:`;

  const model = selectedModel || FALLBACK_MODELS[0];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt
    });

    const responseText = response.text || '[]';

    // Parse JSON
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result = JSON.parse(jsonText);
    return Array.isArray(result) ? result : [];

  } catch (error: any) {
    console.error('Lỗi brainstorm đề tài:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};

/**
 * AI gợi ý phương pháp/kỹ thuật dạy học dựa trên bối cảnh Bước 1 + Bước 2
 */
export const suggestMethods = async (
  apiKey: string,
  inputs: {
    subject: string;
    level: string;
    grade: string;
    topicArea: string;
    chapter: string;
    targetCompetence: string;
    otherRequirements: string;
  },
  selectedModel?: string
): Promise<Array<{ method: string; reason: string }>> => {
  const ai = new GoogleGenAI({ apiKey });

  const methodList = TEACHING_METHODS.map((m, i) => `${i + 1}. ${m}`).join('\n');

  const prompt = `Bạn là chuyên gia thiết kế giáo dục hàng đầu Việt Nam, am hiểu sâu 46 kỹ thuật/phương pháp dạy học tích cực.

NHIỆM VỤ: Phân tích bối cảnh giáo viên cung cấp và GỢI Ý 3-5 phương pháp/kỹ thuật PHÙ HỢP NHẤT từ danh sách bên dưới.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BỐI CẢNH CỦA GIÁO VIÊN:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Môn học: ${inputs.subject}
- Cấp học: ${inputs.level}
- Khối lớp: ${inputs.grade}
- Chuyên đề nghiên cứu: ${inputs.topicArea}
- Chương/Bài: ${inputs.chapter}
- Năng lực/Phẩm chất cần đạt: ${inputs.targetCompetence}
- Yêu cầu khác: ${inputs.otherRequirements || 'Không có'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DANH SÁCH 46 PHƯƠNG PHÁP/KỸ THUẬT (CHỌN TỪ ĐÂY):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${methodList}

${METHOD_SUGGESTION_RULES}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU:
- Chọn 3-5 PP/KT phù hợp NHẤT với bối cảnh trên
- "method" PHẢI ĐÚNG CHÍNH XÁC tên trong danh sách trên (copy-paste)
- "reason" giải thích ngắn gọn vì sao phù hợp (1-2 câu)
- Ưu tiên kết hợp phương pháp truyền thống + AI nếu phù hợp

TRẢ VỀ JSON ARRAY (CHỈ JSON THUẦN, KHÔNG MARKDOWN CODE BLOCK):
[
  { "method": "Tên PP/KT chính xác từ danh sách", "reason": "Lý do phù hợp" },
  ...
]
BẮT ĐẦU JSON NGAY:`;

  const model = selectedModel || FALLBACK_MODELS[0];

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt
    });

    const responseText = response.text || '[]';

    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    const jsonMatch = jsonText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }

    const result = JSON.parse(jsonText);
    return Array.isArray(result) ? result : [];

  } catch (error: any) {
    console.error('Lỗi gợi ý phương pháp:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};
