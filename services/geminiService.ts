import { GoogleGenAI, Chat, ThinkingLevel } from "@google/genai";
import {
  SYSTEM_INSTRUCTION,
  FALLBACK_MODELS,
  AGENT_PLATFORM_MODELS,
  AGENT_PLATFORM_FALLBACK_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_AGENT_PLATFORM_MODEL,
  getModelConfigSafe,
  isGemini3Or4,
} from "../constants";
import { TEACHING_METHODS, METHOD_SUGGESTION_RULES } from "../data/teachingMethods";
import { TitleAnalysisResult, AiProvider } from '../types';
import { apiKeyManager } from './apiKeyManager';

export { ThinkingLevel };

export type FallbackNoticeCallback = (notice: string | null) => void;
export type KeyChangedCallback = (newKey: string) => void;

// Callback hiển thị thông báo chuyển model / xoay key tạm thời (tự ẩn khi hoàn tất)
let globalFallbackNoticeCallback: FallbackNoticeCallback | null = null;
let globalKeyChangedCallback: KeyChangedCallback | null = null;

export const setOnFallbackNotice = (callback: FallbackNoticeCallback | null) => {
  globalFallbackNoticeCallback = callback;
};

export const setOnKeyChanged = (callback: KeyChangedCallback | null) => {
  globalKeyChangedCallback = callback;
};

export const notifyFallback = (notice: string | null, localCallback?: FallbackNoticeCallback) => {
  if (localCallback) {
    localCallback(notice);
  }
  if (globalFallbackNoticeCallback) {
    globalFallbackNoticeCallback(notice);
  }
};

const emitKeyChanged = (newKey: string) => {
  if (globalKeyChangedCallback && newKey) {
    globalKeyChangedCallback(newKey);
  }
};

// ============================================================
// SERVER PROXY STATUS (Vercel Edge /api/gemini — giữ key ngầm 100%)
// ============================================================
export interface ServerProxyStatus {
  checked: boolean;
  available: boolean;
  keyCount: number;
}

let serverProxyStatus: ServerProxyStatus = {
  checked: false,
  available: false,
  keyCount: 0,
};

export const getServerProxyStatus = (): ServerProxyStatus => ({ ...serverProxyStatus });

