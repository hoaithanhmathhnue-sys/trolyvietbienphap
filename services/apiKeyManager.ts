import {
    isValidGoogleAiApiKey,
    maskGoogleAiApiKey,
    normalizeGoogleAiApiKey,
    parseGoogleAiApiKeys,
} from './googleAiApiKey';
import { FALLBACK_MODELS } from '../constants';
import type { AiProvider } from '../types';

/**
 * API Key Manager - Quản lý nhiều API key với cơ chế xoay vòng + cooldown thông minh theo từng cặp (key, model)
 *
 * Nguyên tắc bảo mật & tách biệt (api.md v5.0):
 * - Tối đa 30 key trong kho xoay vòng.
 * - Gemini API và Agent Platform API có vùng lưu trữ hoàn toàn tách biệt.
 * - Key ngầm từ biến môi trường (VITE_GEMINI_API_KEYS) CHỈ giữ trong RAM (source: 'env', isHidden: true),
 *   tuyệt đối KHÔNG ghi xuống localStorage và KHÔNG hiển thị nguyên văn ra UI.
 */

export type ApiKeyStatus = 'active' | 'error' | 'cooldown';
export type ApiKeySource = 'user' | 'env';

export interface ApiKeyInfo {
    key: string;
    name: string;
    status: ApiKeyStatus;
    source?: ApiKeySource;
    isHidden?: boolean;
    lastError?: string;
    lastErrorModel?: string;
    errorCount: number;
    cooldownUntil?: number; // Timestamp khi hết cooldown chung
    modelCooldowns?: Record<string, number>; // Cooldown riêng theo từng model: { [modelId]: timestamp }
    addedAt: number;
}

export interface ApiKeyRotationResult {
    success: boolean;
    hasMoreKeys: boolean;
    newKey?: string;
    message: string;
}

export interface BulkAddResult {
    added: number;
    duplicates: number;
    invalid: number;
    limitReached: number;
    total: number;
    addedKeys: string[];
}

export interface KeyPoolStats {
    total: number;
    active: number;
    error: number;
    cooldown: number;
    userTotal: number;
    envTotal: number;
    partialCooldown: number;
}

export type KeyRotationCallback = (info: { fromKey: string; toKey: string; reason: string; provider?: AiProvider }) => void;
export type AllKeysFailedCallback = (provider?: AiProvider) => void;

const MAX_KEYS = 30;
const RPM_COOLDOWN_MS = 65 * 1000;          // 65 giây cho giới hạn tốc độ theo phút (RPM)
const RPD_COOLDOWN_MS = 15 * 60 * 1000;     // 15 phút cho lỗi hết quota ngày (RPD) trên 1 model
const DEFAULT_COOLDOWN_MS = 3 * 60 * 1000;  // 3 phút mặc định khi không rõ loại 429

interface ProviderStore {
    storageKey: string;
    legacySingleKey: string;
    envVar: string;
}

const PROVIDER_STORES: Record<AiProvider, ProviderStore> = {
    'gemini': {
        storageKey: 'gemini_api_keys',
        legacySingleKey: 'gemini_api_key',
        envVar: 'VITE_GEMINI_API_KEYS',
    },
    'agent-platform': {
        storageKey: 'agent_platform_api_keys',
        legacySingleKey: 'agent_platform_api_key',
        envVar: 'VITE_AGENT_PLATFORM_API_KEYS',
    },
};

// Đọc danh sách API key ngầm từ biến môi trường (.env.local) — CHỈ giữ trong RAM, không ghi vào localStorage
const getEnvKeys = (envVar: string): { key: string; name: string }[] => {
    const raw = (import.meta as any).env?.[envVar] || '';
    if (!raw) return [];
    return parseGoogleAiApiKeys(raw).map((k: string, i: number) => ({
        key: k,
        name: `Key dự phòng #${i + 1}`,
    }));
};

const ENV_KEYS_BY_PROVIDER: Record<AiProvider, { key: string; name: string }[]> = {
    'gemini': getEnvKeys(PROVIDER_STORES.gemini.envVar),
    'agent-platform': getEnvKeys(PROVIDER_STORES['agent-platform'].envVar),
};

class ProviderKeyManager {
    private keys: ApiKeyInfo[] = [];
    private currentIndex: number = 0;
    private onKeyRotation?: KeyRotationCallback;
    private onAllKeysFailed?: AllKeysFailedCallback;

    constructor(private provider: AiProvider, private store: ProviderStore) {
        this.loadFromStorage();
    }

