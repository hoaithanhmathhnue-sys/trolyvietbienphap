export const GOOGLE_AI_API_KEY_PATTERN = /^(?:AIzaSy|AQ)\S{8,}$/;

export const isValidGoogleAiApiKey = (key: string): boolean => {
  return GOOGLE_AI_API_KEY_PATTERN.test(key.trim());
};

export const parseGoogleAiApiKeys = (rawKeys: string = ''): string[] => {
  return rawKeys
    .split(',')
    .map((key) => key.trim())
    .filter(isValidGoogleAiApiKey);
};

export const maskGoogleAiApiKey = (key: string): string => {
  const trimmedKey = key.trim();
  if (!trimmedKey || trimmedKey.length < 8) return '***';

  const prefix = trimmedKey.startsWith('AIzaSy')
    ? 'AIzaSy'
    : trimmedKey.startsWith('AQ')
      ? 'AQ'
      : trimmedKey.slice(0, 4);

  return `${prefix}...${trimmedKey.slice(-4)}`;
};