export const checkServerProxyAvailable = async (force = false): Promise<ServerProxyStatus> => {
  if (serverProxyStatus.checked && !force) {
    return { ...serverProxyStatus };
  }
  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    serverProxyStatus = { checked: true, available: false, keyCount: 0 };
    return { ...serverProxyStatus };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch('/api/gemini', {
        method: 'GET',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        serverProxyStatus = {
          checked: true,
          available: Boolean(data?.available),
          keyCount: Number(data?.keyCount) || 0,
        };
      } else {
        serverProxyStatus = { checked: true, available: false, keyCount: 0 };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    serverProxyStatus = { checked: true, available: false, keyCount: 0 };
  }
  return { ...serverProxyStatus };
};

// ============================================================
// CLIENT FACTORY — điểm duy nhất khởi tạo SDK (api.md §III)
// ============================================================
export const createGoogleAiClient = (apiKey: string, provider: AiProvider = 'gemini'): GoogleGenAI => {
  if (provider === 'agent-platform') {
    // Cờ kỹ thuật của Google Gen AI SDK để định tuyến tới aiplatform.googleapis.com trong chế độ API key
    return new GoogleGenAI({ vertexai: true, apiKey });
  }
  return new GoogleGenAI({ apiKey });
};

// ============================================================
// PHÂN LOẠI LỖI (api.md v5.0)
// ============================================================
export type ApiErrorType =
  | 'MODEL_OVERLOADED'        // 503/UNAVAILABLE/overloaded → chuyển model
  | 'TRANSIENT_SERVER_ERROR'  // 500/502/504/DEADLINE_EXCEEDED/fetch failed → chuyển model
  | 'NOT_FOUND'               // 404 → bỏ model này, chuyển model
  | 'QUOTA_EXCEEDED'          // 429 → xoay key trước, hết key thì chuyển model Free khác
  | 'RATE_LIMIT'              // RPM rate limit → xoay key / chờ ngắn / chuyển model
  | 'INVALID_API_KEY'         // 401/API_KEY_INVALID → đánh dấu key lỗi & xoay sang key khác
  | 'PERMISSION_DENIED'       // 403 → xoay key (Gemini) hoặc thử model tiếp (Agent Platform)
  | 'INVALID_ARGUMENT'        // 400 → dừng ngay (trừ lỗi thinkingConfig / tools)
  | 'NETWORK_ERROR'           // kết nối → chuyển model
  | 'UNKNOWN';

const FALLBACKABLE_ERRORS: ApiErrorType[] = [
  'MODEL_OVERLOADED',
  'TRANSIENT_SERVER_ERROR',
  'NOT_FOUND',
  'NETWORK_ERROR',
];

const extractStatusCode = (error: any, message: string): number => {
  const direct = Number(error?.status ?? error?.httpCode ?? error?.code ?? error?.error?.code);
  if (Number.isInteger(direct) && direct >= 100 && direct < 600) return direct;
  const match = message.match(/got status:\s*(\d{3})/) || message.match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : 0;
};

// Trích xuất thời gian gợi ý chờ thử lại (giây) từ thông báo lỗi 429 của Google
export const extractRetryDelaySeconds = (error: any): number | undefined => {
  const raw = `${error?.message || ''} ${(() => { try { return JSON.stringify(error || {}); } catch { return ''; } })()}`;
  const m1 = raw.match(/retry\s+in\s+([\d.]+)\s*s/i);
  if (m1) return Math.ceil(Number(m1[1]));
  const m2 = raw.match(/"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (m2) return Math.ceil(Number(m2[1]));
  return undefined;
};

// Nhận diện lỗi giới hạn theo phút (RPM/TPM) so với hết quota theo ngày (RPD)
export const isPerMinuteRateLimit = (error: any): boolean => {
  const raw = `${error?.message || ''} ${(() => { try { return JSON.stringify(error || {}); } catch { return ''; } })()}`.toLowerCase();
  if (raw.includes('perday') || raw.includes('per_day') || raw.includes('daily')) return false;
  if (raw.includes('perminute') || raw.includes('per_minute') || raw.includes('requests per minute') || raw.includes('tokens per minute')) {
    return true;
  }
  const delaySec = extractRetryDelaySeconds(error);
  return delaySec !== undefined && delaySec > 0 && delaySec <= 90;
};

// Hàm phân tích và trả về phân loại lỗi chuẩn theo api.md v5.0
export const parseApiError = (error: any): ApiErrorType => {
  const rawMessage = String(error?.message || error?.toString() || '');
  const errorMessage = rawMessage.toLowerCase();
  const statusCode = extractStatusCode(error, rawMessage);
  let errorString = '';
  try { errorString = JSON.stringify(error || {}).toLowerCase(); } catch { /* circular */ }
  const combined = `${errorMessage} ${errorString}`;

  // Timeout / DEADLINE_EXCEEDED phải xét TRƯỚC quota, vì "deadline_exceeded" chứa chữ "exceeded"
  if (
    statusCode === 504 ||
    combined.includes('deadline_exceeded') ||
    combined.includes('deadline exceeded') ||
    combined.includes('gateway timeout') ||
    combined.includes('timeout')
  ) {
    return 'TRANSIENT_SERVER_ERROR';
  }

  // 401 / API_KEY_INVALID → key sai hoặc hết hạn
  if (
    statusCode === 401 ||
    combined.includes('api_key_invalid') ||
    combined.includes('api key not valid') ||
    combined.includes('api key expired') ||
    combined.includes('api_key_expired') ||
    combined.includes('unauthenticated') ||
    combined.includes('unauthorized')
  ) {
    return 'INVALID_API_KEY';
  }

  // 429 / RESOURCE_EXHAUSTED → quota hoặc giới hạn tốc độ (KHÔNG đánh dấu key invalid)
  if (statusCode === 429 || combined.includes('resource_exhausted') || combined.includes('quota')) {
    return isPerMinuteRateLimit(error) ? 'RATE_LIMIT' : 'QUOTA_EXCEEDED';
  }

  if (combined.includes('rate limit') || combined.includes('too many requests')) {
    return 'RATE_LIMIT';
  }

  // 403 / PERMISSION_DENIED
  if (statusCode === 403 || combined.includes('permission_denied') || combined.includes('forbidden')) {
    return 'PERMISSION_DENIED';
  }

  // 404 NOT_FOUND → cho phép fallback
  if (
    statusCode === 404 ||
    combined.includes('not_found') ||
    combined.includes('is not found') ||
    combined.includes('not supported for generatecontent')
  ) {
    return 'NOT_FOUND';
  }

  // 400 / INVALID_ARGUMENT → dừng ngay (trừ lỗi thinkingConfig / tools)
  if (statusCode === 400 || combined.includes('invalid_argument') || combined.includes('bad request')) {
    return 'INVALID_ARGUMENT';
  }

  // 503 / UNAVAILABLE / overloaded → MODEL_OVERLOADED
  if (
    statusCode === 503 ||
    combined.includes('unavailable') ||
    combined.includes('overloaded') ||
    combined.includes('high demand') ||
    combined.includes('try again later')
  ) {
    return 'MODEL_OVERLOADED';
  }

  // 500 / 502 / transient network → TRANSIENT_SERVER_ERROR
  if (
    statusCode === 500 ||
    statusCode === 502 ||
    combined.includes('internal') ||
    combined.includes('bad gateway') ||
    combined.includes('fetch failed') ||
    combined.includes('failed to fetch') ||
    combined.includes('networkerror') ||
    combined.includes('econnreset') ||
    combined.includes('etimedout')
  ) {
    return 'TRANSIENT_SERVER_ERROR';
  }

  if (errorMessage.includes('rate') && errorMessage.includes('limit')) {
    return 'RATE_LIMIT';
  }

  if (
    errorMessage.includes('network') ||
    errorMessage.includes('fetch') ||
    errorMessage.includes('connection') ||
    errorMessage.includes('econnrefused')
  ) {
    return 'NETWORK_ERROR';
  }

  return 'UNKNOWN';
};

// Kiểm tra lỗi có được phép fallback sang model khác trực tiếp không (KHÔNG đánh dấu key lỗi)
export const isFallbackableError = (errorType: ApiErrorType, provider: AiProvider = 'gemini'): boolean => {
  if (FALLBACKABLE_ERRORS.includes(errorType)) return true;
  if (provider === 'agent-platform' && errorType === 'PERMISSION_DENIED') return true;
  return false;
};

// Giữ tương thích tên export cũ
export const shouldTryFallbackModel = (errorType: string, provider: AiProvider = 'gemini'): boolean => {
  return (
    isFallbackableError(errorType as ApiErrorType, provider) ||
    errorType === 'QUOTA_EXCEEDED' ||
    errorType === 'RATE_LIMIT' ||
    errorType === 'PERMISSION_DENIED'
  );
};

// Hàm tạo thông báo lỗi thân thiện
export const getFriendlyErrorMessage = (error: any): { type: string; title: string; message: string; suggestions: string[] } => {
  const errorType = parseApiError(error);
  const stats = apiKeyManager.getKeyStats('gemini');

  switch (errorType) {
    case 'MODEL_OVERLOADED':
    case 'TRANSIENT_SERVER_ERROR':
      return {
        type: 'overloaded',
        title: '⚡ Model đang quá tải tạm thời',
        message: 'Các model Google Gemini đang quá tải tạm thời. Đây là lỗi dịch vụ từ phía Google, không phải lỗi API Key.',
        suggestions: [
          '🔄 Bấm "Thử lại" sau vài chục giây — dữ liệu đã viết vẫn được giữ nguyên',
          '⚡ Chọn model tốc độ cao như Gemini 4 Hydrogen hoặc Gemini 3.5 Flash-Lite trong Cài đặt',
          '🔑 Giữ nguyên API Key hiện tại (key của bạn vẫn hoạt động bình thường)'
        ]
      };

    case 'NOT_FOUND':
      return {
        type: 'not_found',
        title: '🔍 Model không khả dụng',
        message: 'Model hoặc endpoint không khả dụng với API Key này.',
        suggestions: [
          '🔄 App đã tự động thử các model miễn phí dự phòng',
          '📋 Chọn Gemini 4 Hydrogen hoặc Gemini 3.8 Flash trong Cài đặt'
        ]
      };

    case 'QUOTA_EXCEEDED':
      return {
        type: 'quota',
        title: '⚠️ Đã hết quota trên tất cả key và model hiện có',
        message: stats.total <= 1
          ? 'API key hiện tại đã hết hạn mức trên tất cả các model miễn phí. Bạn nên thêm 2–5 API key từ các Gmail khác nhau để app tự động xoay vòng không bị ngắt quãng.'
          : `Tất cả ${stats.total} API key trong kho đều đã hết hạn mức (hoặc đang tạm nghỉ) trên các model miễn phí. Hãy dán thêm API key mới hoặc đợi hồi phục.`,
        suggestions: [
          '🔑 Bấm "Thêm / Quản lý nhiều API Key" → dán cùng lúc nhiều key từ các Gmail khác nhau (mỗi dòng 1 key) để app tự xoay vòng',
          '🌐 Tạo thêm API key miễn phí tại aistudio.google.com/api-keys bằng tài khoản Gmail khác',
          '⏰ Đợi vài phút (nếu hết hạn mức phút RPM) hoặc đến hôm sau khi quota ngày reset (14h–15h giờ VN)',
          '💾 Bấm "Lưu phiên" ở thanh bên trái để không mất tiến độ Biện pháp đang viết'
        ]
      };

    case 'RATE_LIMIT':
      return {
        type: 'rate_limit',
        title: '🚦 Vượt giới hạn tốc độ gửi yêu cầu (RPM)',
        message: 'Các API key đang gửi quá nhiều yêu cầu trong 1 phút. Hạn mức tốc độ sẽ tự hồi phục sau khoảng 30–60 giây.',
        suggestions: [
          '⏳ Đợi 30–60 giây rồi bấm "Thử lại" để tiếp tục ngay',
          '🔑 Dán thêm 2–3 API key dự phòng trong Cài đặt để app tự chuyển key khi bị giới hạn tốc độ',
          '🔄 Không bấm nút gửi nhiều lần liên tiếp'
        ]
      };

    case 'INVALID_API_KEY':
      return {
        type: 'auth',
        title: '🔐 API Key không hợp lệ hoặc đã hết hạn',
        message: 'API Key không hợp lệ hoặc đã bị thu hồi. Vui lòng kiểm tra lại trong Cài đặt.',
        suggestions: [
          '🔑 Mở Cài đặt API Key → bấm "Kiểm tra tất cả" để lọc bỏ key lỗi',
          '🆕 Tạo API Key mới tại Google AI Studio (aistudio.google.com/api-keys)',
          '📋 Đảm bảo copy đầy đủ key (AIzaSy... hoặc AQ...), không thừa ký tự'
        ]
      };

    case 'PERMISSION_DENIED':
      return {
        type: 'permission',
        title: '🚫 Không có quyền truy cập',
        message: 'API key không có quyền truy cập dịch vụ hoặc model này. Google đã nhận key nhưng dự án/key chưa được cấp quyền.',
        suggestions: [
          '🔧 Kiểm tra API đã được bật trong Google Cloud Console / AI Studio',
          '🔑 Kiểm tra API restrictions trên key hoặc thêm key từ Gmail khác',
          '📋 Nếu dùng Agent Platform: đảm bảo đã bật Agent Platform API'
        ]
      };

    case 'INVALID_ARGUMENT':
      return {
        type: 'invalid_arg',
        title: '⚙️ Lỗi tham số yêu cầu',
        message: 'Yêu cầu gửi tới AI có tham số không hợp lệ hoặc tài liệu đính kèm quá lớn.',
        suggestions: [
          '🔄 Thử lại với nội dung hoặc tài liệu tham khảo ngắn hơn',
          '📋 Chọn model Gemini 4 Hydrogen hoặc Gemini 3.8 Flash trong Cài đặt'
        ]
      };

    case 'NETWORK_ERROR':
      return {
        type: 'network',
        title: '🌐 Lỗi kết nối mạng',
        message: 'Không thể kết nối đến máy chủ Google AI. Hãy kiểm tra kết nối internet của bạn.',
        suggestions: [
          '📶 Kiểm tra kết nối WiFi/Internet',
          '🔄 Bấm "Thử lại" hoặc làm mới trang (F5)',
          '🌍 Thử sử dụng mạng khác'
        ]
      };

    default:
      return {
        type: 'unknown',
        title: '❌ Đã xảy ra lỗi',
        message: error?.message || 'Có lỗi không xác định xảy ra khi gọi AI.',
        suggestions: [
          '🔄 Bấm "Thử lại" để tiếp tục từ bước hiện tại',
          '🔑 Kiểm tra kho API Key trong Cài đặt',
          '⏰ Đợi một lúc rồi thử lại'
        ]
      };
  }
};

/**
 * Lấy câu thông báo gốc của Google trong lỗi SDK (message thường chứa JSON lồng nhau),
 * ví dụ "Quota exceeded for metric: ...generate_content_free_tier_requests, limit: 0, model: gemini-4-hydrogen".
 */
export const extractGoogleErrorDetail = (error: any): string => {
  const raw = typeof error === 'string' ? error : (error?.message || '');
  const matches = [...raw.matchAll(/\\*"message\\*"\s*:\s*\\*"((?:[^"\\]|\\.)*?)\\*"/g)].map(m => m[1]);
  const detail = (matches.length > 0 ? matches[matches.length - 1] : raw)
    .replace(/\\+n/g, ' ')
    .replace(/\\+"/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  const quotaParts = detail.match(/Quota exceeded for metric:.*?(?=\s\*\s|\sPlease retry|$)/g);
  if (quotaParts) {
    const retry = detail.match(/Please retry in [\d.]+m?s/);
    return [...quotaParts, retry?.[0]].filter(Boolean).join(' | ');
  }
  return detail.length > 300 ? detail.slice(0, 300) + '…' : detail;
};

let chatSession: Chat | null = null;
let currentApiKey: string | null = null;
let currentSelectedModel: string | null = null;
let currentProvider: AiProvider = 'gemini';
let history: any[] = []; // Store history to restore when switching models or keys

// Model trả 404 (không tồn tại / key chưa được mở) → bỏ qua trong phiên này
const unavailableModels = new Set<string>();
// Model báo không hỗ trợ thinkingConfig (400) → gửi lại không kèm thinkingConfig
const noThinkingModels = new Set<string>();
// Model báo không hỗ trợ tools (400) → gửi lại không kèm tools
const noToolsModels = new Set<string>();

const modelCacheKey = (model: string, provider: AiProvider) => `${provider}:${model}`;

const isThinkingConfigError = (error: any): boolean => {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('thinking');
};

const isToolsConfigError = (error: any): boolean => {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('tool') || msg.includes('google_search') || msg.includes('googlesearch');
};

const toThinkingLevelEnum = (level?: string | ThinkingLevel): ThinkingLevel | undefined => {
  if (!level) return undefined;
  const upper = String(level).toUpperCase();
  switch (upper) {
    case 'LOW': return ThinkingLevel.LOW;
    case 'MEDIUM': return ThinkingLevel.MEDIUM;
    case 'HIGH': return ThinkingLevel.HIGH;
    case 'MINIMAL': return ThinkingLevel.LOW; // Không gửi MINIMAL cho Gemini 4 & 3.8/3.6/3-flash-preview
    default: return undefined;
  }
};

const resolveActiveProvider = (provider?: AiProvider): AiProvider => {
  if (provider) return provider;
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('google_ai_provider') : null;
    if (stored === 'agent-platform') return 'agent-platform';
    if (stored === 'gemini') return 'gemini';
  } catch {
    // ignore storage access errors
  }
  return currentProvider || 'gemini';
};

export const initializeGeminiChat = (apiKey: string, selectedModel?: string, provider: AiProvider = 'gemini') => {
  const nextProvider = provider || 'gemini';
  if (currentApiKey !== apiKey || currentProvider !== nextProvider) {
    unavailableModels.clear();
  }
  currentApiKey = apiKey;
  currentProvider = nextProvider;
  const defaultModel = nextProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
  const trimmedSelected = selectedModel?.trim();
  if (nextProvider === 'agent-platform') {
    currentSelectedModel =
      trimmedSelected && AGENT_PLATFORM_MODELS.includes(trimmedSelected)
        ? trimmedSelected
        : defaultModel;
  } else {
    currentSelectedModel =
      trimmedSelected && FALLBACK_MODELS.includes(trimmedSelected)
        ? trimmedSelected
        : defaultModel;
  }
  chatSession = null;
  history = []; // Reset history on new initialization
};

/**
 * Đổi API key / model / provider mà KHÔNG xóa lịch sử hội thoại.
 * initializeGeminiChat() xóa history nên không được dùng giữa chừng quá trình viết Biện pháp.
 */
export const updateApiKey = (apiKey: string, selectedModel?: string, provider?: AiProvider) => {
  if (provider && provider !== currentProvider) {
    unavailableModels.clear();
    currentProvider = provider;
  }
  if (apiKey !== currentApiKey) {
    unavailableModels.clear();
  }
  currentApiKey = apiKey;
  if (selectedModel) {
    const trimmed = selectedModel.trim();
    const validList = currentProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : FALLBACK_MODELS;
    if (validList.includes(trimmed)) {
      currentSelectedModel = trimmed;
    }
  }
  chatSession = null;
};

// Lấy lịch sử chat để lưu phiên làm việc
export const getChatHistory = (): any[] => {
  return [...history];
};

// Khôi phục lịch sử chat từ phiên đã lưu
export const setChatHistory = (savedHistory: any[]) => {
  history = savedHistory || [];
};

/**
 * Chuẩn hóa cấu hình request theo đúng thế hệ model (Gemini 4.x / 3.x vs 2.x) và provider (api.md v5.0).
 * - TUYỆT ĐỐI KHÔNG gửi temperature, topP, topK, thinkingBudget cho mọi model gemini-4* và gemini-3*
 * - Không gửi thinkingLevel cho model flash-lite (để mặc định của Google cho tốc độ cao nhất)
 * - Không gửi ThinkingLevel.MINIMAL cho gemini-4* hoặc gemini-3.8/3.6/3-flash-preview
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
  const cfg = getModelConfigSafe(model);
  const isModern = isGemini3Or4(model);
  const isLite = model.includes('lite');
  const cacheK = modelCacheKey(model, provider);
  const thinkingAllowed = !noThinkingModels.has(cacheK);
  const toolsAllowed = !noToolsModels.has(cacheK);

  const result: Record<string, any> = {
    maxOutputTokens: maxOutputTokens ?? cfg.maxOutputTokens,
  };

  if (systemInstruction) {
    result.systemInstruction = systemInstruction;
  }
  if (responseMimeType) {
    result.responseMimeType = responseMimeType;
  }

  if (isModern) {
    // Gemini 4.x & 3.x: KHÔNG truyền temperature, topP, topK, thinkingBudget
    if (thinkingAllowed && provider !== 'agent-platform' && !isLite) {
      const safeLevel = toThinkingLevelEnum(thinkingLevel || cfg.thinkingLevel);
      if (safeLevel) {
        result.thinkingConfig = { thinkingLevel: safeLevel };
      }
    }
  } else {
    // Gemini 2.x: cho phép truyền temperature & thinkingBudget
    if (cfg.temperature !== undefined) result.temperature = cfg.temperature;
    if (cfg.topK !== undefined) result.topK = cfg.topK;
    if (cfg.topP !== undefined) result.topP = cfg.topP;
    if (thinkingAllowed && provider !== 'agent-platform' && cfg.thinkingBudget && !isLite) {
      result.thinkingConfig = { thinkingBudget: cfg.thinkingBudget };
    }
  }

  if (toolsAllowed && tools && tools.length > 0 && provider !== 'agent-platform') {
    result.tools = tools;
  }

  return result;
};

// Sắp xếp models — chọn fallback list theo provider (api.md v5.0)
export const getOrderedModels = (
  selectedModel?: string | null,
  provider: AiProvider = currentProvider
): string[] => {
  const rawPreferred = selectedModel?.trim() || currentSelectedModel?.trim();
  const allowedModels = provider === 'agent-platform'
    ? [...AGENT_PLATFORM_MODELS]
    : [...FALLBACK_MODELS];
  const fallbackList = provider === 'agent-platform'
    ? [...AGENT_PLATFORM_FALLBACK_MODELS]
    : [...FALLBACK_MODELS];

  const ordered = (!rawPreferred || !allowedModels.includes(rawPreferred))
    ? fallbackList
    : [rawPreferred, ...fallbackList.filter((model) => model !== rawPreferred)];

  // Bỏ các model đã trả 404 trong phiên; nếu bỏ hết thì vẫn thử lại toàn bộ
  const available = ordered.filter((model) => !unavailableModels.has(modelCacheKey(model, provider)));
  return available.length > 0 ? available : ordered;
};

const fallbackReason = (error: any): string => {
  const t = parseApiError(error);
  if (t === 'NOT_FOUND') return 'không khả dụng với API key này';
  if (t === 'QUOTA_EXCEEDED' || t === 'RATE_LIMIT') return 'hết lượt quota';
  if (t === 'PERMISSION_DENIED') return 'không mở cho API key này';
  return 'đang bận';
};

// Chờ có thể hủy bằng AbortSignal (dùng cho nhịp chờ ngắn khi dính RPM)
const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Đã hủy yêu cầu.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Đã hủy yêu cầu.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

// Chuẩn hóa contents & config sang định dạng REST v1beta cho Server Proxy /api/gemini
const buildProxyRequestBody = (
  model: string,
  contents: any,
  config: any,
  stream: boolean
) => {
  const normalizedContents = typeof contents === 'string'
    ? [{ role: 'user', parts: [{ text: contents }] }]
    : Array.isArray(contents)
      ? contents
      : [contents];

  const {
    systemInstruction,
    tools,
    httpOptions: _httpOptions,
    abortSignal: _abortSignal,
    ...generationConfig
  } = config || {};

  return {
    model,
    contents: normalizedContents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(Array.isArray(tools) && tools.length > 0 ? { tools } : {}),
    generationConfig,
    stream,
  };
};

// Trích xuất text từ 1 JSON candidate của Gemini REST API (bỏ qua thought summary)
const extractTextFromRestPayload = (data: any): string => {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p: any) => p && typeof p.text === 'string' && !p.thought)
    .map((p: any) => p.text)
    .join('');
};

// ============================================================
// TIMEOUT & ABORT CONFIGURATION
// ============================================================
const REQUEST_TIMEOUT_MS = 4 * 60 * 1000; // 4 phút cho tác vụ không stream (phân tích, thẩm định, sửa DOCX)
const FIRST_CHUNK_TIMEOUT_MS = 45_000;    // 45s chờ kết nối / chunk đầu tiên
const INTER_CHUNK_TIMEOUT_MS = 45_000;    // 45s chờ giữa các chunk
const TOTAL_STREAM_TIMEOUT_MS = 600_000;  // 10 phút tổng thời gian stream

let currentAbortController: AbortController | null = null;

/** Hủy stream đang chạy (gọi từ UI khi user muốn dừng) */
export const abortCurrentStream = () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    console.log('🛑 Đã hủy stream theo yêu cầu người dùng.');
  }
};

