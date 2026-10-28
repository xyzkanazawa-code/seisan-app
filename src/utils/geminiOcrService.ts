import { getAppConfig } from './configStorage';
import type { ExpenseCategory, PaymentMethod } from '../db';

export interface GeminiReceiptItem {
  name: string;
  price: number;
}

export interface GeminiReceiptResult {
  date: string;          // YYYY-MM-DD
  time?: string;         // 利用時刻 (HH:mm)
  shopName: string;      // 店名・料金所名
  items: GeminiReceiptItem[]; // 品目・内訳リスト
  totalAmount: number;   // 合計金額
  category?: string;     // 推定カテゴリ
  paymentMethod?: string;// 推定支払方法
  invoiceNumber?: string;// インボイス番号
  entryGate?: string;    // ETC入口
  exitGate?: string;     // ETC出口
  etcType?: 'jissha' | 'kaiso'; // 実車または回送の推定（記載があれば）
  etcPaidByGuide?: boolean;     // ガイド預り金から引くかどうか（ユーザー選択保持用）
  memo?: string;                // 手入力メモ（ユーザー編集保持用）
  splitBox?: { topPct: number; bottomPct: number }; // 縦方向の比率
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
 * （縦に連続したETC利用明細や複数レシートを自動分離して配列で返却）
 */
export async function analyzeReceiptsWithGemini(
  imageDataUrl: string,
  customApiKey?: string
): Promise<GeminiReceiptResult[]> {
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

  // 3. プロンプト定義（縦連続ETC明細の完全分離指示）
  const prompt = `あなたはバス乗務員・運行経費（ETC利用証明書、有料道路、駐車場、ガソリン燃料、タクシー、宿泊、その他経費）の高精度OCR解析エンジンです。
添付された画像から情報を正確に読み取り、必ず指定されたJSON形式で返却してください。

【超重要指示：縦に連続したETC利用明細・複数レシートの分離と金額計算】
- ETC利用証明書・利用明細書は、1本の細長い紙に複数の利用区間・走行明細（複数の「御利用書」「ETC利用証明書」「利用明細」「通行料金」「料金所」）が縦に連続して印字されていることが多々あります。
- ただし、**1つの走行区間（1枚のETC利用証明書）の中に記載されている「通常料金」「ETC割引」「休日割引」「深夜割引」「平日朝夕割引」「内消費税」などを別々のレシートに分割してはいけません！** それらは1回の走行の内訳であり、最終的に支払った通行料金（割引適用後の金額1つだけ）を \`totalAmount\` としてください。
- もしレシートの下部に「合計 N件 〇〇円」のような総合計行が印字されていても、各区間明細を個別に出力した場合は、**その総合計行をもう1件のレシートとして出力しないでください（二重計上になります）！**
- 複数枚の別々の領収書・レシート、または明確に別の走行区間（入口IC→出口ICが異なる複数区間）が写っている場合のみ、1区間・1枚ごとに分離したレシート配列として出力してください。
- レシートが1枚（1区間）だけの場合でも、配列 "receipts": [ ... ] の形式で出力してください。

【各レシートの抽出項目】
1. date: 利用日・購入日。必ず "YYYY-MM-DD" 形式（例: "2026-10-09"）。年がない場合は今年（2026年）を補完。
2. time: 利用時刻・購入時刻。必ず "HH:mm" 形式（例: "12:34", "08:15"）。レシートに時刻の印字があれば抽出。なければ空文字。
3. shopName: 店舗名・料金所名・区間名（ETCの場合は "ETC: 東京 → 厚木IC" のように区間がわかる名称にしてください）。
4. entryGate: ETCの場合の入口料金所名（例: "東京", "厚木"）。不明なら空文字。
5. exitGate: ETCの場合の出口料金所名（例: "沼津", "小田原"）。不明なら空文字。
6. items: 内訳リスト [{ "name": "品目名または区間名", "price": 数値 }]。
7. totalAmount: その区間・レシートの支払金額（半角数値）。
8. category: 経費カテゴリ（"ETC" | "駐車場" | "燃料" | "有料道路" | "朝食代" | "昼食代" | "夜食代" | "お茶代" | "ミネラルウォーター" | "残業代" | "タクシー" | "宿泊" | "その他"）。
9. paymentMethod: 支払方法（"会社ETC" | "前払い金" | "現金" | "会社カード" | "燃料カード" | "その他"）。ETCの場合は "会社ETC"。
10. invoiceNumber: インボイス登録番号（"T" + 13桁の数字）。なければ空文字。
11. splitBox: 縦に連続したレシートの場合、その区間が画像全体の縦方向のどの位置にあるか（0.0〜1.0）。例: {"topPct": 0.0, "bottomPct": 0.5}。1枚だけなら {"topPct": 0.0, "bottomPct": 1.0}。

【返却JSONスキーマ】
{
  "receipts": [
    {
      "date": "2026-10-09",
      "time": "12:34",
      "shopName": "ETC: 東京 → 海老名IC",
      "entryGate": "東京",
      "exitGate": "海老名",
      "items": [{ "name": "東名高速道路", "price": 1850 }],
      "totalAmount": 1850,
      "category": "ETC",
      "paymentMethod": "会社ETC",
      "invoiceNumber": "T1234567890123",
      "splitBox": { "topPct": 0.0, "bottomPct": 0.5 }
    }
  ]
}

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

  // 4. APIキーで使用可能なモデル候補
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
        break;
      }

      let errorDetail = '';
      try {
        const errJson = await response.json();
        errorDetail = errJson?.error?.message || response.statusText;
      } catch {
        errorDetail = response.statusText;
      }

      lastError = errorDetail;

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

  // 6. データの正規化（配列へのマッピング）
  let rawList: any[] = [];
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (Array.isArray(parsed?.receipts)) {
    rawList = parsed.receipts;
  } else if (typeof parsed === 'object' && parsed !== null) {
    rawList = [parsed];
  }

  if (rawList.length === 0) {
    rawList = [parsed];
  }

  const today = new Date().toISOString().split('T')[0];

  const results: GeminiReceiptResult[] = rawList.map((item: any, idx: number) => {
    const totalAmount = Number(item.totalAmount) || 0;
    const itemsList = Array.isArray(item.items)
      ? item.items.map((it: any) => ({
          name: String(it?.name || '利用明細').trim(),
          price: Number(it?.price) || 0
        }))
      : [];

    let entryGate = typeof item.entryGate === 'string' ? item.entryGate.trim() : undefined;
    let exitGate = typeof item.exitGate === 'string' ? item.exitGate.trim() : undefined;

    let shopName = typeof item.shopName === 'string' && item.shopName.trim()
      ? item.shopName.trim()
      : '運行経費';

    // ETCの場合にIC名をshopNameに補完
    if (entryGate && exitGate && (!shopName || shopName === '運行経費' || shopName.includes('ETC'))) {
      shopName = `ETC: ${entryGate} → ${exitGate}`;
    }

    let splitBox = item.splitBox;
    if (!splitBox && rawList.length > 1) {
      // 均等スライス比率を補完
      const segSize = 1 / rawList.length;
      splitBox = {
        topPct: Number((idx * segSize).toFixed(2)),
        bottomPct: Number(((idx + 1) * segSize).toFixed(2))
      };
    }

    // 時刻 (HH:mm) の正規化
    let parsedTime: string | undefined = undefined;
    if (typeof item.time === 'string' && item.time.trim()) {
      const tm = item.time.trim().match(/(?:^|[\sT])([0-2]?[0-9])[:時]([0-5][0-9])/);
      if (tm) {
        const hh = tm[1].padStart(2, '0');
        const mm = tm[2];
        parsedTime = `${hh}:${mm}`;
      }
    }

    const res: GeminiReceiptResult = {
      date: typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : today,
      time: parsedTime,
      shopName,
      entryGate,
      exitGate,
      items: itemsList,
      totalAmount: totalAmount > 0 ? totalAmount : itemsList.reduce((s: number, it: any) => s + it.price, 0),
      category: item.category || 'その他',
      paymentMethod: item.paymentMethod || '会社ETC',
      invoiceNumber: typeof item.invoiceNumber === 'string' ? item.invoiceNumber.trim() : '',
      splitBox,
      rawJson: JSON.stringify(item, null, 2)
    };

    return res;
  });

  return results;
}

/**
 * 従来の単一結果返却API（互換用）
 */
export async function analyzeReceiptWithGemini(
  imageDataUrl: string,
  customApiKey?: string
): Promise<GeminiReceiptResult> {
  const results = await analyzeReceiptsWithGemini(imageDataUrl, customApiKey);
  if (results.length === 0) {
    throw new Error('レシート情報を解析できませんでした。');
  }
  return results[0];
}