    setOnKeyRotation(callback: KeyRotationCallback) {
        this.onKeyRotation = callback;
    }

    setOnAllKeysFailed(callback: AllKeysFailedCallback) {
        this.onAllKeysFailed = callback;
    }

    /**
     * Load danh sách key của người dùng từ localStorage + nạp ngầm env keys vào RAM
     */
    loadFromStorage(): void {
        try {
            const backupEnvKeys = ENV_KEYS_BY_PROVIDER[this.provider] || [];
            const envKeySet = new Set(backupEnvKeys.map(b => b.key));
            const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(this.store.storageKey) : null;

            if (stored) {
                const data = JSON.parse(stored);
                const rawKeys = Array.isArray(data.keys)
                    ? data.keys.filter((k: any) => k && typeof k.key === 'string')
                    : [];

                // Dọn sạch các key env cũ từng bị bản trước ghi nhầm vào localStorage
                this.keys = rawKeys
                    .map((k: any): ApiKeyInfo => {
                        const normalized = normalizeGoogleAiApiKey(k.key);
                        const isEnv = k.source === 'env' || envKeySet.has(normalized);
                        return {
                            key: normalized,
                            name: k.name || 'Key của tôi',
                            status: k.status === 'error' || k.status === 'cooldown' ? k.status : 'active',
                            source: isEnv ? 'env' : 'user',
                            isHidden: isEnv,
                            lastError: k.lastError,
                            lastErrorModel: k.lastErrorModel,
                            errorCount: Number.isFinite(k.errorCount) ? k.errorCount : 0,
                            cooldownUntil: k.cooldownUntil,
                            modelCooldowns: k.modelCooldowns && typeof k.modelCooldowns === 'object' ? { ...k.modelCooldowns } : {},
                            addedAt: Number.isFinite(k.addedAt) ? k.addedAt : Date.now(),
                        };
                    })
                    .filter((k: ApiKeyInfo) => isValidGoogleAiApiKey(k.key) && k.source !== 'env');

                this.currentIndex = Number.isInteger(data.currentIndex) ? data.currentIndex : 0;
                if (this.currentIndex < 0 || this.currentIndex >= this.keys.length) this.currentIndex = 0;
            }

            // Migration: nếu có key đơn cũ ở legacySingleKey và chưa tồn tại trong danh sách user
            const oldKeyRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.store.legacySingleKey) : null;
            const oldKey = oldKeyRaw ? normalizeGoogleAiApiKey(oldKeyRaw) : '';
            if (oldKey && isValidGoogleAiApiKey(oldKey) && !envKeySet.has(oldKey)) {
                if (!this.keys.some(k => k.key === oldKey)) {
                    this.keys.unshift({
                        key: oldKey,
                        name: 'Key mặc định',
                        status: 'active',
                        source: 'user',
                        isHidden: false,
                        errorCount: 0,
                        modelCooldowns: {},
                        addedAt: Date.now(),
                    });
                }
            }

            // Nạp ngầm backup env keys vào RAM (đặt sau user keys để ưu tiên key người dùng trước)
            this.injectBackupKeys();
            this.checkAndResetCooldowns();
        } catch (e) {
            console.error(`Lỗi load API keys (${this.provider}):`, e);
            this.keys = [];
            this.currentIndex = 0;
            this.injectBackupKeys();
        }
    }

    /**
     * Nạp các backup API key từ .env vào RAM (KHÔNG ghi xuống localStorage)
     */
    private injectBackupKeys(): void {
        const backupEnvKeys = ENV_KEYS_BY_PROVIDER[this.provider] || [];
        let added = 0;
        for (const backup of backupEnvKeys) {
            if (!this.keys.some(k => k.key === backup.key)) {
                if (this.keys.length < MAX_KEYS) {
                    this.keys.push({
                        key: backup.key,
                        name: backup.name,
                        status: 'active',
                        source: 'env',
                        isHidden: true,
                        errorCount: 0,
                        modelCooldowns: {},
                        addedAt: Date.now(),
                    });
                    added++;
                }
            }
        }
        if (added > 0) {
            console.log(`🔑 Đã nạp ngầm ${added} API key dự phòng (${this.provider}) từ cấu hình môi trường`);
        }
    }

    /**
     * Lưu CHỈ các key của người dùng vào localStorage (tuyệt đối không lưu key ẩn từ .env)
     */
    saveToStorage(): void {
        try {
            if (typeof localStorage === 'undefined') return;
            const userKeys = this.keys.filter(k => k.source !== 'env');
            const activeUserKey = userKeys.find(k => k.status === 'active')?.key || userKeys[0]?.key || '';
            const currentKey = this.keys[this.currentIndex]?.key;
            const userCurrentIndex = Math.max(0, userKeys.findIndex(k => k.key === currentKey));

            localStorage.setItem(this.store.storageKey, JSON.stringify({
                keys: userKeys,
                currentIndex: userCurrentIndex,
            }));

            // Chỉ đồng bộ legacySingleKey cho key của người dùng (không chép key .env vào localStorage)
            if (activeUserKey) {
                localStorage.setItem(this.store.legacySingleKey, activeUserKey);
            } else {
                localStorage.removeItem(this.store.legacySingleKey);
            }
        } catch (e) {
            console.error(`Lỗi lưu API keys (${this.provider}):`, e);
        }
    }

    /**
     * Kiểm tra và gỡ các cooldown đã hết hạn (cả cooldown chung lẫn cooldown theo từng model)
     */
    private checkAndResetCooldowns(): void {
        const now = Date.now();
        let hasChanges = false;

        this.keys.forEach(keyInfo => {
            if (keyInfo.modelCooldowns) {
                for (const [model, until] of Object.entries(keyInfo.modelCooldowns)) {
                    if (until <= now) {
                        delete keyInfo.modelCooldowns[model];
                        hasChanges = true;
                    }
                }
            }

            if (keyInfo.status === 'cooldown') {
                const generalExpired = !keyInfo.cooldownUntil || keyInfo.cooldownUntil <= now;
                const activeModelCooldowns = Object.values(keyInfo.modelCooldowns || {}).filter(t => t > now);
                if (generalExpired && activeModelCooldowns.length === 0) {
                    keyInfo.status = 'active';
                    keyInfo.errorCount = 0;
                    keyInfo.cooldownUntil = undefined;
                    keyInfo.lastError = undefined;
                    keyInfo.lastErrorModel = undefined;
                    hasChanges = true;
                } else if (generalExpired && activeModelCooldowns.length > 0 && activeModelCooldowns.length < FALLBACK_MODELS.length) {
                    // Còn ít nhất 1 model miễn phí khác dùng được → mở lại trạng thái active
                    keyInfo.status = 'active';
                    keyInfo.cooldownUntil = undefined;
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) {
            this.saveToStorage();
        }
    }

    /**
     * Thêm một API key mới của người dùng
     */
    addKey(key: string, name?: string): { success: boolean; message: string } {
        const trimmedKey = normalizeGoogleAiApiKey(key);
        if (!isValidGoogleAiApiKey(trimmedKey)) {
            return { success: false, message: 'API Key không đúng định dạng (cần bắt đầu bằng AIza... hoặc AQ...)' };
        }

        const existing = this.keys.find(k => k.key === trimmedKey);
        if (existing) {
            // Nếu key đang lỗi/cooldown mà người dùng nhập lại → kích hoạt lại
            if (existing.status !== 'active' || (existing.modelCooldowns && Object.keys(existing.modelCooldowns).length > 0)) {
                existing.status = 'active';
                existing.errorCount = 0;
                existing.cooldownUntil = undefined;
                existing.modelCooldowns = {};
                existing.lastError = undefined;
                existing.lastErrorModel = undefined;
                this.saveToStorage();
            }
            return { success: false, message: 'Key này đã tồn tại trong danh sách' };
        }

        if (this.keys.length >= MAX_KEYS) {
            return { success: false, message: `Đã đạt giới hạn tối đa ${MAX_KEYS} API key` };
        }

        const userCount = this.keys.filter(k => k.source !== 'env').length;
        const newKey: ApiKeyInfo = {
            key: trimmedKey,
            name: name?.trim() || `Key ${userCount + 1}`,
            status: 'active',
            source: 'user',
            isHidden: false,
            errorCount: 0,
            modelCooldowns: {},
            addedAt: Date.now(),
        };

        // Chèn key người dùng TRƯỚC các key env ẩn để luôn ưu tiên key người dùng trước
        const firstEnvIdx = this.keys.findIndex(k => k.source === 'env');
        if (firstEnvIdx === -1) {
            this.keys.push(newKey);
        } else {
            this.keys.splice(firstEnvIdx, 0, newKey);
            if (this.currentIndex >= firstEnvIdx) {
                this.currentIndex++;
            }
        }

        this.saveToStorage();
        return { success: true, message: 'Đã thêm key thành công' };
    }

    /**
     * Thêm hàng loạt nhiều API key cùng lúc (tách theo dòng, dấu phẩy, chấm phẩy, khoảng trắng)
     */
    addKeysBulk(rawText: string, namePrefix = 'Key'): BulkAddResult {
        const tokens = (rawText || '')
            .split(/[\r\n,;\t ]+/)
            .map(token => normalizeGoogleAiApiKey(token))
            .filter(token => token.length > 0);

        let added = 0;
        let duplicates = 0;
        let invalid = 0;
        let limitReached = 0;
        const addedKeys: string[] = [];

        for (const token of tokens) {
            if (!isValidGoogleAiApiKey(token)) {
                invalid++;
                continue;
            }
            if (this.keys.some(k => k.key === token)) {
                duplicates++;
                continue;
            }
            if (this.keys.length >= MAX_KEYS) {
                limitReached++;
                continue;
            }
            const userCount = this.keys.filter(k => k.source !== 'env').length;
            const res = this.addKey(token, `${namePrefix} ${userCount + 1}`);
            if (res.success) {
                added++;
                addedKeys.push(token);
            }
        }

        return {
            added,
            duplicates,
            invalid,
            limitReached,
            total: this.keys.length,
            addedKeys,
        };
    }

    /**
     * Xóa một API key (chỉ cho xóa key của người dùng, bảo vệ key ẩn hệ thống)
     */
    removeKey(key: string): { success: boolean; message: string } {
        const index = this.keys.findIndex(k => k.key === key);
        if (index === -1) {
            return { success: false, message: 'Không tìm thấy key' };
        }
        if (this.keys[index].source === 'env') {
            return { success: false, message: 'Không thể xóa key dự phòng hệ thống' };
        }

        this.keys.splice(index, 1);

        if (index < this.currentIndex) {
            this.currentIndex--;
        }
        if (this.currentIndex >= this.keys.length) {
            this.currentIndex = 0;
        }
        this.saveToStorage();

        return { success: true, message: 'Đã xóa key' };
    }

    /**
     * Xóa toàn bộ key do người dùng nhập (giữ lại key dự phòng hệ thống nếu có)
     */
    clearAllUserKeys(): void {
        this.keys = this.keys.filter(k => k.source === 'env');
        this.currentIndex = 0;
        this.saveToStorage();
    }

    /**
     * Kiểm tra một cặp (key, model) có đang sẵn sàng gọi API hay không
     */
    isKeyModelAvailable(key: string, model?: string): boolean {
        this.checkAndResetCooldowns();
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) return true; // Key ngoài pool (vd key test trực tiếp)
        if (keyInfo.status === 'error') return false;
        const now = Date.now();
        if (keyInfo.cooldownUntil && keyInfo.cooldownUntil > now) return false;
        if (model && keyInfo.modelCooldowns?.[model] && keyInfo.modelCooldowns[model] > now) {
            return false;
        }
        return true;
    }

    /**
     * Trả về danh sách các API key khả dụng cho một model cụ thể theo thứ tự ưu tiên xoay vòng
     */
    getAvailableKeysForModel(model: string, preferredKey?: string): string[] {
        this.checkAndResetCooldowns();
        if (this.keys.length === 0) return preferredKey ? [preferredKey] : [];

        const result: string[] = [];
        const addIfAvailable = (k: string) => {
            if (!k || result.includes(k)) return;
            if (this.isKeyModelAvailable(k, model)) {
                result.push(k);
            }
        };

        // 1. Ưu tiên key đang dùng hiện tại nếu sẵn sàng cho model này
        if (preferredKey) addIfAvailable(preferredKey);

        // 2. Xoay vòng bắt đầu từ currentIndex qua các key còn lại
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            addIfAvailable(this.keys[idx].key);
        }

        return result;
    }

    /**
     * Lấy key đang active (hoặc còn ít nhất 1 model khả dụng)
     */
    getActiveKey(model?: string): string | null {
        this.checkAndResetCooldowns();

        if (this.keys.length === 0) {
            return null;
        }

        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const keyInfo = this.keys[idx];
            if (this.isKeyModelAvailable(keyInfo.key, model)) {
                this.currentIndex = idx;
                return keyInfo.key;
            }
        }

        // Nếu mọi key đều cooldown trên model được hỏi, nhưng có key vẫn active cho model khác
        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const keyInfo = this.keys[idx];
            if (keyInfo.status !== 'error') {
                this.currentIndex = idx;
                return keyInfo.key;
            }
        }

        return null;
    }

    /**
     * Đánh dấu cặp (key, model) gặp lỗi quota/rate-limit với thời gian cooldown thông minh (RPM vs RPD)
     * — Giữ nguyên khả năng dùng key đó cho các model Free Tier khác!
     */
    markKeyModelQuotaError(
        key: string,
        model: string,
        errorType: 'QUOTA_EXCEEDED' | 'RATE_LIMIT',
        options?: { isPerMinute?: boolean; retryDelaySec?: number }
    ): ApiKeyRotationResult {
        this.checkAndResetCooldowns();
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) {
            return { success: false, hasMoreKeys: false, message: 'Không tìm thấy key trong danh sách' };
        }

        let cooldownMs = DEFAULT_COOLDOWN_MS;
        if (options?.retryDelaySec && options.retryDelaySec > 0) {
            cooldownMs = Math.min(Math.max((options.retryDelaySec + 3) * 1000, 15_000), RPD_COOLDOWN_MS);
        } else if (errorType === 'RATE_LIMIT' || options?.isPerMinute) {
            cooldownMs = RPM_COOLDOWN_MS;
        } else {
            cooldownMs = RPD_COOLDOWN_MS;
        }

        const until = Date.now() + cooldownMs;
        if (!keyInfo.modelCooldowns) keyInfo.modelCooldowns = {};
        keyInfo.modelCooldowns[model] = until;
        keyInfo.lastError = errorType;
        keyInfo.lastErrorModel = model;
        keyInfo.errorCount++;

        // Chỉ chuyển trạng thái tổng thể sang 'cooldown' nếu key đã hết quota trên TẤT CẢ model trong FALLBACK_MODELS
        const now = Date.now();
        const blockedModels = FALLBACK_MODELS.filter(m => (keyInfo.modelCooldowns?.[m] || 0) > now);
        if (blockedModels.length >= FALLBACK_MODELS.length) {
            keyInfo.status = 'cooldown';
            keyInfo.cooldownUntil = Math.min(...blockedModels.map(m => keyInfo.modelCooldowns![m]));
        }

        this.saveToStorage();
        console.log(
            `⏸️ Key ${this.maskKey(key)} tạm nghỉ trên model ${model} (${Math.round(cooldownMs / 1000)}s) do ${errorType}. Còn ${FALLBACK_MODELS.length - blockedModels.length}/${FALLBACK_MODELS.length} model khả dụng trên key này.`
        );

        // Thử xoay sang key khác sẵn sàng cho CÙNG model này trước
        return this.rotateToNextKey(errorType, model);
    }

    /**
     * Đánh dấu key bị lỗi chung và xoay sang key tiếp theo
     */
    markKeyError(key: string, errorType: string, model?: string): ApiKeyRotationResult {
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) {
            return { success: false, hasMoreKeys: false, message: 'Không tìm thấy key' };
        }

        keyInfo.lastError = errorType;
        if (model) keyInfo.lastErrorModel = model;

        if (
            errorType === 'MODEL_OVERLOADED' ||
            errorType === 'TRANSIENT_SERVER_ERROR' ||
            errorType === 'NOT_FOUND' ||
            errorType === 'MODEL_NOT_FOUND' ||
            errorType === 'NETWORK_ERROR'
        ) {
            this.saveToStorage();
            console.log(`⚠️ Model Gemini quá tải / lỗi tạm thời (${errorType}); key ${this.maskKey(key)} vẫn giữ active`);
            return {
                success: false,
                hasMoreKeys: this.hasAvailableKeys(),
                message: 'Model Gemini đang quá tải tạm thời; API key vẫn hoạt động.'
            };
        }

        if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
            if (model) {
                return this.markKeyModelQuotaError(key, model, errorType);
            }
            keyInfo.errorCount++;
            keyInfo.status = 'cooldown';
            keyInfo.cooldownUntil = Date.now() + (errorType === 'RATE_LIMIT' ? RPM_COOLDOWN_MS : DEFAULT_COOLDOWN_MS);
            this.saveToStorage();
            return this.rotateToNextKey(errorType);
        }

        keyInfo.errorCount++;
        if (errorType === 'INVALID_API_KEY') {
            keyInfo.status = 'error';
            console.log(`❌ Key ${this.maskKey(key)} không hợp lệ, đã đánh dấu lỗi`);
        } else if (errorType === 'PERMISSION_DENIED') {
            keyInfo.status = 'cooldown';
            keyInfo.cooldownUntil = Date.now() + RPD_COOLDOWN_MS;
            console.log(`🚫 Key ${this.maskKey(key)} không có quyền truy cập, tạm nghỉ và chuyển key khác`);
        }

        this.saveToStorage();
        return this.rotateToNextKey(errorType, model);
    }

    /**
     * Xoay sang key tiếp theo (tùy chọn lọc theo model cụ thể)
     */
    rotateToNextKey(reason: string = 'manual', model?: string): ApiKeyRotationResult {
        this.checkAndResetCooldowns();
        if (this.keys.length === 0) {
            return { success: false, hasMoreKeys: false, message: 'Chưa có API key nào' };
        }

        const fromKey = this.keys[this.currentIndex]?.key;

        for (let i = 1; i <= this.keys.length; i++) {
            const nextIndex = (this.currentIndex + i) % this.keys.length;
            const nextKey = this.keys[nextIndex];

            if (this.isKeyModelAvailable(nextKey.key, model)) {
                // Nếu chỉ có 1 key duy nhất và quay lại đúng key cũ khi đang lỗi → không tính là xoay thành công
                if (nextKey.key === fromKey && reason !== 'manual' && reason !== 'manual_retry') {
                    continue;
                }
                this.currentIndex = nextIndex;
                this.saveToStorage();

                if (this.onKeyRotation && fromKey && fromKey !== nextKey.key) {
                    this.onKeyRotation({
                        fromKey: this.maskKey(fromKey),
                        toKey: this.maskKey(nextKey.key),
                        reason,
                        provider: this.provider,
                    });
                }

                return {
                    success: true,
                    hasMoreKeys: true,
                    newKey: nextKey.key,
                    message: `Đã chuyển sang ${nextKey.name} (${this.maskKey(nextKey.key)})`
                };
            }
        }

        if (this.onAllKeysFailed) {
            this.onAllKeysFailed(this.provider);
        }

        return {
            success: false,
            hasMoreKeys: false,
            message: model
                ? `Tất cả API key đều đã tạm nghỉ trên model ${model}`
                : 'Tất cả API key đều không khả dụng'
        };
    }

    /**
     * Thời gian ngắn nhất (ms) cho tới khi có ít nhất 1 key hết cooldown (trả về 0 nếu đang có key sẵn sàng)
     */
    getSoonestCooldownMs(model?: string): number | null {
        this.checkAndResetCooldowns();
        const now = Date.now();
        let soonest = Infinity;

        for (const k of this.keys) {
            if (k.status === 'error') continue;
            if (this.isKeyModelAvailable(k.key, model)) return 0;

            const generalUntil = k.cooldownUntil && k.cooldownUntil > now ? k.cooldownUntil : 0;
            const modelUntil = model && k.modelCooldowns?.[model] && k.modelCooldowns[model] > now
                ? k.modelCooldowns[model]
                : 0;
            const effectiveUntil = Math.max(generalUntil, modelUntil);
            if (effectiveUntil > now && effectiveUntil < soonest) {
                soonest = effectiveUntil;
            }
        }

        return soonest === Infinity ? null : Math.max(0, soonest - now);
    }

    /**
     * Lấy danh sách model đang bị cooldown trên một key cụ thể (kèm thời gian còn lại theo ms)
     */
    getActiveModelCooldowns(key: string): Record<string, number> {
        this.checkAndResetCooldowns();
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo?.modelCooldowns) return {};
        const now = Date.now();
        const active: Record<string, number> = {};
        for (const [m, until] of Object.entries(keyInfo.modelCooldowns)) {
            if (until > now) active[m] = until - now;
        }
        return active;
    }

    getAllKeys(): ApiKeyInfo[] {
        this.checkAndResetCooldowns();
        return this.keys.map(k => ({
            ...k,
            modelCooldowns: k.modelCooldowns ? { ...k.modelCooldowns } : {},
        }));
    }

    getUserKeys(): ApiKeyInfo[] {
        return this.getAllKeys().filter(k => k.source !== 'env');
    }

    getHiddenEnvKeyCount(): number {
        return this.keys.filter(k => k.source === 'env').length;
    }

    getKeyStats(): KeyPoolStats {
        this.checkAndResetCooldowns();
        const now = Date.now();
        const partialCooldown = this.keys.filter(k => {
            if (k.status !== 'active') return false;
            return Object.values(k.modelCooldowns || {}).some(t => t > now);
        }).length;

        return {
            total: this.keys.length,
            active: this.keys.filter(k => k.status === 'active').length,
            error: this.keys.filter(k => k.status === 'error').length,
            cooldown: this.keys.filter(k => k.status === 'cooldown').length,
            userTotal: this.keys.filter(k => k.source !== 'env').length,
            envTotal: this.keys.filter(k => k.source === 'env').length,
            partialCooldown,
        };
    }

    resetKey(key: string): { success: boolean; message: string } {
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) {
            return { success: false, message: 'Không tìm thấy key' };
        }

        keyInfo.status = 'active';
        keyInfo.errorCount = 0;
        keyInfo.cooldownUntil = undefined;
        keyInfo.modelCooldowns = {};
        keyInfo.lastError = undefined;
        keyInfo.lastErrorModel = undefined;

        this.saveToStorage();
        return { success: true, message: 'Đã kích hoạt lại key' };
    }

    updateKeyName(key: string, newName: string): { success: boolean; message: string } {
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) {
            return { success: false, message: 'Không tìm thấy key' };
        }
        if (keyInfo.source === 'env') {
            return { success: false, message: 'Không thể đổi tên key hệ thống' };
        }

        keyInfo.name = newName.trim() || keyInfo.name;
        this.saveToStorage();
        return { success: true, message: 'Đã cập nhật tên key' };
    }

    maskKey(key: string): string {
        return maskGoogleAiApiKey(key);
    }

    hasAvailableKeys(model?: string): boolean {
        this.checkAndResetCooldowns();
        return this.keys.some(k => this.isKeyModelAvailable(k.key, model));
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    getMaxKeys(): number {
        return MAX_KEYS;
    }

    setActiveKey(keyOrIndex: string | number): { success: boolean; message: string } {
        let index: number;

        if (typeof keyOrIndex === 'number') {
            index = keyOrIndex;
        } else {
            const normalized = normalizeGoogleAiApiKey(keyOrIndex);
            index = this.keys.findIndex(k => k.key === normalized);
        }

        if (index < 0 || index >= this.keys.length) {
            return { success: false, message: 'Key không tồn tại' };
        }

        const keyInfo = this.keys[index];
        keyInfo.status = 'active';
        keyInfo.errorCount = 0;
        keyInfo.cooldownUntil = undefined;
        keyInfo.modelCooldowns = {};
        keyInfo.lastError = undefined;
        keyInfo.lastErrorModel = undefined;

        this.currentIndex = index;
        this.saveToStorage();
        console.log(`✅ Đã đặt ${keyInfo.name} (${this.maskKey(keyInfo.key)}) làm key ưu tiên`);
        return { success: true, message: `Đã chuyển sang ${keyInfo.name}` };
    }

    resetAllKeys(): { success: boolean; message: string } {
        let resetCount = 0;
        this.keys.forEach(keyInfo => {
            const hadCooldowns = keyInfo.modelCooldowns && Object.keys(keyInfo.modelCooldowns).length > 0;
            if (keyInfo.status !== 'active' || hadCooldowns) {
                keyInfo.status = 'active';
                keyInfo.errorCount = 0;
                keyInfo.cooldownUntil = undefined;
                keyInfo.modelCooldowns = {};
                keyInfo.lastError = undefined;
                keyInfo.lastErrorModel = undefined;
                resetCount++;
            }
        });

        this.saveToStorage();
        console.log(`🔄 Đã reset ${resetCount} key (${this.provider}) về trạng thái sẵn sàng`);
        return { success: true, message: `Đã làm mới ${resetCount} key` };
    }

    getNextAvailableKey(model?: string): string | null {
        this.checkAndResetCooldowns();
        for (let i = 1; i <= this.keys.length; i++) {
            const nextIndex = (this.currentIndex + i) % this.keys.length;
            const nextKey = this.keys[nextIndex];
            if (this.isKeyModelAvailable(nextKey.key, model)) {
                return nextKey.key;
            }
        }
        return null;
    }
}

