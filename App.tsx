import React, { useState, useEffect, useCallback, useRef } from 'react';
import { UserInfo, GenerationStep, GenerationState, SKKNTemplate, SolutionsState, AiProvider } from './types';
import {
  STEPS_INFO,
  SOLUTION_MODE_PROMPT,
  FALLBACK_MODELS,
  AGENT_PLATFORM_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_AGENT_PLATFORM_MODEL,
  GEMINI_MODEL_STORAGE_KEY,
  LEGACY_GEMINI_MODEL_STORAGE_KEY,
  LEGACY_SELECTED_MODEL_STORAGE_KEY,
  HIGHER_ED_LEVELS,
  HIGHER_ED_SYSTEM_INSTRUCTION
} from './constants';
import {
  initializeGeminiChat,
  sendMessageStream,
  getFriendlyErrorMessage,
  parseApiError,
  getChatHistory,
  setChatHistory,
  setOnFallbackNotice,
  ThinkingLevel
} from './services/geminiService';
import { apiKeyManager } from './services/apiKeyManager';
import { isValidGoogleAiApiKey, parseGoogleAiApiKeys } from './services/googleAiApiKey';
import { getSubjectInfo } from './data/subjectsData';
import { SKKNForm } from './components/SKKNForm';
import { DocumentPreview } from './components/DocumentPreview';
import { Button } from './components/Button';
import { ApiKeyModal } from './components/ApiKeyModal';

import {
  FileText, Brain, LayoutTemplate, PenTool, BookOpen, User, Users,
  CheckCircle, ChevronRight, Save, Wand2, Download, Trash2, Settings, AlertTriangle, RefreshCw, Microscope
} from 'lucide-react';

import { LockScreen } from './components/LockScreen';
import ReviewOldDocPanel from './components/ReviewOldDocPanel';
import TeachingMethodsCatalog from './components/TeachingMethodsCatalog';

// Helper: Truncate text dài cho AI prompt - giữ phần đầu (nội dung chính) và thông báo lược bớt
const MAX_REF_DOCS_FOR_PROMPT = 80000; // ~80K ký tự tối đa cho tài liệu tham khảo trong prompt

const truncateForPrompt = (text: string, maxChars: number = MAX_REF_DOCS_FOR_PROMPT): string => {
  if (!text || text.length <= maxChars) return text;

  const truncated = text.substring(0, maxChars);
  const removedChars = text.length - maxChars;
  const estimatedPages = Math.round(removedChars / 2500); // ~2500 ký tự/trang A4

  return truncated + `\n\n[... ĐÃ LƯỢC BỚT ${removedChars.toLocaleString()} KÝ TỰ (~${estimatedPages} trang) DO QUÁ DÀI. Nội dung phía trên đã đủ để tham khảo các ý chính ...]`;
};

// SessionStorage key cho tài liệu tham khảo lớn
const SESSION_REF_DOCS_KEY = 'skkn_ref_docs';
const SESSION_REF_NAMES_KEY = 'skkn_ref_file_names';

// LocalStorage key cho lưu/khôi phục phiên làm việc
const SESSION_SAVE_KEY = 'skkn_session_data';

// Interface cho session data
interface SessionData {
  userInfo: Omit<UserInfo, 'referenceDocuments'> & { hasReferenceDocuments: boolean };
  state: {
    step: GenerationStep;
    messages: Array<{ role: string; text: string }>;
    fullDocument: string;
  };
  solutionsState: SolutionsState;
  appendixDocument: string;
  outlineFeedback: string;
  chatHistory: any[];
  savedAt: string;
}

// -------------------------------------------------------------------------------- //
// HELPER: Thêm prompt cải thiện nếu đang ở chế độ Healing
// -------------------------------------------------------------------------------- //
const getHealingPromptSnippet = (healingContext: { originalContent: string; analysisResult: any } | null) => {
  if (!healingContext) return "";
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🩺 CHẾ ĐỘ Cải thiện (HEALING MODE) ĐANG ĐƯỢC BẬT:
Đây là văn bản báo cáo/Biện pháp gốc của người dùng được tải lên:
<DOCUMENT_GOC>
${healingContext.originalContent}
</DOCUMENT_GOC>

Và đây là BÁO CÁO Thẩm định (Giải pháp) từ AI chuyên gia:
<TOA_THUOC_KHAM_BENH>
${JSON.stringify(healingContext.analysisResult, null, 2)}
</TOA_THUOC_KHAM_BENH>

YÊU CẦU ĐẶC BIỆT KHI VIẾT BÀI / LẬP DÀN Ý:
- Tái sử dụng tối đa CÁC Ý TƯỞNG TỐT từ văn bản gốc.
- Bắt buộc phải TIÊU DIỆT HOÀN TOÀN các lỗi được nêu trong Giải pháp (đặc biệt là lỗi cấu trúc, đạo văn, thiếu số liệu).
- Mục tiêu là tạo ra phiên bản NÂNG CẤP XUẤT SẮC từ bài gốc, chứ không phải viết một bài mới hoàn toàn không liên quan.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
};