/** Kiểm tra stream có đang chạy không */
export const isStreamActive = (): boolean => {
  return currentAbortController !== null && !currentAbortController.signal.aborted;
};

const createTimeout = (ms: number, label: string): { promise: Promise<never>; clear: () => void } => {
  let timerId: ReturnType<typeof setTimeout>;
  const promise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`⏰ Timeout: ${label} (${Math.round(ms / 1000)}s). Vui lòng thử lại.`));
    }, ms);
  });
  return { promise, clear: () => clearTimeout(timerId) };
};

/** Làm sạch HTML tags thừa từ AI output */
const sanitizeAIOutput = (text: string): string => {
  let clean = text;
  clean = clean.replace(/<br\s*\/?>/gi, '\n');
  clean = clean.replace(/<\/?(p|div|span|b|i|em|strong|u|s|del|ins|mark|sub|sup|small|big|center)(\s[^>]*)?>/gi, '');
  return clean;
};

// Gọi generateContent qua Vercel Edge Proxy /api/gemini (ẩn key 100%)
const callServerProxyGenerateContent = async ({
  model,
  contents,
  config,
  signal,
}: {
  model: string;
  contents: any;
  config: any;
  signal?: AbortSignal;
}): Promise<{ text: string; modelVersion: string }> => {
  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildProxyRequestBody(model, contents, config, false)),
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err: any = new Error(errText || `Server proxy got status: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return {
    text: extractTextFromRestPayload(data),
    modelVersion: data?.modelVersion || model,
  };
};

// Gọi generateContentStream qua Vercel Edge Proxy /api/gemini (SSE)
const callServerProxyStream = async ({
  model,
  contents,
  config,
  onChunk,
  signal,
  abortPromise,
}: {
  model: string;
  contents: any;
  config: any;
  onChunk: (text: string) => void;
  signal?: AbortSignal;
  abortPromise?: Promise<never>;
}): Promise<{ fullResponse: string; hasEmittedChunks: boolean }> => {
  const connectTimeout = createTimeout(FIRST_CHUNK_TIMEOUT_MS, `Kết nối Server Proxy tới ${model}`);
  let res: Response;
  try {
    const races: Promise<any>[] = [
      fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildProxyRequestBody(model, contents, config, true)),
        signal,
      }),
      connectTimeout.promise,
    ];
    if (abortPromise) races.push(abortPromise);
    res = await Promise.race(races);
  } finally {
    connectTimeout.clear();
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const err: any = new Error(errText || `Server proxy got status: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (!res.body) {
    throw new Error('Server proxy không trả về luồng dữ liệu.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullResponse = '';
  let hasEmittedChunks = false;
  let receivedFirstChunk = false;
  const totalTimeout = createTimeout(TOTAL_STREAM_TIMEOUT_MS, `Tổng thời gian stream từ ${model} quá dài`);

  try {
    while (true) {
      const timeoutMs = receivedFirstChunk ? INTER_CHUNK_TIMEOUT_MS : FIRST_CHUNK_TIMEOUT_MS;
      const chunkTimeout = createTimeout(timeoutMs, `Chờ phản hồi từ ${model}`);
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        const races: Promise<any>[] = [reader.read(), chunkTimeout.promise, totalTimeout.promise];
        if (abortPromise) races.push(abortPromise);
        readResult = await Promise.race(races);
      } finally {
        chunkTimeout.clear();
      }

      if (readResult.done) break;
      buffer += decoder.decode(readResult.value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const text = extractTextFromRestPayload(parsed);
          if (text) {
            receivedFirstChunk = true;
            hasEmittedChunks = true;
            const cleanText = sanitizeAIOutput(text);
            onChunk(cleanText);
            fullResponse += cleanText;
          }
        } catch {
          // Bỏ qua frame SSE không đầy đủ
        }
      }
    }
  } finally {
    totalTimeout.clear();
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  return { fullResponse, hasEmittedChunks };
};

// Helper lấy danh sách key ứng viên cho 1 model (tôn trọng provider và allowKeyRotation)
const resolveCandidateKeys = (
  model: string,
  preferredKey: string | null | undefined,
  provider: AiProvider,
  allowKeyRotation: boolean
): string[] => {
  if (provider !== 'gemini' || !allowKeyRotation) {
    return preferredKey ? [preferredKey] : [];
  }
  const poolKeys = apiKeyManager.getAvailableKeysForModel(model, preferredKey || undefined, 'gemini');
  if (poolKeys.length > 0) return poolKeys;
  if (preferredKey && !apiKeyManager.getAllKeys('gemini').some(k => k.key === preferredKey)) {
    return [preferredKey];
  }
  return [];
};

// Khi mọi cặp (key, model) đều lỗi, ưu tiên trả về lỗi hữu ích nhất cho người dùng
const pickReportedError = (errors: any[]): any => {
  const priority: ApiErrorType[] = ['QUOTA_EXCEEDED', 'RATE_LIMIT', 'INVALID_API_KEY', 'PERMISSION_DENIED'];
  for (const type of priority) {
    const found = errors.find(e => parseApiError(e) === type);
    if (found) return found;
  }
  return errors[errors.length - 1];
};

/**
 * Helper gọi generateContent đơn lẻ có đầy đủ xoay toàn bộ kho key + fallback model 2 tầng + Server Proxy + chờ ngắn RPM (api.md v5.0).
 * Dùng chung cho mọi tác vụ phụ trợ & nâng cao: phân tích tài liệu, trích xuất mẫu, phân tích tên đề tài,
 * thẩm định biện pháp cũ, brainstorm tên đề tài, gợi ý phương pháp, và sửa trực tiếp file DOCX.
 */
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
  provider,
  onFallback,
  allowKeyRotation = true,
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
  onFallback?: FallbackNoticeCallback;
  allowKeyRotation?: boolean;
}) => {
  const activeProvider = resolveActiveProvider(provider);

  if (activeProvider === 'gemini' && allowKeyRotation && !serverProxyStatus.checked) {
    await checkServerProxyAvailable();
  }

  const executePass = async (): Promise<any> => {
    const modelsToTry = getOrderedModels(selectedModel, activeProvider);
    let lastError: any = null;
    const errors: any[] = [];
    let activePreferredKey =
      apiKey ||
      currentApiKey ||
      (activeProvider === 'gemini' ? apiKeyManager.getActiveKey(modelsToTry[0], 'gemini') : '') ||
      '';

    console.log(`🚀 [${logLabel}] (${activeProvider}) Thử ${modelsToTry.length} model: ${modelsToTry.join(' → ')}`);

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const model = modelsToTry[mIdx];
      const keysForModel = resolveCandidateKeys(model, activePreferredKey, activeProvider, allowKeyRotation);
      let modelFailedByAvailability = false;

      // 1. Thử lần lượt tất cả các API key khả dụng cho model này
      for (let kIdx = 0; kIdx < keysForModel.length; kIdx++) {
        const keyToUse = keysForModel[kIdx];
        let retriedWithoutThinking = false;
        let retriedWithoutTools = false;

        while (true) {
          try {
            console.log(`🤖 [${logLabel}] Model ${model} | Key [${kIdx + 1}/${keysForModel.length}] (${apiKeyManager.maskKey(keyToUse)})`);
            const ai = createGoogleAiClient(keyToUse, activeProvider);
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
              config: { ...mergedConfig, httpOptions: { timeout: REQUEST_TIMEOUT_MS } },
            });

            if (activeProvider === 'gemini' && allowKeyRotation && keyToUse !== currentApiKey) {
              currentApiKey = keyToUse;
              emitKeyChanged(keyToUse);
            }
            console.log(`✅ [${logLabel}] Thành công với ${model}`);
            notifyFallback(null, onFallback);
            return response;
          } catch (error: any) {
            lastError = error;
            errors.push(error);
            const errorType = parseApiError(error);
            console.warn(`⚠️ [${logLabel}] ${model} (${apiKeyManager.maskKey(keyToUse)}) lỗi ${errorType}:`, error?.message || error);

            const cacheK = modelCacheKey(model, activeProvider);
            // Lỗi thinkingConfig → gửi lại đúng key + model này không kèm thinkingConfig
            if (errorType === 'INVALID_ARGUMENT' && isThinkingConfigError(error) && !retriedWithoutThinking && !noThinkingModels.has(cacheK)) {
              noThinkingModels.add(cacheK);
              retriedWithoutThinking = true;
              continue;
            }
            // Lỗi tools → gửi lại đúng key + model này không kèm tools
            if (errorType === 'INVALID_ARGUMENT' && isToolsConfigError(error) && !retriedWithoutTools && !noToolsModels.has(cacheK)) {
              noToolsModels.add(cacheK);
              retriedWithoutTools = true;
              continue;
            }

            // Lỗi do model/mạng (503, 500, 502, 504, 404, network) → KHÔNG phạt key, chuyển model
            if (isFallbackableError(errorType, activeProvider)) {
              if (errorType === 'NOT_FOUND') unavailableModels.add(cacheK);
              modelFailedByAvailability = true;
              break;
            }

            // Lỗi quota / rate limit / key sai / quyền trên Gemini API
            if (
              activeProvider === 'gemini' &&
              allowKeyRotation &&
              (errorType === 'QUOTA_EXCEEDED' ||
                errorType === 'RATE_LIMIT' ||
                errorType === 'INVALID_API_KEY' ||
                errorType === 'PERMISSION_DENIED')
            ) {
              if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
                apiKeyManager.markKeyModelQuotaError(keyToUse, model, errorType, {
                  isPerMinute: isPerMinuteRateLimit(error),
                  retryDelaySec: extractRetryDelaySeconds(error),
                }, 'gemini');
              } else {
                apiKeyManager.markKeyError(keyToUse, errorType, model, 'gemini');
              }

              const nextKey = keysForModel[kIdx + 1];
              if (nextKey) {
                activePreferredKey = nextKey;
                notifyFallback(
                  `🔑 Key hiện tại hết lượt ${model} — tự động xoay sang key dự phòng (${kIdx + 2}/${keysForModel.length})...`,
                  onFallback
                );
              }
              break; // Chuyển sang key tiếp theo trong vòng kIdx
            }

            // Khi tắt xoay key (testApiKey) hoặc lỗi cứng (400 payload xấu, Agent Platform 401/429...) → dừng ngay
            notifyFallback(null, onFallback);
            throw error;
          }
        }

        if (modelFailedByAvailability) break;
      }

      // 2. Nếu chưa thành công với key client & có Server Proxy ngầm trên Vercel → thử Server Proxy cho model này
      if (!modelFailedByAvailability && activeProvider === 'gemini' && allowKeyRotation && serverProxyStatus.available) {
        try {
          notifyFallback(`🛡️ Đang sử dụng kho key dự phòng bảo mật trên máy chủ (${model})...`, onFallback);
          const proxyConfig = createGeminiConfig({
            provider: activeProvider,
            model,
            systemInstruction: systemInstruction ?? config?.systemInstruction,
            responseMimeType: responseMimeType ?? config?.responseMimeType,
            maxOutputTokens: maxOutputTokens ?? config?.maxOutputTokens,
            thinkingLevel: config?.thinkingConfig?.thinkingLevel ?? thinkingLevel,
            tools: config?.tools,
          });
          const proxyResp = await callServerProxyGenerateContent({
            model,
            contents,
            config: proxyConfig,
          });
          console.log(`✅ [${logLabel}] Thành công qua Server Proxy với ${model}`);
          notifyFallback(null, onFallback);
          return proxyResp;
        } catch (proxyError: any) {
          lastError = proxyError;
          errors.push(proxyError);
          console.warn(`⚠️ [${logLabel}] Server Proxy (${model}) lỗi:`, proxyError?.message || proxyError);
          if (parseApiError(proxyError) === 'NOT_FOUND') {
            unavailableModels.add(modelCacheKey(model, activeProvider));
          }
        }
      }

      // 3. Hết key khả dụng trên model này → chuyển sang model Free Tier tiếp theo (có hạn mức riêng!)
      const nextModel = modelsToTry[mIdx + 1];
      if (nextModel) {
        const reason = lastError ? fallbackReason(lastError) : 'đang tạm nghỉ';
        notifyFallback(
          `🔄 Đang tự động chuyển từ ${model} sang ${nextModel} (do ${model} ${reason})...`,
          onFallback
        );
      }
    }

    throw (
      pickReportedError(errors) ||
      lastError ||
      new Error('Tất cả API key và model Gemini đều tạm hết hạn mức. Vui lòng thêm API key mới hoặc thử lại sau.')
    );
  };

  try {
    return await executePass();
  } catch (firstError: any) {
    // Nhịp chờ thông minh 1 lần nếu chỉ bị giới hạn tốc độ RPM ngắn (<= 35s)
    const errType = parseApiError(firstError);
    if (activeProvider === 'gemini' && allowKeyRotation && (errType === 'RATE_LIMIT' || errType === 'QUOTA_EXCEEDED')) {
      const soonestMs = apiKeyManager.getSoonestCooldownMs(selectedModel || FALLBACK_MODELS[0], 'gemini');
      if (soonestMs !== null && soonestMs > 0 && soonestMs <= 35_000) {
        const waitSec = Math.ceil(soonestMs / 1000);
        notifyFallback(`⏳ Đang chờ ${waitSec}s để giới hạn tốc độ (RPM) hồi phục rồi tự động thử lại...`, onFallback);
        await sleepWithAbort(soonestMs + 1000);
        return await executePass();
      }
    }
    notifyFallback(null, onFallback);
    throw firstError;
  }
};

