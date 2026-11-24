import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Button } from './Button';
import {
    Key, X, Zap, Cpu, Sparkles, ExternalLink, Server,
    Plus, Trash2, RefreshCw, ShieldCheck, CheckCircle2,
    AlertCircle, Clock, FlaskConical, Check
} from 'lucide-react';
import {
    DEFAULT_GEMINI_MODEL,
    DEFAULT_AGENT_PLATFORM_MODEL,
    GEMINI_MODEL_STORAGE_KEY,
    LEGACY_GEMINI_MODEL_STORAGE_KEYS,
    FALLBACK_MODELS,
    AGENT_PLATFORM_MODELS,
    MODEL_INFO,
} from '../constants';
import { isValidGoogleAiApiKey, normalizeGoogleAiApiKey } from '../services/googleAiApiKey';
import { apiKeyManager, type ApiKeyInfo } from '../services/apiKeyManager';
import {
    testApiKey,
    checkServerProxyAvailable,
    getServerProxyStatus,
    type ServerProxyStatus
} from '../services/geminiService';
import type { AiProvider } from '../types';

interface ApiKeyModalProps {
    isOpen: boolean;
    onSave: (key: string, selectedModel: string, provider: AiProvider) => void;
    onClose: () => void;
    isDismissible?: boolean;
}

const ModelIcon: React.FC<{ modelId: string }> = ({ modelId }) => {
    if (modelId.startsWith('gemini-4')) return <Sparkles className="w-5 h-5" />;
    if (modelId.includes('flash-lite')) return <Zap className="w-5 h-5" />;
    if (modelId.includes('pro')) return <Sparkles className="w-5 h-5" />;
    return <Cpu className="w-5 h-5" />;
};

const getModelsForProvider = (provider: AiProvider): string[] => {
    if (provider === 'agent-platform') {
        return [...AGENT_PLATFORM_MODELS];
    }
    return [...FALLBACK_MODELS];
};

const getDefaultModel = (provider: AiProvider): string => {
    if (provider === 'agent-platform') return DEFAULT_AGENT_PLATFORM_MODEL;
    return DEFAULT_GEMINI_MODEL;
};