const App: React.FC = () => {
  // Lock Screen State
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Session Restore State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [pendingSessionData, setPendingSessionData] = useState<SessionData | null>(null);
  const [sessionSavedAt, setSessionSavedAt] = useState<string | null>(null);

  // API Key & Provider State
  const [provider, setProvider] = useState<AiProvider>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [showApiModal, setShowApiModal] = useState(false);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_GEMINI_MODEL);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  // Đăng ký nhận thông báo fallback tạm thời từ geminiService
  useEffect(() => {
    setOnFallbackNotice((notice) => {
      setFallbackNotice(notice);
    });
    return () => setOnFallbackNotice(null);
  }, []);

  // App Navigation State
  const [activeAppTab, setActiveAppTab] = useState<'create' | 'heal' | 'methods'>('create');
  const [healingContext, setHealingContext] = useState<{
    originalContent: string;
    analysisResult: any;
  } | null>(null);

  // Form Tabs State
  const [activeTab, setActiveTab] = useState<'create' | 'review'>('create');

  // Auto Generate State
  const [isAutoGenerate, setIsAutoGenerate] = useState(false);
  const autoGenerateRef = useRef(false);
  useEffect(() => {
    autoGenerateRef.current = isAutoGenerate;
  }, [isAutoGenerate]);

  // Check LocalStorage on Mount
  useEffect(() => {
    const authState = localStorage.getItem('skkn_app_unlocked');
    if (authState === 'true') {
      setIsUnlocked(true);
    }

    // Dọn dẹp key model cũ để nâng cấp tự động người dùng lên gemini-3.8-flash
    localStorage.removeItem(LEGACY_GEMINI_MODEL_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SELECTED_MODEL_STORAGE_KEY);

    // Đọc provider đã chọn thủ công (reset giá trị 'vertex' cũ hoặc thiếu selection_source về 'gemini')
    const rawProvider = localStorage.getItem('google_ai_provider');
    const selectionSource = localStorage.getItem('google_ai_provider_selection_source');
    const activeProvider: AiProvider =
      rawProvider === 'agent-platform' && selectionSource === 'manual'
        ? 'agent-platform'
        : 'gemini';

    if (rawProvider !== activeProvider) {
      localStorage.setItem('google_ai_provider', activeProvider);
    }
    setProvider(activeProvider);

    // Load API key theo provider
    if (activeProvider === 'agent-platform') {
      const savedAgentKey = localStorage.getItem('agent_platform_api_key');
      if (savedAgentKey && isValidGoogleAiApiKey(savedAgentKey)) {
        setApiKey(savedAgentKey.trim());
      } else {
        if (savedAgentKey) {
          localStorage.removeItem('agent_platform_api_key');
        }
        setShowApiModal(true);
      }
    } else {
      const savedKey = localStorage.getItem('gemini_api_key');
      if (savedKey && isValidGoogleAiApiKey(savedKey)) {
        setApiKey(savedKey.trim());
      } else {
        if (savedKey) {
          localStorage.removeItem('gemini_api_key');
        }

        const envKeys = parseGoogleAiApiKeys(import.meta.env.VITE_GEMINI_API_KEYS || '');
        if (envKeys.length > 0) {
          const firstEnvKey = envKeys[0];
          setApiKey(firstEnvKey);
          localStorage.setItem('gemini_api_key', firstEnvKey);
          console.log('🔑 Tự động sử dụng API key từ biến môi trường');
        } else {
          // Không có key nào → hiển thị modal bắt buộc nhập
          setShowApiModal(true);
        }
      }
    }

    const availableModels = activeProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : FALLBACK_MODELS;
    const defaultModelForProvider = activeProvider === 'agent-platform' ? DEFAULT_AGENT_PLATFORM_MODEL : DEFAULT_GEMINI_MODEL;
    const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);

    if (savedModel && availableModels.includes(savedModel)) {
      setSelectedModel(savedModel);
    } else {
      setSelectedModel(defaultModelForProvider);
      localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, defaultModelForProvider);
    }

    // Kiểm tra phiên làm việc đã lưu
    try {
      const savedSession = localStorage.getItem(SESSION_SAVE_KEY);
      if (savedSession) {
        const sessionData: SessionData = JSON.parse(savedSession);
        // Chỉ hiện modal khôi phục nếu phiên có tiến trình (step > INPUT_FORM)
        if (sessionData.state && sessionData.state.step > GenerationStep.INPUT_FORM) {
          setPendingSessionData(sessionData);
          setShowRestoreModal(true);
        }
      }
    } catch (e) {
      console.warn('Không thể đọc phiên đã lưu:', e);
      localStorage.removeItem(SESSION_SAVE_KEY);
    }

    setCheckingAuth(false);
  }, []);

  const handleSaveApiKey = (key: string, model: string, newProvider?: AiProvider) => {
    const targetProvider = newProvider || provider;
    setProvider(targetProvider);
    localStorage.removeItem(LEGACY_GEMINI_MODEL_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SELECTED_MODEL_STORAGE_KEY);
    localStorage.setItem('google_ai_provider', targetProvider);
    localStorage.setItem('google_ai_provider_selection_source', 'manual');

    if (targetProvider === 'agent-platform') {
      localStorage.setItem('agent_platform_api_key', key);
    } else {
      localStorage.setItem('gemini_api_key', key);
    }

    localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, model);
    setApiKey(key);
    setSelectedModel(model);
    setShowApiModal(false);

    // 🆕 Nếu đang có lỗi (ví dụ: hết quota), clear error và reinitialize chat với key mới
    if (state.error) {
      setState(prev => ({ ...prev, error: null }));
      // Reinitialize chat session với key mới
      initializeGeminiChat(key, model, targetProvider);
    }
  };

  const handleLogin = (username: string) => {
    localStorage.setItem('skkn_app_unlocked', 'true');
    localStorage.setItem('skkn_logged_user', username);
    setIsUnlocked(true);
  };

  const [userInfo, setUserInfo] = useState<UserInfo>({
    topic: '',
    subject: '',
    level: '',
    grade: '',
    school: '',
    location: '',
    facilities: '',
    teachingMethod: '',
    textbook: '',
    researchSubjects: '',
    timeframe: '',
    applyAI: '',
    focus: '',
    referenceDocuments: '',
    skknTemplate: '',
    specialRequirements: '',
    pageLimit: '', // Số trang giới hạn (để trống = không giới hạn)
    includePracticalExamples: false, // Thêm ví dụ thực tế
    includeStatistics: false, // Bổ sung bảng biểu thống kê
    requirementsConfirmed: false, // Đã xác nhận yêu cầu
    includeSolution4_5: false, // Viết thêm Giải pháp 4 và 5
    customTemplate: undefined // Cấu trúc mẫu Biện pháp tùy chỉnh (đã trích xuất)
  });

  // Khôi phục referenceDocuments từ sessionStorage khi mount
  useEffect(() => {
    try {
      const savedRefDocs = sessionStorage.getItem(SESSION_REF_DOCS_KEY);
      if (savedRefDocs && !userInfo.referenceDocuments) {
        setUserInfo(prev => ({ ...prev, referenceDocuments: savedRefDocs }));
        console.log(`📄 Đã khôi phục tài liệu tham khảo từ session (${(savedRefDocs.length / 1024).toFixed(1)}KB)`);
      }
    } catch (e) {
      console.warn('Không thể khôi phục tài liệu tham khảo:', e);
    }
  }, []);

  // Lưu referenceDocuments vào sessionStorage khi thay đổi
  useEffect(() => {
    try {
      if (userInfo.referenceDocuments) {
        sessionStorage.setItem(SESSION_REF_DOCS_KEY, userInfo.referenceDocuments);
      } else {
        sessionStorage.removeItem(SESSION_REF_DOCS_KEY);
      }
    } catch (e) {
      console.warn('Text quá lớn cho sessionStorage, bỏ qua persistence:', e);
    }
  }, [userInfo.referenceDocuments]);

  const [state, setState] = useState<GenerationState>({
    step: GenerationStep.INPUT_FORM,
    messages: [],
    fullDocument: '',
    isStreaming: false,
    error: null
  });

  const [outlineFeedback, setOutlineFeedback] = useState("");

  // Phụ lục riêng biệt
  const [appendixDocument, setAppendixDocument] = useState('');
  const [isAppendixLoading, setIsAppendixLoading] = useState(false);

  // State quản lý từng giải pháp riêng biệt
  const [solutionsState, setSolutionsState] = useState<SolutionsState>({
    solution1: null,
    solution2: null,
    solution3: null,
    solution4: null,
    solution5: null,
  });

  // ═══════════════════════════════════════════════════════════
  // SESSION PERSISTENCE: Tự động lưu phiên vào localStorage
  // ═══════════════════════════════════════════════════════════

  // Hàm lưu phiên
  const saveSession = useCallback(() => {
    // Chỉ lưu khi đã bắt đầu làm việc (không lưu khi đang ở form nhập)
    if (state.step <= GenerationStep.INPUT_FORM || state.isStreaming) return;

    try {
      const sessionData: SessionData = {
        userInfo: {
          ...userInfo,
          referenceDocuments: '', // Không lưu ref docs (quá lớn, đã có sessionStorage)
          hasReferenceDocuments: !!userInfo.referenceDocuments,
        } as any,
        state: {
          step: state.step,
          messages: state.messages,
          fullDocument: state.fullDocument,
        },
        solutionsState,
        appendixDocument,
        outlineFeedback,
        chatHistory: getChatHistory(),
        savedAt: new Date().toISOString(),
      };

      localStorage.setItem(SESSION_SAVE_KEY, JSON.stringify(sessionData));
      setSessionSavedAt(new Date().toLocaleTimeString('vi-VN'));
      console.log('💾 Đã lưu phiên làm việc:', sessionData.state.step);
    } catch (e) {
      console.warn('Không thể lưu phiên (có thể do dữ liệu quá lớn):', e);
    }
  }, [state.step, state.messages, state.fullDocument, state.isStreaming, userInfo, solutionsState, appendixDocument, outlineFeedback]);

  // Tự động lưu khi state thay đổi (debounce 2 giây)
  useEffect(() => {
    if (state.step <= GenerationStep.INPUT_FORM || state.isStreaming) return;

    const timer = setTimeout(() => {
      saveSession();
    }, 2000);

    return () => clearTimeout(timer);
  }, [state.step, state.fullDocument, solutionsState, appendixDocument, saveSession]);

  // Hàm khôi phục phiên
  const restoreSession = useCallback((sessionData: SessionData) => {
    try {
      // Khôi phục userInfo (trừ referenceDocuments)
      const { hasReferenceDocuments, ...savedUserInfo } = sessionData.userInfo as any;
      setUserInfo(prev => ({
        ...prev,
        ...savedUserInfo,
        referenceDocuments: prev.referenceDocuments || '', // Giữ ref docs từ sessionStorage
      }));

      // Khôi phục GenerationState
      setState({
        step: sessionData.state.step,
        messages: (sessionData.state.messages || []) as any,
        fullDocument: sessionData.state.fullDocument || '',
        isStreaming: false,
        error: null,
      });

      // Khôi phục solutions
      if (sessionData.solutionsState) {
        setSolutionsState(sessionData.solutionsState);
      }

      // Khôi phục phụ lục
      if (sessionData.appendixDocument) {
        setAppendixDocument(sessionData.appendixDocument);
      }

      // Khôi phục outline feedback
      if (sessionData.outlineFeedback) {
        setOutlineFeedback(sessionData.outlineFeedback);
      }

      // Khôi phục chat history cho Gemini
      if (sessionData.chatHistory && sessionData.chatHistory.length > 0) {
        setChatHistory(sessionData.chatHistory);
      }

      // Initialize Gemini chat với API key & provider hiện tại
      const rawProvider = localStorage.getItem('google_ai_provider');
      const selectionSource = localStorage.getItem('google_ai_provider_selection_source');
      const activeProvider: AiProvider =
        rawProvider === 'agent-platform' && selectionSource === 'manual'
          ? 'agent-platform'
          : 'gemini';
      const savedKey = activeProvider === 'agent-platform'
        ? localStorage.getItem('agent_platform_api_key')
        : localStorage.getItem('gemini_api_key');
      const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
      if (savedKey && isValidGoogleAiApiKey(savedKey)) {
        initializeGeminiChat(savedKey.trim(), savedModel || undefined, activeProvider);
        // Khôi phục history SAU khi init (vì init reset history)
        if (sessionData.chatHistory && sessionData.chatHistory.length > 0) {
          setChatHistory(sessionData.chatHistory);
        }
      }

      console.log('✅ Đã khôi phục phiên làm việc thành công!');
    } catch (e) {
      console.error('Lỗi khôi phục phiên:', e);
      setState(prev => ({ ...prev, error: 'Không thể khôi phục phiên làm việc. Vui lòng bắt đầu lại.' }));
    }
  }, []);

  // Hàm xóa phiên đã lưu
  const clearSavedSession = useCallback(() => {
    localStorage.removeItem(SESSION_SAVE_KEY);
    setSessionSavedAt(null);
    console.log('🗑 Đã xóa phiên làm việc đã lưu');
  }, []);


  // Helper: Tính toán phân bổ trang cho từng phần Biện pháp
  const getPageAllocation = useCallback(() => {
    if (!userInfo.pageLimit || typeof userInfo.pageLimit !== 'number') return null;

    const pages = userInfo.pageLimit;
    const wordsPerPage = 350; // 1 trang A4 ≈ 350 từ (font 13pt, line spacing 1.5)
    const charsPerPage = 2500;
    const numSolutions = 3; // Biện pháp GVG luôn có 3 biện pháp

    // Phân bổ: I&II (5%), III (5%), IV-GP (85%), V&VI (5%)
    const partI_II_pages = Math.max(1, Math.round(pages * 0.05));
    const partIII_pages = Math.max(1, Math.round(pages * 0.05));
    const partIV_pages = Math.max(numSolutions * 3, Math.round(pages * 0.85));
    const partV_VI_pages = Math.max(1, pages - partI_II_pages - partIII_pages - partIV_pages);
    const pagesPerSolution = Math.max(2, Math.floor(partIV_pages / numSolutions));

    return {
      totalPages: pages,
      wordsPerPage,
      charsPerPage,
      totalWords: pages * wordsPerPage,
      totalChars: pages * charsPerPage,
      numSolutions,
      partI_II: { pages: partI_II_pages, words: partI_II_pages * wordsPerPage, chars: partI_II_pages * charsPerPage },
      partIII: { pages: partIII_pages, words: partIII_pages * wordsPerPage, chars: partIII_pages * charsPerPage },
      partIV: { pages: partIV_pages, words: partIV_pages * wordsPerPage, chars: partIV_pages * charsPerPage },
      perSolution: { pages: pagesPerSolution, words: pagesPerSolution * wordsPerPage, chars: pagesPerSolution * charsPerPage },
      partV_VI: { pages: partV_VI_pages, words: partV_VI_pages * wordsPerPage, chars: partV_VI_pages * charsPerPage },
    };
  }, [userInfo.pageLimit]);

  // Helper: Tạo prompt giới hạn số từ/trang cho MỘT phần cụ thể đang viết
  const getSectionPagePrompt = useCallback((sectionName: string, sectionKey: 'partI_II' | 'partIII' | 'perSolution' | 'partV_VI') => {
    const alloc = getPageAllocation();
    if (!alloc) return '';

    const section = alloc[sectionKey];
    return `
🚨 GIỚI HẠN SỐ TRANG CHO PHẦN NÀY (BẮT BUỘC):
📌 ${sectionName}: PHẢI viết khoảng ${section.pages} TRANG (≈ ${section.words.toLocaleString()} từ ≈ ${section.chars.toLocaleString()} ký tự)
⚠️ Trong tổng ${alloc.totalPages} trang Biện pháp, phần này chiếm ${section.pages} trang.
🚫 KHÔNG viết quá ${Math.ceil(section.pages * 1.15)} trang và KHÔNG viết dưới ${Math.max(1, Math.floor(section.pages * 0.85))} trang.
✅ Viết CÔ ĐỌNG, SÚC TÍCH nhưng ĐẦY ĐỦ NỘI DUNG. Ưu tiên bảng biểu để tiết kiệm không gian.
`;
  }, [getPageAllocation]);

  // Helper function để tạo prompt nhắc lại các yêu cầu đặc biệt
  const getPageLimitPrompt = useCallback(() => {
    // Kiểm tra xem người dùng đã xác nhận yêu cầu chưa
    if (!userInfo.requirementsConfirmed) return '';

    const requirements: string[] = [];

    // 1. Giới hạn số trang - TÍNH TOÁN CHI TIẾT
    const alloc = getPageAllocation();
    if (alloc) {
      requirements.push(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 GIỚI HẠN SỐ TRANG - BẮT BUỘC TUYỆT ĐỐI 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 TỔNG SỐ TRANG YÊU CẦU: ${alloc.totalPages} TRANG (không tính Dàn ý và Phụ lục)

📐 QUY ĐỔI CHUẨN (Font 13pt, Line spacing 1.5):
• 1 trang A4 ≈ ${alloc.wordsPerPage} từ ≈ ${alloc.charsPerPage} ký tự
• TỔNG CHO ${alloc.totalPages} TRANG: ≈ ${alloc.totalWords.toLocaleString()} từ ≈ ${alloc.totalChars.toLocaleString()} ký tự

📊 PHÂN BỔ CHI TIẾT TỪNG PHẦN:
┌──────────────────────────────────────────────────────────────────┐
│ PHẦN                │ SỐ TRANG  │ SỐ TỪ         │ SỐ KÝ TỰ       │
├──────────────────────────────────────────────────────────────────┤
│ Phần I & II         │ ${alloc.partI_II.pages} trang    │ ~${alloc.partI_II.words.toLocaleString()} từ      │ ~${alloc.partI_II.chars.toLocaleString()} ký tự     │
│ Phần III            │ ${alloc.partIII.pages} trang    │ ~${alloc.partIII.words.toLocaleString()} từ      │ ~${alloc.partIII.chars.toLocaleString()} ký tự     │
│ Phần IV (${alloc.numSolutions} GP)    │ ${alloc.partIV.pages} trang   │ ~${alloc.partIV.words.toLocaleString()} từ     │ ~${alloc.partIV.chars.toLocaleString()} ký tự    │
│  → Mỗi giải pháp   │ ${alloc.perSolution.pages} trang    │ ~${alloc.perSolution.words.toLocaleString()} từ      │ ~${alloc.perSolution.chars.toLocaleString()} ký tự     │
│ Phần V & VI + KL    │ ${alloc.partV_VI.pages} trang    │ ~${alloc.partV_VI.words.toLocaleString()} từ      │ ~${alloc.partV_VI.chars.toLocaleString()} ký tự     │
└──────────────────────────────────────────────────────────────────┘

⚠️ QUY TẮC NGHIÊM NGẶT:
1. MỖI ĐOẠN VĂN: Tối đa 3-4 câu (≈ 60-80 từ)
2. MỖI MỤC NHỎ: Tối đa 5-7 đoạn văn
3. KHÔNG lặp lại ý, KHÔNG viết dư thừa
4. VÍ DỤ MINH HỌA: Chỉ 1-2 ví dụ ngắn gọn/giải pháp (trừ khi yêu cầu thêm)
5. BẢNG BIỂU: Giúp tiết kiệm không gian - ưu tiên sử dụng

🚫 CẢNH BÁO: NẾU VƯỢT QUÁ ${alloc.totalPages} TRANG → VI PHẠM YÊU CẦU!
✅ MỤC TIÊU: Viết CÔ ĐỌNG, SÚC TÍCH nhưng vẫn ĐẦY ĐỦ NỘI DUNG.`);
    }

    // 2. Thêm bài toán thực tế, ví dụ minh họa
    if (userInfo.includePracticalExamples) {
      requirements.push(`
📊 YÊU CẦU THÊM BÀI TOÁN THỰC TẾ, VÍ DỤ MINH HỌA:
- Mỗi giải pháp PHẢI có ít nhất 2-3 ví dụ thực tế cụ thể
- Bài toán thực tế phải gắn với đời sống, công việc, nghề nghiệp
- Ví dụ minh họa phải chi tiết, có thể áp dụng ngay
- Ưu tiên các ví dụ từ SGK ${userInfo.textbook || "hiện hành"}`);
    }

    // 3. Bổ sung bảng biểu, số liệu thống kê
    if (userInfo.includeStatistics) {
      requirements.push(`
📈 YÊU CẦU BỔ SUNG BẢNG BIỂU, SỐ LIỆU THỐNG KÊ:
- Mỗi phần quan trọng PHẢI có bảng biểu hoặc số liệu minh họa
- Sử dụng số liệu lẻ tự nhiên (42.3%, 67.8%) thay vì số tròn
- Bảng số liệu phải rõ ràng, format Markdown chuẩn
- Có biểu đồ gợi ý khi cần thiết
- Số liệu phải logic và nhất quán trong toàn bài`);
    }

    // 4. Yêu cầu bổ sung khác
    if (userInfo.specialRequirements && userInfo.specialRequirements.trim()) {
      requirements.push(`
✏️ YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:
${userInfo.specialRequirements}
Hãy áp dụng CHÍNH XÁC các yêu cầu trên vào phần đang viết!`);
    }

    if (requirements.length === 0) return '';

    return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CÁC YÊU CẦU ĐẶC BIỆT ĐÃ XÁC NHẬN (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${requirements.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }, [userInfo.requirementsConfirmed, userInfo.pageLimit, userInfo.includePracticalExamples, userInfo.includeStatistics, userInfo.specialRequirements, userInfo.textbook, getPageAllocation]);

  // Helper function để tạo prompt cấu trúc từ mẫu Biện pháp đã trích xuất
  const getCustomTemplatePrompt = useCallback(() => {
    if (!userInfo.customTemplate) return null;

    try {
      const template: SKKNTemplate = JSON.parse(userInfo.customTemplate);
      if (!template.sections || template.sections.length === 0) return null;

      // Tạo chuỗi hiển thị cấu trúc
      const structureText = template.sections.map(s => {
        const indent = '  '.repeat(s.level - 1);
        const prefix = s.level === 1 ? '📌' : s.level === 2 ? '•' : '○';
        return `${indent}${prefix} ${s.id}. ${s.title}`;
      }).join('\n');

      return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 CẤU TRÚC MẪU BIỆN PHÁP TỪ ${template.name || 'Sở/Phòng GD'} (BẮT BUỘC TUYỆT ĐỐI) 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CẢNH BÁO: Đây là CẤU TRÚC DUY NHẤT được phép sử dụng.
🚫 TUYỆT ĐỐI KHÔNG sử dụng cấu trúc Biện pháp mặc định/chuẩn.
✅ BẮT BUỘC TẠO DÀN Ý VÀ NỘI DUNG THEO ĐÚNG CẤU TRÚC NÀY:

${structureText}

QUY TẮC BẮT BUỘC:
1. TẠO DÀN Ý theo ĐÚNG thứ tự và tên các phần/mục như trên
2. KHÔNG thay đổi tên các phần lớn (level 1)
3. CÁC MỤC CON có thể điều chỉnh nội dung cho phù hợp đề tài nhưng PHẢI giữ nguyên cấu trúc
4. Điền nội dung phù hợp với đề tài vào TỪNG MỤC
5. KHÔNG sử dụng cấu trúc "Phần I, II, III, IV, V, VI" mặc định nếu mẫu có cấu trúc khác
6. Số lượng giải pháp, tên các phần, thứ tự trình bày PHẢI theo mẫu này

[HẾT CẤU TRÚC MẪU - MỌI NỘI DUNG PHẢI TUÂN THỦ CẤU TRÚC TRÊN]
`;
    } catch (e) {
      console.error('Lỗi parse customTemplate:', e);
      return null;
    }
  }, [userInfo.customTemplate]);

  // Handle Input Changes
  const handleUserChange = (field: keyof UserInfo, value: string) => {
    setUserInfo(prev => {
      const updated = { ...prev, [field]: value };
      // Reset grade khi đổi cấp học giữa bậc phổ thông và bậc cao
      if (field === 'level') {
        const wasHigherEd = HIGHER_ED_LEVELS.includes(prev.level);
        const isHigherEd = HIGHER_ED_LEVELS.includes(value as string);
        if (wasHigherEd !== isHigherEd) {
          updated.grade = '';
        }
      }
      return updated;
    });
  };

  // Handle Manual Document Edit
  const handleDocumentUpdate = (newContent: string) => {
    setState(prev => ({ ...prev, fullDocument: newContent }));
  };

  // Handle Manual Outline Submission (Skip Generation)
  const handleManualOutlineSubmit = (content: string) => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    // Initialize chat session silently so it's ready for next steps
    initializeGeminiChat(apiKey, selectedModel, provider);

    setState(prev => ({
      ...prev,
      fullDocument: content,
      step: GenerationStep.OUTLINE, // Go to Outline step so user can Review/Confirm
      isStreaming: false,
      error: null
    }));
  };

  // Start the Generation Process
  const startGeneration = async () => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    try {
      setState(prev => ({ ...prev, step: GenerationStep.OUTLINE, isStreaming: true, error: null }));

      initializeGeminiChat(apiKey, selectedModel, provider);

      const isHigherEd = HIGHER_ED_LEVELS.includes(userInfo.level);
      const learnerTerm = isHigherEd ? 'sinh viên' : 'học sinh';
      const teacherTerm = isHigherEd ? 'giảng viên' : 'giáo viên';
      const schoolTerm = isHigherEd ? 'trường/học viện' : 'trường';
      const textbookTerm = isHigherEd ? 'giáo trình' : 'SGK';

      const initMessage = `
Bạn là chuyên gia giáo dục cấp quốc gia, có 20+ năm kinh nghiệm viết, thẩm định và chấm điểm Sáng kiến Kinh nghiệm (Biện pháp) đạt giải cấp Bộ, cấp tỉnh tại Việt Nam.
${isHigherEd ? `
⚠️ LƯU Ý QUAN TRỌNG: Đây là Biện pháp dành cho BẬC ${userInfo.level.toUpperCase()} - KHÔNG PHẢI PHỔ THÔNG.
Phải sử dụng thuật ngữ phù hợp: "sinh viên" thay "học sinh", "giảng viên" thay "giáo viên", "giáo trình" thay "SGK", v.v.
` : ''}
NHIỆM VỤ CỦA BẠN:
Lập DÀN Ý CHI TIẾT cho một đề tài Biện pháp dựa trên thông tin tôi cung cấp. Dàn ý phải đầy đủ, cụ thể, có độ sâu và đảm bảo 4 tiêu chí: Tính MỚI, Tính KHOA HỌC, Tính KHẢ THI, Tính HIỆU QUẢ.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆 10 NGUYÊN TẮC VÀNG CHỐNG ĐẠO VĂN & NÂNG TẦM CHẤT LƯỢNG (BẮT BUỘC TUÂN THỦ NGHIÊM NGẶT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CẢNH BÁO: Bạn PHẢI tuân thủ 10 nguyên tắc sau để Biện pháp có tính "CON NGƯỜI", giọng điệu tự nhiên như một giáo viên thực sự đang viết sáng kiến của chính họ - là tâm huyết và sáng tạo của họ.

1️⃣ KHÔNG SAO CHÉP TRỰC TIẾP (Zero Copy-Paste):
   ❌ SAI: Copy nguyên văn định nghĩa từ Wikipedia, sách giáo khoa.
   ✅ ĐÚNG: Đọc hiểu ý tưởng → Tóm tắt theo tư duy riêng → Viết bằng ngôn ngữ và văn phong riêng biệt.

2️⃣ TƯ DUY VIẾT HOÀN TOÀN MỚI (Unique Thinking):
   ❌ SAI: "Giáo dục là quốc sách hàng đầu", "Thầy cô là người lái đò" (sáo rỗng).
   ✅ ĐÚNG: Viết câu có chiều sâu, phản ánh tư duy cá nhân của người viết.

3️⃣ XỬ LÝ LÝ THUYẾT GIÁO DỤC:
   Công thức: [Diễn giải lý thuyết theo cách mới] + [Ý nghĩa với giáo dục VN hiện tại] + [Liên hệ trực tiếp đề tài tại trường cụ thể].

4️⃣ XỬ LÝ VĂN BẢN PHÁP LUẬT:
   KHÔNG trích dẫn nguyên văn các Điều, Khoản. Hãy TÓM TẮT NỘI HÀM theo cách riêng.

5️⃣ TẠO SỐ LIỆU ĐỘC BẢN & HỢP LÝ:
   - Dùng số lẻ tự nhiên (42.3%, 68.7%) thay vì số tròn (40%, 50%).
   - Tổng tỷ lệ phải = 100%. Kết quả "Sau" tốt hơn "Trước" nhưng không tuyệt đối hóa.

6️⃣ GIẢI PHÁP CỤ THỂ HÓA:
   ❌ Tránh: "Đổi mới phương pháp dạy học" (chung chung).
   ✅ Phải: Đặt tên giải pháp ấn tượng và cụ thể (VD: "Thiết kế chuỗi hoạt động theo mô hình 5E kết hợp Padlet").

7️⃣ KỸ THUẬT PARAPHRASE 5 CẤP ĐỘ:
   1. Thay đổi từ vựng (Học sinh → Người học, Giáo viên → Nhà giáo dục).
   2. Đổi cấu trúc câu chủ động ↔ bị động.
   3. Kết hợp 2-3 câu đơn thành câu phức.
   4. Thêm trạng từ/tính từ biểu cảm.
   5. Đảo ngữ nhấn mạnh.

8️⃣ CẤU TRÚC CÂU PHỨC HỢP:
   Ưu tiên câu ghép, câu phức có nhiều mệnh đề để thể hiện tư duy logic chặt chẽ.

9️⃣ NGÔN NGỮ CHUYÊN NGÀNH:
   Sử dụng từ khóa "đắt" giá: Hiện thực hóa, Tối ưu hóa, Cá nhân hóa, Tích hợp liên môn, Phẩm chất cốt lõi, Năng lực đặc thù, Tư duy đa chiều, Chuyển đổi số, Hệ sinh thái học tập...

🔟 TỰ KIỂM TRA:
   Trong quá trình viết, liên tục tự hỏi: "Đoạn này có quá giống văn mẫu không?". Nếu có → Viết lại ngay.

💡 GIỌNG ĐIỆU YÊU CẦU:
- Viết như một GIÁO VIÊN THỰC SỰ đang chia sẻ sáng kiến của chính mình.
- Thể hiện TÂM HUYẾT, TRĂN TRỞ với nghề và với học sinh.
- Dùng ngôn ngữ TỰ NHIÊN, CHÂN THÀNH, không máy móc hay khuôn mẫu.
- Xen kẽ những suy nghĩ cá nhân, những quan sát thực tế từ lớp học.

BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái Bước 2 (Lập Dàn Ý - Đang thực hiện).

${isHigherEd ? HIGHER_ED_SYSTEM_INSTRUCTION : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THÔNG TIN ĐỀ TÀI:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

• Tên đề tài: ${userInfo.topic}
• Môn học/Lĩnh vực: ${userInfo.subject}${(() => {
          const info = getSubjectInfo(userInfo.subject); return info ? `
  → Nhóm: ${info.group}
  → Đặc trưng: ${info.description}
  → Hãy viết nội dung Biện pháp bám sát đặc thù lĩnh vực "${info.name}" thuộc nhóm "${info.group}"` : '';
        })()}
• Cấp học: ${userInfo.level}
• Khối lớp / Đối tượng: ${userInfo.grade}
• Tên ${schoolTerm}: ${userInfo.school}
• Phân tích/Kết hợp: Các yêu cầu đặc biệt của cấp học

${(['GVG', 'GVCN'].includes(userInfo.subject.toUpperCase().trim())) ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏆🏆🏆 CHẾ ĐỘ ĐẶC BIỆT: BIỆN PHÁP ${userInfo.subject.toUpperCase()} — ƯU TIÊN DATA APP 🏆🏆🏆
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ CẢNH BÁO NGHIÊM NGẶT: Giáo viên đã chọn danh mục "${userInfo.subject.toUpperCase()}" — đây là Biện pháp thi đua cấp cao.
BẠN BẮT BUỘC PHẢI:

1. 📚 SỬ DỤNG TRIỆT ĐỂ DỮ LIỆU NỘI BỘ APP:
   - Tham khảo 48 phương pháp/kỹ thuật dạy học tích cực (từ database knowledgeBase)
   - Áp dụng các kỹ thuật dạy học phù hợp (Think-Pair-Share, Jigsaw, KWL, 5E, STEM, AI...)
   - Tuân thủ quy tắc viết biện pháp chất lượng cao (writingRules)
   - Kết hợp đa dạng phương pháp truyền thống và hiện đại

2. 🌟 ĐẢM BẢO TÍNH MỚI & SÁNG TẠO:
   - Đề xuất giải pháp MỚI, CHƯA AI NGHĨ ĐẾN — không dùng lại ý tưởng phổ biến
   - Kết hợp sáng tạo giữa PP truyền thống + công nghệ + AI
   - Mỗi giải pháp phải có "điểm nhấn" độc đáo riêng

3. 🚫 KHÔNG TRÙNG LẶP, KHÔNG ĐẠO VĂN:
   - Mỗi giải pháp PHẢI có góc tiếp cận HOÀN TOÀN KHÁC BIỆT
   - Câu từ phải NGUYÊN BẢN — viết từ tư duy cá nhân, không copy
   - Số liệu, ví dụ phải ĐỘC BẢN, phù hợp với bối cảnh trường/lớp thực tế

4. 💎 CHẤT LƯỢNG XUẤT SẮC:
   - Dàn ý phải đạt chuẩn cấp tỉnh/quốc gia
   - Nội dung sâu sắc, logic chặt chẽ, có tính ứng dụng cao
   - Thể hiện chuyên môn vững và tâm huyết nghề nghiệp

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
` : ''}
${userInfo.referenceDocuments ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TÀI LIỆU THAM KHẢO (DO GIÁO VIÊN CUNG CẤP):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dưới đây là nội dung các tài liệu tham khảo mà giáo viên đã tải lên. BẮT BUỘC phải bám sát vào nội dung này để viết Biện pháp phù hợp và chính xác:

${truncateForPrompt(userInfo.referenceDocuments)}

[HẾT TÀI LIỆU THAM KHẢO]
` : ''}

${userInfo.customTemplate ? getCustomTemplatePrompt() : (userInfo.skknTemplate ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨🚨🚨 MẪU YÊU CẦU BIỆN PHÁP TỪ SỞ/PHÒNG GD (BẮT BUỘC TUYỆT ĐỐI) 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ CẢNH BÁO QUAN TRỌNG NHẤT: Giáo viên đã cung cấp MẪU YÊU CẦU Biện pháp chính thức bên dưới.

🚫 BẠN TUYỆT ĐỐI KHÔNG ĐƯỢC sử dụng bất kỳ cấu trúc Biện pháp mặc định/chuẩn nào.
✅ BẠN BẮT BUỘC PHẢI viết HOÀN TOÀN theo cấu trúc và mẫu này:

1. Tạo dàn ý và viết nội dung ĐÚNG CHÍNH XÁC theo cấu trúc, các mục, các phần trong mẫu này
2. Tuân theo ĐÚNG trình tự, tên gọi, cách đánh số các mục như trong mẫu
3. KHÔNG tự ý thay đổi tên mục, KHÔNG bỏ qua mục nào, KHÔNG thêm mục nếu mẫu không yêu cầu
4. KHÔNG sử dụng cấu trúc "Phần I, II, III, IV, V, VI" mặc định nếu mẫu có cấu trúc khác
5. Số lượng giải pháp, tên các phần lớn, thứ tự trình bày ĐỀU PHẢI theo mẫu này
6. Viết đúng theo format và quy cách mẫu đề ra

NỘI DUNG MẪU BIỆN PHÁP (ĐÂY LÀ CẤU TRÚC DUY NHẤT ĐƯỢC PHÉP SỬ DỤNG):
${userInfo.skknTemplate}

[HẾT MẪU BIỆN PHÁP - MỌI NỘI DUNG PHẢI TUÂN THỦ CẤU TRÚC TRÊN]
` : '')}

