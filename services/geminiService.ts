
import { GoogleGenAI, Chat } from "@google/genai";
import { SYSTEM_INSTRUCTION, FALLBACK_MODELS } from "../constants";
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
  selectedModel?: string
): Promise<TitleAnalysisResult> => {
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `Bạn là chuyên gia phân tích tên đề tài Sáng kiến kinh nghiệm (SKKN) với 20 năm kinh nghiệm.

## THÔNG TIN ĐỀ TÀI CẦN PHÂN TÍCH:
- Tên đề tài: "${title}"
${subject ? `- Môn học/Lĩnh vực: ${subject}` : ''}
${level ? `- Cấp học: ${level}` : ''}

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
export const analyzeOldDocument = async (
  apiKey: string,
  content: string,
  selectedModel?: string
): Promise<{
  totalScore: number;
  criteria: Array<{ name: string; score: number; maxScore: number; details: string }>;
  suggestions: string[];
  summary: string;
}> => {
  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = selectedModel || 'gemini-2.5-flash';

    // Truncate content if too long (keep first 15000 chars)
    const truncatedContent = content.length > 15000
      ? content.substring(0, 15000) + '\n\n[... nội dung còn lại đã được cắt bớt ...]'
      : content;

    const prompt = `
Bạn là CHUYÊN GIA THẨM ĐỊNH SKKN/Biện pháp GVG/GVCN hàng đầu Việt Nam.

NHIỆM VỤ: Phân tích và chấm điểm biện pháp/SKKN sau theo 5 tiêu chí.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 NỘI DUNG CẦN PHÂN TÍCH:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${truncatedContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 YÊU CẦU CHẤM ĐIỂM (5 TIÊU CHÍ, MỖI TIÊU CHÍ TỐI ĐA 20 ĐIỂM):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **CẤU TRÚC & BỐ CỤC** (20 điểm):
   - Có đầy đủ các phần: Đặt vấn đề, Thực trạng, Giải pháp/Biện pháp, Kết quả, Kết luận?
   - Bố cục logic, mạch lạc?
   - Tiêu đề rõ ràng, phân cấp hợp lý?

2. **CHỐNG ĐẠO VĂN & TÍNH ĐỘC ĐÁO** (20 điểm):
   - Có câu khuôn mẫu "Trong bối cảnh...", "Với sự phát triển..." không?
   - Có paraphrase tốt hay copy nguyên văn?
   - Mỗi đoạn có yếu tố riêng biệt (bối cảnh, tên riêng, quan sát) không?

3. **TÍNH MỚI & SÁNG TẠO** (20 điểm):
   - Giải pháp/Biện pháp có thực sự mới không?
   - Có ứng dụng công nghệ, phương pháp hiện đại?
   - Khác biệt so với các SKKN phổ biến?

4. **SỐ LIỆU & TÍNH KHOA HỌC** (20 điểm):
   - Có bảng số liệu so sánh trước/sau?
   - Số liệu có lẻ, cụ thể (không tròn trĩnh)?
   - Có ghi rõ nguồn gốc số liệu (khảo sát ngày nào, bao nhiêu học sinh)?

5. **NGÔN NGỮ & GIỌNG VĂN** (20 điểm):
   - Cân bằng giữa khoa học và thực tiễn?
   - Có quan sát cá nhân xen kẽ số liệu?
   - Có thừa nhận hạn chế?
   - Câu văn đa dạng hay lặp pattern?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ TRẢ VỀ ĐÚNG FORMAT JSON (KHÔNG CÓ GÌ KHÁC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "totalScore": <tổng điểm 0-100>,
  "criteria": [
    {"name": "Cấu trúc & Bố cục", "score": <0-20>, "maxScore": 20, "details": "<phân tích chi tiết 3-5 câu>"},
    {"name": "Chống đạo văn & Tính độc đáo", "score": <0-20>, "maxScore": 20, "details": "<phân tích chi tiết 3-5 câu>"},
    {"name": "Tính mới & Sáng tạo", "score": <0-20>, "maxScore": 20, "details": "<phân tích chi tiết 3-5 câu>"},
    {"name": "Số liệu & Tính khoa học", "score": <0-20>, "maxScore": 20, "details": "<phân tích chi tiết 3-5 câu>"},
    {"name": "Ngôn ngữ & Giọng văn", "score": <0-20>, "maxScore": 20, "details": "<phân tích chi tiết 3-5 câu>"}
  ],
  "suggestions": [
    "<gợi ý cải thiện cụ thể 1>",
    "<gợi ý cải thiện cụ thể 2>",
    "<gợi ý cải thiện cụ thể 3>",
    "<gợi ý cải thiện cụ thể 4>",
    "<gợi ý cải thiện cụ thể 5>"
  ],
  "summary": "<tóm tắt tổng quan 3-5 câu về chất lượng biện pháp>"
}

CHỈ TRẢ VỀ JSON, KHÔNG CÓ GIẢI THÍCH HAY VĂN BẢN KHÁC.`;

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

    // Validate and sanitize result
    return {
      totalScore: Math.min(100, Math.max(0, result.totalScore || 0)),
      criteria: (result.criteria || []).map((c: any) => ({
        name: c.name || 'Không rõ',
        score: Math.min(c.maxScore || 20, Math.max(0, c.score || 0)),
        maxScore: c.maxScore || 20,
        details: c.details || 'Không có chi tiết',
      })),
      suggestions: result.suggestions || [],
      summary: result.summary || 'Không có tóm tắt.',
    };

  } catch (error: any) {
    console.error('Lỗi phân tích biện pháp cũ:', error);
    throw new Error(getFriendlyErrorMessage(error).message);
  }
};
