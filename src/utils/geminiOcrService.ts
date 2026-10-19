import { getAppConfig } from './configStorage';
import type { ExpenseCategory, PaymentMethod } from '../db';

export interface GeminiReceiptItem {
  name: string;
  price: number;
}

export interface GeminiReceiptResult {
  date: string;          // YYYY-MM-DD
  shopName: string;      // 店名・料金所名
  items: GeminiReceiptItem[]; // 品目・内訳リスト
  totalAmount: number;   // 合計金額
  category?: string;     // 推定カテゴリ
  paymentMethod?: string;// 推定支払方法
  invoiceNumber?: string;// インボイス番号
  rawJson?: string;      // 生のJSON文字列
}

/**
 * AI推定カテゴリ文字列をアプリの ExpenseCategory 型へ厳格にマッピング
 */
export function mapAiCategoryToExpenseCategory(aiCategoryStr?: string): ExpenseCategory {
  if (!aiCategoryStr) return 'other';
  const s = aiCategoryStr.toLowerCase().trim();
  if (s.includes('昼食') || s.includes('ランチ') || s.includes('lunch') || s.includes('弁当')) return 'lunch';
  if (s.includes('朝食') || s.includes('モーニング') || s.includes('breakfast')) return 'breakfast';
  if (s.includes('夜食') || s.includes('ディナー') || s.includes('夕食') || s.includes('dinner') || s.includes('night')) return 'night_meal';
  if (s.includes('お茶') || s.includes('飲料') || s.includes('カフェ') || s.includes('珈琲') || s.includes('コーヒー') || s.includes('tea')) return 'tea';
  if (s.includes('ミネラルウォーター') || s.includes('水') || s.includes('ウォーター') || s.includes('天然水') || s.includes('water')) return 'water';
  if (s.includes('残業') || s.includes('超過勤務') || s.includes('時間外') || s.includes('overtime')) return 'overtime';
  if (s.includes('etc') || s.includes('高速')) return 'etc';
  if (s.includes('駐車') || s.includes('parking') || s.includes('パーキング')) return 'parking';
  if (s.includes('燃料') || s.includes('給油') || s.includes('ガソリン') || s.includes('軽油') || s.includes('fuel')) return 'fuel';
  if (s.includes('有料道路') || s.includes('有料道') || s.includes('toll')) return 'toll';
  if (s.includes('タクシー') || s.includes('taxi')) return 'taxi';
  if (s.includes('宿泊') || s.includes('ホテル') || s.includes('lodging') || s.includes('hotel')) return 'lodging';
  return 'other';
}

/**
 * AI推定支払方法文字列を PaymentMethod 型へ厳格にマッピング
 */
export function mapAiPaymentMethodToPaymentMethod(aiPaymentStr?: string, category?: ExpenseCategory): PaymentMethod {
  if (category === 'etc') return 'company_etc';
  if (category === 'fuel') return 'company_fuel';
  if (!aiPaymentStr) return 'advance';
  const s = aiPaymentStr.toLowerCase().trim();
  if (s.includes('etc')) return 'company_etc';
  if (s.includes('燃料') || s.includes('ガソリン')) return 'company_fuel';
  if (s.includes('会社カード') || s.includes('法人カード') || s.includes('クレジット')) return 'company_card';
  if (s.includes('自腹') || s.includes('個人立替') || s.includes('立替')) return 'cash';
  // バス運行経費の現金・レシート支払いは、基本的に前渡金（前払い金）からの支払い
  return 'advance';
}

/**
 * Data URL (base64) から純粋な MIMEタイプ と Base64文字列 を抽出
 */
export function extractMimeAndBase64(dataUrl: string): { mimeType: string; base64Data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      base64Data: match[2]
    };
  }
  return {
    mimeType: 'image/jpeg',
    base64Data: dataUrl
  };
}

/**
 * File オブジェクトを Base64 Data URL に変換
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('ファイルの読み込みに失敗しました'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('ファイル読み込みエラー'));
    reader.readAsDataURL(file);
  });
}

/**
 * 画像サイズを適切にリサイズ・軽量化する（API送信高速化）
 */
export async function optimizeImageForGemini(dataUrl: string, maxDimension = 1600): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const compressedUrl = canvas.toDataURL('image/jpeg', 0.88);
      resolve(compressedUrl);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Gemini Flash モデルを活用した運行経費レシートOCR解析API呼び出し
 */
