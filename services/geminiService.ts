import { GoogleGenAI, Chat, ThinkingLevel } from "@google/genai";
import {
  SYSTEM_INSTRUCTION,
  FALLBACK_MODELS,
  AGENT_PLATFORM_MODELS,
  AGENT_PLATFORM_FALLBACK_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_AGENT_PLATFORM_MODEL
} from "../constants";
import { TEACHING_METHODS, METHOD_SUGGESTION_RULES } from "../data/teachingMethods";
import { TitleAnalysisResult, AiProvider } from '../types';

export { ThinkingLevel };

// Callback hiển thị thông báo chuyển model tạm thời (tự ẩn khi hoàn tất)
let fallbackNoticeCallback: ((notice: string | null) => void) | null = null;

export const setOnFallbackNotice = (callback: ((notice: string | null) => void) | null) => {
  fallbackNoticeCallback = callback;
};

export const notifyFallback = (notice: string | null) => {
  if (fallbackNoticeCallback) {
    fallbackNoticeCallback(notice);
  }
};

// Hàm phân tích và trả về phân loại lỗi chuẩn theo API.md
export const parseApiError = (error: any): string => {
  const errorMessage = error?.message || error?.toString() || '';
  let errorString = '';
  try {
    errorString = JSON.stringify(error) || '';
  } catch {
    errorString = '';
  }
  const combinedError = `${errorMessage} ${errorString}`;
  const lowerError = combinedError.toLowerCase();

  if (
    error?.code === 'REQUEST_TIMEOUT' ||
    lowerError.includes('request_timeout') ||
    lowerError.includes('chưa phản hồi sau 60 giây') ||
    lowerError.includes('ngừng trả dữ liệu quá lâu')
  ) {
    return 'REQUEST_TIMEOUT';
  }
  if (
    error?.code === 'EMPTY_RESPONSE' ||
    lowerError.includes('empty_response') ||
    lowerError.includes('trả về nội dung rỗng')
  ) {
    return 'EMPTY_RESPONSE';
  }

  // 1. Lỗi quota / rate limit (429)
  if (
    lowerError.includes('429') ||
    lowerError.includes('resource_exhausted') ||
    lowerError.includes('quota')
  ) {
    return 'QUOTA_EXCEEDED';
  }

  if (lowerError.includes('rate limit') || lowerError.includes('too many requests')) {
    return 'RATE_LIMIT';
  }

  // 2. Lỗi model quá tải tạm thời (503 UNAVAILABLE) - tuyệt đối không đổ lỗi cho API key
  if (
    lowerError.includes('503') ||
    lowerError.includes('unavailable') ||
    lowerError.includes('high demand') ||
    lowerError.includes('overloaded') ||
    lowerError.includes('try again later') ||
    lowerError.includes('temporarily unavailable')
  ) {
    return 'MODEL_OVERLOADED';
  }

  // 3. Lỗi máy chủ hoặc mạng tạm thời (500, 502, 504, fetch failed) - được phép fallback
  if (
    lowerError.includes('500') ||
    lowerError.includes('502') ||
    lowerError.includes('504') ||
    lowerError.includes('deadline_exceeded') ||
    lowerError.includes('deadline exceeded') ||
    lowerError.includes('bad gateway') ||
    lowerError.includes('fetch failed') ||
    lowerError.includes('failed to fetch') ||
    lowerError.includes('networkerror') ||
    lowerError.includes('econnreset') ||
    lowerError.includes('etimedout')
  ) {
    return 'TRANSIENT_SERVER_ERROR';
  }

  // 4. Lỗi 404 model/endpoint không còn khả dụng - được phép fallback
  if (
    lowerError.includes('404') ||
    lowerError.includes('not_found') ||
    lowerError.includes('is not found')
  ) {
    return 'MODEL_NOT_FOUND';
  }

  // 5. Lỗi 403 PERMISSION_DENIED - tách riêng khỏi 401 để xử lý chuẩn cho Agent Platform
  if (
    lowerError.includes('403') ||
    lowerError.includes('permission_denied') ||
    lowerError.includes('caller does not have permission')
  ) {
    return 'PERMISSION_DENIED';
  }

  // 6. Lỗi 401 API key không hợp lệ / hết hạn
  if (
    lowerError.includes('api_key_invalid') ||
    lowerError.includes('401') ||
    lowerError.includes('unauthorized') ||
    lowerError.includes('invalid api key')
  ) {
    return 'INVALID_API_KEY';
  }

  // 7. Lỗi 400 INVALID_ARGUMENT (dừng ngay, không fallback)
  if (lowerError.includes('400') || lowerError.includes('invalid_argument')) {
    return 'INVALID_ARGUMENT';
  }

  // 8. Lỗi kết nối mạng chung
  if (
    lowerError.includes('network') ||
    lowerError.includes('fetch') ||
    lowerError.includes('connection')
  ) {
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
        message: 'Đã hết quota hoặc vượt giới hạn tốc độ API. Vui lòng đợi rồi thử lại.',
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
        message: 'Đã hết quota hoặc vượt giới hạn tốc độ API. Vui lòng đợi rồi thử lại.',
        suggestions: [
          '⏳ Đợi 30-60 giây rồi thử lại',
          '🔄 Không bấm nút nhiều lần liên tiếp'
        ]
      };

    case 'MODEL_OVERLOADED':
    case 'TRANSIENT_SERVER_ERROR':
      return {
        type: 'model_overloaded',
        title: '⏳ Model Gemini đang quá tải tạm thời',
        message: 'Máy chủ Google AI đang có lưu lượng truy cập cao. API Key của bạn vẫn hợp lệ; vui lòng thử lại sau giây lát hoặc chọn model nhẹ hơn.',
        suggestions: [
          '⏰ Đợi vài giây rồi bấm Thử lại',
          '⚡ Chọn model Gemini 3.8 Flash hoặc Gemini 3.5 Flash Lite trong Cài đặt',
          '🔄 Hệ thống tự động thử qua chuỗi model dự phòng khi gọi lại'
        ]
      };

    case 'PERMISSION_DENIED':
      return {
        type: 'permission',
        title: '🔒 Chưa có quyền truy cập dịch vụ / model',
        message: 'Google đã nhận khóa API nhưng dự án hoặc khóa của bạn chưa được cấp quyền gọi API hoặc model đang chọn.',
        suggestions: [
          '⚙️ Kiểm tra đã chọn đúng nhà cung cấp (Gemini API hoặc Agent Platform API)',
          '💳 Kiểm tra quyền bật API, Billing và API restrictions trên Google Cloud / AI Studio',
          '🔄 Thử chọn model khác tương thích như Gemini 3.8 Flash (Gemini) hoặc Gemini 2.5 Flash (Agent Platform)'
        ]
      };

    case 'INVALID_API_KEY':
      return {
        type: 'auth',
        title: '🔐 API Key không hợp lệ',
        message: 'API Key không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại trong Cài đặt.',
        suggestions: [
          '🔑 Kiểm tra lại API Key đã nhập (bắt đầu bằng AIzaSy... hoặc AQ...)',
          '🆕 Tạo API Key mới tại Google AI Studio hoặc Agent Platform',
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

    case 'REQUEST_TIMEOUT':
      return {
        type: 'timeout',
        title: '⏱️ AI phản hồi quá lâu',
        message: 'Hệ thống đã dừng chờ sau một khoảng thời gian để tránh treo vô hạn.',
        suggestions: [
          '🔄 Bấm "Thử lại" để gửi lại yêu cầu',
          '⚡ Chọn model nhẹ hơn như Gemini 3.5 Flash-Lite trong Cài đặt',
          '📄 Giảm bớt tài liệu tham khảo nếu đang tải file quá lớn'
        ]
      };

    case 'EMPTY_RESPONSE':
      return {
        type: 'empty',
        title: '📭 AI không trả về nội dung',
        message: 'Yêu cầu đã gửi thành công nhưng AI không trả về chữ nào.',
        suggestions: [
          '🔄 Bấm "Thử lại" — phần lớn trường hợp này tự khỏi ở lần thử thứ hai',
          '✂️ Rút gọn yêu cầu đặc biệt hoặc tài liệu tham khảo',
          '🔀 Đổi model trong Cài đặt'
        ]
      };

    default:
      return {
        type: 'unknown',
        title: '❌ Đã xảy ra lỗi',
        message: error?.message || 'Có lỗi không xác định xảy ra khi gọi AI.',
        suggestions: [
          '🔄 Thử làm mới trang và thực hiện lại',
          '🔑 Kiểm tra API Key và nhà cung cấp trong Cài đặt',
          '⏰ Đợi một lúc rồi thử lại'
        ]
      };
  }
};

// Factory function tập trung khởi tạo SDK GoogleGenAI theo provider
export const createGoogleAiClient = (apiKey: string, provider: AiProvider = 'gemini'): GoogleGenAI => {
  if (provider === 'agent-platform') {
    // Cờ kỹ thuật của Google Gen AI SDK để định tuyến tới aiplatform.googleapis.com trong chế độ API key
    return new GoogleGenAI({ vertexai: true, apiKey });
  }
  return new GoogleGenAI({ apiKey });
};

/**
 * Chuẩn hóa cấu hình request theo đúng thế hệ model (Gemini 3.x vs 2.5) và provider.
 * - Không gửi temperature, topP, topK cho mọi model gemini-3*
 * - Mặc định ThinkingLevel.MEDIUM cho bước sinh chính, ThinkingLevel.LOW cho bước phụ trợ
 * - Không gửi ThinkingLevel.MINIMAL cho gemini-3.8-flash hoặc gemini-3.7-flash
 */
export const createGeminiConfig = ({
  provider = 'gemini',
  model,
  systemInstruction,
  responseMimeType,
  maxOutputTokens,
  thinkingLevel = ThinkingLevel.MEDIUM,
  tools,
}: {
  provider?: AiProvider;
  model: string;
  systemInstruction?: string;
  responseMimeType?: string;
  maxOutputTokens?: number;
  thinkingLevel?: ThinkingLevel;
  tools?: any[];
}) => {
  const isGemini3 = model.startsWith('gemini-3');
  const safeThinkingLevel =
    thinkingLevel === ThinkingLevel.MINIMAL ? ThinkingLevel.LOW : thinkingLevel;

  return {
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(responseMimeType ? { responseMimeType } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    // Chỉ truyền temperature cho dòng 2.5 trở xuống
    ...(!isGemini3 ? { temperature: 0.3 } : {}),
    ...(provider === 'gemini' && isGemini3
      ? { thinkingConfig: { thinkingLevel: safeThinkingLevel } }
      : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
  };
};

let chatSession: Chat | null = null;
let currentApiKey: string | null = null;
let currentSelectedModel: string | null = null;
let currentProvider: AiProvider = 'gemini';
let history: any[] = []; // Store history to restore when switching models

export const initializeGeminiChat = (apiKey: string, selectedModel?: string, provider: AiProvider = 'gemini') => {
  currentApiKey = apiKey;
  currentProvider = provider;
  const defaultModel = provider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
  const trimmedSelected = selectedModel?.trim();
  if (provider === 'agent-platform') {
    currentSelectedModel =
      trimmedSelected && AGENT_PLATFORM_MODELS.includes(trimmedSelected)
        ? trimmedSelected
        : defaultModel;
  } else {
    currentSelectedModel = trimmedSelected || defaultModel;
  }
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

// Sắp xếp models: model người dùng chọn luôn thử trước, sau đó nối chuỗi fallback không trùng lặp
export const getOrderedModels = (selectedModel?: string | null, provider: AiProvider = 'gemini'): string[] => {
  const rawPreferred = selectedModel?.trim() || currentSelectedModel?.trim();
  if (provider === 'agent-platform') {
    const validPreferred =
      rawPreferred && AGENT_PLATFORM_MODELS.includes(rawPreferred)
        ? rawPreferred
        : DEFAULT_AGENT_PLATFORM_MODEL;
    return [validPreferred, ...AGENT_PLATFORM_FALLBACK_MODELS].filter(
      (model, index, models) => models.indexOf(model) === index
    );
  }

  const preferred = rawPreferred || DEFAULT_GEMINI_MODEL;
  return [preferred, ...FALLBACK_MODELS].filter(
    (model, index, models) => models.indexOf(model) === index
  );
};

export const shouldTryFallbackModel = (errorType: string, provider: AiProvider = 'gemini'): boolean => {
  if (
    errorType === 'MODEL_OVERLOADED' ||
    errorType === 'TRANSIENT_SERVER_ERROR' ||
    errorType === 'NETWORK_ERROR' ||
    errorType === 'MODEL_NOT_FOUND' ||
    errorType === 'REQUEST_TIMEOUT' ||
    errorType === 'EMPTY_RESPONSE'
  ) {
    return true;
  }
  if (provider === 'agent-platform' && errorType === 'PERMISSION_DENIED') {
    return true;
  }
  return false;
};

export const generateContentWithModelFallback = async ({
  apiKey,
  selectedModel,
  contents,
  config,
  thinkingLevel = ThinkingLevel.LOW,
  maxOutputTokens,
  responseMimeType,
  systemInstruction,
  logLabel = 'Gemini request',
  provider = 'gemini'
}: {
  apiKey: string;
  selectedModel?: string;
  contents: any;
  config?: any;
  thinkingLevel?: ThinkingLevel;
  maxOutputTokens?: number;
  responseMimeType?: string;
  systemInstruction?: string;
  logLabel?: string;
  provider?: AiProvider;
}) => {
  const activeProvider = provider || currentProvider || 'gemini';
  const ai = createGoogleAiClient(apiKey, activeProvider);
  const modelsToTry = getOrderedModels(selectedModel, activeProvider);
  let lastError: any = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    try {
      console.log(`🤖 ${logLabel} [${activeProvider}]: thử model ${model}`);
      const mergedConfig = createGeminiConfig({
        provider: activeProvider,
        model,
        systemInstruction: systemInstruction ?? config?.systemInstruction,
        responseMimeType: responseMimeType ?? config?.responseMimeType,
        maxOutputTokens: maxOutputTokens ?? config?.maxOutputTokens,
        thinkingLevel: config?.thinkingConfig?.thinkingLevel ?? thinkingLevel,
        tools: config?.tools,
      });

      const response = await ai.models.generateContent({
        model,
        contents,
        ...(Object.keys(mergedConfig).length > 0 ? { config: mergedConfig } : {})
      });
      notifyFallback(null);
      return response;
    } catch (error: any) {
      lastError = error;
      const errorType = parseApiError(error);
      console.warn(`⚠️ ${logLabel} [${activeProvider}]: model ${model} lỗi ${errorType}`, error?.message || error);

      if (!shouldTryFallbackModel(errorType, activeProvider)) {
        break;
      }

      const nextModel = modelsToTry[i + 1];
      if (nextModel) {
        notifyFallback(`Đang tự động chuyển từ ${model} sang ${nextModel} (do ${model} đang bận)...`);
      }
    }
  }

  notifyFallback(null);
  throw lastError || new Error(`Tất cả model ${activeProvider === 'agent-platform' ? 'Agent Platform' : 'Gemini'} đều thất bại. Vui lòng thử lại sau.`);
};

export class StreamTimeoutError extends Error {
  code = 'REQUEST_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'StreamTimeoutError';
  }
}

// Ngưỡng thời gian: chờ token đầu tiên lâu hơn token tiếp theo
const FIRST_CHUNK_TIMEOUT_MS = 60_000;   // 60s không có chữ đầu tiên → bỏ
const IDLE_TIMEOUT_MS = 45_000;          // 45s không có chữ mới → bỏ
const TOTAL_TIMEOUT_MS = 8 * 60_000;     // trần tuyệt đối 8 phút / một model

/**
 * Đọc stream có watchdog. Không phụ thuộc việc SDK có hỗ trợ AbortSignal hay không:
 * nếu quá hạn, ta chủ động reject để thoát khỏi `for await` treo.
 */
const consumeStreamWithWatchdog = async (
  stream: AsyncIterable<any>,
  opts: {
    firstChunkTimeoutMs?: number;
    idleTimeoutMs?: number;
    totalTimeoutMs?: number;
    onChunk: (text: string) => void;
  }
): Promise<void> => {
  const firstMs = opts.firstChunkTimeoutMs ?? FIRST_CHUNK_TIMEOUT_MS;
  const idleMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const totalMs = opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;

  const startedAt = Date.now();
  let receivedAny = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fireTimeout: ((e: Error) => void) | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    fireTimeout = reject;
  });

  const arm = () => {
    if (timer) clearTimeout(timer);
    const remainingTotal = totalMs - (Date.now() - startedAt);
    const window = receivedAny ? idleMs : firstMs;
    const wait = Math.max(1_000, Math.min(window, remainingTotal));
    timer = setTimeout(() => {
      fireTimeout?.(
        new StreamTimeoutError(
          receivedAny
            ? 'AI ngừng trả dữ liệu quá lâu. Vui lòng thử lại.'
            : 'AI chưa phản hồi sau 60 giây. Vui lòng thử lại hoặc chọn model nhẹ hơn.'
        )
      );
    }, wait);
  };

  const iterator = stream[Symbol.asyncIterator]();
  arm();

  try {
    while (true) {
      const next = await Promise.race([iterator.next(), timeoutPromise]);
      if (next.done) break;
      const text = (next.value as any)?.text;
      if (text) {
        receivedAny = true;
        opts.onChunk(text);
      }
      arm();
    }
  } finally {
    if (timer) clearTimeout(timer);
    try {
      await iterator.return?.();   // đóng kết nối, tránh rò rỉ socket
    } catch {
      /* bỏ qua */
    }
  }
};

