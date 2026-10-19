export interface HouseholdAppConfig {
  name: string;          // 氏名
  birthdate: string;     // 生年月日 (YYYY-MM-DD)
  userId: string;        // ユーザーID (半角英数字)
  password: string;      // パスワード
  geminiApiKey: string;  // Gemini APIキー (AIzaSy...)
  updatedAt?: number;
}

export const STORAGE_KEY_CONFIG = 'household_app_config';

/**
 * localStorage から設定データを取得（サーバーを介さず完結）
 */
export function getAppConfig(): HouseholdAppConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONFIG);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        name: typeof parsed.name === 'string' ? parsed.name : '',
        birthdate: typeof parsed.birthdate === 'string' ? parsed.birthdate : '',
        userId: typeof parsed.userId === 'string' ? parsed.userId : '',
        password: typeof parsed.password === 'string' ? parsed.password : '',
        geminiApiKey: typeof parsed.geminiApiKey === 'string' ? parsed.geminiApiKey : '',
        updatedAt: parsed.updatedAt || Date.now()
      };
    }
  } catch (err) {
    console.error('household_app_config の取得に失敗しました:', err);
  }
  return null;
}

/**
 * localStorage に設定データを保存
 */
export function saveAppConfig(config: HouseholdAppConfig): void {
  try {
    const dataToSave: HouseholdAppConfig = {
      ...config,
      updatedAt: Date.now()
    };
    localStorage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(dataToSave));
  } catch (err) {
    console.error('household_app_config の保存に失敗しました:', err);
  }
}

/**
 * 設定データが存在し、初期設定が完了しているかを判定
 */
export function isAppConfigured(): boolean {
  const config = getAppConfig();
  if (!config) return false;
  // 氏名とユーザーIDが入力されていれば設定完了とみなす
  return Boolean(config.name.trim() && config.userId.trim());
}

/**
 * 設定データを削除（リセット用）
 */
export function clearAppConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY_CONFIG);
  } catch (err) {
    console.error('household_app_config の削除に失敗しました:', err);
  }
}