/**
 * Facade định tuyến theo provider (mặc định 'gemini'), hỗ trợ đầy đủ API v5.0
 */
class ApiKeyManagerFacade {
    private managers: Record<AiProvider, ProviderKeyManager> = {
        'gemini': new ProviderKeyManager('gemini', PROVIDER_STORES.gemini),
        'agent-platform': new ProviderKeyManager('agent-platform', PROVIDER_STORES['agent-platform']),
    };

    private resolve(provider: AiProvider = 'gemini'): ProviderKeyManager {
        return this.managers[provider] || this.managers.gemini;
    }

    setOnKeyRotation(callback: KeyRotationCallback) {
        this.managers.gemini.setOnKeyRotation(callback);
        this.managers['agent-platform'].setOnKeyRotation(callback);
    }

    setOnAllKeysFailed(callback: AllKeysFailedCallback) {
        this.managers.gemini.setOnAllKeysFailed(callback);
        this.managers['agent-platform'].setOnAllKeysFailed(callback);
    }

    addKey(key: string, name?: string, provider: AiProvider = 'gemini') {
        return this.resolve(provider).addKey(key, name);
    }

    addKeysBulk(rawText: string, namePrefix = 'Key', provider: AiProvider = 'gemini'): BulkAddResult {
        return this.resolve(provider).addKeysBulk(rawText, namePrefix);
    }