/**
 * Gọi thử một yêu cầu rất ngắn để biết 1 API key cụ thể có dùng được không (và model nào trả lời được).
 * Dùng ở màn hình Cài đặt — cố tình tắt xoay key để kiểm tra đúng key được chọn.
 */
export const testApiKey = async (
  apiKey: string,
  provider: AiProvider = 'gemini',
  selectedModel?: string
): Promise<{ ok: boolean; title: string; message: string; model?: string; errorType?: ApiErrorType }> => {
  try {
    const response: any = await generateContentWithModelFallback({
      apiKey,
      selectedModel,
      provider,
      contents: 'Chỉ trả lời đúng một từ: OK',
      thinkingLevel: ThinkingLevel.LOW,
      maxOutputTokens: 256,
      logLabel: 'testApiKey',
      allowKeyRotation: false,
    });
    const model = response?.modelVersion || selectedModel;
    return {
      ok: true,
      title: '✅ API key hoạt động',
      message: `Kết nối thành công${model ? ` (model: ${model})` : ''}.`,
      model,
    };
  } catch (error: any) {
    const info = getFriendlyErrorMessage(error);
    return {
      ok: false,
      title: info.title,
      message: info.message,
      errorType: parseApiError(error),
    };
  }
};

/**
 * Hàm lõi streaming dùng chung cho cả SinglePrompt (Phụ lục) và ChatSession (Viết Biện pháp).
 * Tự động xoay toàn bộ kho key → tự chuyển model miễn phí khác → tự dùng Server Proxy ngầm → tự chờ RPM ngắn.
 */
