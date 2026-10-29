import { db, type Receipt, type ExpenseCategory } from '../db';

export type DuplicateConfidence = 'exact_image' | 'high' | 'medium' | 'low';

export interface DuplicateMatch {
  existingReceipt: Receipt;
  tourCode?: string;
  tourTitle?: string;
  isSameTour: boolean;
  confidence: DuplicateConfidence;
  reasons: string[];
  isEtc?: boolean; // ETCによる同一高速区間の利用かどうか（控えめ通知用）
}

export interface DuplicateCheckCandidate {
  id?: number | string;
  tourId?: number;
  date: string;
  time?: string; // 利用時刻 (HH:mm)
  amount: number;
  place: string;
  category?: ExpenseCategory | string;
  invoiceNumber?: string;
  imageUrl?: string;
  imageHash?: string;
  isDuplicateDismissed?: boolean;
}

/**
 * 2つの時刻文字列（HH:mm）の差を分単位で計算
 */
export function getTimeDiffMinutes(timeA?: string, timeB?: string): number | null {
  if (!timeA || !timeB) return null;
  const matchA = timeA.trim().match(/^([0-2]?[0-9]):([0-5][0-9])/);
  const matchB = timeB.trim().match(/^([0-2]?[0-9]):([0-5][0-9])/);
  if (!matchA || !matchB) return null;
  const minA = parseInt(matchA[1], 10) * 60 + parseInt(matchA[2], 10);
  const minB = parseInt(matchB[1], 10) * 60 + parseInt(matchB[2], 10);
  return Math.abs(minA - minB);
}

/**
 * 店舗名・場所名の正規化（表記ゆれ吸収）
 * 全角英数→半角、スペース・ハイフン・記号除去、小文字化
 */
export function normalizePlaceName(name: string): string {
  if (!name) return '';
  return name
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[‐－―ー−\-~〜・･\s　()（）【】「」『』株式会社有限会社]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * 汎用名・デフォルト名判定（店名未読取時に入る名称）
 * 表記ゆれ（長音符除去等）を考慮してすべて normalizePlaceName して格納
 */
const RAW_GENERIC_PLACES = [
  '経費',
  'その他',
  'その他経費',
  'レシート経費',
  '運行経費',
  '不明',
  '利用場所不明',
  '店舗名不明',
  '店名不明',
  'レシート',
  '領収書',
  '領収証',
  'お買上票',
  'お買い上げ票',
  'お買上げ票',
  '計算書',
  '明細書',
  'ご利用明細'
];

export const GENERIC_PLACE_NAMES = new Set(RAW_GENERIC_PLACES.map(normalizePlaceName));

export function isGenericPlace(name: string): boolean {
  const norm = normalizePlaceName(name);
  if (!norm) return true;
  return GENERIC_PLACE_NAMES.has(norm);
}

/**
 * 2つの正規化済み店舗名が類似しているか判定
 */
export function isPlaceSimilar(placeA: string, placeB: string): boolean {
  const normA = normalizePlaceName(placeA);
  const normB = normalizePlaceName(placeB);

  // どちらかが未入力または汎用名（「運行経費」「レシート」など）の場合は一致とみなさない
  if (!normA || !normB) return false;
  if (isGenericPlace(normA) || isGenericPlace(normB)) return false;

  // 正当な店舗名同士で完全一致
  if (normA === normB) return true;

  // 【超重要】先頭4文字一致（「タイムズ」「コインパ」「セブン」等）は誤爆の温床（別拠点を同じと誤認）のため廃止！
  // 片方がもう片方を完全に内包している場合（例: 「セブンイレブン日光駅前店」と「セブンイレブン日光駅前」）
  // 短すぎるチェーン名単体（「タイムズ」「エネオス」等）による誤爆を防ぐため、双方とも5文字以上で内包チェック
  if (normA.length >= 6 && normB.length >= 6) {
    if (normA.includes(normB) || normB.includes(normA)) {
      return true;
    }
  }

  return false;
}

/**
 * 2つの店舗名が明確に異なっているか判定
 * （両方に有効な店舗名が入っており、かつ汎用名ではなく、類似もしていない場合）
 */
export function isPlaceDistinct(placeA: string, placeB: string): boolean {
  const normA = normalizePlaceName(placeA);
  const normB = normalizePlaceName(placeB);
  if (!normA || !normB) return false;
  if (isGenericPlace(normA) || isGenericPlace(normB)) return false;
  return !isPlaceSimilar(placeA, placeB);
}

/**
 * 画像DataURLから高速な知覚ハッシュ（8x8 平均ハッシュ aHash）を生成
 * 同じ写真やわずかな再圧縮画像を検知するために使用
 */
export async function computeImageHash(dataUrl?: string): Promise<string | undefined> {
  if (!dataUrl || !dataUrl.startsWith('data:image')) return undefined;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 8;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const imageData = ctx.getImageData(0, 0, size, size).data;
        const grays: number[] = [];
        let sum = 0;

        for (let i = 0; i < imageData.length; i += 4) {
          const g = Math.round(
            imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114
          );
          grays.push(g);
          sum += g;
        }

        const avg = sum / 64;
        // 均一すぎるダミー画像（手入力プレースホルダー等）はハッシュ判定から除外
        const variance = grays.reduce((acc, g) => acc + Math.abs(g - avg), 0) / 64;
        if (variance < 5) {
          resolve(undefined);
          return;
        }

        let bits = '';
        for (let i = 0; i < 64; i++) {
          bits += grays[i] >= avg ? '1' : '0';
        }
        resolve(bits);
      } catch {
        resolve(undefined);
      }
    };
    img.onerror = () => resolve(undefined);
    img.src = dataUrl;
  });
}