    removeKey(key: string, provider: AiProvider = 'gemini') {
        return this.resolve(provider).removeKey(key);
    }

    clearAllUserKeys(provider: AiProvider = 'gemini'): void {
        this.resolve(provider).clearAllUserKeys();
    }

    isKeyModelAvailable(key: string, model?: string, provider: AiProvider = 'gemini'): boolean {
        return this.resolve(provider).isKeyModelAvailable(key, model);
    }

    getAvailableKeysForModel(model: string, preferredKey?: string, provider: AiProvider = 'gemini'): string[] {
        return this.resolve(provider).getAvailableKeysForModel(model, preferredKey);
    }

    getActiveKey(model?: string, provider: AiProvider = 'gemini'): string | null {
        return this.resolve(provider).getActiveKey(model);
    }

    markKeyModelQuotaError(
        key: string,
        model: string,
        errorType: 'QUOTA_EXCEEDED' | 'RATE_LIMIT',
        options?: { isPerMinute?: boolean; retryDelaySec?: number },
        provider: AiProvider = 'gemini'
    ): ApiKeyRotationResult {
        return this.resolve(provider).markKeyModelQuotaError(key, model, errorType, options);
    }

    markKeyError(key: string, errorType: string, model?: string, provider: AiProvider = 'gemini'): ApiKeyRotationResult {
        return this.resolve(provider).markKeyError(key, errorType, model);
    }

