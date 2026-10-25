/**
 * API Key Manager - Quản lý nhiều API key với cơ chế xoay vòng
 *
 * Nguyên tắc bắt buộc (xem api.md mục VII.4):
 * - Gemini API và Agent Platform API có vùng lưu trữ hoàn toàn tách biệt,
 *   mọi hàm public đều nhận `provider` để không ghi nhầm danh sách.
 * - Key lấy từ biến môi trường (.env) CHỈ giữ trong bộ nhớ (source: 'env'),
 *   KHÔNG BAO GIỜ ghi xuống localStorage — tránh lộ vĩnh viễn key của chủ app
 *   trong trình duyệt của người dùng.
 */
import { isValidGoogleAiApiKey, maskGoogleAiApiKey, parseGoogleAiApiKeys } from './googleAiApiKey';
import type { AiProvider } from '../types';

// Trạng thái của một API key
export type ApiKeyStatus = 'active' | 'error' | 'cooldown';

// Nguồn gốc của key: do người dùng tự nhập hay lấy từ biến môi trường .env
export type ApiKeySource = 'user' | 'env';

// Thông tin một API key
export interface ApiKeyInfo {
    key: string;
    name: string;
    status: ApiKeyStatus;
    lastError?: string;
    errorCount: number;
    cooldownUntil?: number; // Timestamp khi hết cooldown
    addedAt: number;
    source: ApiKeySource; // 'env' = key hệ thống, không bao giờ ghi xuống localStorage
}

// Kết quả khi xoay key
export interface ApiKeyRotationResult {
    success: boolean;
    hasMoreKeys: boolean;
    newKey?: string;
    message: string;
}

// Callback khi có sự kiện
export type KeyRotationCallback = (info: { fromKey: string; toKey: string; reason: string; provider: AiProvider }) => void;
export type AllKeysFailedCallback = (provider: AiProvider) => void;

const QUOTA_COOLDOWN_DURATION = 10 * 60 * 1000; // 10 phút cooldown cho lỗi quota
const RATE_LIMIT_COOLDOWN_DURATION = 60 * 1000; // 60 giây cooldown cho lỗi rate limit
const MAX_USER_KEYS = 16; // Giới hạn số key NGƯỜI DÙNG tự nhập (không tính key env)

interface ProviderStore {
    storageKey: string;       // localStorage key cho danh sách key người dùng
    legacySingleKey: string;  // localStorage key cho "key đang dùng gần nhất" (tương thích ngược)
    envVar: string;           // Tên biến môi trường .env chứa key hệ thống, cách nhau bằng dấu phẩy
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

// Đọc danh sách key hệ thống từ .env theo từng provider (chỉ đọc 1 lần khi module load)
const readEnvKeys = (envVar: string): { key: string; name: string }[] => {
    const raw = (import.meta as any).env?.[envVar] || '';
    return parseGoogleAiApiKeys(raw).map((k: string, i: number) => ({ key: k, name: `Key hệ thống ${i + 1}` }));
};

const ENV_KEYS_BY_PROVIDER: Record<AiProvider, { key: string; name: string }[]> = {
    'gemini': readEnvKeys(PROVIDER_STORES.gemini.envVar),
    'agent-platform': readEnvKeys(PROVIDER_STORES['agent-platform'].envVar),
};

/**
 * Quản lý key cho MỘT provider (Gemini hoặc Agent Platform).
 * Key `source: 'env'` luôn được nạp lại từ bộ nhớ khi khởi tạo và KHÔNG được persist.
 */
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

    /** Load danh sách key NGƯỜI DÙNG từ localStorage, sau đó nạp key env vào đầu danh sách (chỉ trong memory). */
    loadFromStorage(): void {
        try {
            const stored = localStorage.getItem(this.store.storageKey);
            let userKeys: ApiKeyInfo[] = [];
            if (stored) {
                const data = JSON.parse(stored);
                userKeys = (data.keys || [])
                    // Dọn mọi bản sao key 'env' từng bị ghi nhầm vào localStorage ở bản cũ
                    .filter((k: ApiKeyInfo) => k.source !== 'env')
                    .map((k: ApiKeyInfo) => ({ ...k, source: 'user' as ApiKeySource }));
                this.currentIndex = data.currentIndex || 0;
            }

            // Migration: key đơn lưu theo format cũ (nếu chưa có trong danh sách)
            const oldKey = localStorage.getItem(this.store.legacySingleKey);
            if (oldKey && isValidGoogleAiApiKey(oldKey) && !userKeys.some(k => k.key === oldKey)) {
                userKeys.push({
                    key: oldKey.trim(),
                    name: 'Key đã lưu',
                    status: 'active',
                    errorCount: 0,
                    addedAt: Date.now(),
                    source: 'user',
                });
            }

            this.keys = userKeys;
            this.checkAndResetCooldowns();
        } catch (e) {
            console.error(`Lỗi load API keys (${this.provider}):`, e);
            this.keys = [];
            this.currentIndex = 0;
        }

        // Key hệ thống (.env): luôn nạp lại vào ĐẦU danh sách trong memory, không persist.
        this.injectEnvKeys();
    }

