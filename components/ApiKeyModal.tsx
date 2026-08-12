import React, { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { Key, X, Zap, Cpu, Sparkles, ExternalLink, Server } from 'lucide-react';
import { FALLBACK_MODELS, AGENT_PLATFORM_MODELS, MODEL_INFO } from '../constants';
import { isValidGoogleAiApiKey, maskGoogleAiApiKey, parseGoogleAiApiKeys } from '../services/googleAiApiKey';
import { AiProvider } from '../types';

interface ApiKeyModalProps {
    isOpen: boolean;
    onSave: (key: string, selectedModel: string, provider: AiProvider) => void;
    onClose: () => void;
    isDismissible?: boolean;
}

// Đọc API keys từ biến môi trường
const getEnvApiKeys = (): string[] => {
    return parseGoogleAiApiKeys(import.meta.env.VITE_GEMINI_API_KEYS || '');
};

const ModelIcon: React.FC<{ modelId: string }> = ({ modelId }) => {
    if (modelId.includes('3-flash')) return <Zap className="w-5 h-5" />;
    if (modelId.includes('3-pro')) return <Sparkles className="w-5 h-5" />;
    return <Cpu className="w-5 h-5" />;
};

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onSave, onClose, isDismissible = true }) => {
    const [provider, setProvider] = useState<AiProvider>('gemini');
    const [selectedModel, setSelectedModel] = useState(FALLBACK_MODELS[0]);
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState('');

    // Lấy danh sách key từ env (chỉ tính 1 lần cho Gemini)
    const envKeys = useMemo(() => getEnvApiKeys(), []);
    const hasEnvKeys = envKeys.length > 0;

    // Load từ localStorage khi modal mở
    useEffect(() => {
        if (isOpen) {
            const savedProvider = (localStorage.getItem('google_ai_provider') as AiProvider) || 'gemini';
            setProvider(savedProvider);

            const savedKey = savedProvider === 'agent-platform'
                ? (localStorage.getItem('agent_platform_api_key') || '')
                : (localStorage.getItem('gemini_api_key') || '');
            
            const savedModel = localStorage.getItem('selected_model');

            const currentModels = savedProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : FALLBACK_MODELS;
            setApiKey(savedKey);
            if (savedModel && currentModels.includes(savedModel)) {
                setSelectedModel(savedModel);
            } else {
                setSelectedModel(currentModels[0]);
            }
        }
    }, [isOpen]);

    // Handler đổi provider
    const handleProviderChange = (newProvider: AiProvider) => {
        setProvider(newProvider);
        const savedKey = newProvider === 'agent-platform'
            ? (localStorage.getItem('agent_platform_api_key') || '')
            : (localStorage.getItem('gemini_api_key') || '');
        setApiKey(savedKey);
        
        const models = newProvider === 'agent-platform' ? AGENT_PLATFORM_MODELS : FALLBACK_MODELS;
        setSelectedModel(models[0]);
        setError('');
    };

    const handleSave = () => {
        const trimmedKey = apiKey.trim();

        let keyToSave = trimmedKey;
        if (provider === 'gemini' && !keyToSave && hasEnvKeys) {
            keyToSave = envKeys[0];
        }

        if (!keyToSave) {
            setError(`Vui lòng nhập API Key cho ${provider === 'gemini' ? 'Google Gemini' : 'Agent Platform'}`);
            return;
        }

        if (provider === 'gemini' && !isValidGoogleAiApiKey(keyToSave)) {
            setError('API Key Gemini không hợp lệ. Key phải bắt đầu bằng "AIzaSy..." hoặc "AQ..."');
            return;
        }

        // Lưu vào localStorage
        localStorage.setItem('google_ai_provider', provider);
        if (provider === 'agent-platform') {
            localStorage.setItem('agent_platform_api_key', keyToSave);
        } else {
            localStorage.setItem('gemini_api_key', keyToSave);
        }
        localStorage.setItem('selected_model', selectedModel);

        setError('');
        onSave(keyToSave, selectedModel, provider);
    };

    if (!isOpen) return null;

    const availableModels = provider === 'agent-platform' ? AGENT_PLATFORM_MODELS : FALLBACK_MODELS;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex-shrink-0 relative">
                    {isDismissible && (
                        <button
                            onClick={onClose}
                            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    )}

                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-sky-100 rounded-lg">
                            <Key className="w-6 h-6 text-sky-600" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-gray-900">Thiết lập Model & API Key</h2>
                            <p className="text-sm text-gray-500">Cấu hình kết nối AI Multi-Provider</p>
                        </div>
                    </div>
                </div>

                {/* Body - Scrollable */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Provider Selector Tabs */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Chọn nhà cung cấp AI (Provider)
                        </label>
                        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
                            <button
                                type="button"
                                onClick={() => handleProviderChange('gemini')}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                                    provider === 'gemini'
                                        ? 'bg-white text-sky-700 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                <Sparkles size={16} />
                                Google Gemini
                            </button>
                            <button
                                type="button"
                                onClick={() => handleProviderChange('agent-platform')}
                                className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-semibold transition-all ${
                                    provider === 'agent-platform'
                                        ? 'bg-white text-indigo-700 shadow-sm'
                                        : 'text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                <Server size={16} />
                                Agent Platform API
                            </button>
                        </div>
                    </div>

                    {/* Model Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3">
                            Chọn Model AI ({provider === 'agent-platform' ? 'Agent Platform' : 'Gemini'})
                        </label>
                        <div className="grid grid-cols-1 gap-3">
                            {availableModels.map((modelId) => {
                                const info = MODEL_INFO[modelId];
                                const isSelected = selectedModel === modelId;
                                return (
                                    <button
                                        key={modelId}
                                        type="button"
                                        onClick={() => setSelectedModel(modelId)}
                                        className={`relative flex items-center gap-3 p-4 rounded-lg border-2 transition-all text-left ${isSelected
                                            ? provider === 'agent-platform' ? 'border-indigo-500 bg-indigo-50 shadow-md' : 'border-sky-500 bg-sky-50 shadow-md'
                                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div className={`p-2 rounded-lg ${isSelected ? (provider === 'agent-platform' ? 'bg-indigo-500 text-white' : 'bg-sky-500 text-white') : 'bg-gray-100 text-gray-600'}`}>
                                            <ModelIcon modelId={modelId} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`font-semibold ${isSelected ? (provider === 'agent-platform' ? 'text-indigo-700' : 'text-sky-700') : 'text-gray-900'}`}>
                                                    {info?.name || modelId}
                                                </span>
                                                {info?.isDefault && (
                                                    <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                                                        Default
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {info?.description || ''}
                                            </p>
                                        </div>
                                        {isSelected && (
                                            <div className={`w-5 h-5 ${provider === 'agent-platform' ? 'bg-indigo-500' : 'bg-sky-500'} rounded-full flex items-center justify-center`}>
                                                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-gray-500 mt-2 italic">
                            💡 Nếu model đang chọn bị lỗi/quá tải, hệ thống sẽ tự động chuyển đổi sang model dự phòng.
                        </p>
                    </div>

                    {/* API Key Input */}
                    <div className="border-t pt-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            🔑 API Key ({provider === 'gemini' ? 'Google Gemini' : 'Agent Platform'}) {provider === 'gemini' && hasEnvKeys && <span className="text-green-600 font-normal">(Tùy chọn - đã có key mặc định)</span>}
                        </label>
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => {
                                setApiKey(e.target.value);
                                setError('');
                            }}
                            placeholder={provider === 'gemini' && hasEnvKeys ? "Để trống để dùng key mặc định, hoặc nhập key riêng" : `Nhập ${provider === 'gemini' ? 'Gemini' : 'Agent Platform'} API Key`}
                            className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-sky-500 focus:border-transparent outline-none text-sm font-mono"
                        />

                        {/* Error message */}
                        {error && (
                            <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                ⚠️ {error}
                            </div>
                        )}

                        {/* Thông báo key mặc định cho Gemini */}
                        {provider === 'gemini' && hasEnvKeys && (
                            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
                                ✅ Hệ thống đã có <strong>{envKeys.length} API Key</strong> được cấu hình sẵn. Bạn có thể bỏ trống ô trên để sử dụng key mặc định, hoặc nhập key riêng nếu muốn.
                            </div>
                        )}

                        {/* Preset API Keys - chỉ hiện cho Gemini nếu có keys từ env */}
                        {provider === 'gemini' && hasEnvKeys && (
                            <div className="mt-4 p-4 bg-sky-50 border border-sky-200 rounded-lg">
                                <p className="text-sm font-semibold text-sky-800 mb-2">
                                    🔑 Chọn nhanh API Key có sẵn:
                                </p>
                                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                                    {envKeys.map((key, idx) => {
                                        const masked = maskGoogleAiApiKey(key);
                                        const isActive = apiKey === key;
                                        return (
                                            <button
                                                key={idx}
                                                type="button"
                                                onClick={() => {
                                                    setApiKey(key);
                                                    setError('');
                                                }}
                                                className={`px-3 py-2 text-xs font-mono rounded-lg border transition-all text-left truncate ${isActive
                                                    ? 'border-sky-500 bg-sky-100 text-sky-800 ring-2 ring-sky-300'
                                                    : 'border-gray-200 bg-white text-gray-700 hover:border-sky-300 hover:bg-sky-50'
                                                    }`}
                                                title={`Key #${idx + 1}`}
                                            >
                                                🔑 {masked}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-sky-600 mt-2 italic">
                                    💡 Nhấn vào key bất kỳ để chọn. Nếu key hết lượt, hãy thử key khác.
                                </p>
                            </div>
                        )}

                        {/* Help text */}
                        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                            <p className="text-sm font-semibold text-amber-800 mb-2">
                                📖 Hướng dẫn lấy API Key:
                            </p>
                            {provider === 'gemini' ? (
                                <>
                                    <ol className="text-sm text-amber-700 space-y-1 list-decimal list-inside">
                                        <li>Truy cập Google AI Studio</li>
                                        <li>Đăng nhập bằng tài khoản Google</li>
                                        <li>Nhấn "Create API Key" hoặc "Get API Key"</li>
                                        <li>Copy key và dán vào ô trên</li>
                                    </ol>
                                    <a
                                        href="https://aistudio.google.com/api-keys"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium"
                                    >
                                        <ExternalLink size={16} />
                                        Lấy API Key tại đây
                                    </a>
                                </>
                            ) : (
                                <p className="text-sm text-amber-700">
                                    Agent Platform API Key là khóa API được cấp riêng để kết nối tới endpoint Google Cloud AI Platform (Express / Vertex AI). Hãy dán khóa API của bạn vào ô trên để sử dụng dịch vụ.
                                </p>
                            )}
                        </div>

                        <div className="mt-3 text-xs text-gray-500">
                            <p>💡 API Key được lưu trên trình duyệt của bạn, không gửi đến bất kỳ server trung gian nào.</p>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 flex justify-end gap-3 flex-shrink-0">
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