const runStreamWithResilience = async ({
  message,
  useChatHistory,
  onChunk,
  onRetry,
  provider,
  thinkingLevel = ThinkingLevel.MEDIUM,
  enableSearch = true,
  logLabel,
}: {
  message: string;
  useChatHistory: boolean;
  onChunk: (text: string) => void;
  onRetry?: () => void;
  provider?: AiProvider;
  thinkingLevel?: ThinkingLevel;
  enableSearch?: boolean;
  logLabel: string;
}): Promise<string> => {
  const activeProvider = resolveActiveProvider(provider);

  if (activeProvider === 'gemini' && !serverProxyStatus.checked) {
    await checkServerProxyAvailable();
  }

  const initialKey = currentApiKey || (activeProvider === 'gemini' ? apiKeyManager.getActiveKey(undefined, 'gemini') : null);
  if (!initialKey && !(activeProvider === 'gemini' && serverProxyStatus.available)) {
    throw new Error("Không có API Key. Vui lòng nhập API key trong phần Cài đặt.");
  }

  abortCurrentStream();
  const abortController = new AbortController();
  currentAbortController = abortController;

  const abortPromise = new Promise<never>((_, reject) => {
    abortController.signal.addEventListener('abort', () => reject(new Error('Đã hủy yêu cầu.')), { once: true });
  });
  abortPromise.catch(() => { /* tránh unhandled rejection */ });

  const finish = () => {
    if (currentAbortController === abortController) currentAbortController = null;
    notifyFallback(null);
  };

  const executeStreamPass = async (): Promise<string> => {
    const modelsToTry = getOrderedModels(undefined, activeProvider);
    let lastError: any = null;
    const errors: any[] = [];
    let activePreferredKey =
      currentApiKey ||
      (activeProvider === 'gemini' ? apiKeyManager.getActiveKey(modelsToTry[0], 'gemini') : '') ||
      '';

    console.log(`🚀 [${logLabel}] (${activeProvider}) Bắt đầu. Chuỗi model: ${modelsToTry.join(' → ')}`);

    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const model = modelsToTry[mIdx];
      if (abortController.signal.aborted) throw new Error('Đã hủy yêu cầu.');

      const keysForModel = resolveCandidateKeys(model, activePreferredKey, activeProvider, true);
      let modelFailedByAvailability = false;

      // 1. Thử lần lượt mọi API key khả dụng cho model này
      for (let kIdx = 0; kIdx < keysForModel.length; kIdx++) {
        const keyToUse = keysForModel[kIdx];
        let retriedWithoutThinking = false;
        let retriedWithoutTools = false;

        while (true) {
          if (abortController.signal.aborted) throw new Error('Đã hủy yêu cầu.');
          let hasEmittedChunks = false;

          try {
            console.log(`🤖 [${logLabel}] Model ${model} | Key [${kIdx + 1}/${keysForModel.length}] (${apiKeyManager.maskKey(keyToUse)})`);
            const ai = createGoogleAiClient(keyToUse, activeProvider);
            const chatConfig = createGeminiConfig({
              provider: activeProvider,
              model,
              systemInstruction: SYSTEM_INSTRUCTION,
              maxOutputTokens: 65536,
              thinkingLevel,
              tools: enableSearch && activeProvider !== 'agent-platform' ? [{ googleSearch: {} }] : undefined,
            });

            const connectTimeout = createTimeout(FIRST_CHUNK_TIMEOUT_MS, `Kết nối tới model ${model}`);
            let responseStream: any;
            try {
              if (useChatHistory) {
                chatSession = ai.chats.create({
                  model,
                  config: chatConfig,
                  history,
                });
                responseStream = await Promise.race([
                  chatSession.sendMessageStream({ message, config: { abortSignal: abortController.signal } }),
                  connectTimeout.promise,
                  abortPromise,
                ]);
              } else {
                responseStream = await Promise.race([
                  ai.models.generateContentStream({
                    model,
                    config: { ...chatConfig, abortSignal: abortController.signal },
                    contents: [{ role: 'user', parts: [{ text: message }] }],
                  }),
                  connectTimeout.promise,
                  abortPromise,
                ]);
              }
            } finally {
              connectTimeout.clear();
            }

            let fullResponse = "";
            let receivedFirstChunk = false;
            const totalTimeout = createTimeout(TOTAL_STREAM_TIMEOUT_MS, `Tổng thời gian stream từ ${model} quá dài`);

            try {
              const iterator = responseStream[Symbol.asyncIterator]();
              while (true) {
                const timeoutMs = receivedFirstChunk ? INTER_CHUNK_TIMEOUT_MS : FIRST_CHUNK_TIMEOUT_MS;
                const chunkTimeout = createTimeout(timeoutMs, `Chờ phản hồi tiếp theo từ ${model}`);
                let chunkResult: IteratorResult<any>;
                try {
                  chunkResult = await Promise.race([
                    iterator.next(),
                    chunkTimeout.promise,
                    totalTimeout.promise,
                    abortPromise,
                  ]);
                } finally {
                  chunkTimeout.clear();
                }

                if (chunkResult.done) break;

                const chunk = chunkResult.value;
                if (chunk?.text) {
                  receivedFirstChunk = true;
                  hasEmittedChunks = true;
                  const cleanText = sanitizeAIOutput(chunk.text);
                  onChunk(cleanText);
                  fullResponse += cleanText;
                }
              }
            } finally {
              totalTimeout.clear();
            }

            if (!fullResponse.trim()) {
              throw new Error("Model không phản hồi nội dung văn bản (hoặc bị chặn nội dung).");
            }

            // Thành công: đồng bộ key đang hoạt động & cập nhật history
            if (activeProvider === 'gemini' && keyToUse !== currentApiKey) {
              currentApiKey = keyToUse;
              emitKeyChanged(keyToUse);
            }
            if (useChatHistory) {
              history.push({ role: 'user', parts: [{ text: message }] });
              history.push({ role: 'model', parts: [{ text: fullResponse }] });
            }
            console.log(`✅ [${logLabel}] Hoàn tất với ${model}, ${fullResponse.length} ký tự`);
            return fullResponse;

          } catch (error: any) {
            lastError = error;
            errors.push(error);
            if (abortController.signal.aborted) throw new Error('Đã hủy yêu cầu.');

            const errorType = parseApiError(error);
            console.error(`❌ [${logLabel}] ${model} (${apiKeyManager.maskKey(keyToUse)}) lỗi ${errorType}:`, error?.message || error);

            // Nếu đã phát 1 phần nội dung ra UI mà không có callback rollback → dừng để tránh lặp chữ
            if (hasEmittedChunks && !onRetry) {
              throw error;
            }
            if (hasEmittedChunks && onRetry) {
              onRetry();
            }

            const cacheK = modelCacheKey(model, activeProvider);
            // Lỗi thinkingConfig → gửi lại đúng key + model này không kèm thinkingConfig
            if (errorType === 'INVALID_ARGUMENT' && isThinkingConfigError(error) && !retriedWithoutThinking && !noThinkingModels.has(cacheK)) {
              noThinkingModels.add(cacheK);
              retriedWithoutThinking = true;
              continue;
            }
            // Lỗi tools → gửi lại đúng key + model này không kèm tools
            if (errorType === 'INVALID_ARGUMENT' && isToolsConfigError(error) && !retriedWithoutTools && !noToolsModels.has(cacheK)) {
              noToolsModels.add(cacheK);
              retriedWithoutTools = true;
              continue;
            }

            // Lỗi quá tải / lỗi tạm thời / 404 / mạng → chuyển sang model tiếp theo (KHÔNG phạt key)
            if (isFallbackableError(errorType, activeProvider)) {
              if (errorType === 'NOT_FOUND') unavailableModels.add(cacheK);
              modelFailedByAvailability = true;
              break;
            }

            // Lỗi quota / rate limit / key sai / quyền trên Gemini API → đánh dấu key & xoay sang key tiếp theo
            if (
              activeProvider === 'gemini' &&
              (errorType === 'QUOTA_EXCEEDED' ||
                errorType === 'RATE_LIMIT' ||
                errorType === 'INVALID_API_KEY' ||
                errorType === 'PERMISSION_DENIED')
            ) {
              if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
                apiKeyManager.markKeyModelQuotaError(keyToUse, model, errorType, {
                  isPerMinute: isPerMinuteRateLimit(error),
                  retryDelaySec: extractRetryDelaySeconds(error),
                }, 'gemini');
              } else {
                apiKeyManager.markKeyError(keyToUse, errorType, model, 'gemini');
              }

              const nextKey = keysForModel[kIdx + 1];
              if (nextKey) {
                activePreferredKey = nextKey;
                notifyFallback(
                  `🔑 Key hiện tại hết lượt ${model} — tự động xoay sang key dự phòng (${kIdx + 2}/${keysForModel.length})...`
                );
              }
              break;
            }

            // Các lỗi cứng khác (400 payload xấu, Agent Platform 401/429...)
            throw error;
          }
        }

        if (modelFailedByAvailability) break;
      }

      // 2. Dự phòng qua Server Proxy ngầm /api/gemini nếu đã cấu hình trên Vercel
      if (!modelFailedByAvailability && activeProvider === 'gemini' && serverProxyStatus.available) {
        let proxyEmitted = false;
        try {
          notifyFallback(`🛡️ Đang kết nối kho key dự phòng bảo mật trên máy chủ (${model})...`);
          const proxyContents = useChatHistory
            ? [...history, { role: 'user', parts: [{ text: message }] }]
            : [{ role: 'user', parts: [{ text: message }] }];
          const proxyConfig = createGeminiConfig({
            provider: activeProvider,
            model,
            systemInstruction: SYSTEM_INSTRUCTION,
            maxOutputTokens: 65536,
            thinkingLevel,
            tools: enableSearch ? [{ googleSearch: {} }] : undefined,
          });
          const { fullResponse, hasEmittedChunks } = await callServerProxyStream({
            model,
            contents: proxyContents,
            config: proxyConfig,
            onChunk,
            signal: abortController.signal,
            abortPromise,
          });
          proxyEmitted = hasEmittedChunks;
          if (!fullResponse.trim()) {
            throw new Error("Model không phản hồi nội dung văn bản.");
          }
          if (useChatHistory) {
            history.push({ role: 'user', parts: [{ text: message }] });
            history.push({ role: 'model', parts: [{ text: fullResponse }] });
          }
          console.log(`✅ [${logLabel}] Hoàn tất qua Server Proxy với ${model}, ${fullResponse.length} ký tự`);
          return fullResponse;
        } catch (proxyError: any) {
          lastError = proxyError;
          errors.push(proxyError);
          if (abortController.signal.aborted) throw new Error('Đã hủy yêu cầu.');
          if (proxyEmitted && !onRetry) throw proxyError;
          if (proxyEmitted && onRetry) onRetry();
          console.warn(`⚠️ [${logLabel}] Server Proxy (${model}) lỗi:`, proxyError?.message || proxyError);
          if (parseApiError(proxyError) === 'NOT_FOUND') {
            unavailableModels.add(modelCacheKey(model, activeProvider));
          }
        }
      }

      // 3. Hết key khả dụng trên model này → chuyển sang model Free Tier tiếp theo (có hạn mức riêng!)
      const nextModel = modelsToTry[mIdx + 1];
      if (nextModel) {
        const reason = lastError ? fallbackReason(lastError) : 'đang tạm nghỉ';
        console.log(`⏭️ [${logLabel}] Tự động chuyển từ ${model} sang ${nextModel} (${reason})...`);
        notifyFallback(
          `🔄 Tự động chuyển từ ${model} sang ${nextModel} (do ${model} ${reason})...`
        );
      }
    }

    throw (
      pickReportedError(errors) ||
      lastError ||
      new Error("Tất cả API key và model miễn phí đều đã hết hạn mức. Vui lòng thêm API key mới hoặc thử lại sau.")
    );
  };

  try {
    const result = await executeStreamPass();
    finish();
    return result;
  } catch (firstError: any) {
    if (abortController.signal.aborted) {
      finish();
      throw new Error('Đã hủy yêu cầu.');
    }

    // Nếu tất cả key chỉ đang tạm nghỉ RPM ngắn (<= 35 giây) → tự chờ đếm ngược rồi thử lại 1 nhịp!
    const errType = parseApiError(firstError);
    if (activeProvider === 'gemini' && (errType === 'RATE_LIMIT' || errType === 'QUOTA_EXCEEDED')) {
      const soonestMs = apiKeyManager.getSoonestCooldownMs(getOrderedModels(undefined, activeProvider)[0], 'gemini');
      if (soonestMs !== null && soonestMs > 0 && soonestMs <= 35_000) {
        const waitSec = Math.ceil(soonestMs / 1000);
        notifyFallback(`⏳ Hạn mức tốc độ (RPM) sẽ hồi phục sau ${waitSec}s — đang tự động chờ để tiếp tục...`);
        try {
          await sleepWithAbort(soonestMs + 1000, abortController.signal);
          onRetry?.();
          const retryResult = await executeStreamPass();
          finish();
          return retryResult;
        } catch (retryError) {
          finish();
          throw retryError;
        }
      }
    }

    finish();
    throw firstError;
  }
};