    /** Nạp key .env vào đầu danh sách trong memory (idempotent, không ghi localStorage). */
    private injectEnvKeys(): void {
        const envKeys = ENV_KEYS_BY_PROVIDER[this.provider] || [];
        if (envKeys.length === 0) return;

        // Loại bỏ mọi bản ghi env cũ còn sót lại trong memory trước khi nạp lại
        this.keys = this.keys.filter(k => k.source !== 'env');

        const envKeyInfos: ApiKeyInfo[] = envKeys.map(e => ({
            key: e.key,
            name: e.name,
            status: 'active',
            errorCount: 0,
            addedAt: Date.now(),
            source: 'env',
        }));

        this.keys = [...envKeyInfos, ...this.keys];
    }

    /** Lưu DUY NHẤT key người dùng (source: 'user') vào localStorage. Key env không bao giờ được persist. */
    saveToStorage(): void {
        try {
            const userKeys = this.keys.filter(k => k.source !== 'env');
            const data = { keys: userKeys, currentIndex: this.currentIndex };
            localStorage.setItem(this.store.storageKey, JSON.stringify(data));

            // Cập nhật key "đang dùng" để tương thích ngược — CHỈ khi đó là key người dùng.
            const activeKey = this.keys[this.currentIndex];
            if (activeKey && activeKey.source !== 'env') {
                localStorage.setItem(this.store.legacySingleKey, activeKey.key);
            } else {
                localStorage.removeItem(this.store.legacySingleKey);
            }
        } catch (e) {
            console.error(`Lỗi lưu API keys (${this.provider}):`, e);
        }
    }

    private checkAndResetCooldowns(): void {
        const now = Date.now();
        let hasChanges = false;

        this.keys.forEach(keyInfo => {
            if (keyInfo.status === 'cooldown' && keyInfo.cooldownUntil && keyInfo.cooldownUntil <= now) {
                keyInfo.status = 'active';
                keyInfo.errorCount = 0;
                keyInfo.cooldownUntil = undefined;
                hasChanges = true;
            }
        });

        if (hasChanges) this.saveToStorage();
    }

    addKey(key: string, name?: string): { success: boolean; message: string } {
        const userKeyCount = this.keys.filter(k => k.source !== 'env').length;
        if (userKeyCount >= MAX_USER_KEYS) {
            return { success: false, message: `Đã đạt giới hạn ${MAX_USER_KEYS} key` };
        }

        const trimmedKey = key.trim();
        if (this.keys.some(k => k.key === trimmedKey)) {
            return { success: false, message: 'Key này đã tồn tại' };
        }

        if (!isValidGoogleAiApiKey(trimmedKey)) {
            return { success: false, message: 'Key không hợp lệ. Key phải bắt đầu bằng AIzaSy... hoặc AQ...' };
        }

        const newKey: ApiKeyInfo = {
            key: trimmedKey,
            name: name?.trim() || `Key ${userKeyCount + 1}`,
            status: 'active',
            errorCount: 0,
            addedAt: Date.now(),
            source: 'user',
        };

        this.keys.push(newKey);
        this.saveToStorage();

        return { success: true, message: 'Đã thêm key thành công' };
    }

    removeKey(key: string): { success: boolean; message: string } {
        const index = this.keys.findIndex(k => k.key === key);
        if (index === -1) {
            return { success: false, message: 'Không tìm thấy key' };
        }
        if (this.keys[index].source === 'env') {
            return { success: false, message: 'Không thể xóa key hệ thống (.env)' };
        }

        this.keys.splice(index, 1);

        // Chỉnh lại currentIndex cho đúng với danh sách mới, tránh out-of-range hoặc trỏ sai key
        if (this.keys.length === 0) {
            this.currentIndex = 0;
        } else if (this.currentIndex >= index) {
            this.currentIndex = Math.max(0, Math.min(this.currentIndex - 1, this.keys.length - 1));
        } else {
            this.currentIndex = Math.min(this.currentIndex, this.keys.length - 1);
        }

        this.saveToStorage();
        return { success: true, message: 'Đã xóa key' };
    }