${userInfo.specialRequirements ? `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 YÊU CẦU ĐẶC BIỆT TỪ GIÁO VIÊN (BẮT BUỘC THỰC HIỆN):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ QUAN TRỌNG: Giáo viên đã đưa ra các yêu cầu đặc biệt sau.
BẠN BẮT BUỘC PHẢI TUÂN THỦ NGHIÊM NGẶT:

${userInfo.specialRequirements}

Hãy phân tích kỹ các yêu cầu trên và áp dụng CHÍNH XÁC vào toàn bộ bài viết.

📌 HƯỚNG DẪN XỬ LÝ GIỚI HẠN SỐ TRANG:
- Nếu yêu cầu "giới hạn X trang" → Số trang này tính từ PHẦN I & II đến hết PHẦN V, VI & KẾT LUẬN
- KHÔNG tính dàn ý vào giới hạn số trang
- KHÔNG tính Phụ lục vào giới hạn số trang (Phụ lục được tạo riêng, không giới hạn)
- Phân bổ số trang hợp lý cho NỘI DUNG CHÍNH (không tính Phụ lục):
  + Phần I & II: TỐI ĐA 4 trang (khoảng 10%)
  + Phần III (Thực trạng): TỐI ĐA 3 trang (khoảng 7-8%)
  + Phần IV (Giải pháp): khoảng 55-65% tổng số trang (phần quan trọng nhất)
  + Phần V, VI & Kết luận: khoảng 15-20% tổng số trang

Ví dụ: Nếu giới hạn 40 trang (KHÔNG tính Phụ lục):
  + Phần I & II: 3-4 trang (TỐI ĐA 4 trang)
  + Phần III: 2-3 trang (TỐI ĐA 3 trang)
  + Phần IV: 24-28 trang
  + Phần V, VI & Kết luận: 6-8 trang
  + Phụ lục: TÍNH RIÊNG (không giới hạn)

Các yêu cầu khác:
- Nếu yêu cầu "viết ngắn gọn phần lý thuyết" → Tóm tắt cô đọng phần cơ sở lý luận
- Nếu yêu cầu "thêm nhiều bài toán thực tế" → Bổ sung ví dụ toán thực tế phong phú
- Nếu yêu cầu "tập trung vào giải pháp" → Ưu tiên phần IV với nhiều chi tiết hơn

[HẾT YÊU CẦU ĐẶC BIỆT]
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ YÊU CẦU ĐỊNH DẠNG OUTPUT (BẮT BUỘC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. SAU MỖI CÂU: Phải xuống dòng (Enter 2 lần).
2. SAU MỖI ĐOẠN: Cách 1 dòng trống.
3. KHÔNG viết dính liền (wall of text).
4. Sử dụng gạch đầu dòng và tiêu đề rõ ràng.

${(userInfo.skknTemplate || userInfo.customTemplate) ? '' : (isHigherEd ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CẤU TRÚC BIỆN PHÁP BẬC CAO (TRUNG CẤP / CAO ĐẲNG / ĐẠI HỌC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 MÔ TẢ SÁNG KIẾN

1. BỐI CẢNH VÀ LÝ DO NGHIÊN CỨU (3-4 trang)

   1.1. Bối cảnh giáo dục đại học Việt Nam hiện nay
        → Nghị quyết 29-NQ/TW về đổi mới căn bản, toàn diện giáo dục
        → Luật Giáo dục đại học 2018 (sửa đổi 2024)
        → Yêu cầu đổi mới phương pháp giảng dạy ${userInfo.subject} bậc ${userInfo.level}
        → Xu hướng chuyển đổi số, chuẩn đầu ra CDIO/ABET
        → Cách mạng công nghiệp 4.0 và yêu cầu nguồn nhân lực chất lượng cao
        
   1.2. Xuất phát từ thực tiễn giảng dạy
        → Thực trạng giảng dạy ${userInfo.subject} tại ${userInfo.school}
        → Đặc điểm ${userInfo.grade}: năng lực đầu vào, động lực học tập
        → Hạn chế của phương pháp giảng dạy truyền thống ở bậc ${userInfo.level}
        → Khoảng cách giữa đào tạo và nhu cầu thị trường lao động

2. TỔNG QUAN TÀI LIỆU & CƠ SỞ LÝ LUẬN (5-7 trang)

   2.1. Tổng quan nghiên cứu (Literature Review)
        → Các nghiên cứu trong nước liên quan (ít nhất 3-5 nghiên cứu)
        → Các nghiên cứu quốc tế liên quan (ít nhất 3-5 nghiên cứu)
        → Phân tích khoảng trống nghiên cứu (Research Gap)
        → Trích dẫn chuẩn APA: (Tác giả, Năm)
        
   2.2. Khung lý thuyết (Theoretical Framework)
        → Andragogy - Lý thuyết học tập người lớn (Knowles)
        → Experiential Learning - Học qua trải nghiệm (Kolb)
        → Constructive Alignment - Căn chỉnh kiến tạo (Biggs)
        → Bloom's Taxonomy bậc cao (Analyze, Evaluate, Create)
        → Outcome-based Education (OBE)
        [Phân tích sâu + Liên hệ đề tài tại ${userInfo.school}]
        
   2.3. Cơ sở pháp lý
        → Luật Giáo dục đại học 2018, sửa đổi bổ sung
        → Thông tư quy định về chuẩn chương trình đào tạo
        → Quy chế đào tạo trình độ ${userInfo.level}

3. PHÂN TÍCH HIỆN TRẠNG & ĐÁNH GIÁ NHU CẦU (5-6 trang)

   3.1. Hiện trạng tổng quan
        → Điều kiện CSVC tại ${userInfo.school} (${userInfo.facilities})
        → Đặc thù đào tạo ngành/chuyên ngành liên quan
        → Chuẩn đầu ra chương trình đào tạo hiện hành
        
   3.2. Khảo sát giảng viên
        → Bảng khảo sát giảng viên (n=X, sử dụng thang Likert 5 điểm)
        → Phương pháp giảng dạy hiện tại
        → Thuận lợi - Khó khăn trong giảng dạy bậc ${userInfo.level}
        → Cronbach's Alpha kiểm tra độ tin cậy
        
   3.3. Khảo sát sinh viên
        → Bảng khảo sát sinh viên ${userInfo.grade} (n=Y)  
        → Kết quả học tập trước khi áp dụng sáng kiến
        → Mức độ hài lòng, động lực học tập
        → Kỹ năng tự học, nghiên cứu
        → Nhu cầu đổi mới phương pháp
        
   → Phân tích nguyên nhân bằng mô hình Fishbone/SWOT

4. CÁC GIẢI PHÁP, BIỆN PHÁP THỰC HIỆN (12-18 trang - PHẦN QUAN TRỌNG NHẤT)

   ⚠️ MỖI GIẢI PHÁP PHẢI CÓ CƠ SỞ NGHIÊN CỨU KHOA HỌC RÕ RÀNG.

   GIẢI PHÁP 1: [Tên giải pháp - dựa trên nghiên cứu khoa học]
   
        1.1. Mục tiêu giải pháp (gắn với Chuẩn đầu ra / Learning Outcomes)
             → Mục tiêu về kiến thức chuyên ngành
             → Mục tiêu về năng lực nghề nghiệp
             → Mục tiêu về kỹ năng mềm, tư duy phản biện
             
        1.2. Cơ sở khoa học & Nghiên cứu liên quan
             → Trích dẫn 2-3 nghiên cứu hỗ trợ (APA)
             → Phân tích mô hình quốc tế tương tự
             → Điểm mới, sáng tạo so với nghiên cứu trước
             
        1.3. Thiết kế nghiên cứu & Quy trình
             → Thiết kế: thực nghiệm/bán thực nghiệm/nghiên cứu hành động
             → Nhóm thực nghiệm (n=?) và nhóm đối chứng (n=?)
             → Quy trình thực hiện chi tiết (5-7 bước)
             → Công cụ đánh giá: rubric, bài thi, khảo sát
             
        1.4. Ví dụ minh họa cụ thể
             → Bài giảng/học phần cụ thể trong giáo trình ${userInfo.textbook || "hiện hành"}
             → Hoạt động giảng dạy chi tiết
             → Sản phẩm sinh viên mẫu / Đồ án / Tiểu luận
             
        1.5. Điều kiện thực hiện & Hạn chế
             → Yêu cầu về CSVC (tận dụng ${userInfo.facilities})
             → Hạn chế của phương pháp (phản biện)
             → Điều kiện nhân rộng

   GIẢI PHÁP 2: [Tên giải pháp - dựa trên nghiên cứu khoa học]
        [Cấu trúc tương tự, triển khai đầy đủ 5 mục]

   GIẢI PHÁP 3: [Tên giải pháp - dựa trên nghiên cứu khoa học]
        [Cấu trúc tương tự, triển khai đầy đủ 5 mục]

   → MỐI LIÊN HỆ HỆ THỐNG GIỮA CÁC GIẢI PHÁP

5. KẾT QUẢ NGHIÊN CỨU & ĐÁNH GIÁ (5-6 trang)

   5.1. Mục đích & Phương pháp đánh giá
        → Thiết kế thực nghiệm: Pre-test / Post-test
        → Công cụ thu thập dữ liệu: Bài thi, bảng hỏi Likert, phỏng vấn sâu
        
   5.2. Kết quả định lượng
        → Đối tượng: ${userInfo.researchSubjects || "Sinh viên tại đơn vị"}
        → Thời gian: ${userInfo.timeframe || "Năm học hiện tại"}
        → Bảng kết quả kèm phân tích thống kê (Mean, SD, t-value, p-value)
        → Effect size (Cohen's d)
        → Biểu đồ so sánh nhóm thực nghiệm vs đối chứng
        
   5.3. Kết quả định tính
        → Phỏng vấn sinh viên, giảng viên
        → Quan sát lớp học / giảng đường
        → Phân tích sản phẩm sinh viên
        → Ý kiến phản hồi từ chuyên gia, đồng nghiệp

6. ĐIỀU KIỆN NHÂN RỘNG & PHÁT TRIỂN (1-2 trang)

   → Điều kiện về CSVC, công nghệ
   → Điều kiện về năng lực giảng viên, bồi dưỡng
   → Phạm vi áp dụng: các trường ${userInfo.level} khác
   → Hướng nghiên cứu phát triển tiếp theo

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 KẾT LUẬN VÀ KHUYẾN NGHỊ (2-3 trang)

1. Kết luận
   → Tóm tắt đóng góp chính của sáng kiến
   → Tính mới và giá trị khoa học
   → Giá trị thực tiễn cho đào tạo bậc ${userInfo.level}

2. Khuyến nghị  
   → Với nhà trường / Ban giám hiệu
   → Với khoa / bộ môn
   → Với giảng viên
   → Với Bộ GD&ĐT / Hội đồng khoa học
   → Hướng nghiên cứu phát triển tiếp

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 TÀI LIỆU THAM KHẢO
   → Liệt kê 10-15 tài liệu theo chuẩn APA (gồm tiếng Việt và tiếng Anh)

📎 PHỤ LỤC
   → Phiếu khảo sát (Likert scale)
   → Đề cương bài giảng minh họa
   → Rubric đánh giá
   → Sản phẩm sinh viên
   → Kết quả phân tích thống kê chi tiết
` : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CẤU TRÚC BIỆN PHÁP CHUẨN (ÁP DỤNG KHI KHÔNG CÓ MẪU RIÊNG):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 MÔ TẢ SÁNG KIẾN

1. HOÀN CẢNH NẢY SINH SÁNG KIẾN (3-4 trang)

   1.1. Xuất phát từ mục tiêu của giáo dục Việt Nam trong thời kì hiện nay
        → Nghị quyết 29-NQ/TW về đổi mới căn bản, toàn diện giáo dục
        → Chương trình GDPT 2018 - định hướng phát triển năng lực, phẩm chất
        → Yêu cầu đổi mới dạy học môn ${userInfo.subject}
        → Xu hướng chuyển đổi số trong giáo dục
        
   1.2. Xuất phát từ thực tiễn dạy - học hiện nay
        → Thực trạng dạy học môn ${userInfo.subject} tại ${userInfo.school}
        → Khó khăn, thách thức của học sinh ${userInfo.grade}
        → Hạn chế của phương pháp dạy học truyền thống
        → Nhu cầu cấp thiết đổi mới để nâng cao chất lượng

2. CƠ SỞ LÝ LUẬN CỦA VẤN ĐỀ (4-5 trang)

   2.1. Các khái niệm cơ bản liên quan đến đề tài
        → Định nghĩa, thuật ngữ then chốt (DIỄN GIẢI theo cách riêng, không copy)
        
   2.2. Cơ sở pháp lý (TÓM TẮT TINH THẦN, không trích nguyên văn)
        → Luật Giáo dục 2019
        → Thông tư hướng dẫn liên quan
        → Công văn chỉ đạo của Bộ/Sở GD&ĐT
        
   2.3. Cơ sở lý luận giáo dục (Chọn 2-3 lý thuyết PHÙ HỢP)
        → Lý thuyết kiến tạo (Piaget, Vygotsky)
        → Lý thuyết học tập qua trải nghiệm (Kolb)
        → Dạy học phát triển năng lực
        [Diễn giải LÍ THUYẾT + Liên hệ đề tài tại ${userInfo.school}]

3. THỰC TRẠNG VẤN ĐỀ CẦN NGHIÊN CỨU (5-6 trang)

   3.1. Thực trạng chung
        → Điều kiện CSVC tại ${userInfo.school} (${userInfo.facilities})
        → Đặc điểm địa phương ${userInfo.location}
        → Xu hướng dạy học hiện nay
        
   3.2. Thực trạng đối với giáo viên
        → Bảng khảo sát giáo viên (n=X)
        → Thuận lợi - Khó khăn trong giảng dạy
        → Phương pháp đang sử dụng
        
   3.3. Thực trạng đối với học sinh
        → Bảng khảo sát học sinh ${userInfo.grade} (n=Y)  
        → Kết quả học tập trước khi áp dụng sáng kiến
        → Thái độ, hứng thú với môn học
        → Những khó khăn học sinh gặp phải
        
   → Phân tích nguyên nhân (khách quan + chủ quan)

4. CÁC GIẢI PHÁP, BIỆN PHÁP THỰC HIỆN (12-15 trang - PHẦN QUAN TRỌNG NHẤT)

   ⚠️ CHỈ ĐỀ XUẤT 3 GIẢI PHÁP TRỌNG TÂM, ĐẶC SẮC NHẤT - làm hoàn thiện, chỉn chu từng giải pháp.

   GIẢI PHÁP 1: [Tên giải pháp cụ thể, ấn tượng]
   
        1.1. Mục tiêu của giải pháp
             → Mục tiêu về kiến thức
             → Mục tiêu về năng lực
             → Mục tiêu về phẩm chất
             
        1.2. Nội dung và cách thực hiện
             → Mô tả chi tiết bản chất giải pháp
             → Cơ sở khoa học của giải pháp
             → Điểm mới, sáng tạo
             
        1.3. Quy trình thực hiện (5-7 bước cụ thể)
             Bước 1: [Tên bước] - [Chi tiết cách làm]
             Bước 2: [Tên bước] - [Chi tiết cách làm]
             Bước 3: [Tên bước] - [Chi tiết cách làm]
             Bước 4: [Tên bước] - [Chi tiết cách làm]
             Bước 5: [Tên bước] - [Chi tiết cách làm]
             
        1.4. Ví dụ minh họa cụ thể
             → Bài học trong SGK ${userInfo.textbook || "hiện hành"}
             → Hoạt động chi tiết với thời lượng
             → Sản phẩm học sinh mẫu
             
        1.5. Điều kiện thực hiện & Lưu ý
             → Yêu cầu về CSVC (tận dụng ${userInfo.facilities})
             → Điều kiện thành công
             → Những lưu ý quan trọng

   GIẢI PHÁP 2: [Tên giải pháp cụ thể, ấn tượng]
        [Cấu trúc tương tự giải pháp 1, triển khai đầy đủ 5 mục]

   GIẢI PHÁP 3: [Tên giải pháp cụ thể, ấn tượng]
        [Cấu trúc tương tự giải pháp 1, triển khai đầy đủ 5 mục]

   → MỐI LIÊN HỆ GIỮA CÁC GIẢI PHÁP (giải thích tính hệ thống, logic)

5. KẾT QUẢ ĐẠT ĐƯỢC (4-5 trang)

   5.1. Mục đích thực nghiệm
        → Kiểm chứng tính hiệu quả của sáng kiến
        → Đánh giá mức độ phù hợp với thực tiễn
        
   5.2. Nội dung thực nghiệm
        → Đối tượng: ${userInfo.researchSubjects || "Học sinh tại đơn vị"}
        → Thời gian: ${userInfo.timeframe || "Năm học hiện tại"}
        → Phạm vi áp dụng
        
   5.3. Tổ chức thực nghiệm
        → Bảng so sánh kết quả TRƯỚC - SAU (dùng số liệu lẻ: 42.3%, 67.8%)
        → Biểu đồ minh họa
        → Phân tích, nhận xét kết quả

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 KẾT LUẬN VÀ KIẾN NGHỊ (2-3 trang)

1. Kết luận
   → Tóm tắt những đóng góp chính
   → Giá trị thực tiễn

2. Kiến nghị, đề xuất
   → Với nhà trường
   → Với Phòng/Sở GD&ĐT
   → Hướng phát triển tiếp theo

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📚 TÀI LIỆU THAM KHẢO
   → Liệt kê 8-12 tài liệu theo chuẩn trích dẫn

📎 PHỤ LỤC
   → Phiếu khảo sát
   → Giáo án minh họa
   → Hình ảnh hoạt động
   → Sản phẩm học sinh
`)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YÊU CẦU DÀN Ý(NGẮN GỌN - CHỈ ĐẦU MỤC):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ QUAN TRỌNG: Dàn ý phải NGẮN GỌN, chỉ liệt kê CÁC ĐẦU MỤC CHÍNH.
Nội dung chi tiết sẽ được triển khai ở các bước viết sau.

✓ CHỈ 3 BIỆN PHÁP - liệt kê TÊN biện pháp, không triển khai chi tiết
✓ Mỗi phần chỉ ghi tiêu đề mục và các ý chính(1 - 2 dòng mỗi ý)
✓ KHÔNG viết đoạn văn dài trong dàn ý
✓ KHÔNG triển khai chi tiết nội dung - chỉ gợi ý hướng đi
✓ Gợi ý danh sách phụ lục cần tạo(dựa trên các giải pháp)
✓ Phù hợp với đặc thù môn ${userInfo.subject} và cấp ${userInfo.level}
${isHigherEd ? `✓ SỬ DỤNG THUẬT NGỮ BẬC CAO: "sinh viên", "giảng viên", "giáo trình", "học phần", "chuẩn đầu ra"
✓ Giải pháp phải có CƠ SỞ NGHIÊN CỨU KHOA HỌC, trích dẫn APA
✓ Cấu trúc chặt chẽ hơn: có Literature Review, Thiết kế nghiên cứu, Phân tích thống kê` : ''
        }
✓ Có thể triển khai ngay ở các bước sau

${getPageLimitPrompt() ? `
${getPageLimitPrompt()}

📋 LƯU Ý KHI LẬP DÀN Ý VỚI GIỚI HẠN TRANG:
- Dàn ý phải TƯƠNG XỨNG với số trang cho phép
- Nếu ít trang (≤25): Giảm số mục con, mỗi giải pháp chỉ 3-4 ý chính
- Nếu trung bình (25-40): Số mục con vừa phải, mỗi giải pháp 5-6 ý chính
- Nếu nhiều trang (>40): Có thể mở rộng, mỗi giải pháp 6-8 ý chính
- Đảm bảo dàn ý phản ánh đúng quy mô nội dung sẽ viết
` : ''}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ĐỊNH DẠNG ĐẦU RA:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Trình bày theo cấu trúc phân cấp rõ ràng(Markdown):
1. TÊN PHẦN LỚN
1.1.Tên mục nhỏ
        • Ý chi tiết 1
        • Ý chi tiết 2


Sử dụng icon để dễ nhìn: ✓ → • ○ ▪ ■

QUAN TRỌNG:
1. HIỂN THỊ "📱 MENU NAVIGATION" ĐẦU TIÊN(Bước 2: Đang thực hiện).
2. Cuối dàn ý, hiển thị hộp thoại xác nhận:
      ┌─────────────────────────────────┐
      │ ✅ Đồng ý dàn ý này ?            │
      │ ✏️ Bạn có thể CHỈNH SỬA trực   │
      │    tiếp bằng nút "Chỉnh sửa"    │
      └─────────────────────────────────┘
`;

      let generatedText = "";
      await sendMessageStream(initMessage, (chunk) => {
        generatedText += chunk;
        setState(prev => ({
          ...prev,
          fullDocument: generatedText // Initial document is just the outline
        }));
      }, provider, ThinkingLevel.LOW);

      setFallbackNotice(null);
      setState(prev => ({ ...prev, isStreaming: false }));

    } catch (error: any) {
      setFallbackNotice(null);
      // Thử xoay API key nếu lỗi quota/rate limit (chỉ áp dụng cho Gemini API)
      const errorType = parseApiError(error);
      if (provider === 'gemini' && (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT')) {
        const rotation = apiKeyManager.markKeyError(apiKey, errorType);
        if (rotation.success && rotation.newKey) {
          console.log(`🔄 Tự động xoay key: ${rotation.message}`);
          setApiKey(rotation.newKey);
          localStorage.setItem('gemini_api_key', rotation.newKey);
          initializeGeminiChat(rotation.newKey, selectedModel, provider);
          // Tự động thử lại với key mới
          setState(prev => ({ ...prev, isStreaming: false, error: null }));
          setTimeout(() => startGeneration(), 500);
          return;
        }
      }
      setState(prev => ({ ...prev, isStreaming: false, error: error.message || "Failed to generate." }));
    }
  };

  // Regenerate Outline based on feedback
  const regenerateOutline = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!outlineFeedback.trim()) return;

    try {
      setState(prev => ({ ...prev, isStreaming: true, error: null, fullDocument: '' }));

      const feedbackMessage = `
      BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái Bước 2(Lập Dàn Ý - Đang thực hiện).

      Dựa trên dàn ý đã lập, người dùng có yêu cầu chỉnh sửa sau:
"${outlineFeedback}"
      
      Hãy viết lại TOÀN BỘ Dàn ý chi tiết mới đã được cập nhật theo yêu cầu trên. 
      Vẫn đảm bảo cấu trúc chuẩn Biện pháp.
      
      Lưu ý các quy tắc định dạng:
- Xuống dòng sau mỗi câu.
      - Tách đoạn rõ ràng.
      
      Kết thúc phần dàn ý, hãy xuống dòng và hiển thị hộp thoại:
      ┌─────────────────────────────────┐
      │ ✅ Đồng ý dàn ý này ?            │
      │ ✏️ Bạn có thể CHỈNH SỬA trực   │
      │    tiếp bằng nút "Chỉnh sửa"    │
      └─────────────────────────────────┘
`;

      let generatedText = "";
      await sendMessageStream(feedbackMessage, (chunk) => {
        generatedText += chunk;
        setState(prev => ({
          ...prev,
          fullDocument: generatedText
        }));
      }, provider, ThinkingLevel.LOW);

      setFallbackNotice(null);
      setState(prev => ({ ...prev, isStreaming: false }));
      setOutlineFeedback(""); // Clear feedback after sending

    } catch (error: any) {
      setFallbackNotice(null);
      setState(prev => ({ ...prev, isStreaming: false, error: error.message }));
    }
  };

  // Generate Next Section
  const generateNextSection = async (stepToRun?: GenerationStep) => {
    // ⚠️ GUARD: Ngăn gọi trùng khi đang streaming (race condition)
    if (state.isStreaming) {
      console.warn('⚠️ generateNextSection bị chặn: đang streaming');
      return;
    }

    let currentStepPrompt = "";
    let nextStepEnum = GenerationStep.PART_1;
    let shouldAppend = true; // Mặc định append nội dung vào fullDocument

    const activeStep = stepToRun !== undefined ? stepToRun : state.step;
    console.log(`📝 generateNextSection: activeStep=${activeStep}, state.step=${state.step}, stepToRun=${stepToRun}`);
    const healingSnippet = getHealingPromptSnippet(healingContext);

    // Logic for OUTLINE step specifically handles manual edits synchronization
    if (activeStep === GenerationStep.OUTLINE) {
      // We inject the CURRENT fullDocument (which might have been edited by user) into the prompt
      // This ensures the AI uses the user's finalized outline.
      currentStepPrompt = `
        BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Phần 1 - Đặt vấn đề - Đang thực hiện).
        
        Đây là bản DÀN Ý CHÍNH THỨC mà tôi đã chốt (tôi có thể đã chỉnh sửa trực tiếp). 
        Hãy DÙNG CHÍNH XÁC NỘI DUNG NÀY để làm cơ sở triển khai các phần tiếp theo:

--- BẮT ĐẦU DÀN Ý CHÍNH THỨC---
  ${state.fullDocument}
--- KẾT THÚC DÀN Ý CHÍNH THỨC---

  NHIỆM VỤ TIẾP THEO:
        Viết chi tiết PHẦN 1: ĐẶT VẤN ĐỀ theo cấu trúc:
        
        ## 1. Đặt vấn đề
        ### 1.1. Lí do chọn đề tài
        ### 1.2. Mục đích nghiên cứu
        ### 1.3. Đối tượng nghiên cứu
        
        ⚠️ LƯU Ý FORMAT:
- Viết từng câu xuống dòng riêng.
        - Tách đoạn rõ ràng.
        
        Viết sâu sắc, học thuật, đúng cấu trúc đã đề ra.

        ⚠️ NHẮC LẠI THÔNG TIN QUAN TRỌNG (BẮT BUỘC BÁM SÁT):
        - Cấp học: ${userInfo.level}
        - Khối lớp / Đối tượng: ${userInfo.grade}
        - Môn học: ${userInfo.subject}
        - Trường: ${userInfo.school}
        - Địa phương: ${userInfo.location}
        🚫 TUYỆT ĐỐI KHÔNG dùng thông tin của cấp học khác (THPT, THCS...) nếu đề tài là cấp ${userInfo.level}!
        Mọi ví dụ, số liệu, thuật ngữ PHẢI phù hợp với cấp ${userInfo.level}, khối ${userInfo.grade}.

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Phần 1 (Đặt vấn đề)', 'partI_II')} `;

      nextStepEnum = GenerationStep.PART_1;
    } else {
      // Standard flow for other steps
      const nextStepMap: Record<number, { prompt: string, nextStep: GenerationStep, skipAppend?: boolean }> = {
        [GenerationStep.PART_1]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Phần 2 - Thực trạng - Đang thực hiện).

              Tiếp tục viết chi tiết PHẦN 2: THỰC TRẠNG VẤN ĐỀ theo cấu trúc:
              
              ## 2. Thực trạng vấn đề
              
              ### 2.1. Cơ sở lý luận
              - Lý thuyết giáo dục liên quan
              - Văn bản pháp lý (định hướng GD hiện hành)
              - Cơ sở khoa học của đề tài
              
              ### 2.2. Cơ sở thực tiễn
              - Thực trạng dạy và học môn ${userInfo.subject} tại ${userInfo.school}
              - Bảng số liệu khảo sát trước khi áp dụng (số lẻ, cụ thể)
              - Phân tích nguyên nhân và thực trạng
              
              ⚠️ NHẮC LẠI: Cấp ${userInfo.level}, khối ${userInfo.grade}, môn ${userInfo.subject}.
              Bảng số liệu Markdown chuẩn: | Tiêu đề | Số liệu |.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA.
              
              ⚠️ NHẮC LẠI: Đây là Biện pháp cấp ${userInfo.level}, khối ${userInfo.grade}, môn ${userInfo.subject}.
              Mọi nội dung, ví dụ, số liệu, đối tượng khảo sát PHẢI phù hợp với cấp ${userInfo.level}.
              🚫 TUYỆT ĐỐI KHÔNG nhầm sang THPT, THCS hoặc cấp học khác nếu đề tài không thuộc cấp đó!
              
              ⚠️ LƯU Ý FORMAT:
- Viết từng câu xuống dòng riêng.
              - Tách đoạn rõ ràng.
              - Bảng số liệu phải tuân thủ format Markdown chuẩn: | Tiêu đề | Số liệu |.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA(BẮT BUỘC):
              Trong phần Thực trạng, hãy gợi ý 1 - 2 vị trí nên đặt hình ảnh minh họa với format:
              ** [🖼️ GỢI Ý HÌNH ẢNH: Mô tả chi tiết hình ảnh cần chụp / tạo - Đặt sau phần nào] **
  Ví dụ:
              ** [🖼️ GỢI Ý HÌNH ẢNH: Biểu đồ cột thể hiện tỉ lệ học sinh yếu / trung bình / khá / giỏi trước khi áp dụng sáng kiến - Đặt sau bảng khảo sát đầu năm] **
              ** [🖼️ GỢI Ý HÌNH ẢNH: Ảnh chụp thực tế lớp học / phòng thí nghiệm tại ${userInfo.school} - Đặt phần đặc điểm nhà trường] **

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Phần III (Thực trạng vấn đề)', 'partIII')} `,
          nextStep: GenerationStep.PART_2
        },
        [GenerationStep.PART_2]: {
          // BIỆN PHÁP 1 - Mục 2.3
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Biện pháp 1 - Đang thực hiện).

  ${SOLUTION_MODE_PROMPT}
      
              ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              🚀 THỰC THI NHIỆM VỤ (MỤC 2.3 - BIỆN PHÁP 1)
              ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
              
              Thông tin đề tài: "${userInfo.topic}"
Môn: ${userInfo.subject} - Lớp: ${userInfo.grade}
Trường: ${userInfo.school}
SGK: ${userInfo.textbook}
              Công nghệ / AI: ${userInfo.applyAI}
              CSVC hiện có: ${userInfo.facilities}
              
              YÊU CẦU:
              Hãy viết chi tiết GIẢI PHÁP 1(Giải pháp trọng tâm nhất) tuân thủ nghiêm ngặt 10 NGUYÊN TẮC VÀNG.
              Giải pháp phải khả thi với điều kiện CSVC: ${userInfo.facilities}.
              
              QUAN TRỌNG: Tuân thủ "YÊU CẦU ĐỊNH DẠNG OUTPUT" vừa cung cấp:
1. Xuống dòng sau mỗi câu.
              2. Xuống 2 dòng sau mỗi đoạn.
              3. Sử dụng Format "KẾT THÚC GIẢI PHÁP" ở cuối.
              
              Lưu ý đặc biệt: Phải có VÍ DỤ MINH HỌA(Giáo án / Hoạt động) cụ thể theo SGK ${userInfo.textbook}.
              Menu Navigation: Đánh dấu Bước 5 đang làm(🔵).
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA(BắT BUỘC):
              Trong GIẢI PHÁP 1, hãy gợi ý 1 - 2 vị trí nên đặt hình ảnh minh họa với format:
              ** [🖼️ GỢI Ý HÌNH ẢNH: Mô tả chi tiết hình ảnh - Đặt sau phần nào] **
  Ví dụ gợi ý cho Giải pháp 1:
              ** [🖼️ GỢI Ý HÌNH ẢNH: Sơ đồ quy trình thực hiện giải pháp(5 - 7 bước) dạng flowchart - Đặt đầu mục Quy trình thực hiện] **
              ** [🖼️ GỢI Ý HÌNH ẢNH: Ảnh chụp học sinh thực hiện hoạt động / Ảnh miền họa hoạt động mẫu - Đặt trong phần Ví dụ minh họa] **

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Giải pháp 1', 'perSolution')} `,
          nextStep: GenerationStep.BP1
        },
        [GenerationStep.BP1]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái(Viết Giải pháp 2 - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC(ULTRA MODE).
              
              Nhiệm vụ: Viết chi tiết GIẢI PHÁP 2 cho đề tài: "${userInfo.topic}".
              
              Yêu cầu:
1. Nội dung độc đáo, KHÔNG trùng lặp với Giải pháp 1.
2. Tận dụng tối đa CSVC: ${userInfo.facilities}.
3. BẮT BUỘC TUÂN THỦ FORMAT "YÊU CẦU ĐỊNH DẠNG OUTPUT":
- Xuống dòng sau mỗi câu.
                 - Xuống 2 dòng sau mỗi đoạn.
                 - Có khung "KẾT THÚC GIẢI PHÁP" ở cuối.
              4. Phải có VÍ DỤ MINH HỌA cụ thể theo SGK ${userInfo.textbook}.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA(BẮT BUỘC):
              Trong GIẢI PHÁP 2, hãy gợi ý 1 - 2 vị trí nên đặt hình ảnh minh họa với format:
              ** [🖼️ GỢI Ý HÌNH ẢNH: Mô tả chi tiết hình ảnh - Đặt sau phần nào] **

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Giải pháp 2', 'perSolution')} `,
          nextStep: GenerationStep.BP2
        },
        [GenerationStep.BP2]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái(Viết Giải pháp 3 - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC(ULTRA MODE).
              
              Nhiệm vụ: Viết chi tiết GIẢI PHÁP 3 cho đề tài: "${userInfo.topic}".
              
              Yêu cầu:
1. Nội dung độc đáo, KHÔNG trùng lặp với Giải pháp 1 và 2.
2. Tận dụng tối đa CSVC: ${userInfo.facilities}.
3. BẮT BUỘC TUÂN THỦ FORMAT "YÊU CẦU ĐỊNH DẠNG OUTPUT":
- Xuống dòng sau mỗi câu.
                 - Xuống 2 dòng sau mỗi đoạn.
                 - Có khung "KẾT THÚC GIẢI PHÁP" ở cuối.
              4. Phải có VÍ DỤ MINH HỌA cụ thể theo SGK ${userInfo.textbook}.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA(BẮT BUỘC):
              Trong GIẢI PHÁP 3, hãy gợi ý 1 - 2 vị trí nên đặt hình ảnh minh họa.

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Giải pháp 3', 'perSolution')} `,
          nextStep: GenerationStep.BP3
        },
        [GenerationStep.BP3]: {
          prompt: userInfo.includeSolution4_5
            ? `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Giải pháp 4 - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC (ULTRA MODE).
              
              Nhiệm vụ: Viết chi tiết GIẢI PHÁP 4 cho đề tài: "${userInfo.topic}".
              
              Yêu cầu:
1. Nội dung độc đáo, KHÔNG trùng lặp với Giải pháp 1, 2 và 3.
2. Tận dụng tối đa CSVC: ${userInfo.facilities}.
3. BẮT BUỘC TUÂN THỦ FORMAT "YÊU CẦU ĐỊNH DẠNG OUTPUT":
   - Xuống dòng sau mỗi câu.
   - Xuống 2 dòng sau mỗi đoạn.
   - Có khung "KẾT THÚC GIẢI PHÁP" ở cuối.
4. Phải có VÍ DỤ MINH HỌA cụ thể theo SGK ${userInfo.textbook}.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA (BẮT BUỘC):
              Trong GIẢI PHÁP 4, hãy gợi ý 1-2 vị trí nên đặt hình ảnh minh họa.

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Giải pháp 4', 'perSolution')} `
            : `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết mục 2.4 Tính mới, tính sáng tạo - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC.
              
              Nhiệm vụ: Viết chi tiết MỤC 2.4 cho đề tài: "${userInfo.topic}".
              
              CẤU TRÚC BẮT BUỘC:
              
              ## 2.4. Tính mới, tính sáng tạo
              
              ### 2.4.1. Tính mới của giải pháp
              - So sánh với các biện pháp/giải pháp hiện có
              - Điểm khác biệt nổi bật
              - Giá trị mới mang lại cho giáo dục
              
              ### 2.4.2. Tính sáng tạo của giải pháp
              - Sự sáng tạo trong cách tiếp cận
              - Sáng tạo trong ứng dụng công nghệ/phương pháp
              - Sáng tạo trong tổ chức hoạt động dạy học
              
              ⚠️ LƯU Ý:
              - Phải liên hệ trực tiếp với 3 biện pháp đã viết ở mục 2.3
              - Dùng số liệu cụ thể để chứng minh tính mới
              - Bám sát đặc thù cấp ${userInfo.level}, môn ${userInfo.subject}
              
              ${getPageLimitPrompt()}`,
          nextStep: userInfo.includeSolution4_5 ? GenerationStep.BP4 : GenerationStep.TINH_MOI
        },
        [GenerationStep.BP4]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Giải pháp 5 - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC (ULTRA MODE).
              
              Nhiệm vụ: Viết chi tiết GIẢI PHÁP 5 (GIẢI PHÁP CUỐI CÙNG) cho đề tài: "${userInfo.topic}".
              
              Yêu cầu:
1. Nội dung độc đáo, KHÔNG trùng lặp với Giải pháp 1, 2, 3 và 4.
2. Tận dụng tối đa CSVC: ${userInfo.facilities}.
3. BẮT BUỘC TUÂN THỦ FORMAT "YÊU CẦU ĐỊNH DẠNG OUTPUT":
   - Xuống dòng sau mỗi câu.
   - Xuống 2 dòng sau mỗi đoạn.
   - Có khung "KẾT THÚC GIẢI PHÁP" ở cuối.
4. Phải có VÍ DỤ MINH HỌA cụ thể theo SGK ${userInfo.textbook}.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA (BẮT BUỘC):
              Trong GIẢI PHÁP 5, hãy gợi ý 1-2 vị trí nên đặt hình ảnh minh họa.

  ${getPageLimitPrompt()}
  ${getSectionPagePrompt('Giải pháp 5', 'perSolution')} `,
          nextStep: GenerationStep.BP5
        },
        [GenerationStep.BP5]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết mục 2.4 Tính mới, tính sáng tạo - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC.
              
              Nhiệm vụ: Viết chi tiết MỤC 2.4 cho đề tài: "${userInfo.topic}".
              
              CẤU TRÚC BẮT BUỘC:
              
              ## 2.4. Tính mới, tính sáng tạo
              
              ### 2.4.1. Tính mới của giải pháp
              - So sánh với các biện pháp/giải pháp hiện có
              - Điểm khác biệt nổi bật
              - Giá trị mới mang lại cho giáo dục
              
              ### 2.4.2. Tính sáng tạo của giải pháp
              - Sự sáng tạo trong cách tiếp cận
              - Sáng tạo trong ứng dụng công nghệ/phương pháp
              - Sáng tạo trong tổ chức hoạt động dạy học
              
              ⚠️ LƯU Ý:
              - Phải liên hệ trực tiếp với 5 biện pháp đã viết ở mục 2.3
              - Dùng số liệu cụ thể để chứng minh tính mới
              - Bám sát đặc thù cấp ${userInfo.level}, môn ${userInfo.subject}
              
              ${getPageLimitPrompt()}`,
          nextStep: GenerationStep.TINH_MOI
        },
        [GenerationStep.TINH_MOI]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Phần 3 - Phạm vi ảnh hưởng - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC.
              
              Nhiệm vụ: Viết chi tiết PHẦN 3 cho đề tài: "${userInfo.topic}".
              
              CẤU TRÚC BẮT BUỘC:
              
              ## 3. Phạm vi ảnh hưởng, khả năng áp dụng giải pháp
              
              ### 3.1. Phạm vi ảnh hưởng
              - Đối tượng được hưởng lợi (${userInfo.grade} tại ${userInfo.school})
              - Phạm vi áp dụng: trong trường, cụm trường, huyện/tỉnh
              - Tác động đến chất lượng dạy và học
              
              ### 3.2. Khả năng áp dụng
              - Điều kiện cần thiết để áp dụng (CSVC, năng lực GV)
              - Khả năng nhân rộng trong các trường cùng cấp
              - Tính khả thi với điều kiện thực tế
              
              ### 3.3. Hiệu quả, lợi ích thu được từ giải pháp
              - Kết quả thực nghiệm: Bảng so sánh TRƯỚC - SAU (số liệu lẻ: 68.9%, 42.3%)
              - Bảng Markdown chuẩn với dữ liệu khảo sát
              - Phân tích hiệu quả định lượng và định tính
              - Lợi ích cho học sinh, giáo viên, nhà trường
              
              ⚠️ NHẮC LẠI: Cấp ${userInfo.level}, khối ${userInfo.grade}, môn ${userInfo.subject}.
              Số liệu phải LOGIC, sử dụng số lẻ. Có bảng so sánh Markdown chuẩn.
              
              🖼️ GỢI Ý HÌNH ẢNH MINH HỌA.
              
              ${getPageLimitPrompt()}`,
          nextStep: GenerationStep.PHAM_VI
        },
        [GenerationStep.PHAM_VI]: {
          prompt: `
              BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái (Viết Phần 4 - Kết luận và kiến nghị - Đang thực hiện).

              Tiếp tục giữ vững vai trò CHUYÊN GIA GIÁO DỤC.
              
              Nhiệm vụ: Viết chi tiết PHẦN 4 cho đề tài: "${userInfo.topic}".
              
              CẤU TRÚC BẮT BUỘC:
              
              ## 4. Kết luận và kiến nghị
              
              ### 4.1. Kết luận
              - Tóm tắt lại vấn đề đã giải quyết
              - Tổng kết 3 biện pháp đã thực hiện
              - Đánh giá mức độ đạt mục tiêu nghiên cứu
              
              ### 4.2. Hiệu quả và ý nghĩa của giải pháp
              - Hiệu quả thực tiễn (số liệu cụ thể)
              - Ý nghĩa khoa học và sư phạm
              - Đóng góp cho giáo dục tại ${userInfo.school} và địa phương
              
              ### 4.3. Kiến nghị, đề xuất
              - Kiến nghị với nhà trường
              - Kiến nghị với Phòng/Sở GD&ĐT
              - Đề xuất hướng phát triển, nghiên cứu tiếp theo
              
              TÀI LIỆU THAM KHẢO (8-12 tài liệu)
              - Sách, tạp chí khoa học giáo dục
              - Văn bản pháp luật, thông tư
              - Tài liệu điện tử (website uy tín)
              
              ⚠️ LƯU Ý: Kết luận phải bám sát nội dung đã viết. Kiến nghị phải khả thi.
              
              ${getPageLimitPrompt()}`,
          nextStep: GenerationStep.KET_LUAN
        },
        // KẾT LUẬN → COMPLETED
        [GenerationStep.KET_LUAN]: {
          prompt: `
              ✅ BIỆN PHÁP GVG ĐÃ HOÀN THÀNH!
              
              Bạn đã viết xong toàn bộ nội dung chính gồm 4 phần:
              1. Đặt vấn đề
              2. Thực trạng vấn đề (Cơ sở lý luận, Thực tiễn, 3 Biện pháp, Tính mới)
              3. Phạm vi ảnh hưởng, khả năng áp dụng
              4. Kết luận và kiến nghị
              
              📌 BÂY GIỜ BẠN CÓ THỂ:
1. Xuất file Word để chỉnh sửa chi tiết
2. Tạo PHỤ LỤC chi tiết bằng nút "TẠO PHỤ LỤC"
3. Kiểm tra lại nội dung và định dạng
              
              Chúc mừng bạn đã hoàn thành bản thảo biện pháp GVG!`,
          nextStep: GenerationStep.COMPLETED,
          skipAppend: true
        }
      };
      // ⚠️ QUAN TRỌNG: Dùng activeStep (đã xử lý stepToRun) thay vì state.step
      // để tránh stale closure — khi gọi generateNextSection(stepToRun) từ setTimeout,
      // state.step trong closure có thể chưa cập nhật, gây lặp bước cũ.
      const stepConfig = nextStepMap[activeStep];
      if (!stepConfig) return;
      currentStepPrompt = stepConfig.prompt;
      nextStepEnum = stepConfig.nextStep;
      // Các bước chuyển tiếp (HOÀN THÀNH GP, COMPLETED) không append vào fullDocument
      shouldAppend = !stepConfig.skipAppend;
    }

    if (!currentStepPrompt) return;

    setState(prev => ({ ...prev, isStreaming: true, error: null, step: nextStepEnum }));

    try {
      let sectionText = "\n\n---\n\n"; // Separator
      // Tiêm healing context vào prompt nếu đang ở chế độ Cải thiện
      const finalPrompt = healingSnippet + currentStepPrompt;
      await sendMessageStream(finalPrompt, (chunk) => {
        sectionText += chunk;
        if (shouldAppend) {
          setState(prev => ({
            ...prev,
            fullDocument: prev.fullDocument + chunk
          }));
        }
      }, provider, ThinkingLevel.MEDIUM);

      setFallbackNotice(null);
      setState(prev => ({ ...prev, isStreaming: false }));

      // Tự động gọi hàm kế tiếp nếu chưa tới bài toán COMPLETED
      // Timeout một xíu để mượt UX render
      if (nextStepEnum !== GenerationStep.COMPLETED) {
        if (autoGenerateRef.current) {
          setTimeout(() => {
            generateNextSection(nextStepEnum);
          }, 1500);
        }
      } else {
        // Nếu đã hoàn thành, tự động tạo phụ lục
        setTimeout(() => {
          generateAppendix();
        }, 3000);
      }

    } catch (error: any) {
      setFallbackNotice(null);
      // Thử xoay API key nếu lỗi quota/rate limit (chỉ áp dụng cho Gemini API)
      const errorType = parseApiError(error);
      if (provider === 'gemini' && (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT')) {
        const rotation = apiKeyManager.markKeyError(apiKey, errorType);
        if (rotation.success && rotation.newKey) {
          console.log(`🔄 Tự động xoay key: ${rotation.message}`);
          setApiKey(rotation.newKey);
          localStorage.setItem('gemini_api_key', rotation.newKey);
          initializeGeminiChat(rotation.newKey, selectedModel, provider);
          // Tự động thử lại với key mới
          setState(prev => ({ ...prev, isStreaming: false, error: null }));
          setTimeout(() => generateNextSection(activeStep), 500);
          return;
        }
      }
      setState(prev => ({ ...prev, isStreaming: false, error: error.message }));
    }
  };

  // Export to Word
  const exportToWord = async () => {
    try {
      const { exportMarkdownToDocx } = await import('./services/docxExporter');
      const filename = `SKKN_${userInfo.topic.substring(0, 30).replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '_')}.docx`;
      await exportMarkdownToDocx(state.fullDocument, filename);
    } catch (error: any) {
      console.error('Export error:', error);
      alert('Có lỗi khi xuất file. Vui lòng thử lại.');
    }
  };



  // Generate Appendix - Function riêng để tạo phụ lục
  const generateAppendix = async () => {
    if (!apiKey) {
      setShowApiModal(true);
      return;
    }

    setIsAppendixLoading(true);

    // Khởi tạo lại chat session với API key hiện tại (quan trọng khi user thay đổi API key)
    initializeGeminiChat(apiKey, selectedModel, provider);

    try {
      const appendixPrompt = `
        BẮT ĐẦU phản hồi bằng MENU NAVIGATION trạng thái Bước 8(Tạo Phụ lục chi tiết - Đang thực hiện).

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📎 NHIỆM VỤ: TẠO ĐẦY ĐỦ CÁC TÀI LIỆU PHỤ LỤC
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        ⚠️ QUAN TRỌNG: Bạn PHẢI dựa vào NỘI DUNG BIỆN PHÁP ĐÃ VIẾT bên dưới để tạo phụ lục.
        Các phụ lục phải KHỚP với nội dung, số liệu, giải pháp đã đề cập trong Biện pháp.
        KHÔNG tạo phụ lục liên quan đến hình ảnh, video(vì không thể hiển thị).
        
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📄 NỘI DUNG BIỆN PHÁP ĐÃ VIẾT(ĐỌC KỸ ĐỂ TẠO PHỤ LỤC PHÙ HỢP):
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        ${state.fullDocument}
        
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 THÔNG TIN ĐỀ TÀI:
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Tên đề tài: ${userInfo.topic}
- Môn học: ${userInfo.subject}
- Cấp học: ${userInfo.level}
- Khối lớp: ${userInfo.grade}
- Trường: ${userInfo.school}
- Địa điểm: ${userInfo.location}
- CSVC: ${userInfo.facilities}
- SGK: ${userInfo.textbook || "Hiện hành"}
        
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📎 YÊU CẦU TẠO PHỤ LỤC:
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        Dựa trên NỘI DUNG BIỆN PHÁP ĐÃ VIẾT ở trên, hãy tạo ĐẦY ĐỦ, CHI TIẾT từng tài liệu phụ lục sau:

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 1: PHIẾU KHẢO SÁT ĐÁNH GIÁ MỨC ĐỘ HỨNG THÚ VÀ HIỆU QUẢ HỌC TẬP CỦA HỌC SINH
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        ** PHẦN A: PHIẾU KHẢO SÁT TRƯỚC KHI ÁP DỤNG SÁNG KIẾN **

  Tạo bảng khảo sát với format:
        | STT | Nội dung khảo sát | 1 | 2 | 3 | 4 | 5 |
        | -----| -------------------| ---| ---| ---| ---| ---|
        | 1 | [Nội dung câu hỏi về mức độ hứng thú với môn ${userInfo.subject}] | | | | | |
        | 2 | [Nội dung câu hỏi về khó khăn khi học] | | | | | |
        ...
        
        Ghi chú: 1 = Rất không đồng ý, 2 = Không đồng ý, 3 = Bình thường, 4 = Đồng ý, 5 = Rất đồng ý
        
        Nội dung câu hỏi(10 - 12 câu):
