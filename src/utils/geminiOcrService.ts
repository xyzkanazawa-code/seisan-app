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

  // 3. プロンプト定義（駐車場・給油・飲食・ETCなど全経費の超高精度読み取り）
  const prompt = `あなたはプロのバス運行経費・領収書・レシート専用の超高精度OCR解析AIです。
画像全体を注意深く読み取り、店舗名・利用場所名・利用日・利用時刻・合計支払金額・品目を正確に抽出して指定のJSON形式で返却してください。

【経費種別ごとの重要読み取り指示】
1. 駐車場（コインパーキング・市営駐車場・観光バス駐車場等）:
   - shopName: レシート上部や下部に印字された駐車場名（例: 「タイムズ日光駅前」「三井のリパーク 〇〇」「NPC24H 〇〇」「名鉄協商 〇〇」「〇〇市営駐車場」「〇〇観光バス駐車場」）。ブランド名だけでなく具体的な拠点名まで含めてください。
   - totalAmount: 実際に支払った料金（「領収金額」「料金」「現収」「合計」「駐車料金」などに記載された半角数値）。
     ※【超厳禁】「精算日時（20261028等）」「入庫日時」「出庫日時」「精算機No」「駐車券No」「車両No」「お預り額」「釣銭」などの数字を絶対に totalAmount にしないでください！必ず実際の駐車料金（通常300円〜数千円、最大でも数万円）を抽出してください。
   - category: 必ず "駐車場" にしてください。
2. ガソリンスタンド（燃料・軽油・ガソリン・AdBlue）:
   - shopName: 給油所名（例: 「ENEOS 〇〇SS」「出光」「コスモ石油」等）。
   - totalAmount: 最終支払金額（給油合計額）。
   - category: 必ず "燃料" にしてください。
3. 食事・お茶・コンビニ・売店・自動販売機:
   - shopName: 店舗名（例: 「セブン-イレブン 〇〇店」「ローソン」「ファミリーマート」「〇〇食堂」「〇〇PA売店」等）。
   - category: 内容や時間帯に応じて "朝食代", "昼食代", "夜食代", "お茶代", "ミネラルウォーター", "その他" から適切なものを選択。
4. 有料道路・普通料金所（非ETCの現金/領収書）:
   - shopName: 道路名または料金所名（例: 「富士山スカイライン」「日光宇都宮道路 〇〇料金所」等）。
   - category: "有料道路"。
5. ETC利用証明書・利用明細書:
   - 1本の縦長い紙に複数の利用区間が縦に連続して印字されている場合は、1走行区間（入口IC→出口IC）ごとに別々のレシートオブジェクトとして配列に出力してください。
   - ただし、1つの走行の内訳（通常料金、各種割引、内消費税等）は分割せず、割引適用後の最終通行料金1つを \`totalAmount\` としてください。
   - shopName: "ETC: 入口IC → 出口IC" の形式にしてください。
   - category: "ETC"。支払方法は "会社ETC"。

【金額（totalAmount）の厳格ルール】
- 日付（20261028等）、時刻、電話番号、郵便番号、車両番号、お預り金（10,000円など）、釣銭を金額に絶対に誤認しないでください。
- 1回のレシート金額が数十万円・数百万円になることは運行経費では原則ありません。異常値は避け、必ず「領収金額・合計料金」を抽出してください。

【各レシートの共通抽出項目】
1. date: 利用日・精算日。"YYYY-MM-DD" 形式（例: "2026-10-28"）。年がなければ今年（2026年）を補完。
2. time: 利用時刻・精算時刻。"HH:mm" 形式（例: "14:35", "09:10"）。印字があれば必ず抽出。なければ空文字。
3. shopName: 店舗名・駐車場名・施設名・利用場所名。
4. totalAmount: 実際に支払った合計金額（半角数値）。必ず数値を抽出してください。
5. category: 経費カテゴリ（"駐車場" | "燃料" | "有料道路" | "ETC" | "朝食代" | "昼食代" | "夜食代" | "お茶代" | "ミネラルウォーター" | "残業代" | "タクシー" | "宿泊" | "その他"）。
6. paymentMethod: 支払方法（"会社ETC" | "前払い金" | "現金" | "会社カード" | "燃料カード" | "その他"）。
7. invoiceNumber: 適格請求書発行事業者登録番号（"T" + 13桁の数字）。印字があれば抽出、なければ空文字。
8. items: 内訳品目リスト [{ "name": "品目名または料金名", "price": 数値 }]。
9. splitBox: 画像内の縦位置比率（例: {"topPct": 0.0, "bottomPct": 1.0}）。

【返却JSON形式】
必ず以下のJSON形式のみを出力してください。Markdownコードフェンス（\`\`\`json等）は付けず、純粋なJSON文字列として返却してください。
{
  "receipts": [
    {
      "date": "2026-10-28",
      "time": "14:35",
      "shopName": "タイムズ日光駅前",
      "entryGate": "",
      "exitGate": "",
      "items": [{ "name": "駐車料金", "price": 1200 }],
      "totalAmount": 1200,
      "category": "駐車場",
      "paymentMethod": "現金",
      "invoiceNumber": "T1234567890123",
      "splitBox": { "topPct": 0.0, "bottomPct": 1.0 }
    }
  ]
}`;

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
      temperature: 0.0
    }
  };

  // 4. APIキーで使用可能なモデル候補（高精度モデルを最優先）
  let candidateModels = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-2.0-flash-exp'
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
          m.name.includes('flash') &&
          !m.name.includes('8b') // 8b等の極小モデルは精度低下防止のため除外
        )
        .map((m: any) => m.name.replace(/^models\//, ''));

      if (supportedFlashModels.length > 0) {
        // 高性能順にソートして先頭に配置
        const preferredOrder = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest'];
        const sorted = supportedFlashModels.sort((a: string, b: string) => {
          const idxA = preferredOrder.findIndex((p) => a.includes(p));
          const idxB = preferredOrder.findIndex((p) => b.includes(p));
          return (idxA >= 0 ? idxA : 99) - (idxB >= 0 ? idxB : 99);
        });
        candidateModels = [...new Set([...sorted, ...candidateModels])];
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
    let totalAmount = Number(item.totalAmount) || 0;
    const itemsList = Array.isArray(item.items)
      ? item.items.map((it: any) => ({
          name: String(it?.name || '利用明細').trim(),
          price: Number(it?.price) || 0
        }))
      : [];

    // 金額の異常値サニティチェック（日付 20261028 やインボイス番号、電話番号の誤認防止）
    const validItemsSum = itemsList.reduce((s: number, it: any) => (it.price > 0 && it.price < 500000 ? s + it.price : s), 0);
    if (totalAmount >= 20200101 && totalAmount <= 20351231) {
      // 8桁の日付数値（20261028等）が入っていた場合は items の合計または0に補正
      totalAmount = validItemsSum > 0 ? validItemsSum : 0;
    } else if (totalAmount > 500000) {
      // 50万円を超える異常な金額の場合
      if (validItemsSum > 0 && validItemsSum <= 500000) {
        totalAmount = validItemsSum;
      }
    }

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