    getActiveKey(): string | null {
        this.checkAndResetCooldowns();
        if (this.keys.length === 0) return null;

        for (let i = 0; i < this.keys.length; i++) {
            const idx = (this.currentIndex + i) % this.keys.length;
            const keyInfo = this.keys[idx];
            if (keyInfo.status === 'active') {
                this.currentIndex = idx;
                return keyInfo.key;
            }
        }
        return null;
    }

    markKeyError(key: string, errorType: string): ApiKeyRotationResult {
        const keyInfo = this.keys.find(k => k.key === key);
        if (!keyInfo) {
            return { success: false, hasMoreKeys: false, message: 'Không tìm thấy key' };
        }

        // Lỗi tạm thời (quá tải model / mạng / model không tồn tại): KHÔNG đụng vào trạng thái key.
        if (
            errorType === 'MODEL_OVERLOADED' ||
            errorType === 'TRANSIENT_SERVER_ERROR' ||
            errorType === 'NETWORK_ERROR' ||
            errorType === 'MODEL_NOT_FOUND'
        ) {
            keyInfo.lastError = errorType;
            this.saveToStorage();
            return {
                success: false,
                hasMoreKeys: this.hasAvailableKeys(),
                message: 'Model Gemini đang quá tải tạm thời; API key vẫn được giữ hoạt động.'
            };
        }

        keyInfo.lastError = errorType;
        keyInfo.errorCount++;

        if (errorType === 'QUOTA_EXCEEDED' || errorType === 'RATE_LIMIT') {
            const duration = errorType === 'RATE_LIMIT' ? RATE_LIMIT_COOLDOWN_DURATION : QUOTA_COOLDOWN_DURATION;
            keyInfo.status = 'cooldown';
            keyInfo.cooldownUntil = Date.now() + duration;
            console.log(`⏸️ Key ${this.maskKey(key)} (${this.provider}) đã được đưa vào cooldown ${duration / 1000}s do ${errorType}`);
        } else if (errorType === 'INVALID_API_KEY' || errorType === 'PERMISSION_DENIED') {
            keyInfo.status = 'error';
            console.log(`❌ Key ${this.maskKey(key)} (${this.provider}) lỗi ${errorType}, đã đánh dấu error`);
        } else {
            this.saveToStorage();
            return {
                success: false,
                hasMoreKeys: this.hasAvailableKeys(),
                message: 'API key vẫn được giữ hoạt động.'
            };
        }

        this.saveToStorage();
        return this.rotateToNextKey(errorType);
    }

    rotateToNextKey(reason: string = 'manual'): ApiKeyRotationResult {
        this.checkAndResetCooldowns();
        if (this.keys.length === 0) {
            return { success: false, hasMoreKeys: false, message: 'Chưa có API key nào' };
        }

        const fromKey = this.keys[this.currentIndex]?.key;

        for (let i = 1; i <= this.keys.length; i++) {
            const nextIndex = (this.currentIndex + i) % this.keys.length;
            const nextKey = this.keys[nextIndex];

            if (nextKey.status === 'active') {
                this.currentIndex = nextIndex;
                this.saveToStorage();

                if (this.onKeyRotation && fromKey) {
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
                    message: `Đã chuyển sang key: ${nextKey.name}`
                };
            }
        }

        if (this.onAllKeysFailed) this.onAllKeysFailed(this.provider);

        return {
            success: false,
            hasMoreKeys: false,
            message: 'Tất cả API key đều không khả dụng'
        };
    }

    /** Trả về danh sách key hiển thị cho UI. Key env chỉ lộ số lượng, KHÔNG lộ giá trị (kể cả dạng che). */
    getAllKeys(): ApiKeyInfo[] {
        this.checkAndResetCooldowns();
        return this.keys.filter(k => k.source !== 'env').map(k => ({ ...k }));
    }

    /** Số lượng key hệ thống (.env) đang hoạt động — không bao giờ lộ giá trị key. */
    getEnvKeyCount(): number {
        return this.keys.filter(k => k.source === 'env').length;
    }

