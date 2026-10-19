import { db, type ExpenseCategory, type PaymentMethod } from '../db';

export interface LearnedPattern {
  id: string;
  keyword: string;            // OCRテキスト内で照合する文字列
  place: string;              // 推定する店名・場所名
  category: ExpenseCategory;  // 推定する科目
  paymentMethod: PaymentMethod;// 推定する支払方法
  invoiceNumber?: string;     // インボイス登録番号 (あれば)
  confidence: number;         // 信頼度スコア (出現回数や明示的修正など)
  source: 'gemini' | 'manual' | 'receipt_history'; // 学習元
  updatedAt: number;
}

export interface MatchResult {
  matchedKeyword: string;
  place: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  invoiceNumber?: string;
  source: 'gemini' | 'manual' | 'receipt_history';
  confidence: number;
}

const STORAGE_KEY = 'seisan_learned_ocr_patterns_v1';

/**
 * ローカルストレージに保存された明示的・追加学習パターンを取得
 */
function getStoredCustomPatterns(): LearnedPattern[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.warn('学習パターン読み込みエラー:', e);
    return [];
  }
}

/**
 * ローカルストレージに保存
 */
function saveStoredCustomPatterns(patterns: LearnedPattern[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
  } catch (e) {
    console.warn('学習パターン保存エラー:', e);
  }
}

/**
 * 店名・場所文字列から照合用キーワードを分解・生成
 * 例: "セブン-イレブン 日光駅前店 (朝食・おにぎり)"
 *   -> ["セブン-イレブン 日光駅前店", "日光駅前店", "セブン-イレブン"]
 */