/**
 * 2つの64bitハッシュ文字列のハミング距離（異なるビット数）を計算
 */
export function getHashDistance(hashA?: string, hashB?: string): number {
  if (!hashA || !hashB || hashA.length !== 64 || hashB.length !== 64) return 999;
  let dist = 0;
  for (let i = 0; i < 64; i++) {
    if (hashA[i] !== hashB[i]) dist++;
  }
  return dist;
}

/**
 * 1件の候補と既存レシートを比較して重複度を判定
 */
export function evaluateDuplicatePair(
  candidate: DuplicateCheckCandidate,
  existing: Receipt,
  _candidateHash?: string,
  _existingHash?: string
): { confidence: DuplicateConfidence; reasons: string[]; isEtc?: boolean } | null {
  // 自分自身との比較はスキップ
  if (candidate.id !== undefined && existing.id !== undefined && String(candidate.id) === String(existing.id)) {
    return null;
  }

  // ユーザーが明示的に確認・解除済みのレシートは重複判定しない
  if (candidate.isDuplicateDismissed || existing.isDuplicateDismissed) {
    return null;
  }

  const reasons: string[] = [];

  // 1. 画像完全一致（同一データURL）チェック
  // （全く同じ写真データが使われている場合は最優先で重複判定）
  if (
    candidate.imageUrl &&
    (candidate.imageUrl === existing.originalImageUrl ||
      candidate.imageUrl === existing.processedImageUrl)
  ) {
    if (candidate.imageUrl.length > 1000) {
      reasons.push('同一のレシート画像データ');
      return { confidence: 'exact_image', reasons, isEtc: false };
    }
  }

  const candidateAmount = Number(candidate.amount) || 0;
  const existingAmount = Number(existing.amount) || 0;

  // 金額が一致しない、または0以下の場合は絶対に重複ではない
  if (candidateAmount <= 0 || existingAmount <= 0 || candidateAmount !== existingAmount) {
    return null;
  }

  // カテゴリが双方ともに明確に設定されており、かつ異なっている場合は絶対に別経費（例: 駐車場 vs 昼食、燃料 vs ETCなど）
  // 金額が偶然同じであっても、種別が違えば重複ではない
  if (
    candidate.category &&
    existing.category &&
    candidate.category !== 'other' &&
    existing.category !== 'other' &&
    candidate.category !== existing.category
  ) {
    return null;
  }

  const isEtcPair = candidate.category === 'etc' || existing.category === 'etc';
  const isSameDate = Boolean(candidate.date && existing.date && candidate.date === existing.date);

  const normCandInv = candidate.invoiceNumber?.trim().toUpperCase();
  const normExistInv = existing.invoiceNumber?.trim().toUpperCase();
  const hasCandInv = Boolean(normCandInv && /^T\d{13}$/.test(normCandInv));
  const hasExistInv = Boolean(normExistInv && /^T\d{13}$/.test(normExistInv));
  const invoiceMatched = Boolean(hasCandInv && hasExistInv && normCandInv === normExistInv);

  // 【超重要】両方に有効なインボイス番号があり、番号が異なる場合は100%別事業者・別店舗！
  if (hasCandInv && hasExistInv && normCandInv !== normExistInv) {
    return null;
  }

  const placeMatched = isPlaceSimilar(candidate.place, existing.place);
  const placeDistinct = isPlaceDistinct(candidate.place, existing.place);

  // 【超重要】店舗名が両方に正しく存在し、かつ明確に異なっている場合は絶対に別店舗！
  // （例: セブンイレブン vs ENEOS、タイムズ日光 vs タイムズ宇都宮など）
  if (placeDistinct && !invoiceMatched) {
    return null;
  }

  // 【超重要】「金額だけの一致」による誤爆を完全に排除！
  // 店舗名が一致・類似（placeMatched）しているか、またはインボイス番号が一致（invoiceMatched）していなければ重複とみなさない！
  // （店舗名が未入力や汎用名の場合に金額だけで重複警告が出るのを防ぐ）
  if (!placeMatched && !invoiceMatched) {
    return null;
  }

  // 利用時刻（HH:mm）の比較：両方に時刻が印字・記録されている場合
  const timeDiff = getTimeDiffMinutes(candidate.time, existing.time);
  if (timeDiff !== null) {
    // 10分以上離れている場合：同じ店・同じ金額であっても別時間帯の利用（朝とお昼、行きと帰りなど）として重複判定から除外！
    if (timeDiff >= 10) {
      return null;
    }
  }

  // ETCの場合：同じ高速区間（往復等）の利用が多いため、控えめ扱い（low）
  if (isEtcPair) {
    if (isSameDate && placeMatched) {
      reasons.push(`同日の同一ETC区間・料金(¥${existingAmount.toLocaleString()}) ※往復等の正常な利用の可能性があります`);
      return { confidence: 'low', reasons, isEtc: true };
    }
    return null;
  }

  // 2. 高確度重複 (High)（ETC以外）:
  // - 利用日一致 + 金額一致 + (店舗名類似 または インボイス番号一致)
  if (isSameDate && (placeMatched || invoiceMatched)) {
    reasons.push(`利用日(${existing.date})と金額(¥${existingAmount.toLocaleString()})が一致`);
    if (placeMatched) reasons.push(`利用場所「${existing.place}」が一致`);
    if (invoiceMatched) reasons.push(`インボイス番号(${normExistInv})が一致`);
    if (existing.time && timeDiff !== null && timeDiff < 10) {
      reasons.push(`利用時刻(${existing.time})も一致/近接`);
    }
    return { confidence: 'high', reasons, isEtc: false };
  }

  // 3. 中確度重複 (Medium):
  // 日付が1日違いまたは読み取りズレだが、金額 + 店舗名 + インボイス番号が完全一致
  if (!isSameDate && placeMatched && invoiceMatched) {
    reasons.push(
      `金額(¥${existingAmount.toLocaleString()})・店舗名「${existing.place}」・インボイス番号が完全一致（日付相違: ${existing.date}）`
    );
    return { confidence: 'medium', reasons, isEtc: false };
  }

  return null;
}