- Mức độ hứng thú với môn học
  - Cảm nhận về phương pháp dạy học hiện tại
    - Mức độ tham gia hoạt động học tập
      - Khả năng tự học, tự nghiên cứu
        - Mức độ khó khăn khi tiếp thu kiến thức
          - Hiệu quả ghi nhớ kiến thức
            - Kỹ năng vận dụng kiến thức vào thực tế

              ** PHẦN B: PHIẾU KHẢO SÁT SAU KHI ÁP DỤNG SÁNG KIẾN **

                Tạo bảng khảo sát tương tự với 12 - 15 câu hỏi về:
- Mức độ hứng thú sau khi áp dụng sáng kiến
  - Hiệu quả của phương pháp mới
    - Khả năng tiếp thu kiến thức
      - Sự cải thiện kết quả học tập
        - Mong muốn tiếp tục học theo phương pháp mới

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 2: PHIẾU KHẢO SÁT GIÁO VIÊN VỀ THỰC TRẠNG DẠY HỌC
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Viết phiếu khảo sát HOÀN CHỈNH với 10 - 15 câu hỏi
  - Dạng câu hỏi: Trắc nghiệm mức độ(Rất thường xuyên / Thường xuyên / Thỉnh thoảng / Hiếm khi / Không bao giờ)
    - Nội dung: Khảo sát thực trạng sử dụng phương pháp / công nghệ liên quan đến "${userInfo.topic}"
      - Format: Bảng Markdown chuẩn với đầy đủ các cột
        | STT | Nội dung | Rất thường xuyên | Thường xuyên | Thỉnh thoảng | Hiếm khi | Không bao giờ |
        | -----| ----------| ------------------| --------------| --------------| ----------| ---------------|
        
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 3: GIÁO ÁN MINH HỌA(Theo Công văn 5512 / BGDĐT ngày 18 / 12 / 2020)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        ** KHUNG KẾ HOẠCH BÀI DẠY **
  (Kèm theo Công văn số 5512 / BGDĐT - GDTrH ngày 18 tháng 12 năm 2020 của Bộ GDĐT)