export const sendMessageStream = async (
  message: string,
  onChunk: (text: string) => void,
  provider?: AiProvider,
  thinkingLevel: ThinkingLevel = ThinkingLevel.MEDIUM
) => {
  const activeProvider = provider || currentProvider || 'gemini';
  if (!currentApiKey) {
    throw new Error("Vui lòng cấu hình API Key trước khi sử dụng tính năng này.");
  }

  let lastError: any = null;
  const modelsToTry = getOrderedModels(undefined, activeProvider);

  console.log(`🚀 Bắt đầu gửi tin nhắn (${activeProvider}). Sẽ thử ${modelsToTry.length} model theo thứ tự: ${modelsToTry.join(' → ')}`);

  // Thử lần lượt các model theo thứ tự fallback
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let fullResponse = "";

    try {
      console.log(`🤖 Đang thử model: ${model} (${activeProvider})`);

      // Tạo session với model hiện tại theo factory pattern & config chuẩn Gemini 3.x / 2.5
      const ai = createGoogleAiClient(currentApiKey, activeProvider);
      const chatConfig = createGeminiConfig({
        provider: activeProvider,
        model,
        systemInstruction: SYSTEM_INSTRUCTION,
        maxOutputTokens: 32768,
        thinkingLevel,
        tools: activeProvider === 'agent-platform' ? [] : [{ googleSearch: {} }]
      });

      chatSession = ai.chats.create({
        model,
        config: chatConfig,
        history
      });

      const responseStream = await chatSession.sendMessageStream({ message });

      await consumeStreamWithWatchdog(responseStream, {
        onChunk: (text) => {
          onChunk(text);
          fullResponse += text;
        },
      });

      // Chặn trường hợp "thành công" nhưng không có một token nào
      // (bộ lọc an toàn chặn, model từ chối, hoặc stream đóng sớm).
      if (!fullResponse.trim()) {
        const emptyErr: any = new Error(
          'AI trả về nội dung rỗng. Có thể yêu cầu bị bộ lọc an toàn chặn hoặc model từ chối xử lý.'
        );
        emptyErr.code = 'EMPTY_RESPONSE';
        throw emptyErr;
      }

      // Thành công - cập nhật history, xóa thông báo fallback và return
      history.push({ role: 'user', parts: [{ text: message }] });
      history.push({ role: 'model', parts: [{ text: fullResponse }] });
      notifyFallback(null);
      console.log(`✅ Thành công với model ${model}`);
      return;

    } catch (error: any) {
      console.error(`❌ Model ${model} thất bại:`, error.message || error);
      lastError = error;

      const errorType = parseApiError(error);
      if (fullResponse.length > 0) {
        console.warn(`⚠️ Model ${model} lỗi sau khi đã stream một phần nội dung; dừng fallback để tránh trộn kết quả.`);
        break;
      }

      if (shouldTryFallbackModel(errorType, activeProvider)) {
        const nextModel = modelsToTry[i + 1];
        if (nextModel) {
          notifyFallback(`Đang tự động chuyển từ ${model} sang ${nextModel} (do ${model} đang bận)...`);
        }
        console.log(`⏭️ Lỗi ${errorType}, thử model tiếp theo...`);
        continue;
      }

      console.log(`⛔ Lỗi ${errorType} không nên fallback model.`);
      break;
    }
  }

  notifyFallback(null);
  console.error(`💀 Tất cả ${modelsToTry.length} models đều thất bại.`);
  throw lastError || new Error("Tất cả models đều thất bại. Vui lòng kiểm tra API key hoặc thử lại sau.");
};