/**
 * Gửi prompt đơn lẻ với streaming — KHÔNG dùng hoặc xóa lịch sử chat (dùng cho Tạo Phụ lục).
 */
export const sendSinglePromptStream = async (
  message: string,
  onChunk: (text: string) => void,
  onRetry?: () => void,
  provider?: AiProvider,
  thinkingLevel: ThinkingLevel = ThinkingLevel.MEDIUM
): Promise<string> => {
  return runStreamWithResilience({
    message,
    useChatHistory: false,
    onChunk,
    onRetry,
    provider,
    thinkingLevel,
    enableSearch: false,
    logLabel: 'SinglePrompt',
  });
};

/**
 * Gửi tin nhắn có giữ lịch sử hội thoại với đầy đủ xoay nhiều key + fallback model 2 tầng + Server Proxy.
 */
export const sendMessageStream = async (
  message: string,
  onChunk: (text: string) => void,
  provider?: AiProvider,
  thinkingLevel: ThinkingLevel = ThinkingLevel.MEDIUM,
  onRetry?: () => void
): Promise<string> => {
  return runStreamWithResilience({
    message,
    useChatHistory: true,
    onChunk,
    onRetry,
    provider,
    thinkingLevel,
    enableSearch: true,
    logLabel: 'ChatStream',
  });
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
  // Số ký tự thực sự được gửi cho AI chấm so với tổng độ dài văn bản (văn bản dài bị cắt bớt)
  analyzedChars: number;
  totalChars: number;
}

