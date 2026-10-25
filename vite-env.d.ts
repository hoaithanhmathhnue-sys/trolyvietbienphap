/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_GEMINI_API_KEYS: string;
    readonly VITE_AGENT_PLATFORM_API_KEYS?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
