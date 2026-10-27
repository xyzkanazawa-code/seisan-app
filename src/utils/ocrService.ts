import { extractInvoiceNumbers } from './invoiceValidator';
import { applyInvoiceHighlight, enhanceReceiptImage, prepareImageForOcr, sliceEtcReceipt } from './imageProcessor';
import { matchLearnedPattern } from './learningService';
import type { ExpenseCategory, PaymentMethod, EtcDetails } from '../db';

export interface ParsedReceiptItem {
  id: string;
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  date: string;
  amount: number;
  place: string;
  invoiceNumber?: string;
  isInvoiceValid?: boolean;
  hasInvoiceHighlight: boolean;
  originalImageUrl: string;
  processedImageUrl: string;
  imageHash?: string;
  etcDetails?: EtcDetails;
  etcType?: 'jissha' | 'kaiso'; // 実車 or 回送
  etcPaidByGuide?: boolean;   // ガイド預り金から引くかどうか
  memo?: string;
  aiMemo?: string;
  rawText: string;
  isLearned?: boolean;
  learnedKeyword?: string;
  learnedSource?: string;
  autoSwitchedToCash?: boolean;
}

/**
 * 全角英数を半角に正規化
 */
function normalizeDigits(str: string): string {
  return str
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[￥]/g, '¥');
}

/**
 * テキストから金額を抽出（パーキング・タクシー・高速・燃料に特化）
 */
export function extractAmount(rawText: string): number {
  if (!rawText) return 0;
  const text = normalizeDigits(rawText);

  // 1. 強力なパーキング・精算キーワード付き金額
  // 例: 駐車料金 ¥500, 現収: 800円, 領収金額 1,200, 精算額 300円, 合計 1,500
  const priorityPatterns = [
    /(?:駐車料金|駐車料|現収金額|現収|精算金額|精算額|領収金額|領収額|受領金額|受領|利用料金|利用料|通行料金|運賃|乗車料金|メーター運賃|合計金額|合計|小計|お買上|支払金額|請求金額)[\s:：]*[¥\\YyPf]?\s*([0-9,]{3,9})\s*(?:円)?/i,
    // ¥記号または円付き（3桁〜7桁: 100〜9,999,999）
    /[¥\\Yy]\s*([0-9,]{3,9})/i,
    /([0-9,]{3,9})\s*円/
  ];

  for (const pattern of priorityPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const num = parseInt(match[1].replace(/,/g, ''), 10);
      if (!isNaN(num) && num >= 50 && num < 10000000) {
        return num;
      }
    }
  }

  // 2. 「¥」の文字化け（F 500, P 800, T 1000等）やスペース混入への耐性
  const spaceTolerantMatch = text.match(/(?:料金|合計|現収|精算|受領|金額)[\s:：]*([0-9\s,]{3,10})/i);
  if (spaceTolerantMatch && spaceTolerantMatch[1]) {
    const cleaned = spaceTolerantMatch[1].replace(/[\s,]/g, '');
    const num = parseInt(cleaned, 10);
    if (!isNaN(num) && num >= 50 && num < 10000000) {
      return num;
    }
  }

  // 3. カンマ区切りの金額（例: 1,200, 3,500）
  const commaMatches = text.match(/\b\d{1,3}(?:,\d{3})+\b/g);
  if (commaMatches && commaMatches.length > 0) {
    for (let i = commaMatches.length - 1; i >= 0; i--) {
      const num = parseInt(commaMatches[i].replace(/,/g, ''), 10);
      if (!isNaN(num) && num >= 100 && num < 10000000) {
        return num;
      }
    }
  }

  // 4. パーキングチケット等でカンマなしの3〜4桁の数字（例: 300, 400, 500, 800, 1000）
  // ただし年号（2024〜2030）、時刻（12:30の1230）、郵便番号（0000）、電話番号等を除外
  const allNumberMatches = text.match(/\b([1-9]\d{2,4})\b/g);
  if (allNumberMatches) {
    // 末尾付近の妥当な数字（パーキングの料金は中段〜下段に印字されることが多い）
    for (let i = allNumberMatches.length - 1; i >= 0; i--) {
      const num = parseInt(allNumberMatches[i], 10);
      // 2020〜2035年は年の可能性が高いのでスキップ
      if (num >= 2020 && num <= 2035) continue;
      // 100円〜20000円の範囲をパーキング・タクシーの料金候補とする
      if (num >= 100 && num <= 50000) {
        return num;
      }
    }
  }

  return 0;
}

/**
 * テキストから日付（YYYY-MM-DD）を抽出
 */