// Phân tích tài liệu để trích xuất thông tin cho SKKN (không dùng chat session)
export const analyzeDocumentForSKKN = async (
  apiKey: string,
  documentContent: string,
  documentType: 'reference' | 'template',
  selectedModel?: string,
  provider?: AiProvider
): Promise<string> => {
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

  try {
    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Phân tích tài liệu SKKN',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192 }
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
  selectedModel?: string,
  provider?: AiProvider
): Promise<SKKNSection[]> => {
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

  try {
    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Trích xuất cấu trúc SKKN',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' }
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
  teachingMethod?: string,
  provider?: AiProvider
): Promise<TitleAnalysisResult> => {
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

  try {
    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Phân tích tên đề tài',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' }
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
  selectedModel?: string,
  provider?: AiProvider
): Promise<EnhancedAnalysisResult> => {
  try {
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

    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Thẩm định biện pháp cũ',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' }
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
  selectedModel?: string,
  provider?: AiProvider
): Promise<Array<{ title: string; rationale: string }>> => {
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

  try {
    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Brainstorm tên đề tài',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' }
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
  selectedModel?: string,
  provider?: AiProvider
): Promise<Array<{ method: string; reason: string }>> => {
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

  try {
    const response = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      contents: prompt,
      logLabel: 'Gợi ý phương pháp',
      provider,
      thinkingLevel: ThinkingLevel.LOW,
      config: { maxOutputTokens: 8192, responseMimeType: 'application/json' }
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