    getKeyStats(): { total: number; active: number; error: number; cooldown: number } {
        this.checkAndResetCooldowns();
        const userKeys = this.keys.filter(k => k.source !== 'env');
        return {
            total: userKeys.length,
            active: userKeys.filter(k => k.status === 'active').length,
            error: userKeys.filter(k => k.status === 'error').length,
            cooldown: userKeys.filter(k => k.status === 'cooldown').length
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
        keyInfo.lastError = undefined;
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

    hasAvailableKeys(): boolean {
        this.checkAndResetCooldowns();
        return this.keys.some(k => k.status === 'active');
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    /** Đặt key cụ thể làm active. CHỈ xác nhận lại (active) nếu key thực sự hết cooldown/lỗi; không "ép" key invalid thành active mà không xác minh. */
    setActiveKey(keyOrIndex: string | number): { success: boolean; message: string } {
        let index: number;
        if (typeof keyOrIndex === 'number') {
            index = keyOrIndex;
        } else {
            index = this.keys.findIndex(k => k.key === keyOrIndex);
        }

        if (index < 0 || index >= this.keys.length) {
            return { success: false, message: 'Key không tồn tại' };
        }

        const keyInfo = this.keys[index];
        this.checkAndResetCooldowns();

        if (keyInfo.status === 'error') {
            // Key đã bị đánh dấu lỗi xác thực/quyền — người dùng phải bấm "Reset" rõ ràng
            // (resetKey) để xác nhận đã thay key thật, tránh tự động hồi sinh key chết.
            return { success: false, message: 'Key này đang ở trạng thái lỗi. Hãy kích hoạt lại thủ công nếu bạn chắc chắn key đã hợp lệ.' };
        }

        this.currentIndex = index;
        this.saveToStorage();
        console.log(`✅ Đã đặt key ${keyInfo.name} (${this.maskKey(keyInfo.key)}) làm active (${this.provider})`);
        return { success: true, message: `Đã chuyển sang key: ${keyInfo.name}` };
    }

    resetAllKeys(): { success: boolean; message: string } {
        let resetCount = 0;
        this.keys.forEach(keyInfo => {
            if (keyInfo.status !== 'active') {
                keyInfo.status = 'active';
                keyInfo.errorCount = 0;
                keyInfo.cooldownUntil = undefined;
                keyInfo.lastError = undefined;
                resetCount++;
            }
        });
        this.saveToStorage();
        console.log(`🔄 Đã reset ${resetCount} key (${this.provider}) về trạng thái active`);
        return { success: true, message: `Đã reset ${resetCount} key` };
    }

    getNextAvailableKey(): string | null {
        this.checkAndResetCooldowns();
        for (let i = 1; i <= this.keys.length; i++) {
            const nextIndex = (this.currentIndex + i) % this.keys.length;
            const nextKey = this.keys[nextIndex];
            if (nextKey.status === 'active') return nextKey.key;
        }
        return null;
    }
}

/**
 * Facade giữ API công khai tương thích với code hiện tại (App.tsx, components),
 * nhưng định tuyến tới đúng ProviderKeyManager theo tham số `provider`.
 * Mặc định `provider = 'gemini'` khi không truyền, để không phá vỡ các lời gọi cũ.
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

    removeKey(key: string, provider: AiProvider = 'gemini') {
        return this.resolve(provider).removeKey(key);
    }

    getActiveKey(provider: AiProvider = 'gemini'): string | null {
        return this.resolve(provider).getActiveKey();
    }

    markKeyError(key: string, errorType: string, provider: AiProvider = 'gemini'): ApiKeyRotationResult {
        return this.resolve(provider).markKeyError(key, errorType);
    }

    rotateToNextKey(reason: string = 'manual', provider: AiProvider = 'gemini'): ApiKeyRotationResult {
        return this.resolve(provider).rotateToNextKey(reason);
    }

    getAllKeys(provider: AiProvider = 'gemini'): ApiKeyInfo[] {
        return this.resolve(provider).getAllKeys();
    }

    getEnvKeyCount(provider: AiProvider = 'gemini'): number {
        return this.resolve(provider).getEnvKeyCount();
    }

    getKeyStats(provider: AiProvider = 'gemini') {
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

    hasAvailableKeys(provider: AiProvider = 'gemini'): boolean {
        return this.resolve(provider).hasAvailableKeys();
    }

    getCurrentIndex(provider: AiProvider = 'gemini'): number {
        return this.resolve(provider).getCurrentIndex();
    }

    setActiveKey(keyOrIndex: string | number, provider: AiProvider = 'gemini') {
        return this.resolve(provider).setActiveKey(keyOrIndex);
    }

    resetAllKeys(provider: AiProvider = 'gemini') {
        return this.resolve(provider).resetAllKeys();
    }

    getNextAvailableKey(provider: AiProvider = 'gemini'): string | null {
        return this.resolve(provider).getNextAvailableKey();
    }
}

// Export singleton instance
export const apiKeyManager = new ApiKeyManagerFacade();