/**
 * データベース内の既存レシートと照合し、重複候補リストを返す
 */
export async function checkReceiptDuplicates(
  candidate: DuplicateCheckCandidate
): Promise<DuplicateMatch[]> {
  try {
    const allReceipts = await db.receipts.toArray();
    if (allReceipts.length === 0) return [];

    const allTours = await db.tours.toArray();
    const tourMap = new Map(allTours.map((t) => [t.id, t]));

    const candidateHash = candidate.imageHash || (await computeImageHash(candidate.imageUrl));
    const matches: DuplicateMatch[] = [];

    for (const existing of allReceipts) {
      const existingHash = existing.imageHash;
      const evalResult = evaluateDuplicatePair(candidate, existing, candidateHash, existingHash);
      if (evalResult) {
        const isSameTour = candidate.tourId !== undefined && existing.tourId === candidate.tourId;
        // 別ツアーの場合は High または Exact Image のみ通知（ノイズ防止）
        if (!isSameTour && evalResult.confidence === 'medium') {
          continue;
        }
        const tour = tourMap.get(existing.tourId);
        matches.push({
          existingReceipt: existing,
          tourCode: tour?.code,
          tourTitle: tour?.title,
          isSameTour,
          confidence: evalResult.confidence,
          reasons: evalResult.reasons,
          isEtc: evalResult.isEtc
        });
      }
    }

    // 優先度順にソート（同一ツアー優先 → 確度順）
    const confidenceOrder: Record<DuplicateConfidence, number> = {
      exact_image: 3,
      high: 2,
      medium: 1,
      low: 0
    };

    matches.sort((a, b) => {
      if (a.isSameTour !== b.isSameTour) return a.isSameTour ? -1 : 1;
      return confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    });

    return matches;
  } catch (err) {
    console.error('重複チェックエラー:', err);
    return [];
  }
}

