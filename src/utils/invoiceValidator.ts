/**
 * インボイス（適格請求書発行事業者登録番号）の検出および検証ユーティリティ
 * 完全オフラインで動作し、国税庁の番号体系に基づきチェック
 */

export interface InvoiceValidationResult {
  raw: string;                 // 検出された文字列
  normalizedNumber: string;    // 'T' + 13桁数字に正規化
  isValidFormat: boolean;      // T+13桁の形式を満たすか
  isCheckDigitValid: boolean;  // 国税庁チェックディジット検証結果
  details: string;             // 検証メッセージ
}

/**
 * 国税庁法人番号チェックディジット算定式（完全オフライン計算）
 * 13桁のうち、先頭1桁が検査数字(C)、後ろ12桁(d12〜d1)が基礎番号
 * 計算式: C = 9 - ( Σ(dn * Qn) mod 9 )
 * ※ Qn: nが奇数なら1、偶数なら2
 */
export function verifyCorporateCheckDigit(thirteenDigits: string): boolean {
  if (!/^\d{13}$/.test(thirteenDigits)) return false;

  const checkDigit = parseInt(thirteenDigits[0], 10);
  const baseDigits = thirteenDigits.slice(1).split('').map(Number); // 12桁

  // 後ろから1番目(d1)〜12番目(d12)
  const reversed = [...baseDigits].reverse();
  let sum = 0;
  for (let i = 0; i < reversed.length; i++) {
    const n = i + 1; // 1-indexed (d1, d2, ...)
    const weight = n % 2 === 1 ? 1 : 2;
    sum += reversed[i] * weight;
  }

  const remainder = sum % 9;
  const calculatedCheckDigit = remainder === 0 ? 0 : 9 - remainder;

  return checkDigit === calculatedCheckDigit;
}

/**
 * テキストからインボイス登録番号を抽出・バリデーション
 */
export function extractInvoiceNumbers(text: string): InvoiceValidationResult[] {
  if (!text) return [];

  // 全角数字を半角に変換し、一般的なOCR誤読パターン（大文字小文字、スペース、コロン等）を正規化
  const cleaned = text
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[TtＴｔ]/g, 'T');

  // パターン: Tに続く13桁の数字（途中のハイフンや空白を許容）
  // 例: T1234567890123, T 1234-5678-90123, 登録番号: T1234567890123
  const regex = /T[\s\-:：]*(\d[\s\-]*\d{12})/gi;
  const results: InvoiceValidationResult[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(cleaned)) !== null) {
    const fullMatch = match[0];
    const digitsOnly = match[1].replace(/[\s\-]/g, '');

    if (digitsOnly.length === 13 && !seen.has(digitsOnly)) {
      seen.add(digitsOnly);
      const isCheckDigitValid = verifyCorporateCheckDigit(digitsOnly);
      const normalizedNumber = `T${digitsOnly}`;

      results.push({
        raw: fullMatch,
        normalizedNumber,
        isValidFormat: true,
        isCheckDigitValid,
        details: isCheckDigitValid
          ? '国税庁法人番号チェックディジット：合格（適格）'
          : '個人事業主登録番号または要確認形式'
      });
    }
  }

  // もし T が OCR で抜けて「登録番号 1234567890123」となっているケースもフォールバック救済
  if (results.length === 0) {
    const fallbackRegex = /(?:登録番号|事業者番号|インボイス)[\s:：#No.番号]*(\d{13})/gi;
    let fbMatch: RegExpExecArray | null;
    while ((fbMatch = fallbackRegex.exec(cleaned)) !== null) {
      const digitsOnly = fbMatch[1];
      if (!seen.has(digitsOnly)) {
        seen.add(digitsOnly);
        const isCheckDigitValid = verifyCorporateCheckDigit(digitsOnly);
        results.push({
          raw: fbMatch[0],
          normalizedNumber: `T${digitsOnly}`,
          isValidFormat: true,
          isCheckDigitValid,
          details: '登録番号キーワードから検出'
        });
      }
    }
  }

  return results;
}