function extractKeywordsFromPlace(place: string): string[] {
  if (!place || !place.trim()) return [];
  const cleaned = place
    .replace(/[【】\[\]()（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const keywords = new Set<string>();
  if (cleaned.length >= 2) {
    keywords.add(cleaned);
  }

  // カッコ内の補足を除いた主要部分
  const mainPart = place.split(/[（(【\[]/)[0].trim();
  if (mainPart.length >= 2) {
    keywords.add(mainPart);
  }

  // 空白で区切った単語（2文字以上かつ記号以外の意味のある単語）
  const parts = cleaned.split(' ');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length >= 3 && !/^\d+$/.test(trimmed)) {
      keywords.add(trimmed);
    }
  }

  return Array.from(keywords);
}

/**
 * 過去の全レシート（DB）および追加学習データから統合学習辞書を構築
 */
export async function buildLearningKnowledgeBase(): Promise<LearnedPattern[]> {
  const customPatterns = getStoredCustomPatterns();
  const patternMap = new Map<string, LearnedPattern>();

  // 1. カスタム保存された高優先度パターンを先に登録
  for (const p of customPatterns) {
    patternMap.set(p.keyword.toLowerCase(), p);
  }

  // 2. 過去のDB登録レシートからパターンを自動学習
  try {
    const receipts = await db.receipts.toArray();
    for (const r of receipts) {
      if (!r.place || r.place.trim().length < 2) continue;
      const keywords = extractKeywordsFromPlace(r.place);

      for (const kw of keywords) {
        const key = kw.toLowerCase();
        const existing = patternMap.get(key);
        if (existing) {
          existing.confidence += 1;
          // 新しい日付の情報で補完
          if (!existing.invoiceNumber && r.invoiceNumber) {
            existing.invoiceNumber = r.invoiceNumber;
          }
        } else {
          patternMap.set(key, {
            id: `pattern-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
            keyword: kw,
            place: r.place,
            category: r.category,
            paymentMethod: r.paymentMethod,
            invoiceNumber: r.invoiceNumber,
            confidence: 1,
            source: 'receipt_history',
            updatedAt: r.createdAt || Date.now()
          });
        }
      }
    }
  } catch (err) {
    console.warn('DBレシートからの学習データ構築失敗:', err);
  }

  return Array.from(patternMap.values());
}

/**
 * レシート登録・編集・Gemini解析時に新しい学習データを追加/更新する
 */
export async function learnFromReceipt(receipt: {
  place: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  invoiceNumber?: string;
  source?: 'gemini' | 'manual' | 'ocr';
}): Promise<void> {
  const { place, category, paymentMethod, invoiceNumber, source = 'manual' } = receipt;
  if (!place || place.trim().length < 2) return;

  const keywords = extractKeywordsFromPlace(place);
  if (keywords.length === 0) return;

  const currentPatterns = getStoredCustomPatterns();
  const now = Date.now();

  for (const kw of keywords) {
    const existingIndex = currentPatterns.findIndex(
      (p) => p.keyword.toLowerCase() === kw.toLowerCase()
    );

    if (existingIndex >= 0) {
      // 既存パターンを更新して信頼度をUP
      currentPatterns[existingIndex] = {
        ...currentPatterns[existingIndex],
        place: place.trim(),
        category,
        paymentMethod,
        invoiceNumber: invoiceNumber || currentPatterns[existingIndex].invoiceNumber,
        confidence: currentPatterns[existingIndex].confidence + 2,
        source: source === 'gemini' ? 'gemini' : currentPatterns[existingIndex].source,
        updatedAt: now
      };
    } else {
      currentPatterns.push({
        id: `learned-${now}-${Math.random().toString(36).substring(2, 7)}`,
        keyword: kw,
        place: place.trim(),
        category,
        paymentMethod,
        invoiceNumber,
        confidence: source === 'gemini' ? 3 : 2,
        source: source === 'gemini' ? 'gemini' : 'manual',
        updatedAt: now
      });
    }
  }

  // 最大500件まで保持（古い順・信頼度の低い順に剪定）
  if (currentPatterns.length > 500) {
    currentPatterns.sort((a, b) => b.confidence - a.confidence || b.updatedAt - a.updatedAt);
    currentPatterns.splice(500);
  }

  saveStoredCustomPatterns(currentPatterns);
}

/**
 * OCRテキストから学習済みパターンを検索照合
 * 最長一致かつスコアの高いものを選択
 */
export async function matchLearnedPattern(ocrText: string): Promise<MatchResult | null> {
  if (!ocrText || !ocrText.trim()) return null;

  const knowledgeBase = await buildLearningKnowledgeBase();
  if (knowledgeBase.length === 0) return null;

  const lowerOcr = ocrText.toLowerCase();

  let bestMatch: LearnedPattern | null = null;
  let bestScore = -1;

  for (const pattern of knowledgeBase) {
    const kwLower = pattern.keyword.toLowerCase();
    if (lowerOcr.includes(kwLower)) {
      // スコア計算: キーワード長(長い方がより正確) × 10 + 信頼度
      const score = pattern.keyword.length * 10 + pattern.confidence;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = pattern;
      }
    }
  }

  if (bestMatch) {
    return {
      matchedKeyword: bestMatch.keyword,
      place: bestMatch.place,
      category: bestMatch.category,
      paymentMethod: bestMatch.paymentMethod,
      invoiceNumber: bestMatch.invoiceNumber,
      source: bestMatch.source,
      confidence: bestMatch.confidence
    };
  }

  return null;
}

/**
 * 学習状況のサマリー統計を取得
 */
export async function getLearningStats(): Promise<{
  totalPatterns: number;
  geminiLearnedCount: number;
  sampleKeywords: string[];
}> {
  const knowledge = await buildLearningKnowledgeBase();
  const geminiCount = knowledge.filter((p) => p.source === 'gemini').length;
  const sampleKeywords = knowledge
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5)
    .map((p) => `${p.keyword} (${p.category})`);

  return {
    totalPatterns: knowledge.length,
    geminiLearnedCount: geminiCount,
    sampleKeywords
  };
}

/**
 * 学習辞書を初期化
 */
export function clearCustomLearnedPatterns(): void {
  localStorage.removeItem(STORAGE_KEY);
}