export async function analyzeReceiptWithGemini(
  imageDataUrl: string,
  customApiKey?: string
): Promise<GeminiReceiptResult> {
  // 1. APIキーの解決
  const config = getAppConfig();
  const apiKey = (customApiKey || config?.geminiApiKey || '').trim();

  if (!apiKey) {
    throw new Error(
      'Gemini APIキーが設定されていません。Google AI Studio のAPIキー（AQ... または AIzaSy...）を登録してください。'
    );
  }

  // 2. 画像の最適化とBase64抽出
  const optimizedDataUrl = await optimizeImageForGemini(imageDataUrl);
  const { mimeType, base64Data } = extractMimeAndBase64(optimizedDataUrl);

  // 3. プロンプト定義
  const prompt = `あなたはバス乗務員・運行経費（ETC利用証明書、有料道路、駐車場、ガソリン燃料、タクシー、宿泊、その他経費）の高精度OCR解析エンジンです。
添付されたレシート・利用証明書画像から情報を正確に読み取り、必ず指定されたJSON形式で返却してください。

【抽出項目】
1. date: 利用日・購入日。必ず "YYYY-MM-DD" 形式（例: "2026-10-09"）。レシート内に年がない場合は今年（2026年）を補完。不明なら今日の日付。
2. shopName: 店舗名・料金所名・事業者名（例: "東名高速 東京料金所", "タイムズ駐車場 新宿", "出光セルフ ガソリンスタンド"）。
3. items: 品目・内訳リストの配列。各要素は { "name": "品目・区間名", "price": 単価または利用額(数値) }。
4. totalAmount: 合計金額・支払総額（カンマ無しの半角数値）。小計ではなく支払い合計額。
5. category: 適切な経費カテゴリ（"ETC" | "駐車場" | "燃料" | "有料道路" | "朝食代" | "昼食代" | "夜食代" | "お茶代" | "ミネラルウォーター" | "残業代" | "タクシー" | "宿泊" | "その他" のいずれか。飲食・コンビニ等で朝食なら"朝食代"、昼食なら"昼食代"、夜なら"夜食代"、お茶やコーヒーなら"お茶代"、水・天然水なら"ミネラルウォーター"、残業・時間外手当なら"残業代"）。
6. paymentMethod: 支払方法（"前払い金" | "現金" | "会社ETC" | "会社カード" | "燃料カード" | "その他"）。
7. invoiceNumber: インボイス登録番号（"T" + 13桁の数字。例: "T1234567890123"）。記載がない場合は空文字 ""。

【出力仕様】
- Markdownの修飾コードブロック（\`\`\`json 等）を含めず、純粋なJSON文字列として出力してください。
- 金額はすべて半角数値（Number）にしてください。`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Data
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      temperature: 0.1
    }
  };

  // 4. APIキーで使用可能なモデル候補（動的検出 + 静的フォールバック）
  let candidateModels = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash-latest'
  ];

  try {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    if (listRes.ok) {
      const listData = await listRes.json();
      const models = Array.isArray(listData?.models) ? listData.models : [];
      const supportedFlashModels = models
        .filter((m: any) =>
          Array.isArray(m?.supportedGenerationMethods) &&
          m.supportedGenerationMethods.includes('generateContent') &&
          typeof m?.name === 'string' &&
          m.name.includes('flash')
        )
        .map((m: any) => m.name.replace(/^models\//, ''));

      if (supportedFlashModels.length > 0) {
        candidateModels = [...new Set([...supportedFlashModels, ...candidateModels])];
      }
    }
  } catch (err) {
    console.warn('利用可能モデルの事前取得に失敗（静的候補で続行）:', err);
  }

  let lastError = '';
  let responseJson: any = null;

  for (const modelName of candidateModels) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok) {
        responseJson = await response.json();
        break; // 成功したためループを抜ける
      }

      let errorDetail = '';
      try {
        const errJson = await response.json();
        errorDetail = errJson?.error?.message || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      lastError = errorDetail;

      // 404 (Model not found) の場合は次のモデル候補を試行
      if (response.status === 404) {
        console.warn(`モデル ${modelName} が404のため次の候補を試行します:`, errorDetail);
        continue;
      }

      if (response.status === 400 && errorDetail.includes('API_KEY_INVALID')) {
        throw new Error(
          'APIキーが無効です。Google AI Studio (https://aistudio.google.com/app/apikey) で取得したキーを入力してください。'
        );
      }

      throw new Error(`Gemini API エラー (${response.status}): ${errorDetail}`);
    } catch (e: any) {
      if (e.message && e.message.includes('APIキーが無効')) {
        throw e;
      }
      lastError = e?.message || String(e);
    }
  }

  if (!responseJson) {
    throw new Error(
      `Gemini API の呼び出しに失敗しました。最新のキーまたはモデルをご確認ください。（エラー詳細: ${lastError}）`
    );
  }

  const textContent = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textContent) {
    throw new Error('Gemini API からの応答が空でした。再度撮影してお試しください。');
  }

  // 5. JSONパースとクリーンアップ
  let cleanedText = textContent.trim();
  if (cleanedText.startsWith('```')) {
    cleanedText = cleanedText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }

  let parsed: any;
  try {
    parsed = JSON.parse(cleanedText);
  } catch (parseErr) {
    console.error('JSON パース失敗:', cleanedText, parseErr);
    throw new Error('Geminiの出力データをJSONとして解析できませんでした。');
  }

  // 6. データの正規化
  const today = new Date().toISOString().split('T')[0];
  const normalizedResult: GeminiReceiptResult = {
    date: typeof parsed.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : today,
    shopName: typeof parsed.shopName === 'string' && parsed.shopName.trim() ? parsed.shopName.trim() : '運行経費',
    items: Array.isArray(parsed.items)
      ? parsed.items.map((it: any) => ({
          name: String(it?.name || '利用明細').trim(),
          price: Number(it?.price) || 0
        }))
      : [],
    totalAmount: Number(parsed.totalAmount) || 0,
    category: parsed.category || 'その他',
    paymentMethod: parsed.paymentMethod || '現金',
    invoiceNumber: typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber.trim() : '',
    rawJson: JSON.stringify(parsed, null, 2)
  };

  if (normalizedResult.totalAmount === 0 && normalizedResult.items.length > 0) {
    normalizedResult.totalAmount = normalizedResult.items.reduce((s, it) => s + it.price, 0);
  }

  return normalizedResult;
}