// Giới hạn ký tự của văn bản gửi đi thẩm định
export const ANALYZE_OLD_DOC_MAX_CHARS = 20000;

export const analyzeOldDocument = async (
  apiKey: string,
  content: string,
  selectedModel?: string,
  provider?: AiProvider
): Promise<EnhancedAnalysisResult> => {
  try {
    // Truncate content if too long (keep first ANALYZE_OLD_DOC_MAX_CHARS chars)
    const isTruncated = content.length > ANALYZE_OLD_DOC_MAX_CHARS;
    const truncatedContent = isTruncated
      ? content.substring(0, ANALYZE_OLD_DOC_MAX_CHARS) + '\n\n[... nội dung còn lại đã được cắt bớt — chỉ đánh giá trên phần văn bản phía trên, KHÔNG kết luận "thiếu mục" cho các phần có thể nằm ở đoạn bị cắt ...]'
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

## C. PHÂN TÍCH DẤU HIỆU TRÙNG LẶP VĂN PHONG (plagiarism — ƯỚC LƯỢNG, KHÔNG PHẢI ĐỐI CHIẾU NGUỒN THẬT)
⚠️ QUAN TRỌNG: Bạn KHÔNG có khả năng truy cập internet hay cơ sở dữ liệu văn bản thật trong tác vụ này. Do đó:
- Chỉ ước lượng % các đoạn có văn phong SÁO RỖNG, QUÁ PHỔ BIẾN (dễ trùng với nhiều văn bản khác), KHÔNG PHẢI đạo văn đã được xác minh.
- Trường "source" PHẢI để trống hoặc ghi "Không xác định (chưa đối chiếu nguồn thật)" — TUYỆT ĐỐI KHÔNG bịa tên nguồn, tên tài liệu, hay website cụ thể.
- Xác định mức độ: "Thấp" (<15%), "Trung bình" (15-30%), "Cao" (30-50%), "Rất cao" (>50%)
- Liệt kê 3-5 đoạn có văn phong sáo rỗng/phổ biến nhất (nếu có), kèm lý do ngắn gọn vì sao đoạn đó giống văn mẫu

## D. PHÂN TÍCH DẤU HIỆU VĂN PHONG AI (aiRisk — HEURISTIC CHỦ QUAN CỦA MÔ HÌNH, KHÔNG PHẢI CÔNG CỤ PHÁT HIỆN AI ĐÃ KIỂM ĐỊNH)
Đây là một ước lượng chủ quan dựa trên văn phong, không phải kết quả từ công cụ phát hiện AI chuyên dụng. Mục đích là gợi ý người viết chỉnh sửa cho tự nhiên hơn — KHÔNG dùng để kết luận chắc chắn một văn bản "là AI" hay "không là AI".

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
    {"segment": "<trích nguyên văn đoạn có văn phong sáo rỗng/phổ biến, ~50-150 ký tự>", "source": "Không xác định (chưa đối chiếu nguồn thật) — <lý do ngắn vì sao giống văn mẫu>", "similarity": <0-100, mức độ phổ biến ước lượng>},
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
    const qualityCriteria = (Array.isArray(result.qualityCriteria) ? result.qualityCriteria : []).map((c: any) => ({
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
    // Lưu ý P1.3: khi model KHÔNG trả về một trường, KHÔNG được mặc định về giá trị
    // "an toàn"/"thấp" — điều đó khiến người dùng tin nhầm là đã kiểm tra và đạt.
    // Dùng `in` để phân biệt "model trả 0" với "model không trả trường này".
    const hasField = (obj: any, field: string) => obj && Object.prototype.hasOwnProperty.call(obj, field);
    // Ép về số trong [0, 100]; model đôi khi trả "45%" hoặc chuỗi rỗng → NaN, không được để NaN lọt ra UI
    const clampPercent = (value: any): number => {
      const n = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(',', '.'));
      return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
    };
    const toStringArray = (value: any): string[] => Array.isArray(value) ? value.map((v: any) => String(v)) : [];

    return {
      totalScore: clampPercent(result.totalScore),
      summary: result.summary || 'Không có tóm tắt.',
      detectedSections: (Array.isArray(result.detectedSections) ? result.detectedSections : []).map((s: any) => ({
        name: s.name || '',
        status: (['pass', 'warn', 'fail'].includes(s.status) ? s.status : 'warn') as 'pass' | 'warn' | 'fail',
        comment: s.comment || '',
      })),
      qualityCriteria,
      plagiarismPercent: clampPercent(result.plagiarismPercent),
      plagiarismLevel: hasField(result, 'plagiarismLevel') && result.plagiarismLevel ? String(result.plagiarismLevel) : 'Chưa xác định',
      plagiarismSegments: (Array.isArray(result.plagiarismSegments) ? result.plagiarismSegments : []).slice(0, 5).map((p: any) => ({
        segment: p?.segment || '',
        source: p?.source || 'Không xác định (chưa đối chiếu nguồn thật)',
        similarity: clampPercent(p?.similarity),
      })),
      aiRiskPercent: clampPercent(result.aiRiskPercent),
      aiRiskLevel: hasField(result, 'aiRiskLevel') && result.aiRiskLevel ? String(result.aiRiskLevel) : 'Chưa xác định',
      aiRiskDetails: {
        perplexity: clampPercent(result.aiRiskDetails?.perplexity),
        burstiness: clampPercent(result.aiRiskDetails?.burstiness),
        patternDensity: clampPercent(result.aiRiskDetails?.patternDensity),
        suspiciousPatterns: toStringArray(result.aiRiskDetails?.suspiciousPatterns).slice(0, 5),
        recommendations: toStringArray(result.aiRiskDetails?.recommendations).slice(0, 3),
      },
      suggestions: toStringArray(result.suggestions),
      criteria: legacyCriteria,
      analyzedChars: Math.min(content.length, ANALYZE_OLD_DOC_MAX_CHARS),
      totalChars: content.length,
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