    rotateToNextKey(reason: string = 'manual', model?: string, provider: AiProvider = 'gemini'): ApiKeyRotationResult {
        return this.resolve(provider).rotateToNextKey(reason, model);
    }

    getSoonestCooldownMs(model?: string, provider: AiProvider = 'gemini'): number | null {
        return this.resolve(provider).getSoonestCooldownMs(model);
    }

    getActiveModelCooldowns(key: string, provider: AiProvider = 'gemini'): Record<string, number> {
        return this.resolve(provider).getActiveModelCooldowns(key);
    }

    getAllKeys(provider: AiProvider = 'gemini'): ApiKeyInfo[] {
        return this.resolve(provider).getAllKeys();
    }

    getUserKeys(provider: AiProvider = 'gemini'): ApiKeyInfo[] {
        return this.resolve(provider).getUserKeys();
    }

    getHiddenEnvKeyCount(provider: AiProvider = 'gemini'): number {
        return this.resolve(provider).getHiddenEnvKeyCount();
    }

    getEnvKeyCount(provider: AiProvider = 'gemini'): number {
        return this.getHiddenEnvKeyCount(provider);
    }

    getKeyStats(provider: AiProvider = 'gemini'): KeyPoolStats {
        return this.resolve(provider).getKeyStats();
    }

    resetKey(key: string, provider: AiProvider = 'gemini') {
        return this.resolve(provider).resetKey(key);
    }

    updateKeyName(key: string, newName: string, provider: AiProvider = 'gemini') {
        return this.resolve(provider).updateKeyName(key, newName);
    }

    maskKey(key: string): string {
        return maskGoogleAiApiKey(key);
    }

    hasAvailableKeys(model?: string, provider: AiProvider = 'gemini'): boolean {
        return this.resolve(provider).hasAvailableKeys(model);
    }

    getCurrentIndex(provider: AiProvider = 'gemini'): number {
        return this.resolve(provider).getCurrentIndex();
    }

    getMaxKeys(): number {
        return MAX_KEYS;
    }

    setActiveKey(keyOrIndex: string | number, provider: AiProvider = 'gemini') {
        return this.resolve(provider).setActiveKey(keyOrIndex);
    }

    resetAllKeys(provider: AiProvider = 'gemini') {
        return this.resolve(provider).resetAllKeys();
    }

    getNextAvailableKey(model?: string, provider: AiProvider = 'gemini'): string | null {
        return this.resolve(provider).getNextAvailableKey(model);
    }
}

export const apiKeyManager = new ApiKeyManagerFacade();