export interface TourDuplicateInfo {
  reasons: string[];
  matchedWithIds: number[];
  matchedReceipts: { id: number; place: string; amount: number; date: string }[];
  isEtcOnly: boolean;
}

/**
 * ツアー内の登録済みレシート一覧から、互いに重複している可能性があるペア・グループを検出する
 */
export function findDuplicateGroupsInTour(
  receipts: Receipt[]
): Map<number, TourDuplicateInfo> {
  const duplicateMap = new Map<number, TourDuplicateInfo>();

  for (let i = 0; i < receipts.length; i++) {
    for (let j = i + 1; j < receipts.length; j++) {
      const rA = receipts[i];
      const rB = receipts[j];
      if (!rA.id || !rB.id) continue;

      // ユーザーが解除済みのレシートは重複から除外
      if (rA.isDuplicateDismissed || rB.isDuplicateDismissed) {
        continue;
      }

      // ETCの分割明細（同一レシートから分割された別区間）は重複から除外
      if (
        rA.category === 'etc' &&
        rB.category === 'etc' &&
        rA.etcDetails?.splitIndex !== undefined &&
        rB.etcDetails?.splitIndex !== undefined &&
        rA.etcDetails.splitIndex !== rB.etcDetails.splitIndex
      ) {
        continue;
      }

      const evalResult = evaluateDuplicatePair(
        {
          id: rA.id,
          tourId: rA.tourId,
          date: rA.date,
          time: rA.time,
          amount: rA.amount,
          place: rA.place,
          category: rA.category,
          invoiceNumber: rA.invoiceNumber,
          imageUrl: rA.originalImageUrl || rA.processedImageUrl,
          imageHash: rA.imageHash,
          isDuplicateDismissed: rA.isDuplicateDismissed
        },
        rB,
        rA.imageHash,
        rB.imageHash
      );

      if (evalResult) {
        const isEtc = Boolean(evalResult.isEtc);

        const prevA = duplicateMap.get(rA.id) || {
          reasons: [],
          matchedWithIds: [],
          matchedReceipts: [],
          isEtcOnly: true
        };
        if (!prevA.matchedWithIds.includes(rB.id)) {
          prevA.matchedWithIds.push(rB.id);
          prevA.matchedReceipts.push({
            id: rB.id,
            place: rB.place || '名称なし',
            amount: rB.amount,
            date: rB.date
          });
        }
        for (const reason of evalResult.reasons) {
          if (!prevA.reasons.includes(reason)) prevA.reasons.push(reason);
        }
        if (!isEtc) prevA.isEtcOnly = false;
        duplicateMap.set(rA.id, prevA);

        const prevB = duplicateMap.get(rB.id) || {
          reasons: [],
          matchedWithIds: [],
          matchedReceipts: [],
          isEtcOnly: true
        };
        if (!prevB.matchedWithIds.includes(rA.id)) {
          prevB.matchedWithIds.push(rA.id);
          prevB.matchedReceipts.push({
            id: rA.id,
            place: rA.place || '名称なし',
            amount: rA.amount,
            date: rA.date
          });
        }
        for (const reason of evalResult.reasons) {
          if (!prevB.reasons.includes(reason)) prevB.reasons.push(reason);
        }
        if (!isEtc) prevB.isEtcOnly = false;
        duplicateMap.set(rB.id, prevB);
      }
    }
  }

  return duplicateMap;
}
