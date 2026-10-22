import { db, type Receipt, type ExpenseCategory } from '../db';

export type DuplicateConfidence = 'exact_image' | 'high' | 'medium';

export interface DuplicateMatch {
  existingReceipt: Receipt;
  tourCode?: string;
  tourTitle?: string;
  isSameTour: boolean;
  confidence: DuplicateConfidence;
  reasons: string[];
}

export interface DuplicateCheckCandidate {
  id?: number | string;
  tourId?: number;
  date: string;
  amount: number;
  place: string;
  category?: ExpenseCategory | string;
  invoiceNumber?: string;
  imageUrl?: string;
  imageHash?: string;
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
 * 2つの正規化済み店舗名が類似しているか判定
 */
export function isPlaceSimilar(placeA: string, placeB: string): boolean {
  const normA = normalizePlaceName(placeA);
  const normB = normalizePlaceName(placeB);

  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // 初期デフォルト名（「経費」「その他経費」「レシート経費」など）は店舗名一致とみなさない
  const genericNames = new Set(['経費', 'その他経費', 'レシート経費', '不明', '利用場所不明']);
  if (genericNames.has(normA) || genericNames.has(normB)) return false;

  // 片方がもう片方を含んでいる場合（例: 「セブンイレブン」と「セブンイレブン日光駅前店」）
  if (normA.length >= 3 && normB.length >= 3) {
    if (normA.includes(normB) || normB.includes(normA)) {
      return true;
    }
    // 先頭4文字が一致している場合（チェーン店名など）
    if (normA.slice(0, 4) === normB.slice(0, 4)) {
      return true;
    }
  }

  return false;
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
  candidateHash?: string,
  existingHash?: string
): { confidence: DuplicateConfidence; reasons: string[] } | null {
  // 自分自身との比較はスキップ
  if (candidate.id !== undefined && existing.id !== undefined && String(candidate.id) === String(existing.id)) {
    return null;
  }

  const reasons: string[] = [];

  // 1. 画像完全一致または知覚ハッシュ一致チェック
  if (
    candidate.imageUrl &&
    (candidate.imageUrl === existing.originalImageUrl ||
      candidate.imageUrl === existing.processedImageUrl)
  ) {
    // ただし手動入力ダミー画像（サイズが非常に小さい等）の場合は内容も見る
    if (candidate.imageUrl.length > 15000) {
      reasons.push('同一のレシート画像データ');
      return { confidence: 'exact_image', reasons };
    }
  }

  if (candidateHash && existingHash) {
    const dist = getHashDistance(candidateHash, existingHash);
    if (dist <= 3) {
      reasons.push('レシート画像がほぼ同一');
      return { confidence: 'exact_image', reasons };
    }
  }

  const candidateAmount = Number(candidate.amount) || 0;
  const existingAmount = Number(existing.amount) || 0;

  // 金額が0以下の場合は金額ベース比較を行わない
  if (candidateAmount <= 0 || existingAmount <= 0) {
    return null;
  }

  const isSameAmount = candidateAmount === existingAmount;
  if (!isSameAmount) {
    return null;
  }

  const isSameDate = Boolean(candidate.date && existing.date && candidate.date === existing.date);
  const placeMatched = isPlaceSimilar(candidate.place, existing.place);

  const normCandInv = candidate.invoiceNumber?.trim().toUpperCase();
  const normExistInv = existing.invoiceNumber?.trim().toUpperCase();
  const invoiceMatched = Boolean(normCandInv && normExistInv && normCandInv === normExistInv);

  const categoryMatched = Boolean(
    candidate.category && existing.category && candidate.category === existing.category
  );

  // 2. 高確度重複 (High):
  // - 利用日一致 + 金額一致 + (店舗名類似 または インボイス番号一致)
  if (isSameDate && isSameAmount && (placeMatched || invoiceMatched)) {
    reasons.push(`利用日(${existing.date})と金額(¥${existingAmount.toLocaleString()})が一致`);
    if (placeMatched) reasons.push(`利用場所「${existing.place}」が一致・類似`);
    if (invoiceMatched) reasons.push(`インボイス番号(${normExistInv})が一致`);
    return { confidence: 'high', reasons };
  }

  // 3. 中確度重複 (Medium):
  // パターンA: 同一ツアー内で 利用日一致 + 金額一致 + 科目一致（OCRと手入力で店名表記が異なるケース）
  if (isSameDate && isSameAmount && categoryMatched) {
    reasons.push(`同じ日付(${existing.date})・同じ金額(¥${existingAmount.toLocaleString()})・同じ科目の明細が存在`);
    return { confidence: 'medium', reasons };
  }

  // パターンB: 同一ツアー内で 利用日一致 + 金額一致（特に金額が500円以上、または端数のある金額）
  if (isSameDate && isSameAmount && candidate.tourId === existing.tourId) {
    reasons.push(`同じ日付(${existing.date})・同じ金額(¥${existingAmount.toLocaleString()})の明細が存在`);
    return { confidence: 'medium', reasons };
  }

  // パターンC: 日付が1日違いまたは読み取りズレだが、金額 + 店舗名 + インボイス番号が完全一致
  if (!isSameDate && isSameAmount && placeMatched && invoiceMatched) {
    reasons.push(
      `金額(¥${existingAmount.toLocaleString()})・店舗名「${existing.place}」・インボイス番号が完全一致（日付のみ相違: ${existing.date}）`
    );
    return { confidence: 'medium', reasons };
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
          reasons: evalResult.reasons
        });
      }
    }

    // 優先度順にソート（同一ツアー優先 → 確度順）
    const confidenceOrder: Record<DuplicateConfidence, number> = {
      exact_image: 3,
      high: 2,
      medium: 1
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

/**
 * ツアー内の登録済みレシート一覧から、互いに重複している可能性があるペア・グループを検出する
 */
export function findDuplicateGroupsInTour(receipts: Receipt[]): Map<number, { reasons: string[]; matchedWithIds: number[] }> {
  const duplicateMap = new Map<number, { reasons: string[]; matchedWithIds: number[] }>();

  for (let i = 0; i < receipts.length; i++) {
    for (let j = i + 1; j < receipts.length; j++) {
      const rA = receipts[i];
      const rB = receipts[j];
      if (!rA.id || !rB.id) continue;

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
          amount: rA.amount,
          place: rA.place,
          category: rA.category,
          invoiceNumber: rA.invoiceNumber,
          imageUrl: rA.originalImageUrl || rA.processedImageUrl,
          imageHash: rA.imageHash
        },
        rB,
        rA.imageHash,
        rB.imageHash
      );

      if (evalResult) {
        const prevA = duplicateMap.get(rA.id) || { reasons: [], matchedWithIds: [] };
        if (!prevA.matchedWithIds.includes(rB.id)) {
          prevA.matchedWithIds.push(rB.id);
        }
        for (const reason of evalResult.reasons) {
          if (!prevA.reasons.includes(reason)) prevA.reasons.push(reason);
        }
        duplicateMap.set(rA.id, prevA);

        const prevB = duplicateMap.get(rB.id) || { reasons: [], matchedWithIds: [] };
        if (!prevB.matchedWithIds.includes(rA.id)) {
          prevB.matchedWithIds.push(rA.id);
        }
        for (const reason of evalResult.reasons) {
          if (!prevB.reasons.includes(reason)) prevB.reasons.push(reason);
        }
        duplicateMap.set(rB.id, prevB);
      }
    }
  }

  return duplicateMap;
}