Trường: ${userInfo.school}
Tổ: [Tổ chuyên môn]
        Họ và tên giáo viên: ……………………
        
        ** TÊN BÀI DẠY: [Chọn một bài cụ thể từ SGK ${userInfo.textbook || "hiện hành"} phù hợp với đề tài] **
  Môn học: ${userInfo.subject}; Lớp: ${userInfo.grade}
        Thời gian thực hiện: [Số tiết]

  ** I.MỤC TIÊU **

    1. Về kiến thức:
- Nêu cụ thể nội dung kiến thức học sinh cần học

2. Về năng lực:
- Năng lực chung: [Tự chủ và tự học, giao tiếp và hợp tác, giải quyết vấn đề]
  - Năng lực đặc thù: [Năng lực đặc thù môn ${userInfo.subject}]

3. Về phẩm chất:
- Trách nhiệm, chăm chỉ, trung thực trong học tập

  ** II.THIẾT BỊ DẠY HỌC VÀ HỌC LIỆU **
    - Giáo viên: [Liệt kê thiết bị, tài liệu GV chuẩn bị]
      - Học sinh: [Liệt kê những gì HS cần chuẩn bị]
        - Điều kiện CSVC: ${userInfo.facilities}
        
        ** III.TIẾN TRÌNH DẠY HỌC **
        
        ** 1. Hoạt động 1: Mở đầu / Khởi động(...phút) **
  a) Mục tiêu: Tạo hứng thú, xác định vấn đề / nhiệm vụ học tập
        b) Nội dung: [Mô tả cụ thể hoạt động]
        c) Sản phẩm: [Kết quả học sinh đạt được]
        d) Tổ chức thực hiện:
- Giao nhiệm vụ: [GV giao nhiệm vụ cụ thể]
  - Thực hiện: [HS thực hiện, GV theo dõi hỗ trợ]
    - Báo cáo, thảo luận: [HS báo cáo, GV tổ chức thảo luận]
      - Kết luận, nhận định: [GV kết luận, chuyển tiếp]

        ** 2. Hoạt động 2: Hình thành kiến thức mới(...phút) **
          a) Mục tiêu: Giúp HS chiếm lĩnh kiến thức mới
        b) Nội dung: [Mô tả cụ thể các nhiệm vụ học tập]
        c) Sản phẩm: [Kiến thức, kỹ năng HS cần đạt được]
        d) Tổ chức thực hiện:
- Giao nhiệm vụ: [Chi tiết]
  - Thực hiện: [Chi tiết - TÍCH HỢP CÔNG CỤ / PHƯƠNG PHÁP CỦA GIẢI PHÁP 1]
    - Báo cáo, thảo luận: [Chi tiết]
      - Kết luận, nhận định: [Chi tiết]

        ** 3. Hoạt động 3: Luyện tập(...phút) **
          a) Mục tiêu: Củng cố, vận dụng kiến thức đã học
        b) Nội dung: [Hệ thống câu hỏi, bài tập]
        c) Sản phẩm: [Đáp án, lời giải của HS]
        d) Tổ chức thực hiện: [Chi tiết các bước]

  ** 4. Hoạt động 4: Vận dụng(...phút) **
    a) Mục tiêu: Phát triển năng lực vận dụng vào thực tiễn
        b) Nội dung: [Nhiệm vụ / tình huống thực tiễn]
        c) Sản phẩm: [Báo cáo, sản phẩm của HS]
        d) Tổ chức thực hiện: [Giao về nhà hoặc thực hiện trên lớp]

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 4: PHIẾU HỌC TẬP / RUBRIC ĐÁNH GIÁ
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Phiếu học tập mẫu cho hoạt động nhóm
  - Rubric đánh giá sản phẩm học sinh(theo 4 mức: Tốt, Khá, Đạt, Chưa đạt)
    - Bảng tiêu chí đánh giá với các mức độ rõ ràng

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 5: BÀI TẬP MẪU / CÂU HỎI ÔN TẬP
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 5 - 7 bài tập mẫu / câu hỏi ôn tập
  - Có đáp án và hướng dẫn chấm điểm
    - Nếu môn Toán: Sử dụng LaTeX cho công thức

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        📋 PHỤ LỤC 6: BẢNG TỔNG HỢP KẾT QUẢ KHẢO SÁT(MINH CHỨNG CHO BẢNG DỮ LIỆU BIỆN PHÁP)
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Bảng tổng hợp kết quả khảo sát TRƯỚC thực nghiệm(số lượng, tỷ lệ %)
  - Bảng tổng hợp kết quả khảo sát SAU thực nghiệm
    - Bảng so sánh kết quả TRƯỚC - SAU để minh chứng cho các bảng số liệu trong Biện pháp
      - Số liệu phải LOGIC và KHỚP với các bảng trong phần Kết quả của Biện pháp

        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ⚠️ YÊU CẦU FORMAT VÀ NỘI DUNG(BẮT BUỘC):
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
        📌 VỀ NỘI DUNG:
- VIẾT ĐẦY ĐỦ NỘI DUNG thực tế cho từng phụ lục, KHÔNG viết tắt hay bỏ sót
  - Phiếu khảo sát phải có ĐẦY ĐỦ 10 - 15 câu hỏi cụ thể(không ghi "...")
    - Giáo án minh họa phải VIẾT CHI TIẾT từng hoạt động, có lời thoại GV - HS mẫu
      - Rubric phải có ĐẦY ĐỦ tiêu chí và mô tả các mức độ
        - Bài tập mẫu phải có ĐẦY ĐỦ đề bài và đáp án / hướng dẫn giải
          - Số liệu bảng tổng hợp phải KHỚP với số liệu trong phần Kết quả Biện pháp
            - Nếu dàn ý Biện pháp có đề cập phụ lục khác(chưa liệt kê ở trên), hãy TẠO THÊM
        
        📌 VỀ FORMAT:
- Markdown chuẩn, bảng dùng | ---|
  - BẢNG PHẢI CÓ ĐẦY ĐỦ TẤT CẢ CÁC CỘT, không được bỏ sót cột nào
    - Mỗi hàng trong bảng phải có đủ số ô tương ứng với số cột ở header
      - Bảng phải bắt đầu từ đầu dòng(không thụt lề)
        - Xuống dòng sau mỗi câu
          - Tách đoạn rõ ràng
            - Đánh số phụ lục rõ ràng: PHỤ LỤC 1, PHỤ LỤC 2...
        - KHÔNG ghi "...", "[nội dung]", "[điền vào]" - phải viết nội dung thực tế
        
        📌 KHÔNG TẠO:
- Phụ lục hình ảnh, video, ảnh chụp màn hình(không thể hiển thị)
  - Phụ lục yêu cầu file đính kèm
        
        📍 KẾT THÚC bằng dòng:
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        ✅ HOÀN THÀNH TẠO TÀI LIỆU PHỤ LỤC
        ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      let generatedAppendix = "";
      await sendMessageStream(appendixPrompt, (chunk) => {
        generatedAppendix += chunk;
        setAppendixDocument(generatedAppendix);
      }, provider, ThinkingLevel.MEDIUM);

      setFallbackNotice(null);
      setIsAppendixLoading(false);
    } catch (error: any) {
      setFallbackNotice(null);
      console.error('Generate Appendix error:', error);
      alert('Có lỗi khi tạo phụ lục. Vui lòng thử lại.');
      setIsAppendixLoading(false);
    }
  };

  // Export Appendix to Word - Xuất phụ lục thành file Word riêng
  const exportAppendixToWord = async () => {
    try {
      const { exportMarkdownToDocx } = await import('./services/docxExporter');
      const filename = `SKKN_Phuluc_${userInfo.topic.substring(0, 30).replace(/[^a-zA-Z0-9\u00C0-\u1EF9]/g, '_')}.docx`;
      await exportMarkdownToDocx(appendixDocument, filename);
    } catch (error: any) {
      console.error('Export Appendix error:', error);
      alert('Có lỗi khi xuất file phụ lục. Vui lòng thử lại.');
    }
  };

  // Render Logic
  const renderSidebar = () => {
    return (
      <div className="w-full lg:w-80 bg-gradient-to-b from-white to-sky-50 border-r border-sky-100 p-6 flex-shrink-0 flex flex-col h-full overflow-y-auto main-scroll shadow-[4px_0_24px_rgba(56,189,248,0.08)]">
        <div className="mb-8">
          <h1 className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500 flex items-center gap-2" style={{ fontFamily: 'Nunito, sans-serif' }}>
            <Wand2 className="h-6 w-6 text-blue-500" />
            BIỆN PHÁP GVG
          </h1>
          <p className="text-xs text-blue-800 font-medium mt-1.5 tracking-wide">✨TRỢ LÝ VIẾT BIỆN PHÁP GVG/GVCN GIỎI</p>
        </div>

        {/* Progress Stepper */}
        <div className="space-y-6">
          {Object.entries(STEPS_INFO).map(([key, info]) => {
            const stepNum = parseInt(key);

            // Luôn ẩn step Phụ lục (19) và Hoàn tất (20)
            if (stepNum > 18) return null;

            // Ẩn các step Review trong sidebar để không quá dài
            // Reviews: 5 (GP1), 7 (GP2), 9 (GP3), 11 (GP4), 13 (GP5), 15 (Tính mới), 17 (Phạm vi)
            if ([5, 7, 9, 11, 13, 15, 17].includes(stepNum)) return null;

            // Ẩn GP4 (10) và GP5 (12) nếu người dùng KHÔNG tick "Viết thêm Giải pháp 4, 5"
            if (!userInfo.includeSolution4_5 && (stepNum === 10 || stepNum === 12)) return null;

            let statusColor = "text-gray-400 border-gray-200";
            let icon = <div className="w-2 h-2 rounded-full bg-gray-300" />;

            // ERROR STATE HANDLING
            if (state.error && state.step === stepNum) {
              statusColor = "text-red-600 border-red-600 bg-red-50";
              icon = <AlertTriangle className="w-4 h-4 text-red-600" />;
            }
            else if (state.step === stepNum && state.isStreaming) {
              statusColor = "text-sky-600 border-sky-600 bg-sky-50";
              icon = <div className="w-2 h-2 rounded-full bg-sky-500 animate-ping" />;
            } else if (state.step > stepNum) {
              statusColor = "text-sky-800 border-sky-200";
              icon = <CheckCircle className="w-4 h-4 text-sky-600" />;
            } else if (state.step === stepNum) {
              statusColor = "text-sky-600 border-sky-600 font-bold";
              icon = <div className="w-2 h-2 rounded-full bg-sky-600" />;
            }

            // Cho phép click vào các step đã hoàn thành để quay lại sửa
            const isClickable = state.step > stepNum && !state.isStreaming;
            const handleStepClick = () => {
              if (isClickable) {
                setState(prev => ({ ...prev, step: stepNum }));
              }
            };

            return (
              <div
                key={key}
                onClick={handleStepClick}
                className={`flex items - start pl - 4 border - l - 2 ${statusColor.includes('border-sky') ? 'border-sky-500' : statusColor.includes('border-red') ? 'border-red-500' : 'border-gray-200'} py - 1 transition - all ${isClickable ? 'cursor-pointer hover:bg-sky-50 rounded-r-lg' : ''} `}
              >
                <div className="flex-1">
                  <h4 className={`text - sm ${statusColor.includes('text-sky') ? 'text-sky-900' : statusColor.includes('text-red') ? 'text-red-700' : 'text-gray-500'} font - medium`}>
                    {state.error && state.step === stepNum ? "Đã dừng do lỗi" : info.label}
                  </h4>
                  <p className="text-xs text-gray-400">{info.description}</p>
                </div>
                <div className="ml-2 mt-1">
                  {icon}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-auto pt-6 border-t border-gray-100">
          {state.step > GenerationStep.INPUT_FORM && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded text-xs text-gray-500 border border-gray-100">
                <span className="font-bold block text-gray-900">Đề tài:</span>
                {userInfo.topic}
              </div>

              {/* Session persistence buttons */}
              <div className="flex gap-2">
                <button
                  onClick={saveSession}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-medium transition-colors border border-emerald-200"
                  title="Lưu phiên làm việc"
                >
                  <Save size={13} />
                  Lưu phiên
                </button>
                <button
                  onClick={() => {
                    if (confirm('Xóa phiên đã lưu? Bạn sẽ không thể khôi phục lại.')) {
                      clearSavedSession();
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-medium transition-colors border border-red-200"
                  title="Xóa phiên đã lưu"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {sessionSavedAt && (
                <p className="text-[10px] text-gray-400 text-center">
                  💾 Lưu lúc {sessionSavedAt}
                </p>
              )}

              {/* Controls */}
              {state.isStreaming ? (
                <Button disabled className="w-full" isLoading>Đang viết...</Button>
              ) : (
                state.step < GenerationStep.COMPLETED && (
                  <>
                    {/* Feedback / Review Section only for OUTLINE Step */}
                    {state.step === GenerationStep.OUTLINE && (
                      <div className="mb-2 space-y-2 border-t border-gray-100 pt-2">
                        <p className="text-sm font-semibold text-sky-700">Điều chỉnh:</p>

                        <div className="text-xs text-gray-500 italic mb-2">
                          💡 Mẹo: Bạn có thể sửa trực tiếp Dàn ý ở màn hình bên phải trước khi bấm "Chốt & Viết tiếp".
                        </div>

                        <textarea
                          value={outlineFeedback}
                          onChange={(e) => setOutlineFeedback(e.target.value)}
                          placeholder="Hoặc nhập yêu cầu để AI viết lại..."
                          className="w-full p-2 text-sm border border-gray-300 rounded focus:ring-sky-500 focus:border-sky-500"
                          rows={3}
                        />
                        <Button
                          variant="secondary"
                          onClick={() => regenerateOutline()}
                          disabled={!outlineFeedback.trim()}
                          className="w-full text-sm"
                          icon={<RefreshCw size={14} />}
                        >
                          Yêu cầu AI viết lại
                        </Button>
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <Button onClick={() => { generateNextSection(); }} className="w-full" icon={<ChevronRight size={16} />}>
                        {state.step === GenerationStep.OUTLINE ? 'Chốt Dàn ý & Viết tiếp' : 'Viết phần tiếp theo'}
                      </Button>

                      {state.step > GenerationStep.INPUT_FORM && state.step < GenerationStep.COMPLETED && (
                        <label className="flex items-center justify-center gap-2 cursor-pointer text-sm text-gray-600 hover:text-gray-800 bg-white/50 py-1.5 px-3 rounded-md border border-gray-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={isAutoGenerate}
                            onChange={(e) => setIsAutoGenerate(e.target.checked)}
                            className="rounded border-gray-300 text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                          />
                          <span className="font-medium select-none">Tự động viết phần tiếp theo</span>
                        </label>
                      )}
                    </div>
                  </>
                )
              )}

              {/* Nút xuất Word Biện pháp (luôn hiển thị khi đã có nội dung) */}
              {(state.step >= GenerationStep.OUTLINE) && (
                <Button variant="secondary" onClick={exportToWord} className="w-full" icon={<Download size={16} />}>
                  Xuất file Word Biện pháp
                </Button>
              )}

              {/* Sau khi hoàn thành Biện pháp: hiển thị các nút phụ lục */}
              {state.step >= GenerationStep.COMPLETED && (
                <>
                  {!appendixDocument ? (
                    <Button
                      onClick={generateAppendix}
                      isLoading={isAppendixLoading}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      icon={<FileText size={16} />}
                    >
                      {isAppendixLoading ? 'Đang tạo phụ lục...' : 'TẠO PHỤ LỤC'}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={exportAppendixToWord}
                      className="w-full border-emerald-500 text-emerald-700 hover:bg-emerald-50"
                      icon={<Download size={16} />}
                    >
                      Xuất Word Phụ lục
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (checkingAuth) {
    return <div className="h-screen w-screen bg-white flex items-center justify-center"></div>;
  }

  if (!isUnlocked) {
    return <LockScreen onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 flex flex-col lg:flex-row font-sans text-gray-900 overflow-hidden">
      <ApiKeyModal
        isOpen={showApiModal}
        onSave={handleSaveApiKey}
        onClose={() => setShowApiModal(false)}
        isDismissible={!!apiKey}
      />



      {/* Session Restore Modal */}
      {showRestoreModal && pendingSessionData && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-sky-500 p-6 text-white">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center">
                  <Save className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold">Khôi phục phiên làm việc</h3>
                  <p className="text-sm text-blue-100">Bạn có phiên làm việc chưa hoàn thành</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4 mb-4">
                <p className="text-sm text-gray-700">
                  <span className="font-semibold text-sky-800">Đề tài:</span>{' '}
                  {(pendingSessionData.userInfo as any).topic || 'Không rõ'}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Đã lưu lúc: {new Date(pendingSessionData.savedAt).toLocaleString('vi-VN')}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Tiến độ: Bước {pendingSessionData.state.step} / {GenerationStep.COMPLETED}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowRestoreModal(false);
                    clearSavedSession();
                    setPendingSessionData(null);
                  }}
                  className="flex-1 px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl font-medium transition-colors text-sm"
                >
                  ✖ Bắt đầu mới
                </button>
                <button
                  onClick={() => {
                    restoreSession(pendingSessionData);
                    setShowRestoreModal(false);
                    setPendingSessionData(null);
                  }}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-sky-500 hover:from-blue-600 hover:to-sky-600 text-white rounded-xl font-bold transition-colors text-sm shadow-lg"
                >
                  ✔ Tiếp tục làm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header Button for Settings */}
      <button
        onClick={() => setShowApiModal(true)}
        className="fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-2.5 bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-blue-100 hover:bg-blue-50 hover:border-blue-200 hover:shadow-xl transition-all duration-200"
        title="Cấu hình API Key"
      >
        <Settings size={18} className="text-blue-600" />
        <span className="text-blue-700 font-semibold text-sm hidden sm:inline">⚙️ Cài đặt API Key</span>
      </button>

      {/* Sidebar (Desktop) */}
      <div className="hidden lg:block h-screen sticky top-0 z-20">
        {renderSidebar()}
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 p-3 lg:p-6 flex flex-col overflow-y-auto relative main-scroll bg-gray-50/50">

        {/* Main App Navigation Tabs */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 mb-6 p-1.5 flex gap-2 lg:max-w-2xl mx-auto w-full sticky top-0 z-10 backdrop-blur-xl bg-white/80">
          <button
            onClick={() => setActiveAppTab('create')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold transition-all duration-300 ${activeAppTab === 'create'
              ? 'bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transform scale-[1.02]'
              : 'text-gray-500 hover:bg-sky-50 hover:text-sky-700'
              }`}
          >
            <PenTool className="w-5 h-5" /> <span className="text-center leading-tight">📝 VIẾT<br/>BIỆN PHÁP</span>
          </button>

          <button
            onClick={() => setActiveAppTab('heal')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold transition-all duration-300 ${activeAppTab === 'heal'
              ? 'bg-gradient-to-r from-teal-600 to-emerald-500 text-white shadow-md transform scale-[1.02]'
              : 'text-gray-500 hover:bg-teal-50 hover:text-teal-700'
              }`}
          >
            <Microscope className="w-5 h-5" /> <span className="text-center leading-tight">🔬 THẨM ĐỊNH<br/>BIỆN PHÁP</span>
          </button>

          <button
            onClick={() => setActiveAppTab('methods')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold transition-all duration-300 ${activeAppTab === 'methods'
              ? 'bg-gradient-to-r from-violet-600 to-indigo-500 text-white shadow-md transform scale-[1.02]'
              : 'text-gray-500 hover:bg-violet-50 hover:text-violet-700'
              }`}
          >
            <BookOpen className="w-5 h-5" /> <span className="text-center leading-tight">📖 FULL PP/KT<br/>DẠY HỌC</span>
          </button>
        </div>

        {/* Thông báo fallback model tạm thời */}
        {fallbackNotice && (
          <div className="mb-4 max-w-6xl mx-auto w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-xl shadow-sm text-sm font-medium animate-pulse">
            <RefreshCw className="w-4 h-4 text-amber-600 animate-spin flex-shrink-0" />
            <span>{fallbackNotice}</span>
          </div>
        )}

        {/* View Routing */}
        {activeAppTab === 'methods' ? (
          <div className="flex-1 w-full max-w-6xl mx-auto h-full animate-fade-in pb-20">
            <TeachingMethodsCatalog onClose={() => setActiveAppTab('create')} />
          </div>
        ) : activeAppTab === 'heal' ? (
          <div className="flex-1 w-full max-w-6xl mx-auto h-full animate-fade-in">
            <ReviewOldDocPanel
              apiKey={apiKey}
              selectedModel={selectedModel}
              provider={provider}
              onHealDoc={(originalContent, analysisResult) => {
                setHealingContext({ originalContent, analysisResult });
                setActiveAppTab('create');
                // Auto-trigger sinh dàn ý cải thiện sau khi state update
                setTimeout(() => {
                  startGeneration();
                }, 500);
              }}
            />
          </div>
        ) : (
          <div className="flex-1 w-full max-w-6xl mx-auto h-full flex flex-col animate-fade-in relative pb-20">
            {/* Show error context if healing mode */}
            {healingContext && state.step === GenerationStep.INPUT_FORM && (
              <div className="mb-6 bg-teal-50 border-l-4 border-teal-500 p-4 rounded-r-lg shadow-sm">
                <div className="flex items-start gap-3">
                  <Microscope className="w-6 h-6 text-teal-600 mt-0.5" />
                  <div>
                    <h3 className="font-bold text-teal-800 text-lg">Đang ở chế độ: Thẩm định Biện Pháp</h3>
                    <p className="text-teal-700 text-sm mt-1">Hệ thống đã nạp "Bản phân tích" vào dòng chảy AI. Hãy điền thêm thông tin cơ bản bên dưới (Tên đề tài, Môn học...) để cấu hình bài làm, sau đó bấm <strong>Tiếp Theo</strong> để AI tiến hành viết lại bài.</p>

                    <button
                      onClick={() => setHealingContext(null)}
                      className="mt-3 text-xs font-semibold bg-white border border-teal-200 text-teal-600 px-3 py-1.5 rounded-md hover:bg-teal-100 transition-colors"
                    >
                      Hủy bỏ chế độ Thẩm định
                    </button>
                  </div>
                </div>
              </div>
            )}


            {/* Mobile Header */}
            <div className="lg:hidden mb-4 bg-gradient-to-r from-white to-sky-50 p-4 rounded-xl shadow-lg border border-sky-100 flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <h1 className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-sky-500 text-xl" style={{ fontFamily: 'Nunito, sans-serif' }}>BIỆN PHÁP GVG</h1>
                <span className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded-full font-medium">
                  {STEPS_INFO[state.step < 9 ? state.step : 8].label}
                </span>
              </div>
              <p className="text-xs text-blue-700 font-medium">✨ TRỢ LÝ VIẾT BIỆN PHÁP GVG/GVCN GIỎI</p>
            </div>

            {state.error && (() => {
              const errorInfo = getFriendlyErrorMessage({ message: state.error });
              return (
                <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-5 mb-4 shadow-sm">
                  {/* Header */}
                  <div className="flex items-start gap-3 mb-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold text-red-800 text-lg">{errorInfo.title}</h3>
                      <p className="text-red-700 text-sm mt-1">{errorInfo.message}</p>
                    </div>
                  </div>

                  {/* Suggestions */}
                  <div className="bg-white/70 rounded-lg p-4 mt-3 border border-red-100">
                    <p className="text-sm font-semibold text-gray-700 mb-2">💡 Gợi ý khắc phục:</p>
                    <ul className="space-y-2">
                      {errorInfo.suggestions.map((suggestion, index) => (
                        <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                          <span className="text-gray-400">•</span>
                          {suggestion}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Hướng dẫn thao tác cho người dùng */}
                  {state.step > GenerationStep.INPUT_FORM && (
                    <div className="bg-gradient-to-r from-blue-50 to-emerald-50 rounded-lg p-4 mt-3 border border-blue-200">
                      <p className="text-sm font-bold text-blue-800 mb-2">📋 Bạn có 2 lựa chọn:</p>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="text-emerald-600 font-bold text-sm mt-0.5">1.</span>
                          <p className="text-sm text-gray-700">
                            <span className="font-semibold text-emerald-700">Bấm "🔄 Thử lại (đổi key)"</span> - App sẽ tự động chuyển sang API key dự phòng và tiếp tục chạy ngay, không mất dữ liệu.
                          </p>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-sky-600 font-bold text-sm mt-0.5">2.</span>
                          <p className="text-sm text-gray-700">
                            <span className="font-semibold text-sky-700">Bấm "💾 Lưu phiên" ở thanh bên trái</span> rồi tắt app. Hôm sau mở lại, API key sẽ được reset và bạn tiếp tục từ chỗ đã dừng.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex flex-wrap gap-2 mt-4">
                    <button
                      onClick={() => setState(prev => ({ ...prev, error: null }))}
                      className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      ✕ Đóng thông báo
                    </button>
                    <button
                      onClick={() => setShowApiModal(true)}
                      className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
                    >
                      🔑 Đổi API Key
                    </button>
                    {/* 🆕 Nút Thử lại - xoay sang API key dự phòng và retry */}
                    {state.step > GenerationStep.INPUT_FORM && (
                      <button
                        onClick={() => {
                          let keyToUse = apiKey;
                          if (provider === 'gemini') {
                            // Xoay sang API key tiếp theo trước khi thử lại
                            const rotation = apiKeyManager.rotateToNextKey('manual_retry');
                            if (rotation.success && rotation.newKey) {
                              keyToUse = rotation.newKey;
                              setApiKey(keyToUse);
                              localStorage.setItem('gemini_api_key', keyToUse);
                              console.log(`🔑 Đã xoay sang key mới: ${rotation.message}`);
                            } else {
                              // Nếu không có key khác, reset tất cả key và thử lại
                              apiKeyManager.resetAllKeys();
                              const freshKey = apiKeyManager.getActiveKey();
                              if (freshKey) {
                                keyToUse = freshKey;
                                setApiKey(keyToUse);
                                localStorage.setItem('gemini_api_key', keyToUse);
                                console.log('🔄 Đã reset tất cả key và thử lại');
                              }
                            }
                          }
                          setState(prev => ({ ...prev, error: null }));
                          initializeGeminiChat(keyToUse, selectedModel, provider);
                          // Khôi phục chat history trước khi retry
                          const savedHistory = getChatHistory();
                          if (savedHistory.length > 0) {
                            setChatHistory(savedHistory);
                          }
                          setTimeout(() => {
                            generateNextSection();
                          }, 300);
                        }}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors flex items-center gap-2"
                      >
                        <RefreshCw size={16} />
                        🔄 Thử lại {provider === 'gemini' ? '(đổi key)' : ''}
                      </button>
                    )}
                    <a
                      href={provider === 'agent-platform' ? 'https://console.cloud.google.com/apis/credentials' : 'https://aistudio.google.com/api-keys'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors"
                    >
                      📖 Hướng dẫn lấy API Key
                    </a>
                  </div>
                </div>
              );
            })()}

            {state.step === GenerationStep.INPUT_FORM ? (
              <div className="flex-1 flex flex-col items-center">
                <SKKNForm
                  apiKey={apiKey}
                  selectedModel={selectedModel}
                  provider={provider}
                  userInfo={userInfo}
                  onChange={handleUserChange}
                  onSubmit={startGeneration}
                  onManualSubmit={handleManualOutlineSubmit}
                  isSubmitting={state.isStreaming}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col min-h-0 relative">
                <DocumentPreview
                  content={state.fullDocument}
                  onUpdate={handleDocumentUpdate}
                  // Only allow direct editing in the OUTLINE step and when not streaming
                  isEditable={state.step === GenerationStep.OUTLINE && !state.isStreaming}
                />

                {/* Mobile Controls Floating */}
                <div className="lg:hidden absolute bottom-4 left-4 right-4 flex gap-2 shadow-lg">
                  {!state.isStreaming && state.step < GenerationStep.COMPLETED && (
                    <Button onClick={() => generateNextSection()} className="flex-1 shadow-xl">
                      {state.step === GenerationStep.OUTLINE ? 'Chốt & Tiếp tục' : 'Viết tiếp'}
                    </Button>
                  )}
                  <Button onClick={exportToWord} variant="secondary" className="bg-white shadow-xl text-sky-700">
                    <Download size={20} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
