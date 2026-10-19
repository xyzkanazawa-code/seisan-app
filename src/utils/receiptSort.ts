/**
 * レシートのソート用ユーティリティ
 */

export interface HasReceiptSortFields {
  date?: string;
  createdAt?: number;
  category?: string;
  id?: number | string;
}

export const CATEGORY_ORDER: Record<string, number> = {
  etc: 1,
  toll: 2,
  parking: 3,
  fuel: 4,
  breakfast: 5,
  lunch: 6,
  night_meal: 7,
  tea: 8,
  water: 9,
  taxi: 10,
  lodging: 11,
  overtime: 12,
  other: 13
};

/**
 * レシートを常に日付が新しい順（降順：新しい日付が上）にソートする比較関数
 * 同一日の場合はカテゴリ順、さらに同じ場合は作成日時が新しい順
 */
export function compareReceiptsByDate<T extends HasReceiptSortFields>(a: T, b: T): number {
  const dateA = (a.date || '').trim();
  const dateB = (b.date || '').trim();

  // 日付ありを優先（上）、日付未設定は後ろ（下）へ
  if (dateA && !dateB) return -1;
  if (!dateA && dateB) return 1;

  if (dateA && dateB && dateA !== dateB) {
    // 日付が新しいのが上（降順）
    return dateB.localeCompare(dateA);
  }

  // 同一日付の場合：カテゴリ順
  const catA = a.category ? (CATEGORY_ORDER[a.category] || 99) : 99;
  const catB = b.category ? (CATEGORY_ORDER[b.category] || 99) : 99;
  if (catA !== catB) {
    return catA - catB;
  }

  // カテゴリも同一の場合：作成日時が新しい順（降順）
  const createdA = a.createdAt || 0;
  const createdB = b.createdAt || 0;
  if (createdA !== createdB) {
    return createdB - createdA;
  }

  return 0;
}

/**
 * レシート一覧を日付順にソートした新しい配列を返す
 */
export function sortReceiptsByDate<T extends HasReceiptSortFields>(items: T[]): T[] {
  return [...items].sort(compareReceiptsByDate);
}