const formatDurationShort = (ms: number): string => {
    const totalSec = Math.max(1, Math.ceil(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    if (min > 0) return `${min}p ${sec}s`;
    return `${sec}s`;
};

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onSave, onClose, isDismissible = true }) => {
    const [provider, setProvider] = useState<AiProvider>('gemini');
    const [selectedModel, setSelectedModel] = useState<string>(DEFAULT_GEMINI_MODEL);

    // State cho tab Gemini (nhiều key xoay vòng)
    const [bulkKeyInput, setBulkKeyInput] = useState('');
    const [poolKeys, setPoolKeys] = useState<ApiKeyInfo[]>([]);
    const [currentPoolIndex, setCurrentPoolIndex] = useState<number>(0);
    const [bulkFeedback, setBulkFeedback] = useState<{ ok: boolean; text: string } | null>(null);
    const [testingKey, setTestingKey] = useState<string | null>(null);
    const [isTestingAll, setIsTestingAll] = useState(false);
    const [keyTestResults, setKeyTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

    // State cho tab Agent Platform (1 key riêng theo api.md §III)
    const [agentApiKey, setAgentApiKey] = useState('');
    const [isTestingAgent, setIsTestingAgent] = useState(false);
    const [agentTestResult, setAgentTestResult] = useState<{ ok: boolean; title: string; message: string } | null>(null);

    // Trạng thái server proxy ẩn trên Vercel
    const [serverProxy, setServerProxy] = useState<ServerProxyStatus>(() => getServerProxyStatus());
    const [error, setError] = useState('');

    const availableModels = useMemo(() => getModelsForProvider(provider), [provider]);

    const refreshPoolState = useCallback(() => {
        setPoolKeys(apiKeyManager.getAllKeys('gemini'));
        setCurrentPoolIndex(apiKeyManager.getCurrentIndex('gemini'));
    }, []);

    // Load từ localStorage & apiKeyManager khi modal mở
    useEffect(() => {
        if (!isOpen) return;

        LEGACY_GEMINI_MODEL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));

        const rawProvider = localStorage.getItem('google_ai_provider');
        if (rawProvider === 'vertex') {
            localStorage.setItem('google_ai_provider', 'gemini');
        }
        const savedProvider: AiProvider = rawProvider === 'agent-platform' ? 'agent-platform' : 'gemini';
        setProvider(savedProvider);
        setAgentApiKey(localStorage.getItem('agent_platform_api_key') || '');

        const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE_KEY);
        const models = getModelsForProvider(savedProvider);
        if (savedModel && models.includes(savedModel)) {
            setSelectedModel(savedModel);
        } else {
            setSelectedModel(getDefaultModel(savedProvider));
        }

        setBulkKeyInput('');
        setBulkFeedback(null);
        setAgentTestResult(null);
        setError('');
        refreshPoolState();

        checkServerProxyAvailable().then(status => setServerProxy(status));
    }, [isOpen, refreshPoolState]);

    // Cập nhật bộ đếm cooldown mỗi 2 giây khi modal đang mở
    useEffect(() => {
        if (!isOpen || provider !== 'gemini') return;
        const timer = setInterval(() => {
            refreshPoolState();
        }, 2000);
        return () => clearInterval(timer);
    }, [isOpen, provider, refreshPoolState]);

    const handleProviderChange = (newProvider: AiProvider) => {
        setProvider(newProvider);
        setError('');
        setBulkFeedback(null);
        setAgentTestResult(null);

        if (newProvider === 'agent-platform') {
            setAgentApiKey(localStorage.getItem('agent_platform_api_key') || '');
        } else {
            refreshPoolState();
        }

        const models = getModelsForProvider(newProvider);
        if (!models.includes(selectedModel)) {
            setSelectedModel(getDefaultModel(newProvider));
        }
    };

    // Thêm 1 hoặc nhiều API key vào kho xoay vòng Gemini
    const handleAddBulkKeys = () => {
        if (!bulkKeyInput.trim()) {
            setBulkFeedback({ ok: false, text: 'Hãy dán ít nhất 1 API key (AIzaSy... hoặc AQ...) vào ô phía trên.' });
            return;
        }
        const res = apiKeyManager.addKeysBulk(bulkKeyInput, 'Key', 'gemini');
        refreshPoolState();
        setError('');

        if (res.added > 0) {
            setBulkKeyInput('');
            const extras: string[] = [];
            if (res.duplicates > 0) extras.push(`bỏ qua ${res.duplicates} key trùng`);
            if (res.invalid > 0) extras.push(`${res.invalid} dòng sai định dạng`);
            if (res.limitReached > 0) extras.push(`${res.limitReached} key vượt giới hạn ${apiKeyManager.getMaxKeys()}`);
            setBulkFeedback({
                ok: true,
                text: `✅ Đã thêm ${res.added} API key vào kho xoay vòng${extras.length ? ` (${extras.join(', ')})` : ''}. Tổng hiện có: ${res.total} key.`
            });
            if (res.addedKeys[0] && !apiKeyManager.hasAvailableKeys(undefined, 'gemini')) {
                apiKeyManager.setActiveKey(res.addedKeys[0], 'gemini');
                refreshPoolState();
            }
        } else {
            const reasons: string[] = [];
            if (res.duplicates > 0) reasons.push(`${res.duplicates} key đã tồn tại`);
            if (res.invalid > 0) reasons.push(`${res.invalid} key sai định dạng (cần bắt đầu bằng AIza... hoặc AQ...)`);
            if (res.limitReached > 0) reasons.push(`đã đạt giới hạn tối đa ${apiKeyManager.getMaxKeys()} key`);
            setBulkFeedback({
                ok: false,
                text: `⚠️ Không thêm được key mới: ${reasons.join(', ') || 'chưa nhận diện được key hợp lệ'}.`
            });
        }
    };

    // Kiểm tra 1 key cụ thể trong kho Gemini
    const handleTestSinglePoolKey = async (keyInfo: ApiKeyInfo) => {
        setTestingKey(keyInfo.key);
        try {
            const result = await testApiKey(keyInfo.key, 'gemini', selectedModel);
            if (result.ok) {
                apiKeyManager.resetKey(keyInfo.key, 'gemini');
                setKeyTestResults(prev => ({
                    ...prev,
                    [keyInfo.key]: { ok: true, message: `Hoạt động tốt (${result.model || selectedModel})` }
                }));
            } else {
                if (result.errorType === 'INVALID_API_KEY') {
                    apiKeyManager.markKeyError(keyInfo.key, 'INVALID_API_KEY', selectedModel, 'gemini');
                } else if (result.errorType === 'QUOTA_EXCEEDED' || result.errorType === 'RATE_LIMIT') {
                    apiKeyManager.markKeyModelQuotaError(keyInfo.key, selectedModel, result.errorType, undefined, 'gemini');
                }
                setKeyTestResults(prev => ({
                    ...prev,
                    [keyInfo.key]: { ok: false, message: result.title }
                }));
            }
            refreshPoolState();
        } finally {
            setTestingKey(null);
        }
    };

    // Kiểm tra toàn bộ các key trong kho Gemini
    const handleTestAllKeys = async () => {
        const all = apiKeyManager.getAllKeys('gemini');
        if (all.length === 0) {
            setBulkFeedback({ ok: false, text: 'Chưa có API key nào trong kho để kiểm tra.' });
            return;
        }
        setIsTestingAll(true);
        setBulkFeedback(null);
        let okCount = 0;
        try {
            for (const item of all) {
                setTestingKey(item.key);
                const result = await testApiKey(item.key, 'gemini', selectedModel);
                if (result.ok) {
                    okCount++;
                    apiKeyManager.resetKey(item.key, 'gemini');
                    setKeyTestResults(prev => ({
                        ...prev,
                        [item.key]: { ok: true, message: `OK (${result.model || selectedModel})` }
                    }));
                } else {
                    if (result.errorType === 'INVALID_API_KEY') {
                        apiKeyManager.markKeyError(item.key, 'INVALID_API_KEY', selectedModel, 'gemini');
                    } else if (result.errorType === 'QUOTA_EXCEEDED' || result.errorType === 'RATE_LIMIT') {
                        apiKeyManager.markKeyModelQuotaError(item.key, selectedModel, result.errorType, undefined, 'gemini');
                    }
                    setKeyTestResults(prev => ({
                        ...prev,
                        [item.key]: { ok: false, message: result.title }
                    }));
                }
                refreshPoolState();
            }
            setBulkFeedback({
                ok: okCount > 0,
                text: okCount > 0
                    ? `🧪 Kiểm tra xong: ${okCount}/${all.length} API key đang hoạt động tốt với ${selectedModel}.`
                    : `⚠️ Không có key nào vượt qua kiểm tra với ${selectedModel} (có thể đang hết quota hoặc sai key).`
            });
        } finally {
            setTestingKey(null);
            setIsTestingAll(false);
        }
    };

    // Kiểm tra key Agent Platform
    const handleTestAgentKey = async () => {
        const keyToTest = normalizeGoogleAiApiKey(agentApiKey);
        setAgentTestResult(null);
        if (!keyToTest || !isValidGoogleAiApiKey(keyToTest)) {
            setError('Vui lòng nhập Agent Platform API Key đúng định dạng trước khi kiểm tra.');
            return;
        }
        setError('');
        setIsTestingAgent(true);
        try {
            setAgentTestResult(await testApiKey(keyToTest, 'agent-platform', selectedModel));
        } finally {
            setIsTestingAgent(false);
        }
    };

    const handleSave = () => {
        if (provider === 'agent-platform') {
            const keyToSave = normalizeGoogleAiApiKey(agentApiKey);
            if (!keyToSave) {
                setError('Vui lòng nhập Agent Platform API Key.');
                return;
            }
            if (!isValidGoogleAiApiKey(keyToSave)) {
                setError('API Key không đúng định dạng. Key hợp lệ bắt đầu bằng "AIza..." hoặc "AQ...", không chứa khoảng trắng.');
                return;
            }
            localStorage.setItem('agent_platform_api_key', keyToSave);
            localStorage.setItem('google_ai_provider', 'agent-platform');
            localStorage.setItem('google_ai_provider_selection_source', 'manual');
            localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, selectedModel);
            LEGACY_GEMINI_MODEL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));
            setError('');
            onSave(keyToSave, selectedModel, 'agent-platform');
            return;
        }

        // Tab Gemini: nếu người dùng vừa dán key vào textarea mà chưa bấm "+ Thêm", tự động thêm luôn!
        if (bulkKeyInput.trim()) {
            const bulkRes = apiKeyManager.addKeysBulk(bulkKeyInput, 'Key', 'gemini');
            refreshPoolState();
            if (bulkRes.added === 0 && bulkRes.duplicates === 0 && apiKeyManager.getAllKeys('gemini').length === 0) {
                setError('API Key vừa dán không đúng định dạng. Key Gemini bắt đầu bằng "AIzaSy..." hoặc "AQ...".');
                return;
            }
            setBulkKeyInput('');
        }

        const activeKey = apiKeyManager.getActiveKey(selectedModel, 'gemini') || apiKeyManager.getAllKeys('gemini')[0]?.key || '';

        if (!activeKey && !serverProxy.available) {
            setError('Vui lòng thêm ít nhất 1 Gemini API Key vào danh sách (nên thêm 2–5 key để tự động xoay vòng tránh hết quota).');
            return;
        }

        localStorage.setItem('google_ai_provider', 'gemini');
        localStorage.setItem('google_ai_provider_selection_source', 'manual');
        localStorage.setItem(GEMINI_MODEL_STORAGE_KEY, selectedModel);
        LEGACY_GEMINI_MODEL_STORAGE_KEYS.forEach(k => localStorage.removeItem(k));

        setError('');
        onSave(activeKey, selectedModel, 'gemini');
    };

    const stats = useMemo(() => apiKeyManager.getKeyStats('gemini'), [poolKeys]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-xs">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="relative px-6 py-5 border-b border-gray-100 flex-shrink-0 bg-gradient-to-r from-sky-50 to-indigo-50">
                    {isDismissible && (
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-white/70 transition-colors"
                            aria-label="Đóng"
                        >
                            <X size={20} />
                        </button>
                    )}

                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-xl shadow-md">
                            <Key className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">Thiết lập Model & Kho API Key Xoay Vòng</h2>
                            <p className="text-sm text-gray-600">Hỗ trợ nhiều API key + tự đổi model miễn phí khi hết quota</p>
                        </div>
                    </div>
                </div>

                {/* Body - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">

                    {/* Provider Tabs (api.md §III) */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            1. Chọn Dịch vụ AI
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                type="button"
                                onClick={() => handleProviderChange('gemini')}
                                className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${provider === 'gemini'
                                    ? 'border-sky-500 bg-sky-50 shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}
                            >
                                <Cpu className={`w-5 h-5 ${provider === 'gemini' ? 'text-sky-600' : 'text-gray-400'}`} />
                                <div>
                                    <div className={`font-semibold text-sm ${provider === 'gemini' ? 'text-sky-700' : 'text-gray-700'}`}>
                                        Gemini API
                                    </div>
                                    <div className="text-xs text-gray-500">Google AI Studio (Có Free Tier)</div>
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleProviderChange('agent-platform')}
                                className={`flex items-center gap-2.5 p-3 rounded-xl border-2 transition-all text-left ${provider === 'agent-platform'
                                    ? 'border-purple-500 bg-purple-50 shadow-sm'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}
                            >
                                <Server className={`w-5 h-5 ${provider === 'agent-platform' ? 'text-purple-600' : 'text-gray-400'}`} />
                                <div>
                                    <div className={`font-semibold text-sm ${provider === 'agent-platform' ? 'text-purple-700' : 'text-gray-700'}`}>
                                        Agent Platform API
                                    </div>
                                    <div className="text-xs text-gray-500">Google Cloud Express</div>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* Model Selection */}
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-2">
                            2. Chọn Model AI ưu tiên
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {availableModels.map((modelId) => {
                                const info = MODEL_INFO[modelId];
                                const isSelected = selectedModel === modelId;
                                const isDefaultModel = (info?.isDefault && provider === 'gemini' && modelId === DEFAULT_GEMINI_MODEL) ||
                                    (modelId === getDefaultModel('agent-platform') && provider === 'agent-platform');
                                return (
                                    <button
                                        key={modelId}
                                        type="button"
                                        onClick={() => setSelectedModel(modelId)}
                                        className={`relative flex items-start gap-3 p-3 rounded-xl border-2 transition-all text-left ${isSelected
                                            ? 'shadow-sm'
                                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                        style={isSelected ? {
                                            borderColor: provider === 'agent-platform' ? '#a855f7' : '#0ea5e9',
                                            backgroundColor: provider === 'agent-platform' ? '#faf5ff' : '#f0f9ff'
                                        } : {}}
                                    >
                                        <div
                                            className="p-2 rounded-lg flex-shrink-0 mt-0.5"
                                            style={{
                                                backgroundColor: isSelected
                                                    ? (provider === 'agent-platform' ? '#a855f7' : '#0ea5e9')
                                                    : '#f3f4f6',
                                                color: isSelected ? 'white' : '#4b5563'
                                            }}
                                        >
                                            <ModelIcon modelId={modelId} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className={`font-semibold text-sm ${isSelected ? (provider === 'agent-platform' ? 'text-purple-700' : 'text-sky-700') : 'text-gray-900'}`}>
                                                    {info?.name || modelId}
                                                </span>
                                                {isDefaultModel && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-full">
                                                        {info?.badge || 'Mặc định'}
                                                    </span>
                                                )}
                                                {!isDefaultModel && info?.isFree && provider === 'gemini' && (
                                                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-sky-100 text-sky-700 rounded-full">
                                                        {info?.badge || 'Miễn phí'}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                                                {info?.description || ''}
                                            </p>
                                        </div>
                                        {isSelected && (
                                            <div
                                                className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                                                style={{ backgroundColor: provider === 'agent-platform' ? '#a855f7' : '#0ea5e9' }}
                                            >
                                                <Check className="w-3 h-3 text-white" />
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-500 mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            💡 <strong>Cơ chế chống ngắt quãng 2 tầng:</strong> Khi 1 key hết lượt, app tự động xoay sang API key dự phòng kế tiếp trên cùng model; nếu tất cả key đều hết quota model này, app tự chuyển sang model miễn phí kế tiếp (có hạn mức riêng) mà không làm mất nội dung đang viết.
                        </p>
                    </div>

                    {/* SECTION 3: API KEY MANAGEMENT */}
                    {provider === 'gemini' ? (
                        <div className="border-t pt-5 space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <label className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                    🔑 3. Kho API Key Xoay Vòng (tối đa {apiKeyManager.getMaxKeys()} key)
                                </label>
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                                        {stats.active} sẵn sàng
                                    </span>
                                    {stats.cooldown > 0 && (
                                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                                            {stats.cooldown} tạm nghỉ
                                        </span>
                                    )}
                                    {stats.error > 0 && (
                                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                                            {stats.error} lỗi
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Trạng thái Server Proxy bảo mật trên Vercel */}
                            {serverProxy.available && (
                                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-sm text-emerald-800">
                                    <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <strong>Kho key dự phòng bảo mật trên máy chủ đang bật ({serverProxy.keyCount} key ẩn).</strong>
                                        <p className="text-xs text-emerald-700 mt-0.5">
                                            Bạn có thể dùng ngay không cần nhập key, hoặc thêm key riêng bên dưới để ưu tiên dùng trước.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Trạng thái key ẩn từ .env.local */}
                            {stats.envTotal > 0 && (
                                <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl flex items-start gap-2.5 text-sm text-sky-800">
                                    <ShieldCheck className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                                    <div>
                                        Đã nạp ngầm <strong>{stats.envTotal} API key dự phòng</strong> từ cấu hình hệ thống (tự động ẩn giá trị key để bảo mật).
                                    </div>
                                </div>
                            )}

                            {/* Ô nhập 1 hoặc nhiều API key cùng lúc */}
                            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-gray-700">
                                        Dán 1 hoặc nhiều API Key (mỗi dòng 1 key, hoặc ngăn cách bằng dấu phẩy):
                                    </span>
                                    <span className="text-[11px] text-gray-500">Hỗ trợ AIzaSy... & AQ...</span>
                                </div>
                                <textarea
                                    rows={3}
                                    value={bulkKeyInput}
                                    onChange={(e) => {
                                        setBulkKeyInput(e.target.value);
                                        setBulkFeedback(null);
                                        setError('');
                                    }}
                                    placeholder={"Dán danh sách API key tại đây (nên dùng 3–5 key từ các Gmail khác nhau):\nAIzaSy...key1\nAIzaSy...key2\nAIzaSy...key3"}
                                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 bg-white focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none text-xs font-mono resize-y"
                                />

                                <div className="flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAddBulkKeys}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition-colors shadow-xs"
                                    >
                                        <Plus size={14} />
                                        Thêm vào kho xoay vòng
                                    </button>
                                    {poolKeys.length > 0 && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={handleTestAllKeys}
                                                disabled={isTestingAll || testingKey !== null}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-sky-300 text-sky-700 bg-white hover:bg-sky-50 disabled:opacity-50 transition-colors"
                                            >
                                                <FlaskConical size={14} />
                                                {isTestingAll ? 'Đang kiểm tra...' : 'Kiểm tra tất cả'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    apiKeyManager.resetAllKeys('gemini');
                                                    setKeyTestResults({});
                                                    refreshPoolState();
                                                    setBulkFeedback({ ok: true, text: '🔄 Đã reset trạng thái tất cả key về Sẵn sàng.' });
                                                }}
                                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50 transition-colors"
                                            >
                                                <RefreshCw size={13} />
                                                Reset tất cả
                                            </button>
                                        </>
                                    )}
                                </div>

                                {bulkFeedback && (
                                    <div className={`p-2.5 rounded-lg text-xs font-medium border ${bulkFeedback.ok
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                                        : 'bg-amber-50 border-amber-200 text-amber-800'
                                        }`}>
                                        {bulkFeedback.text}
                                    </div>
                                )}
                            </div>

                            {/* Danh sách các key trong kho xoay vòng */}
                            {poolKeys.length > 0 && (
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-gray-700">
                                            Danh sách key trong kho ({poolKeys.length} key — bấm "Dùng" để chọn key ưu tiên #1):
                                        </span>
                                        {stats.userTotal > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (window.confirm('Xóa toàn bộ các API key bạn đã nhập?')) {
                                                        apiKeyManager.clearAllUserKeys('gemini');
                                                        setKeyTestResults({});
                                                        refreshPoolState();
                                                    }
                                                }}
                                                className="text-[11px] text-red-500 hover:text-red-700 hover:underline"
                                            >
                                                Xóa tất cả key của tôi
                                            </button>
                                        )}
                                    </div>

                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                        {poolKeys.map((keyInfo, idx) => {
                                            const isCurrent = idx === currentPoolIndex;
                                            const isEnv = keyInfo.source === 'env';
                                            const masked = apiKeyManager.maskKey(keyInfo.key);
                                            const activeModelCds = apiKeyManager.getActiveModelCooldowns(keyInfo.key, 'gemini');
                                            const cdModelCount = Object.keys(activeModelCds).length;
                                            const soonestCdMs = keyInfo.cooldownUntil
                                                ? Math.max(0, keyInfo.cooldownUntil - Date.now())
                                                : cdModelCount > 0
                                                    ? Math.min(...Object.values(activeModelCds))
                                                    : 0;
                                            const testRes = keyTestResults[keyInfo.key];
                                            const isTestingThis = testingKey === keyInfo.key;

                                            return (
                                                <div
                                                    key={keyInfo.key}
                                                    className={`p-3 rounded-xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${isCurrent && keyInfo.status === 'active'
                                                        ? 'border-sky-400 bg-sky-50/70 shadow-xs'
                                                        : keyInfo.status === 'error'
                                                            ? 'border-red-200 bg-red-50/50'
                                                            : keyInfo.status === 'cooldown'
                                                                ? 'border-amber-200 bg-amber-50/50'
                                                                : 'border-gray-200 bg-white'
                                                        }`}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <span className="font-semibold text-xs text-gray-800">{keyInfo.name}</span>
                                                            <span className="font-mono text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                                                                {masked}
                                                            </span>
                                                            {isEnv && (
                                                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                                                                    Hệ thống (ẩn)
                                                                </span>
                                                            )}
                                                            {isCurrent && keyInfo.status === 'active' && (
                                                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-600 text-white">
                                                                    Đang ưu tiên
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                                                            {keyInfo.status === 'error' ? (
                                                                <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                                                                    <AlertCircle size={12} /> Key lỗi / không hợp lệ
                                                                </span>
                                                            ) : keyInfo.status === 'cooldown' ? (
                                                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                                                    <Clock size={12} /> Tạm nghỉ hết quota ({soonestCdMs > 0 ? `còn ${formatDurationShort(soonestCdMs)}` : 'sắp mở lại'})
                                                                </span>
                                                            ) : cdModelCount > 0 ? (
                                                                <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                                                                    <Clock size={12} /> Hết lượt {cdModelCount}/{FALLBACK_MODELS.length} model (còn {FALLBACK_MODELS.length - cdModelCount} model dùng được)
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                                                    <CheckCircle2 size={12} /> Sẵn sàng
                                                                </span>
                                                            )}

                                                            {testRes && (
                                                                <span className={`font-medium ${testRes.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                                                                    • {testRes.message}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                                        {!isCurrent && keyInfo.status !== 'error' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    apiKeyManager.setActiveKey(keyInfo.key, 'gemini');
                                                                    refreshPoolState();
                                                                }}
                                                                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-sky-300 text-sky-700 bg-white hover:bg-sky-50"
                                                            >
                                                                Dùng
                                                            </button>
                                                        )}
                                                        <button
                                                            type="button"
                                                            disabled={isTestingThis || isTestingAll}
                                                            onClick={() => handleTestSinglePoolKey(keyInfo)}
                                                            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                                                        >
                                                            {isTestingThis ? '...' : 'Test'}
                                                        </button>
                                                        {(keyInfo.status !== 'active' || cdModelCount > 0) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    apiKeyManager.resetKey(keyInfo.key, 'gemini');
                                                                    setKeyTestResults(prev => {
                                                                        const copy = { ...prev };
                                                                        delete copy[keyInfo.key];
                                                                        return copy;
                                                                    });
                                                                    refreshPoolState();
                                                                }}
                                                                className="px-2 py-1 text-[11px] font-semibold rounded-lg border border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50"
                                                                title="Mở lại key"
                                                            >
                                                                <RefreshCw size={12} />
                                                            </button>
                                                        )}
                                                        {!isEnv && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    apiKeyManager.removeKey(keyInfo.key, 'gemini');
                                                                    refreshPoolState();
                                                                }}
                                                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                                                title="Xóa key"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Error message */}
                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                                    ⚠️ {error}
                                </div>
                            )}

                            {/* Help box */}
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                                <p className="text-sm font-semibold text-amber-900 mb-1.5">
                                    📖 Mẹo tránh hết quota giữa chừng khi viết Biện pháp dài:
                                </p>
                                <ol className="text-xs text-amber-800 space-y-1 list-decimal list-inside leading-relaxed">
                                    <li>Đăng nhập Google AI Studio bằng <strong>2–5 tài khoản Gmail khác nhau</strong>, mỗi Gmail tạo 1 API Key miễn phí.</li>
                                    <li>Dán tất cả các key đó vào ô phía trên (mỗi dòng 1 key) → bấm <strong>"Thêm vào kho xoay vòng"</strong>.</li>
                                    <li>Mỗi key × 6 model miễn phí = <strong>6 nguồn quota độc lập</strong>; có 5 key = <strong>30 nguồn quota</strong>, viết liền mạch cả bản Biện pháp không bị ngắt!</li>
                                </ol>
                                <a
                                    href="https://aistudio.google.com/api-keys"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 px-3.5 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-xs font-semibold"
                                >
                                    <ExternalLink size={14} />
                                    Mở Google AI Studio lấy API Key miễn phí
                                </a>
                            </div>
                        </div>
                    ) : (
                        /* TAB AGENT PLATFORM API (riêng biệt theo api.md §III) */
                        <div className="border-t pt-5 space-y-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-2">
                                    🔑 3. Agent Platform API Key
                                </label>
                                <input
                                    type="password"
                                    value={agentApiKey}
                                    onChange={(e) => {
                                        setAgentApiKey(e.target.value);
                                        setError('');
                                        setAgentTestResult(null);
                                    }}
                                    placeholder="Nhập Agent Platform API Key (AIzaSy... hoặc AQ...)"
                                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none text-sm font-mono"
                                />
                                <div className="mt-2 flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={handleTestAgentKey}
                                        disabled={isTestingAgent}
                                        className="px-3 py-2 text-xs font-semibold rounded-lg border border-purple-300 text-purple-700 bg-white hover:bg-purple-50 disabled:opacity-50"
                                    >
                                        {isTestingAgent ? 'Đang kiểm tra...' : '🧪 Kiểm tra key'}
                                    </button>
                                    <span className="text-xs text-gray-500">Gửi 1 yêu cầu ngắn tới Google Cloud để xác nhận key.</span>
                                </div>
                            </div>

                            {agentTestResult && (
                                <div className={`p-3 rounded-xl text-sm border ${agentTestResult.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                                    <strong>{agentTestResult.title}</strong> — {agentTestResult.message}
                                </div>
                            )}

                            {error && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
                                    ⚠️ {error}
                                </div>
                            )}

                            <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl">
                                <p className="text-sm font-semibold text-purple-900 mb-1.5">
                                    📖 Hướng dẫn lấy Agent Platform API Key:
                                </p>
                                <ol className="text-xs text-purple-800 space-y-1 list-decimal list-inside">
                                    <li>Truy cập Google Cloud Console (Express Mode)</li>
                                    <li>Bật Agent Platform API</li>
                                    <li>Tạo API Key và dán vào ô trên</li>
                                </ol>
                                <a
                                    href="https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 inline-flex items-center gap-2 px-3.5 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs font-semibold"
                                >
                                    <ExternalLink size={14} />
                                    Lấy Agent Platform API Key
                                </a>
                            </div>
                        </div>
                    )}

                    <div className="text-xs text-gray-500">
                        <p>🔒 API Key bạn nhập chỉ lưu cục bộ trên trình duyệt của bạn, chỉ gửi thẳng tới Google AI (hoặc dùng kho key ẩn bảo mật trên máy chủ Vercel nếu đã cấu hình).</p>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0 bg-gray-50/70">
                    {isDismissible && (
                        <Button variant="secondary" onClick={onClose}>
                            Đóng
                        </Button>
                    )}
                    <Button onClick={handleSave}>
                        Lưu cấu hình
                    </Button>
                </div>
            </div>
        </div>
    );
};