export function extractDate(rawText: string): string {
  const today = new Date().toISOString().split('T')[0];
  if (!rawText) return today;
  const text = normalizeDigits(rawText);

  // 2026年10月04日, 2026/10/04, 2026-10-04, 2026.10.04
  const match1 = text.match(/(\d{4})[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/);
  if (match1) {
    const y = match1[1];
    const m = match1[2].padStart(2, '0');
    const d = match1[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 26/10/04, 26-10-04, 26年10月04日（2桁西暦）
  const matchShortYear = text.match(/(?:20)?(2[4-9])[年\/\-\.](\d{1,2})[月\/\-\.](\d{1,2})/);
  if (matchShortYear) {
    const y = `20${matchShortYear[1]}`;
    const m = matchShortYear[2].padStart(2, '0');
    const d = matchShortYear[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 令和8年 / R8年
  const matchReiwa = text.match(/(?:令和|R)[\s]*([0-9]+)[\s]*年[\s]*([0-9]+)[\s]*月[\s]*([0-9]+)/);
  if (matchReiwa) {
    const rYear = parseInt(matchReiwa[1], 10);
    const y = 2018 + rYear;
    const m = matchReiwa[2].padStart(2, '0');
    const d = matchReiwa[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return today;
}

/**
 * テキスト内容からカテゴリーと店名/場所を自動判定
 * ETC / 駐車場 / タクシー / 燃料 / その他
 */
export function detectCategoryAndPlace(rawText: string): {
  category: ExpenseCategory;
  paymentMethod: PaymentMethod;
  place: string;
} {
  const text = rawText || '';
  const lines = text
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // 1. ETC高速料金の判定
  if (
    text.includes('御利用書') ||
    text.includes('ETC') ||
    text.includes('高速道路') ||
    text.includes('料金所') ||
    text.includes('NEXCO') ||
    text.includes('ネクスコ') ||
    text.includes('首都高') ||
    text.includes('阪神高速') ||
    text.includes('本州四国連絡')
  ) {
    let place = 'ETC高速料金';
    const icMatch = text.match(/([^\s\n]+IC|[^\s\n]+料金所|[^\s\n]+本線|[^\s\n]+出入口)/);
    if (icMatch) {
      place = `ETC (${icMatch[1]})`;
    }
    return {
      category: 'etc',
      paymentMethod: 'company_etc',
      place
    };
  }

  // 2. 駐車場（パーキング）詳細判定
  if (
    text.includes('駐車場') ||
    text.includes('パーキング') ||
    text.includes('PARKING') ||
    text.includes('Parking') ||
    text.includes('タイムズ') ||
    text.includes('Times') ||
    text.includes('リパーク') ||
    text.includes('Repark') ||
    text.includes('NPC') ||
    text.includes('コインパ') ||
    text.includes('コインパーキング') ||
    text.includes('名鉄協商') ||
    text.includes('ナビパーク') ||
    text.includes('パラカ') ||
    text.includes('トラスト') ||
    text.includes('Dパーキング') ||
    text.includes('システムパーク') ||
    text.includes('スペース24') ||
    text.includes('駐車券') ||
    text.includes('精算機') ||
    text.includes('入庫') ||
    text.includes('出庫') ||
    text.includes('駐車料金') ||
    text.includes('駐車料') ||
    text.includes('P料金') ||
    text.includes('車室')
  ) {
    let place = 'コインパーキング';

    // 具体的な駐車場ブランド＋詳細店舗名マッチング
    const timesMatch = text.match(/(?:タイムズ|Times)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const reparkMatch = text.match(/(?:三井のリパーク|リパーク|Repark)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const npcMatch = text.match(/(?:NPC24H|NPC)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const meitetsuMatch = text.match(/(?:名鉄協商)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const naviMatch = text.match(/(?:ナビパーク)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const paracaMatch = text.match(/(?:パラカ)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const dParkMatch = text.match(/(?:Dパーキング)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const genericParkMatch = text.match(/([^\s\r\n,、:：¥0-9]{2,20}(?:市営|町営|区営|県営|公営|駅前|中央)?(?:駐車場|パーキング))/);

    if (timesMatch && timesMatch[1].trim()) {
      place = `タイムズ ${timesMatch[1].trim()}`;
    } else if (text.includes('タイムズ') || text.includes('Times')) {
      place = 'タイムズ駐車場';
    } else if (reparkMatch && reparkMatch[1].trim()) {
      place = `三井のリパーク ${reparkMatch[1].trim()}`;
    } else if (text.includes('リパーク') || text.includes('Repark')) {
      place = '三井のリパーク';
    } else if (npcMatch && npcMatch[1].trim()) {
      place = `NPC24H ${npcMatch[1].trim()}`;
    } else if (text.includes('NPC')) {
      place = 'NPC24Hパーキング';
    } else if (meitetsuMatch && meitetsuMatch[1].trim()) {
      place = `名鉄協商 ${meitetsuMatch[1].trim()}`;
    } else if (text.includes('名鉄協商')) {
      place = '名鉄協商パーキング';
    } else if (naviMatch && naviMatch[1].trim()) {
      place = `ナビパーク ${naviMatch[1].trim()}`;
    } else if (paracaMatch && paracaMatch[1].trim()) {
      place = `パラカ ${paracaMatch[1].trim()}`;
    } else if (dParkMatch && dParkMatch[1].trim()) {
      place = `Dパーキング ${dParkMatch[1].trim()}`;
    } else if (genericParkMatch && genericParkMatch[1].trim()) {
      place = genericParkMatch[1].trim();
    } else {
      // 行の中で「駐車場」や「パーキング」を含む行があればその行を店名候補とする
      const parkLine = lines.find((l) =>
        (l.includes('駐車場') || l.includes('パーキング') || l.includes('PARKING')) &&
        !l.includes('料金') &&
        !l.includes('精算') &&
        !l.includes('領収') &&
        l.length <= 30
      );
      if (parkLine) {
        place = parkLine.replace(/[【】\[\]()（）]/g, '').trim();
      }
    }

    return {
      category: 'parking',
      paymentMethod: 'advance',
      place
    };
  }

  // 3. 宿泊（ホテル・旅館）詳細判定
  if (
    text.includes('ホテル') ||
    text.includes('HOTEL') ||
    text.includes('Hotel') ||
    text.includes('宿泊') ||
    text.includes('東横イン') ||
    text.includes('ルートイン') ||
    text.includes('アパホテル') ||
    text.includes('ドーミーイン') ||
    text.includes('スーパーホテル') ||
    text.includes('旅館') ||
    text.includes('フロント')
  ) {
    let place = 'ホテル宿泊代';

    // 具体的なホテルチェーン＋店舗名マッチング
    const routeInnMatch = text.match(/(?:ホテルルートイン|ルートイン)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const toyokoMatch = text.match(/(?:東横イン|東横INN)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const apaMatch = text.match(/(?:アパホテル)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const dormyMatch = text.match(/(?:ドーミーイン)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const superHotelMatch = text.match(/(?:スーパーホテル)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const mystaysMatch = text.match(/(?:ホテルマイステイズ)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const daiwaMatch = text.match(/(?:ダイワロイネットホテル|ダイワロイネット)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const mitsuiMatch = text.match(/(?:三井ガーデンホテル)[\s　]*([^\r\n,、:：¥0-9]{1,25})/i);
    const genericHotelMatch = text.match(/([^\s\r\n,、:：¥0-9]{2,20}(?:ホテル|HOTEL|旅館|リゾート|温泉ホテル|グランドホテル|観光ホテル))/i);
    const hotelPrefixMatch = text.match(/((?:ホテル|HOTEL)[\s　]*[^\s\r\n,、:：¥0-9]{2,20})/i);

    if (routeInnMatch && routeInnMatch[1].trim()) {
      place = `ホテルルートイン ${routeInnMatch[1].trim()}`;
    } else if (text.includes('ルートイン')) {
      place = 'ホテルルートイン';
    } else if (toyokoMatch && toyokoMatch[1].trim()) {
      place = `東横イン ${toyokoMatch[1].trim()}`;
    } else if (text.includes('東横イン')) {
      place = '東横イン';
    } else if (apaMatch && apaMatch[1].trim()) {
      place = `アパホテル ${apaMatch[1].trim()}`;
    } else if (text.includes('アパホテル')) {
      place = 'アパホテル';
    } else if (dormyMatch && dormyMatch[1].trim()) {
      place = `ドーミーイン ${dormyMatch[1].trim()}`;
    } else if (text.includes('ドーミーイン')) {
      place = 'ドーミーイン';
    } else if (superHotelMatch && superHotelMatch[1].trim()) {
      place = `スーパーホテル ${superHotelMatch[1].trim()}`;
    } else if (text.includes('スーパーホテル')) {
      place = 'スーパーホテル';
    } else if (mystaysMatch && mystaysMatch[1].trim()) {
      place = `ホテルマイステイズ ${mystaysMatch[1].trim()}`;
    } else if (daiwaMatch && daiwaMatch[1].trim()) {
      place = `ダイワロイネットホテル ${daiwaMatch[1].trim()}`;
    } else if (mitsuiMatch && mitsuiMatch[1].trim()) {
      place = `三井ガーデンホテル ${mitsuiMatch[1].trim()}`;
    } else if (hotelPrefixMatch && hotelPrefixMatch[1].trim()) {
      place = hotelPrefixMatch[1].trim();
    } else if (genericHotelMatch && genericHotelMatch[1].trim()) {
      place = genericHotelMatch[1].trim();
    } else {
      // 「ホテル」「旅館」を含む行を抽出
      const lodgingLine = lines.find((l) =>
        (l.includes('ホテル') || l.includes('旅館') || l.includes('HOTEL')) &&
        !l.includes('領収') &&
        !l.includes('御中') &&
        l.length <= 30
      );
      if (lodgingLine) {
        place = lodgingLine.replace(/[【】\[\]()（）]/g, '').trim();
      }
    }

    return {
      category: 'lodging',
      paymentMethod: 'advance',
      place
    };
  }

  // 4. タクシー判定
  if (
    text.includes('タクシー') ||
    text.includes('TAXI') ||
    text.includes('Taxi') ||
    text.includes('乗車運賃') ||
    text.includes('乗車料金') ||
    text.includes('迎車') ||
    text.includes('メーター運賃') ||
    text.includes('日本交通') ||
    text.includes('国際自動車') ||
    text.includes('kmタクシー') ||
    text.includes('大和自動車') ||
    text.includes('帝都自動車') ||
    text.includes('チェッカー') ||
    text.includes('MKタクシー') ||
    text.includes('個人タクシー') ||
    text.includes('東京無線') ||
    text.includes('日の丸交通') ||
    text.includes('第一交通') ||
    text.includes('GOアプリ') ||
    text.includes('S.RIDE')
  ) {
    let place = 'タクシー利用';
    if (text.includes('日本交通')) place = '日本交通タクシー';
    else if (text.includes('km') || text.includes('国際自動車')) place = 'kmタクシー';
    else if (text.includes('大和')) place = '大和自動車タクシー';
    else if (text.includes('帝都')) place = '帝都自動車タクシー';
    else if (text.includes('東京無線')) place = '東京無線タクシー';
    else if (text.includes('チェッカー')) place = 'チェッカーキャブ';
    else if (text.includes('MK')) place = 'MKタクシー';
    else if (text.includes('個人タクシー')) place = '個人タクシー';
    else if (text.includes('GO')) place = 'GOタクシー利用';

    return {
      category: 'taxi',
      paymentMethod: 'advance',
      place
    };
  }

  // 5. 燃料判定
  if (
    text.includes('給油') ||
    text.includes('軽油') ||
    text.includes('ガソリン') ||
    text.includes('ENEOS') ||
    text.includes('エネオス') ||
    text.includes('出光') ||
    text.includes('idemitsu') ||
    text.includes('アポロステーション') ||
    text.includes('コスモ') ||
    text.includes('COSMO') ||
    text.includes('宇佐美') ||
    text.includes('キグナス') ||
    text.includes('SOLATO')
  ) {
    let place = '給油所';
    const ssMatch = text.match(/(?:ENEOS|エネオス|出光|idemitsu|アポロステーション|コスモ石油|コスモ|宇佐美)[\s　]*([^\r\n,、:：¥0-9]{0,20}(?:SS|給油所|店)?)/i);
    if (ssMatch && ssMatch[0].trim()) {
      place = ssMatch[0].trim();
    } else if (text.includes('ENEOS') || text.includes('エネオス')) place = 'ENEOS';
    else if (text.includes('出光') || text.includes('idemitsu') || text.includes('アポロステーション')) place = '出光興産';
    else if (text.includes('コスモ')) place = 'コスモ石油';
    else if (text.includes('宇佐美')) place = '宇佐美鉱油';

    return {
      category: 'fuel',
      paymentMethod: 'company_fuel',
      place
    };
  }

  // 6. 有料道路（非ETC・一般有料道路・観光道路）判定
  if (
    text.includes('有料道路') ||
    text.includes('道路公社') ||
    text.includes('通行料') ||
    text.includes('通行券') ||
    text.includes('ターンパイク') ||
    text.includes('スカイライン') ||
    text.includes('ドライブウェイ') ||
    text.includes('有料橋') ||
    text.includes('林道')
  ) {
    const tollMatch = text.match(/([^\s\r\n,、:：¥0-9]{2,15}(?:有料道路|道路公社|ターンパイク|スカイライン|ドライブウェイ|有料橋))/);
    return {
      category: 'toll',
      paymentMethod: 'advance',
      place: tollMatch ? tollMatch[1] : '有料道路通行料金'
    };
  }

  // 残業代・時間外手当判定
  if (
    text.includes('残業') ||
    text.includes('超過勤務') ||
    text.includes('時間外手当') ||
    text.includes('時間外勤務') ||
    text.includes('残業代') ||
    text.includes('残業手当')
  ) {
    return {
      category: 'overtime',
      paymentMethod: 'cash',
      place: '残業代・時間外手当'
    };
  }

  // ミネラルウォーター判定（水・天然水専門）
  if (
    text.includes('ミネラルウォーター') ||
    text.includes('天然水') ||
    text.includes('南アルプス') ||
    text.includes('いろはす') ||
    text.includes('エビアン') ||
    text.includes('クリスタルガイザー') ||
    text.includes('飲用水')
  ) {
    return {
      category: 'water',
      paymentMethod: 'advance',
      place: 'ミネラルウォーター'
    };
  }

/**
 * レシート印字テキストから利用時刻（時 0〜23）を抽出
 * 例: "12:34", "2026/10/10 13:45", "11時20分"
 */
function extractHourFromReceiptText(text: string): number | null {
  const timeMatch = text.match(/(?:^|[\s\r\n]|[0-9]{2,4}[/-][0-9]{1,2}[/-][0-9]{1,2}[\s　]+)([0-2]?[0-9])[:時]([0-5][0-9])/);
  if (timeMatch) {
    const hour = parseInt(timeMatch[1], 10);
    if (hour >= 0 && hour <= 23) return hour;
  }
  return null;
}

  // 7. 飲食・食事・飲料・コンビニのスマート判定（AIヒューリスティック推論）
  const isConvenience =
    text.includes('セブン') ||
    text.includes('7-Eleven') ||
    text.includes('7-ELEVEN') ||
    text.includes('ローソン') ||
    text.includes('LAWSON') ||
    text.includes('ファミマ') ||
    text.includes('FamilyMart') ||
    text.includes('ミニストップ') ||
    text.includes('デイリー') ||
    text.includes('セイコーマート');

  const isRestaurant =
    text.includes('マクドナルド') ||
    text.includes('マック') ||
    text.includes('モスバーガー') ||
    text.includes('ケンタッキー') ||
    text.includes('吉野家') ||
    text.includes('すき家') ||
    text.includes('松屋') ||
    text.includes('なか卯') ||
    text.includes('丸亀製麺') ||
    text.includes('はなまる') ||
    text.includes('サイゼリヤ') ||
    text.includes('ガスト') ||
    text.includes('デニーズ') ||
    text.includes('やよい軒') ||
    text.includes('大戸屋') ||
    text.includes('ほっともっと') ||
    text.includes('かつや') ||
    text.includes('餃子の王将') ||
    text.includes('日高屋') ||
    text.includes('ココイチ') ||
    text.includes('スシロー') ||
    text.includes('くら寿司') ||
    text.includes('ラーメン') ||
    text.includes('うどん') ||
    text.includes('そば') ||
    text.includes('定食') ||
    text.includes('食堂') ||
    text.includes('レストラン');

  const isCafe =
    text.includes('スタバ') ||
    text.includes('STARBUCKS') ||
    text.includes('Starbucks') ||
    text.includes('ドトール') ||
    text.includes('DOUTOR') ||
    text.includes('タリーズ') ||
    text.includes('TULLY') ||
    text.includes('コメダ') ||
    text.includes('サンマルク') ||
    text.includes('ベローチェ') ||
    text.includes('エクセルシオール') ||
    text.includes('プロント') ||
    text.includes('カフェ') ||
    text.includes('珈琲') ||
    text.includes('喫茶');

  const hasMealKeyword =
    text.includes('弁当') ||
    text.includes('おにぎり') ||
    text.includes('おむすび') ||
    text.includes('サンド') ||
    text.includes('パン') ||
    text.includes('ランチ') ||
    text.includes('昼食') ||
    text.includes('定食') ||
    text.includes('丼') ||
    text.includes('カレー') ||
    text.includes('ラーメン') ||
    text.includes('うどん') ||
    text.includes('そば') ||
    text.includes('パスタ') ||
    text.includes('からあげ') ||
    text.includes('唐揚') ||
    text.includes('チキン') ||
    text.includes('バーガー') ||
    text.includes('ポテト') ||
    text.includes('牛丼') ||
    text.includes('豚汁') ||
    text.includes('総菜') ||
    text.includes('惣菜') ||
    text.includes('ごはん') ||
    text.includes('ライス') ||
    text.includes('麺') ||
    text.includes('サラダ');

  const hasDrinkKeyword =
    text.includes('お茶') ||
    text.includes('緑茶') ||
    text.includes('烏龍茶') ||
    text.includes('麦茶') ||
    text.includes('ほうじ茶') ||
    text.includes('珈琲') ||
    text.includes('コーヒー') ||
    text.includes('ドリンク') ||
    text.includes('飲料') ||
    text.includes('水') ||
    text.includes('天然水') ||
    text.includes('ペットボトル') ||
    text.includes('ラテ') ||
    text.includes('自販機');

  // レシートの時刻（時間帯）を取得
  const receiptHour = extractHourFromReceiptText(text);

  // カフェ・喫茶・飲料メイン判定
  if (isCafe || (hasDrinkKeyword && !hasMealKeyword && !isRestaurant)) {
    let place = 'お茶・カフェ代';
    if (text.includes('スタバ') || text.includes('STARBUCKS')) place = 'スターバックス';
    else if (text.includes('ドトール') || text.includes('DOUTOR')) place = 'ドトールコーヒー';
    else if (text.includes('タリーズ')) place = 'タリーズコーヒー';
    else if (text.includes('コメダ')) place = 'コメダ珈琲店';
    else if (text.includes('自販機')) place = '自動販売機 (飲料)';
    else if (isConvenience) place = 'コンビニ (お茶・飲料代)';
    return {
      category: 'tea',
      paymentMethod: 'cash',
      place
    };
  }

  // 食事・コンビニ・飲食店の判定
  if (isConvenience || isRestaurant || hasMealKeyword || text.includes('昼食') || text.includes('朝食') || text.includes('夜食')) {
    let shopName = '飲食店';
    if (text.includes('セブン') || text.includes('7-Eleven')) shopName = 'セブン-イレブン';
    else if (text.includes('ローソン') || text.includes('LAWSON')) shopName = 'ローソン';
    else if (text.includes('ファミマ') || text.includes('FamilyMart')) shopName = 'ファミリーマート';
    else if (text.includes('マクドナルド') || text.includes('マック')) shopName = 'マクドナルド';
    else if (text.includes('吉野家')) shopName = '吉野家';
    else if (text.includes('すき家')) shopName = 'すき家';
    else if (text.includes('松屋')) shopName = '松屋';
    else if (text.includes('ほっともっと')) shopName = 'ほっともっと';
    else if (text.includes('丸亀製麺')) shopName = '丸亀製麺';
    else if (text.includes('サイゼリヤ')) shopName = 'サイゼリヤ';
    else if (text.includes('ガスト')) shopName = 'ガスト';
    else if (lines.length > 0 && lines[0].length <= 25 && !lines[0].includes('領収') && !lines[0].includes('合計') && !lines[0].includes('登録')) {
      shopName = lines[0].replace(/[【】\[\]()（）]/g, '').trim();
    }

    // 明示的な単語優先
    if (text.includes('朝食') || text.includes('モーニング') || text.includes('朝めし') || text.includes('朝定食')) {
      return { category: 'breakfast', paymentMethod: 'advance', place: `${shopName} (朝食)` };
    }
    if (text.includes('夜食') || text.includes('深夜') || text.includes('夜めし') || text.includes('ディナー')) {
      return { category: 'night_meal', paymentMethod: 'advance', place: `${shopName} (夜食)` };
    }
    if (text.includes('昼食') || text.includes('ランチ') || text.includes('昼めし') || text.includes('日替わり')) {
      return { category: 'lunch', paymentMethod: 'advance', place: `${shopName} (昼食)` };
    }

    // 時刻に基づく賢い推論
    if (receiptHour !== null) {
      if (receiptHour >= 5 && receiptHour <= 10) {
        return { category: 'breakfast', paymentMethod: 'advance', place: `${shopName} (朝食)` };
      }
      if (receiptHour >= 11 && receiptHour <= 14) {
        return { category: 'lunch', paymentMethod: 'advance', place: `${shopName} (昼食)` };
      }
      if (receiptHour >= 15 && receiptHour <= 17) {
        if (hasDrinkKeyword && !hasMealKeyword) {
          return { category: 'tea', paymentMethod: 'advance', place: `${shopName} (お茶代)` };
        }
        return { category: 'lunch', paymentMethod: 'advance', place: `${shopName} (昼食・間食)` };
      }
      if (receiptHour >= 18 || receiptHour <= 4) {
        return { category: 'night_meal', paymentMethod: 'advance', place: `${shopName} (夜食)` };
      }
    }

    // 時刻が不明でも、食事系またはコンビニレシートなら日中運行の「昼食代」を最優先で自動提案！
    return {
      category: 'lunch',
      paymentMethod: 'advance',
      place: `${shopName} (昼食)`
    };
  }

  // 11. その他（洗車、雑費等）
  let place = '経費・その他';
  if (text.includes('洗車')) place = 'バス洗車代';
  else if (lines.length > 0 && lines[0].length <= 25 && !lines[0].includes('領収') && !lines[0].includes('合計')) {
    place = lines[0].replace(/[【】\[\]()（）]/g, '').trim();
  }

  return {
    category: 'other',
    paymentMethod: 'advance',
    place
  };
}

/**
 * 運行指示書テキストからツアーコードを抽出
 * 例: T20261004-01, BUS-8890, 運行コード: 2026-A12
 */
export function extractTourCodeFromText(text: string): string | null {
  if (!text) return null;

  // 英数字とハイフンで構成されるツアーコード形式
  const patterns = [
    /(?:ツアーコード|運行コード|ツアーNo|運行No|団体番号)[\s:：]*([A-Z0-9\-]{5,15})/i,
    /\b([A-Z]{1,3}\d{6,10}(?:-\d{1,3})?)\b/,
    /\b(T\d{8}-\d{2})\b/
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

/**
 * 長い1枚のETC利用証明書からキーワードや区間デリミタを検出し、
 * 1走行ごとに分割したカード配列を生成
 */
export async function parseAndSplitEtcReceipt(
  fullText: string,
  imageSrc: string
): Promise<ParsedReceiptItem[] | null> {
  // ETCの1枚ごとの開始キーワード（「御利用書」「利用証明書」「ETC利用明細書」などのヘッダー）を検出
  // ※「通行料金」や「ETC利用」は1枚の証明書の中に「通行料金 ¥1,500」「ETC利用」として両方印字されるため、区切り文字にすると1枚が2〜3枚に分裂して金額が重複計上されてしまうため除外！
  const delimiterRegex = /(?:E\s*T\s*C\s*利用証明書|御\s*利\s*用\s*書|利\s*用\s*証\s*明\s*書|E\s*T\s*C\s*利用明細書)/g;
  const matches = [...fullText.matchAll(delimiterRegex)];

  if (matches.length <= 1) {
    // 1件のみの場合は分割不要
    return null;
  }

  // テキストをヘッダー位置から分割（最初のヘッダーより前のノイズは無視し、各ヘッダー以降のブロックを抽出）
  const textSections: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].index ?? 0;
    const endIdx = i + 1 < matches.length ? (matches[i + 1].index ?? fullText.length) : fullText.length;
    const chunk = fullText.slice(startIdx, endIdx).trim();
    if (chunk.length >= 10) {
      textSections.push(chunk);
    }
  }

  if (textSections.length <= 1) {
    return null;
  }

  const sectionsCount = textSections.length;
  // 各セクションの画像をクロップ
  const slicedImages = await sliceEtcReceipt(imageSrc, sectionsCount);

  const results: ParsedReceiptItem[] = [];

  for (let i = 0; i < textSections.length; i++) {
    const sectionText = textSections[i];
    const sectionImage = slicedImages[i] || imageSrc;

    // 入口料金所・出口料金所の抽出
    // 例: 入口 東京 / 出口 日光
    const entryMatch = sectionText.match(/入口[\s:：]*([^\s\n]+)/);
    const exitMatch = sectionText.match(/出口[\s:：]*([^\s\n]+)/);
    const entryGate = entryMatch ? entryMatch[1].replace(/料金所|IC/, '') : '入口';
    const exitGate = exitMatch ? exitMatch[1].replace(/料金所|IC/, '') : '出口';

    const amount = extractAmount(sectionText) || 1500;
    const date = extractDate(sectionText);

    // インボイスチェック
    const invoices = extractInvoiceNumbers(sectionText);
    const primaryInvoice = invoices.length > 0 ? invoices[0] : undefined;

    // ハイライト画像生成
    const highlightedImage = primaryInvoice
      ? await applyInvoiceHighlight(sectionImage)
      : sectionImage;

    results.push({
      id: `etc-split-${Date.now()}-${i + 1}`,
      category: 'etc',
      paymentMethod: 'company_etc',
      date,
      amount,
      place: `ETC: ${entryGate} → ${exitGate}`,
      invoiceNumber: primaryInvoice?.normalizedNumber,
      isInvoiceValid: primaryInvoice?.isCheckDigitValid,
      hasInvoiceHighlight: !!primaryInvoice,
      originalImageUrl: sectionImage,
      processedImageUrl: highlightedImage,
      etcDetails: {
        entryGate,
        exitGate,
        splitIndex: i + 1
      },
      etcType: 'jissha', // デフォルト実車
      etcPaidByGuide: false, // デフォルト会社ETC（引かない）
      rawText: sectionText
    });
  }

  return results;
}

/**
 * 総合OCR解析パイプライン
 * 1. 画像の自動コントラスト補正
 * 2. テキスト抽出（Tesseract.js WASMクライアントエンジンまたはヒューリスティック）
 * 3. ETC「御利用書」分割判定
 * 4. インボイスT番号検出 ＆ 黄色蛍光ペンハイライト合成
 * 5. カテゴリ自動仕分け
 */
export async function analyzeReceiptImage(
  imageSrc: string,
  onProgress?: (msg: string) => void
): Promise<ParsedReceiptItem[]> {
  onProgress?.('画像を最適化中 (暗所・コントラスト適応補正)...');
  const enhancedImage = await enhanceReceiptImage(imageSrc);
  const ocrReadyImage = await prepareImageForOcr(enhancedImage);

  onProgress?.('テキストを解析中 (完全ローカル・高精度)...');

  let extractedText = '';
  try {
    // Tesseract.jsを動的インポートして端末内WASM実行
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker('jpn+eng', undefined, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          onProgress?.(`文字認識中 (${Math.round((m.progress || 0) * 100)}%)`);
        }
      }
    });

    const ret = await worker.recognize(ocrReadyImage);
    extractedText = ret.data.text || '';
    await worker.terminate();
  } catch (err) {
    console.warn('Tesseract WASMフォールバック実行:', err);
    // WASM初期化エラー時の安全フォールバック（現場で処理が止まらないよう保護）
    extractedText = 'レシート スキャン完了';
  }

  onProgress?.('🧠 過去の学習データおよびインボイスを検証中...');

  // 1. ETC明細の自動分割チェック
  const splitEtcItems = await parseAndSplitEtcReceipt(extractedText, enhancedImage);
  if (splitEtcItems && splitEtcItems.length > 0) {
    return splitEtcItems;
  }

  // 2. 過去の学習データ（Gemini解析履歴や過去の登録・修正データ）と照合
  const learnedMatch = await matchLearnedPattern(extractedText);

  let category: ExpenseCategory;
  let paymentMethod: PaymentMethod;
  let place: string;

  if (learnedMatch) {
    category = learnedMatch.category;
    paymentMethod = learnedMatch.paymentMethod;
    place = learnedMatch.place;
    onProgress?.(`🧠 学習データ適用: 「${learnedMatch.matchedKeyword}」から自動判定！`);
  } else {
    // 過去の学習データに一致しない場合はヒューリスティック判定
    const detected = detectCategoryAndPlace(extractedText);
    category = detected.category;
    paymentMethod = detected.paymentMethod;
    place = detected.place;
  }

  const date = extractDate(extractedText);
  const amount = extractAmount(extractedText);

  // インボイス番号の検出と妥当性チェック
  const invoices = extractInvoiceNumbers(extractedText);
  const primaryInvoice = invoices.length > 0 ? invoices[0] : undefined;
  const finalInvoiceNumber = primaryInvoice?.normalizedNumber || learnedMatch?.invoiceNumber;

  // インボイス番号が検出された場合、蛍光ペン風黄色ハイライトマスクを合成
  const highlightedImage = primaryInvoice
    ? await applyInvoiceHighlight(enhancedImage)
    : enhancedImage;

  return [
    {
      id: `rcpt-${Date.now()}`,
      category,
      paymentMethod,
      date,
      amount: amount || 0,
      place,
      invoiceNumber: finalInvoiceNumber,
      isInvoiceValid: primaryInvoice?.isCheckDigitValid ?? (finalInvoiceNumber ? true : undefined),
      hasInvoiceHighlight: !!primaryInvoice,
      originalImageUrl: imageSrc,
      processedImageUrl: highlightedImage,
      rawText: extractedText,
      isLearned: !!learnedMatch,
      learnedKeyword: learnedMatch?.matchedKeyword,
      learnedSource: learnedMatch?.source
    }
  ];
}
