import { jsPDF } from 'jspdf';
import type { Tour, Receipt, DriverProfile, PaymentMethod } from '../db';
import { sortReceiptsByDate } from './receiptSort';

export interface PdfGenerationResult {
  blob: Blob;
  dataUri: string;
  fileName: string;
  summaryPreviewUrl?: string;
  dailySummaryPreviewUrl?: string; // 送付画像に基づく日別集計表サンプルプレビューURL
}

export interface DailyEtcBreakdown {
  date: string;
  etcJissha: number;     // 実車ETC
  etcKaiso: number;      // 回送ETC
  etcGuidePaid: number;  // ガイド預り金から引くETC
  etcCompany: number;    // 会社ETC（引かない）
  otherTotal: number;    // ETC以外の経費計
  dayTotal: number;      // その日の全支出合計
}

/**
 * 項目別集計サマリー（実車・回送ETC、ガイド預り金切替連動）
 */
export function calculateTourSummary(receipts: Receipt[], advancePayment: number) {
  const categoryTotals = {
    etc: 0,
    toll: 0,
    parking: 0,
    fuel: 0,
    breakfast: 0,
    lunch: 0,
    night_meal: 0,
    tea: 0,
    water: 0,
    taxi: 0,
    lodging: 0,
    overtime: 0,
    other: 0
  };

  const paymentTotals: Record<PaymentMethod, number> = {
    advance: 0,
    cash: 0,
    company_etc: 0,
    company_fuel: 0,
    company_card: 0
  };

  let grandTotal = 0;
  let etcJissha = 0;    // ETC実車
  let etcKaiso = 0;     // ETC回送
  let etcGuidePaid = 0; // ガイド預り金から引くETC
  let etcCompany = 0;   // 会社ETCカード（ガイド預り金からは引かない）

  for (const r of receipts) {
    categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amount;
    // ETCで「ガイド預り金から引く (etcPaidByGuide === true)」とした場合は仮払金(advance)からマイナスする
    // 逆にETCで「引かない」場合は会社ETC(company_etc)として仮払金からは引かない
    const pm: PaymentMethod =
      r.category === 'etc'
        ? r.etcPaidByGuide
          ? 'advance'
          : 'company_etc'
        : r.paymentMethod || 'advance';
    paymentTotals[pm] = (paymentTotals[pm] || 0) + r.amount;
    grandTotal += r.amount;

    // ETCの回送 / 実車・ガイド預り金分類
    if (r.category === 'etc') {
      if (r.etcType === 'kaiso') {
        etcKaiso += r.amount;
      } else {
        etcJissha += r.amount; // デフォルトは実車
      }

      if (r.etcPaidByGuide) {
        etcGuidePaid += r.amount;
      } else {
        etcCompany += r.amount;
      }
    }
  }

  // 前払い金（仮払金）として登録された実費合計
  const rawAdvanceOutlay = paymentTotals.advance;
  // 個人立替として登録された実費合計
  const rawCashOutlay = paymentTotals.cash;

  // ★前払金がなくなり次第、自動的に個人立替に振り替え
  // 前払い金から充当できる最大実費（上限は前払金額）
  const advanceOutlay = Math.min(rawAdvanceOutlay, advancePayment);
  // 前払金を使い切って超過した分（自動で個人立替に算入）
  const autoCashFromAdvance = Math.max(0, rawAdvanceOutlay - advancePayment);
  // 実際の個人立替合計（手動個人立替 + 前払金超過分）
  const cashOutlay = rawCashOutlay + autoCashFromAdvance;

  // 乗務員が直接支払った実費計（前払い金実費 + 個人立替実費）
  const totalDriverPaid = rawAdvanceOutlay + rawCashOutlay;

  // 前払い金の差引残金（0未満にはならず、使い切ったら0円）
  const advanceRemaining = Math.max(0, advancePayment - rawAdvanceOutlay);

  // 会社との最終精算差引額（前払い金 - 乗務員直接実費計）
  // プラスなら会社へ返納、マイナスなら会社へ請求
  const balance = advancePayment - totalDriverPaid;

  return {
    categoryTotals,
    paymentTotals,
    grandTotal,
    etcJissha,
    etcKaiso,
    etcGuidePaid,
    etcCompany,
    advanceOutlay,
    cashOutlay,
    rawAdvanceOutlay,
    rawCashOutlay,
    autoCashFromAdvance,
    totalDriverPaid,
    advanceRemaining,
    balance
  };
}

/**
 * 日々の計算（日別集計・実車回送ETC分離）
 */
export function calculateDailyBreakdown(receipts: Receipt[]): DailyEtcBreakdown[] {
  const map = new Map<string, DailyEtcBreakdown>();

  for (const r of receipts) {
    const d = r.date || '日付未設定';
    let entry = map.get(d);
    if (!entry) {
      entry = {
        date: d,
        etcJissha: 0,
        etcKaiso: 0,
        etcGuidePaid: 0,
        etcCompany: 0,
        otherTotal: 0,
        dayTotal: 0
      };
      map.set(d, entry);
    }

    entry.dayTotal += r.amount;

    if (r.category === 'etc') {
      if (r.etcType === 'kaiso') {
        entry.etcKaiso += r.amount;
      } else {
        entry.etcJissha += r.amount;
      }

      if (r.etcPaidByGuide) {
        entry.etcGuidePaid += r.amount;
      } else {
        entry.etcCompany += r.amount;
      }
    } else {
      entry.otherTotal += r.amount;
    }
  }

  // 日付昇順でソート
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * A4サイズ（幅210mm x 高さ297mm）のCanvasコンテキストを作成（高解像度 2xスケール）
 */
function createA4Canvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  // A4 @ 150 DPI = 1240 x 1754 px (縦向き)
  canvas.width = 1240;
  canvas.height = 1754;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/**
 * A4横向き（幅297mm x 高さ210mm）のCanvasコンテキストを作成
 */
function createA4LandscapeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  // A4 横 @ 150 DPI = 1754 x 1240 px (横向き)
  canvas.width = 1754;
  canvas.height = 1240;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/**
 * 表紙・項目別集計表（鑑表）ページをCanvasに美しく描画
 */
async function renderSummaryPage(
  tour: Tour,
  receipts: Receipt[],
  profile: DriverProfile
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createA4Canvas();
  const summary = calculateTourSummary(receipts, tour.advancePayment);

  // ヘッダー装飾（藍色・ネイビーの上品なアクセントバー）
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(40, 40, canvas.width - 80, 8);

  // タイトル
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 36px "Noto Sans JP", sans-serif';
  ctx.fillText('乗務員 運行経費精算書（項目別集計）', 60, 100);

  // 右上: 発行日・提出日
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  ctx.font = '16px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(`作成日: ${todayStr}`, canvas.width - 250, 95);

  // ツアー・乗務員基本情報ボックス（高さを155pxに拡張して自社・相手先情報を網羅）
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(60, 125, canvas.width - 120, 145);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(60, 125, canvas.width - 120, 145);

  ctx.fillStyle = '#1e293b';

  // 左列（ツアー運行情報 & 相手先・発注元会社）
  ctx.font = 'bold 17px "Noto Sans JP", sans-serif';
  ctx.fillText(`ツアーコード: ${tour.code}`, 85, 155);

  ctx.font = '15px "Noto Sans JP", sans-serif';
  ctx.fillText(`ツアー運行名: ${tour.title || '運行経費'}`, 85, 185);

  const clientInfo = tour.clientCompanyName
    ? `${tour.clientCompanyName}${tour.clientContactName ? `（担当: ${tour.clientContactName}）` : ''}`
    : 'ー';
  ctx.fillStyle = '#1e40af';
  ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
  ctx.fillText(`発注元(相手先): ${clientInfo}`, 85, 215);

  ctx.fillStyle = '#475569';
  ctx.font = '14px "Noto Sans JP", sans-serif';
  ctx.fillText(`運行期間: ${tour.startDate} 〜 ${tour.endDate}`, 85, 245);

  // 右列（運行会社名・乗務員名・連絡先TEL・住所）
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillText(`運行会社: ${profile.companyName || '所属会社未設定'}`, 650, 155);

  ctx.font = '14px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(`乗務員氏名: ${profile.driverName}（No: ${profile.staffId}） / 車両: ${profile.vehicleNumber}`, 650, 185);
  ctx.fillText(`会社連絡先: ${profile.phoneNumber || 'ー'}`, 650, 215);

  let addressStr = profile.address || 'ー';
  if (addressStr.length > 25) {
    addressStr = addressStr.substring(0, 24) + '…';
  }
  ctx.fillText(`会社所在地: ${addressStr}`, 650, 245);

  // 精算金サマリーボックス（最重要ハイライト領域）
  const balanceBg = summary.balance >= 0 ? '#eff6ff' : '#fef2f2';
  const balanceBorder = summary.balance >= 0 ? '#3b82f6' : '#ef4444';
  const balanceText = summary.balance >= 0 ? '#1d4ed8' : '#b91c1c';

  ctx.fillStyle = balanceBg;
  ctx.fillRect(60, 285, canvas.width - 120, 110);
  ctx.strokeStyle = balanceBorder;
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 285, canvas.width - 120, 110);

  // サマリー内訳
  ctx.fillStyle = '#334155';
  ctx.font = '15px "Noto Sans JP", sans-serif';
  ctx.fillText('仮払金（前払い金）', 90, 315);
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`¥${tour.advancePayment.toLocaleString()}`, 90, 350);

  ctx.fillStyle = '#334155';
  ctx.font = '15px "Noto Sans JP", sans-serif';
  ctx.fillText('前払い金充当実費', 330, 315);
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`¥${summary.advanceOutlay.toLocaleString()}`, 330, 350);

  ctx.fillStyle = '#334155';
  ctx.font = '15px "Noto Sans JP", sans-serif';
  ctx.fillText(summary.cashOutlay > 0 ? '個人立替実費計' : '経費総支出（カード含）', 570, 315);
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(
    summary.cashOutlay > 0
      ? `¥${summary.cashOutlay.toLocaleString()}`
      : `¥${summary.grandTotal.toLocaleString()}`,
    570,
    350
  );

  // 差引精算額
  ctx.fillStyle = balanceText;
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  const balanceLabel = summary.balance >= 0 ? '【前払い金 差引返納額】' : '【個人立替 不足請求額】';
  ctx.fillText(balanceLabel, 850, 315);
  ctx.font = 'bold 28px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`¥${Math.abs(summary.balance).toLocaleString()}`, 850, 355);

  // 項目別集計テーブル
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 20px "Noto Sans JP", sans-serif';
  ctx.fillText('■ 項目別集計内訳', 60, 430);

  // テーブルヘッダー
  let tableY = 450;
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(60, tableY, canvas.width - 120, 36);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillText('精算項目', 80, tableY + 24);
  ctx.fillText('件数', 280, tableY + 24);
  ctx.fillText('前払い金・立替額', 450, tableY + 24);
  ctx.fillText('会社カード/掛', 680, tableY + 24);
  ctx.fillText('項目小計（税込）', 920, tableY + 24);

  // テーブル各行（ETC、有料道、駐車場、燃料、朝食代、昼食代、夜食代、お茶代、ミネラルウォーター、タクシー、宿泊、残業代、その他）
  const categories: { key: keyof typeof summary.categoryTotals; label: string }[] = [
    { key: 'etc', label: 'ETC高速通行料金' },
    { key: 'toll', label: '有料道路代（非ETC等）' },
    { key: 'parking', label: '駐車場代・パーキング' },
    { key: 'fuel', label: '燃料・軽油代' },
    { key: 'breakfast', label: '朝食代（食事・弁当）' },
    { key: 'lunch', label: '昼食代（食事・弁当）' },
    { key: 'night_meal', label: '夜食代（夜食・食事）' },
    { key: 'tea', label: 'お茶代・飲料費' },
    { key: 'water', label: 'ミネラルウォーター' },
    { key: 'taxi', label: 'タクシー代・緊急移動' },
    { key: 'lodging', label: '宿泊代・ホテル' },
    { key: 'overtime', label: '残業代・時間外手当' },
    { key: 'other', label: 'その他雑費・諸経費' }
  ];

  tableY += 34;
  const rowHeight = 29;
  categories.forEach((cat, idx) => {
    const catReceipts = receipts.filter((r) => r.category === cat.key);
    const count = catReceipts.length;
    const directSum = catReceipts
      .filter((r) =>
        r.category === 'etc'
          ? Boolean(r.etcPaidByGuide)
          : r.paymentMethod === 'advance' || r.paymentMethod === 'cash'
      )
      .reduce((s, r) => s + r.amount, 0);
    const cardSum = catReceipts
      .filter((r) =>
        r.category === 'etc'
          ? !r.etcPaidByGuide
          : r.paymentMethod !== 'advance' && r.paymentMethod !== 'cash'
      )
      .reduce((s, r) => s + r.amount, 0);
    const total = summary.categoryTotals[cat.key];

    ctx.fillStyle = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(60, tableY, canvas.width - 120, rowHeight);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(60, tableY, canvas.width - 120, rowHeight);

    ctx.fillStyle = '#1e293b';
    ctx.font = '14px "Noto Sans JP", sans-serif';
    ctx.fillText(cat.label, 80, tableY + 22);
    ctx.fillText(`${count} 件`, 280, tableY + 22);
    ctx.fillText(`¥${directSum.toLocaleString()}`, 450, tableY + 22);
    ctx.fillText(`¥${cardSum.toLocaleString()}`, 680, tableY + 22);
    ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
    ctx.fillText(`¥${total.toLocaleString()}`, 920, tableY + 22);

    tableY += rowHeight;
  });

  // 総合計行
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(60, tableY, canvas.width - 120, 42);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(60, tableY, canvas.width - 120, 42);

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  ctx.fillText('総合計', 80, tableY + 27);
  ctx.fillText(`${receipts.length} 件`, 280, tableY + 27);
  ctx.fillText(`¥${summary.totalDriverPaid.toLocaleString()}`, 450, tableY + 27);
  ctx.fillText(
    `¥${(summary.grandTotal - summary.totalDriverPaid).toLocaleString()}`,
    680,
    tableY + 27
  );
  ctx.fillStyle = '#1e3a8a';
  ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
  ctx.fillText(`¥${summary.grandTotal.toLocaleString()}`, 920, tableY + 27);

  tableY += 42;

  // 承認印欄（会社提出用のサイン枠）
  const signY = tableY + 30;
  const signBoxW = 120;
  const signBoxH = 90;
  const startX = canvas.width - 60 - signBoxW * 4;

  const signTitles = ['所属長', '配車係', '経理担当', '乗務員'];
  signTitles.forEach((title, i) => {
    const x = startX + i * signBoxW;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, signY, signBoxW, 26);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, signY, signBoxW, signBoxH);

    ctx.fillStyle = '#334155';
    ctx.font = '13px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title, x + signBoxW / 2, signY + 18);
  });
  ctx.textAlign = 'left';

  // 備考メモ
  const memoY = signY + signBoxH + 30;
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  ctx.fillText('■ 備考・連絡事項', 60, memoY);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(60, memoY + 20, canvas.width - 120, 80);
  ctx.strokeStyle = '#cbd5e1';
  ctx.strokeRect(60, memoY + 20, canvas.width - 120, 80);
  ctx.fillStyle = '#475569';
  ctx.font = '14px "Noto Sans JP", sans-serif';
  ctx.fillText(
    tour.memo || '・各レシート原本およびETC利用明細書は、次ページ以降の各項目別貼付台紙（駐車場代、有料道路代、飲食お茶代等）に原寸添付。',
    80,
    memoY + 55
  );

  // フッター注意書き
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px "Noto Sans JP", sans-serif';
  ctx.fillText(
    '※ 本書類は端末ローカルにて生成された公式運行経費精算書類です。原本画像は各項目別（駐車場・有料道・飲食お茶代等）のA4原寸台紙に整理添付しています。',
    60,
    canvas.height - 50
  );

  return canvas;
}

/**
 * 送付された清算書フォーマットに基づく「日別項目別集計表（サンプル鑑表）」のCanvas描画
 * 特徴:
 *  - 横軸: 1日目〜7日目の日別（日付・曜日）＋ 各項目小計
 *  - 縦軸: 預り金（仮払金・繰越金・ガイド預り金）、高速料金（実車・回送）、給油、支出項目（有料道・駐車・交通・宿泊・お茶・食事・残業・その他）
 *  - 右端: 入金合計（収歓総額）、出金合計（支出総額）、残高
 *  - 下部: 水積込/残本数、上記相違ありません、ガイド様署名欄
 */
export async function renderDailySummarySamplePage(
  tour: Tour,
  receipts: Receipt[],
  profile: DriverProfile
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createA4LandscapeCanvas();

  // 背景クリア（白）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // マージン設定
  const leftX = 40;
  const topY = 25;
  const tableW = canvas.width - leftX * 2; // 1674px

  // 1. 最上部ヘッダー（安全運転メッセージ & NO.）
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillText(`NO. ${tour.code || ''}`, leftX, topY + 16);

  ctx.textAlign = 'center';
  ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
  ctx.fillText('いつも安全運転していただき誠にありがとうございます！', canvas.width / 2, topY + 16);
  ctx.textAlign = 'left';

  // 2. 基本情報ヘッダー枠（清算書 / ツアー情報 / 会社情報）
  const infoY = topY + 28;
  const infoH = 105;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(leftX, infoY, tableW, infoH);

  // 左枠: 「清算書」（幅160px）
  const titleBoxW = 160;
  ctx.strokeRect(leftX, infoY, titleBoxW, infoH);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 32px "Noto Serif JP", serif, "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('清算書', leftX + titleBoxW / 2, infoY + 65);
  ctx.textAlign = 'left';

  // 中央枠: ツアー情報（幅840px、3行）
  const midBoxW = 850;
  const midBoxX = leftX + titleBoxW;
  ctx.strokeRect(midBoxX, infoY, midBoxW, infoH);

  const rowH = infoH / 3;
  ctx.beginPath();
  ctx.moveTo(midBoxX, infoY + rowH);
  ctx.lineTo(midBoxX + midBoxW, infoY + rowH);
  ctx.moveTo(midBoxX, infoY + rowH * 2);
  ctx.lineTo(midBoxX + midBoxW, infoY + rowH * 2);
  ctx.stroke();

  ctx.font = '16px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#000000';
  // 1行目: ツアーコード（団号）
  ctx.fillText(`ツアーコード（団号）： ${tour.code} ${tour.title ? `(${tour.title})` : ''}`, midBoxX + 16, infoY + 24);
  // 2行目: 名前（フルネーム、全称）
  ctx.fillText(`名前（フルネーム、全称）： ${profile.driverName || '担当乗務員未登録'}`, midBoxX + 16, infoY + rowH + 24);
  // 3行目: 車両情報（车辆信息）
  ctx.fillText(`車両情報（车辆信息）： ${profile.vehicleNumber || '未登録'}`, midBoxX + 16, infoY + rowH * 2 + 24);

  // 右枠: 会社情報（幅残り664px）
  const rightBoxX = midBoxX + midBoxW;
  const rightBoxW = tableW - titleBoxW - midBoxW;
  ctx.strokeRect(rightBoxX, infoY, rightBoxW, infoH);

  const compName = profile.companyName || '株式会社 全日本交通';
  const compAddr = profile.address || '〒590-0521 泉南市樽井 3-39-19';
  const compTel = profile.phoneNumber ? `TEL : ${profile.phoneNumber}` : 'TEL : 072-468-6208';

  ctx.textAlign = 'center';
  ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
  ctx.fillText(compName, rightBoxX + rightBoxW / 2, infoY + 30);
  ctx.font = '14px "Noto Sans JP", sans-serif';
  ctx.fillText(compAddr, rightBoxX + rightBoxW / 2, infoY + 60);
  ctx.fillText(compTel, rightBoxX + rightBoxW / 2, infoY + 86);
  ctx.textAlign = 'left';

  // 3. メインマトリクス表の設計
  const mainY = infoY + infoH; // 158px
  const colCatW = 46;          // 大区分（預り金・高速料金）
  const colNameW = 230;        // 項目名
  const numDays = 7;           // 基本7日枠
  const colDayW = 135;         // 日別列幅 (135 * 7 = 945px)
  const colSubW = 165;         // 各項目小計
  const colTotalW = tableW - (colCatW + colNameW + colDayW * numDays + colSubW); // 288px (入金合計・出金合計枠)

  // 日付の配列生成
  const daysOfWeekJa = ['日', '月', '火', '水', '木', '金', '土'];
  const startD = new Date(tour.startDate);
  const dateColumns: { key: string; headerDate: string; headerDow: string }[] = [];

  for (let i = 0; i < numDays; i++) {
    if (!isNaN(startD.getTime())) {
      const cur = new Date(startD);
      cur.setDate(startD.getDate() + i);
      const m = cur.getMonth() + 1;
      const d = cur.getDate();
      const dow = daysOfWeekJa[cur.getDay()];
      const yyyy = cur.getFullYear();
      const mm = String(m).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      dateColumns.push({
        key: `${yyyy}-${mm}-${dd}`,
        headerDate: `${m} / ${d}`,
        headerDow: `( ${dow} )`
      });
    } else {
      dateColumns.push({
        key: `day_${i}`,
        headerDate: ' / ',
        headerDow: '(   )'
      });
    }
  }

  // 4. テーブルヘッダー行（高さ 60px）
  const thH = 60;
  ctx.strokeRect(leftX, mainY, tableW, thH);

  // 左上セル: 日付（日期） / 出入金項目（収支項目）
  const headerLeftW = colCatW + colNameW;
  ctx.strokeRect(leftX, mainY, headerLeftW, thH);
  ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
  ctx.fillText('日付（日期）', leftX + 14, mainY + 24);
  ctx.fillText('出入金項目（収支項目）', leftX + 14, mainY + 48);

  // 日付列ヘッダー（7列）
  let curX = leftX + headerLeftW;
  for (let i = 0; i < numDays; i++) {
    ctx.strokeRect(curX, mainY, colDayW, thH);
    ctx.textAlign = 'center';
    ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
    ctx.fillText(dateColumns[i].headerDate, curX + colDayW / 2, mainY + 26);
    ctx.font = '14px "Noto Sans JP", sans-serif';
    ctx.fillText(dateColumns[i].headerDow, curX + colDayW / 2, mainY + 48);
    curX += colDayW;
  }

  // 各項目小計列ヘッダー
  ctx.strokeRect(curX, mainY, colSubW, thH);
  ctx.fillText('各項目小計', curX + colSubW / 2, mainY + 26);
  ctx.font = '13px "Noto Sans JP", sans-serif';
  ctx.fillText('(各項目小計)', curX + colSubW / 2, mainY + 48);
  curX += colSubW;

  // 右端ヘッダー（入金合計の上部）
  ctx.strokeRect(curX, mainY, colTotalW, thH);
  ctx.textAlign = 'left';

  // 5. 各行データの集計ロジック
  // 日別・項目別マップの初期化
  const dayTotals: Record<string, number> = {};
  dateColumns.forEach((c) => {
    dayTotals[c.key] = 0;
  });

  // レシートを日付・項目別に集計
  const getAmount = (filterFn: (r: Receipt) => boolean, dateKey: string) => {
    return receipts
      .filter((r) => r.date === dateKey && filterFn(r))
      .reduce((sum, r) => sum + r.amount, 0);
  };

  const getSubtotal = (filterFn: (r: Receipt) => boolean) => {
    return receipts.filter(filterFn).reduce((sum, r) => sum + r.amount, 0);
  };

  // 行定義
  interface RowDef {
    id: string;
    name: string;
    subtext?: string;
    filter?: (r: Receipt) => boolean;
    isIncome?: boolean;
    customAmounts?: (dateKey: string, idx: number) => number | string;
    customSubtotal?: () => number | string;
  }

  // 預り金セクション
  const incomeRows: RowDef[] = [
    {
      id: 'advance',
      name: '仮払金 / 前渡し金 (円)',
      isIncome: true,
      customAmounts: (_k, idx) => (idx === 0 ? tour.advancePayment : ''),
      customSubtotal: () => tour.advancePayment
    },
    {
      id: 'guide_highway',
      name: 'ガイドからの預り金（高速）',
      isIncome: true,
      filter: (r) => r.category === 'etc' && !!r.etcPaidByGuide
    },
    {
      id: 'guide_overtime',
      name: 'ガイドからの預り金（残業）',
      isIncome: true,
      filter: (r) => r.category === 'overtime'
    }
  ];

  // 高速料金セクション（実車・回送ボタン完全連動 ※現金有料道路(toll)は下の支出セクションで集計するため二重計上を防止）
  const highwayRows: RowDef[] = [
    {
      id: 'highway_actual',
      name: '実車（載有乗客的车）',
      filter: (r) => r.category === 'etc' && r.etcType !== 'kaiso' && !r.memo?.includes('回送')
    },
    {
      id: 'highway_empty',
      name: '回送（空車掉頭）',
      filter: (r) => r.category === 'etc' && (r.etcType === 'kaiso' || !!r.memo?.includes('回送'))
    }
  ];

  // 支出項目セクション（給油数量は削除し、ミネラルウォーター代を追加）
  const expenseRows: RowDef[] = [
    {
      id: 'toll',
      name: '現金有料道路（現金収費道路）',
      filter: (r) => r.category === 'toll'
    },
    {
      id: 'parking',
      name: '駐車料金（停車費）',
      filter: (r) => r.category === 'parking'
    },
    {
      id: 'taxi',
      name: '交通費（タクシー等）',
      subtext: '(交通費：出租車等)',
      filter: (r) => r.category === 'taxi'
    },
    {
      id: 'lodging',
      name: '宿泊代（住宿費）',
      filter: (r) => r.category === 'lodging'
    },
    {
      id: 'tea',
      name: 'お茶代（茶費）',
      filter: (r) => r.category === 'tea'
    },
    {
      id: 'water',
      name: 'ミネラルウォーター代（矿泉水费）',
      filter: (r) => r.category === 'water'
    },
    {
      id: 'meal',
      name: '食事代（餐費）',
      filter: (r) => r.category === 'breakfast' || r.category === 'lunch' || r.category === 'night_meal'
    },
    {
      id: 'overtime',
      name: '残業代（加班費）',
      filter: (r) => r.category === 'overtime'
    },
    {
      id: 'other',
      name: 'その他（其他）',
      filter: (r) => r.category === 'other'
    }
  ];

  // 行の描画関数
  let tableY = mainY + thH;
  const standardRowH = 46;

  // 縦結合セルの描画ユーティリティ
  const drawVerticalLabel = (text: string, x: number, y: number, w: number, h: number) => {
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    const chars = text.split('');
    const charH = 20;
    const startY = y + (h - chars.length * charH) / 2 + 14;
    chars.forEach((c, i) => {
      ctx.fillText(c, x + w / 2, startY + i * charH);
    });
    ctx.textAlign = 'left';
  };

  // 5-1. 預り金セクション（3行）
  const incomeSecH = standardRowH * incomeRows.length;
  drawVerticalLabel('預り金', leftX, tableY, colCatW, incomeSecH);

  incomeRows.forEach((row, rIdx) => {
    const rowY = tableY + rIdx * standardRowH;
    // 項目名セル
    ctx.strokeRect(leftX + colCatW, rowY, colNameW, standardRowH);
    ctx.fillStyle = '#000000';
    ctx.font = '14px "Noto Sans JP", sans-serif';
    ctx.fillText(row.name, leftX + colCatW + 10, rowY + 28);

    // 日付列
    let x = leftX + headerLeftW;
    dateColumns.forEach((col, cIdx) => {
      ctx.strokeRect(x, rowY, colDayW, standardRowH);
      const val = row.customAmounts
        ? row.customAmounts(col.key, cIdx)
        : row.filter
        ? getAmount(row.filter, col.key)
        : '';
      if (typeof val === 'number' && val > 0) {
        ctx.textAlign = 'right';
        ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`¥${val.toLocaleString()}`, x + colDayW - 10, rowY + 28);
        ctx.textAlign = 'left';
      }
      x += colDayW;
    });

    // 小計列
    ctx.strokeRect(x, rowY, colSubW, standardRowH);
    const subVal = row.customSubtotal
      ? row.customSubtotal()
      : row.filter
      ? getSubtotal(row.filter)
      : 0;
    if (typeof subVal === 'number' && subVal > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`¥${subVal.toLocaleString()}`, x + colSubW - 10, rowY + 28);
      ctx.textAlign = 'left';
    }
  });

  // 右端枠: 入金合計（収歓総額）
  const totalIncome = tour.advancePayment; // + ガイド預り金があれば加算
  const incomeTotalX = leftX + headerLeftW + colDayW * numDays + colSubW;
  ctx.strokeRect(incomeTotalX, tableY, colTotalW, incomeSecH);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  ctx.fillText('入金合計（収歓総額）', incomeTotalX + colTotalW / 2, tableY + 36);
  ctx.font = 'bold 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`¥${totalIncome.toLocaleString()}`, incomeTotalX + colTotalW / 2, tableY + 80);
  ctx.textAlign = 'left';

  tableY += incomeSecH;

  // 5-2. 高速料金セクション（2行）
  const hwSecH = standardRowH * highwayRows.length;
  drawVerticalLabel('高速料金', leftX, tableY, colCatW, hwSecH);

  highwayRows.forEach((row, rIdx) => {
    const rowY = tableY + rIdx * standardRowH;
    ctx.strokeRect(leftX + colCatW, rowY, colNameW, standardRowH);
    ctx.fillStyle = '#000000';
    ctx.font = '14px "Noto Sans JP", sans-serif';
    ctx.fillText(row.name, leftX + colCatW + 10, rowY + 28);

    let x = leftX + headerLeftW;
    dateColumns.forEach((col) => {
      ctx.strokeRect(x, rowY, colDayW, standardRowH);
      const amt = row.filter ? getAmount(row.filter, col.key) : 0;
      if (amt > 0) {
        dayTotals[col.key] = (dayTotals[col.key] || 0) + amt;
        ctx.textAlign = 'right';
        ctx.font = '14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`¥${amt.toLocaleString()}`, x + colDayW - 10, rowY + 28);
        ctx.textAlign = 'left';
      }
      x += colDayW;
    });

    ctx.strokeRect(x, rowY, colSubW, standardRowH);
    const sub = row.filter ? getSubtotal(row.filter) : 0;
    if (sub > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`¥${sub.toLocaleString()}`, x + colSubW - 10, rowY + 28);
      ctx.textAlign = 'left';
    }
  });

  tableY += hwSecH;

  // 5-3. 支出項目セクション（9行: 現金有料道路、駐車料金、交通費、宿泊代、お茶代、水代、食事代、残業代、その他）
  const expenseSecH = standardRowH * expenseRows.length;
  // 大区分は空白または「支出」
  ctx.strokeRect(leftX, tableY, colCatW, expenseSecH);

  expenseRows.forEach((row, rIdx) => {
    const rowY = tableY + rIdx * standardRowH;
    ctx.strokeRect(leftX + colCatW, rowY, colNameW, standardRowH);
    ctx.fillStyle = '#000000';
    ctx.font = '14px "Noto Sans JP", sans-serif';
    if (row.subtext) {
      ctx.fillText(row.name, leftX + colCatW + 8, rowY + 20);
      ctx.font = '12px "Noto Sans JP", sans-serif';
      ctx.fillText(row.subtext, leftX + colCatW + 8, rowY + 38);
    } else {
      ctx.fillText(row.name, leftX + colCatW + 8, rowY + 28);
    }

    let x = leftX + headerLeftW;
    dateColumns.forEach((col) => {
      ctx.strokeRect(x, rowY, colDayW, standardRowH);
      const amt = row.filter ? getAmount(row.filter, col.key) : 0;
      if (amt > 0) {
        dayTotals[col.key] = (dayTotals[col.key] || 0) + amt;
        ctx.textAlign = 'right';
        ctx.font = '14px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`¥${amt.toLocaleString()}`, x + colDayW - 10, rowY + 28);
        ctx.textAlign = 'left';
      }
      x += colDayW;
    });

    ctx.strokeRect(x, rowY, colSubW, standardRowH);
    const sub = row.filter ? getSubtotal(row.filter) : 0;
    if (sub > 0) {
      ctx.textAlign = 'right';
      ctx.font = 'bold 14px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`¥${sub.toLocaleString()}`, x + colSubW - 10, rowY + 28);
      ctx.textAlign = 'left';
    }
  });

  // 右端枠: 出金合計（支出総額）※燃料(掛カード)および「預り金から引かない会社ETC」を除いた、仮払金からの差引対象合計
  const deductibleReceipts = receipts.filter((r) => {
    if (r.category === 'fuel') return false;
    if (r.category === 'etc') return Boolean(r.etcPaidByGuide);
    return r.paymentMethod === 'advance' || r.paymentMethod === 'cash';
  });
  const totalExpense = deductibleReceipts.reduce((sum, r) => sum + r.amount, 0);
  const expenseTotalY = mainY + thH + incomeSecH;
  const expenseTotalH = hwSecH + expenseSecH;
  ctx.strokeRect(incomeTotalX, expenseTotalY, colTotalW, expenseTotalH);
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  ctx.fillText('出金合計（支出総額）', incomeTotalX + colTotalW / 2, expenseTotalY + 50);
  ctx.font = 'bold 24px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#b91c1c';
  ctx.fillText(`¥${totalExpense.toLocaleString()}`, incomeTotalX + colTotalW / 2, expenseTotalY + 95);
  ctx.textAlign = 'left';

  tableY += expenseSecH;

  // 6. 下部サマリー行: 水積込本数 / 水残本数 / 残高（余額）
  const sumRowH = 50;
  const waterBoxW = 260;

  // 水積込本数
  ctx.strokeRect(leftX, tableY, waterBoxW, sumRowH);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  const loadedNum = typeof tour.waterLoadedCount === 'number'
    ? tour.waterLoadedCount
    : (tour.waterLoadedCount ? Number(tour.waterLoadedCount) : NaN);
  const loadedVal = !isNaN(loadedNum) && loadedNum > 0
    ? `  ${loadedNum}  `
    : '          ';
  ctx.fillText(`水積込本数（${loadedVal}）本`, leftX + 16, tableY + 32);

  // 水残本数
  ctx.strokeRect(leftX + waterBoxW, tableY, waterBoxW, sumRowH);
  const remainNum = typeof tour.waterRemainingCount === 'number'
    ? tour.waterRemainingCount
    : (tour.waterRemainingCount !== undefined && tour.waterRemainingCount !== null ? Number(tour.waterRemainingCount) : NaN);
  const remainVal = !isNaN(remainNum) && remainNum >= 0
    ? `  ${remainNum}  `
    : '          ';
  ctx.fillText(`水残本数（${remainVal}）本`, leftX + waterBoxW + 16, tableY + 32);

  // 中間余白枠
  const midRemW = tableW - waterBoxW * 2 - colTotalW;
  ctx.strokeRect(leftX + waterBoxW * 2, tableY, midRemW, sumRowH);

  // 残高（余額）
  const balance = totalIncome - totalExpense;
  ctx.strokeRect(incomeTotalX, tableY, colTotalW, sumRowH);
  ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
  ctx.fillText('残高（余額）', incomeTotalX + 16, tableY + 32);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = balance >= 0 ? '#1d4ed8' : '#b91c1c';
  ctx.fillText(`¥${balance.toLocaleString()}`, incomeTotalX + colTotalW - 16, tableY + 32);
  ctx.textAlign = 'left';

  tableY += sumRowH;

  // 7. フッター署名行
  const footerH = 65;
  ctx.strokeRect(leftX, tableY, tableW, footerH);

  ctx.fillStyle = '#000000';
  ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('上記金額に相違ありません。', leftX + tableW / 2 - 100, tableY + 38);

  ctx.font = '16px "Noto Sans JP", sans-serif';
  ctx.fillText('ガイド様 署名欄', leftX + tableW - 200, tableY + 38);
  ctx.textAlign = 'left';

  // 下部注記（サンプル案であることの表示）
  ctx.fillStyle = '#64748b';
  ctx.font = '12px "Noto Sans JP", sans-serif';
  ctx.fillText('※ 本帳票は「日別項目別集計表」のレイアウトサンプル（デザイン確認用）です。', leftX, canvas.height - 20);

  return canvas;
}

/**
 * 日別集計サンプル鑑表の画像DataUrlを高速生成
 */
export async function generateDailySummarySampleDataUrl(
  tour: Tour,
  receipts: Receipt[],
  profile: DriverProfile
): Promise<string> {
  const canvas = await renderDailySummarySamplePage(tour, receipts, profile);
  return canvas.toDataURL('image/jpeg', 0.95);
}

/**
 * 運行経費利用明細書（詳細一覧）ページをCanvasに美しく描画
 * 駐車場名、ホテル名、ETC区間、給油所名などをハッキリと表形式で一覧化
 */
async function renderDetailsPage(
  receiptsSlice: Receipt[],
  pageNumber: number,
  totalPages: number,
  tour: Tour,
  profile: DriverProfile,
  startIndex: number,
  isLastDetailPage: boolean,
  grandTotal: number,
  cashOutlayTotal: number,
  advanceOutlayTotal: number
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createA4LandscapeCanvas();

  // ヘッダー装飾（藍色・ネイビー）
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(40, 32, canvas.width - 80, 8);

  // タイトル
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 28px "Noto Sans JP", sans-serif';
  ctx.fillText('乗務員 運行経費 利用明細書（詳細一覧）', 60, 82);

  // 右上: ページ番号と作成日
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  ctx.font = '14px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(`作成日: ${todayStr}`, canvas.width - 260, 68);
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#1e3a8a';
  ctx.fillText(`ページ ${pageNumber} / ${totalPages}`, canvas.width - 260, 92);

  // ツアー・乗務員情報サマリーバー（横幅1634pxに合わせてバランスよく配置）
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(60, 110, canvas.width - 120, 42);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(60, 110, canvas.width - 120, 42);

  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
  const displayClient = tour.clientCompanyName ? `【発注元: ${tour.clientCompanyName}】` : '';
  ctx.fillText(`ツアー: ${tour.code}  ${tour.title || ''} ${displayClient}`, 80, 136);

  ctx.font = '13.5px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(`期間: ${tour.startDate} 〜 ${tour.endDate}`, 820, 136);

  ctx.fillStyle = '#1e293b';
  ctx.fillText(`乗務員: ${profile.driverName}（${profile.staffId}）`, 1180, 136);
  ctx.fillText(`車両: ${profile.vehicleNumber}`, 1480, 136);

  // 明細テーブル開始位置
  let tableY = 168;
  const tableWidth = canvas.width - 120; // 1634px

  // テーブルヘッダー
  ctx.fillStyle = '#1e3a8a';
  ctx.fillRect(60, tableY, tableWidth, 38);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('No.', 95, tableY + 24);
  ctx.fillText('利用日', 195, tableY + 24);
  ctx.fillText('科目', 320, tableY + 24);
  ctx.textAlign = 'left';
  ctx.fillText('利用施設・詳細（駐車場名・ホテル名・ETC区間等）', 400, tableY + 24);
  ctx.textAlign = 'center';
  ctx.fillText('支払区分', 880, tableY + 24);
  ctx.textAlign = 'right';
  ctx.fillText('金額(税込)', 1040, tableY + 24);
  ctx.textAlign = 'left';
  // 横向きにより備考欄の横幅が約600pxへと大幅拡大！
  ctx.fillText('備考・特記事項（品目読取・手入力メモ）', 1070, tableY + 24);

  tableY += 38;

  const categoryLabels: Record<string, { label: string; color: string; bg: string }> = {
    etc: { label: 'ETC高速', color: '#1d4ed8', bg: '#dbeafe' },
    toll: { label: '有料道', color: '#0369a1', bg: '#e0f2fe' },
    parking: { label: '駐車場', color: '#b45309', bg: '#fef3c7' },
    fuel: { label: '燃料', color: '#b91c1c', bg: '#fee2e2' },
    breakfast: { label: '朝食代', color: '#c2410c', bg: '#ffedd5' },
    lunch: { label: '昼食代', color: '#4d7c0f', bg: '#ecfccb' },
    night_meal: { label: '夜食代', color: '#4338ca', bg: '#e0e7ff' },
    tea: { label: 'お茶代', color: '#0f766e', bg: '#ccfbf1' },
    water: { label: 'ミネラル水', color: '#0891b2', bg: '#cffafe' },
    taxi: { label: 'タクシー', color: '#4338ca', bg: '#e0e7ff' },
    lodging: { label: '宿泊', color: '#6d28d9', bg: '#ede9fe' },
    overtime: { label: '残業代', color: '#db2777', bg: '#fce7f3' },
    other: { label: 'その他', color: '#475569', bg: '#f1f5f9' }
  };

  const methodLabels: Record<string, string> = {
    advance: '前払い金',
    cash: '個人立替',
    company_etc: '会社ETC',
    company_fuel: '燃料カード',
    company_card: '会社カード'
  };

  let pageSum = 0;
  const rowHeight = 44;

  for (let i = 0; i < receiptsSlice.length; i++) {
    const r = receiptsSlice[i];
    pageSum += r.amount;
    const itemNo = startIndex + i + 1;

    // 行背景ストライプ
    ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#f8fafc';
    ctx.fillRect(60, tableY, tableWidth, rowHeight);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(60, tableY, tableWidth, rowHeight);

    // No.
    ctx.fillStyle = '#64748b';
    ctx.font = '13px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${itemNo}`, 95, tableY + 27);

    // 利用日
    ctx.fillStyle = '#1e293b';
    ctx.font = '13px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(r.date, 195, tableY + 27);

    // 科目バッジ
    const catMeta = categoryLabels[r.category] || { label: '経費', color: '#475569', bg: '#f1f5f9' };
    const badgeW = 90;
    const badgeH = 26;
    const badgeX = 320 - badgeW / 2;
    const badgeY = tableY + 9;
    ctx.fillStyle = catMeta.bg;
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
    ctx.strokeStyle = catMeta.color;
    ctx.strokeRect(badgeX, badgeY, badgeW, badgeH);
    ctx.fillStyle = catMeta.color;
    ctx.font = 'bold 12px "Noto Sans JP", sans-serif';
    ctx.fillText(catMeta.label, 320, tableY + 27);

    // 利用施設・詳細（駐車場名・ホテル名・ETC区間等）★最重要
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 14px "Noto Sans JP", sans-serif';

    // 施設名テキストの整形（横向きなので最大28文字までゆったり入る）
    let displayPlace = r.place || '経費';
    if (displayPlace.length > 28) {
      displayPlace = displayPlace.substring(0, 27) + '…';
    }
    ctx.fillText(displayPlace, 400, tableY + 28);

    // 支払区分
    ctx.textAlign = 'center';
    ctx.font = '13px "Noto Sans JP", sans-serif';
    const payLabel =
      r.category === 'etc'
        ? r.etcPaidByGuide
          ? '前払い金(預り)'
          : '会社ETC'
        : methodLabels[r.paymentMethod] || '立替';
    ctx.fillStyle = r.paymentMethod === 'cash' || r.etcPaidByGuide ? '#047857' : '#475569';
    ctx.fillText(payLabel, 880, tableY + 27);

    // 金額
    ctx.textAlign = 'right';
    ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(`¥${r.amount.toLocaleString()}`, 1040, tableY + 28);

    // 備考（横向きにより幅600px以上を確保！手入力メモや品目がゆったり完全に読める）
    ctx.textAlign = 'left';
    let memoText = (r.memo && r.memo.trim()) || '';
    if (memoText.startsWith('【購入品目】')) {
      memoText = '';
    }

    if (memoText) {
      ctx.fillStyle = '#1e293b';
      // 横幅が広いため、36文字までは1行でそのまま美しく入る
      if (memoText.length > 36) {
        ctx.font = '11px "Noto Sans JP", sans-serif';
        const line1 = memoText.substring(0, 36);
        const line2 = memoText.length > 72 ? memoText.substring(36, 70) + '…' : memoText.substring(36);
        ctx.fillText(line1, 1070, tableY + 19);
        ctx.fillText(line2, 1070, tableY + 34);
      } else {
        ctx.font = '12px "Noto Sans JP", sans-serif';
        ctx.fillText(memoText, 1070, tableY + 27);
      }
    } else if (r.aiMemo && r.aiMemo.trim()) {
      ctx.fillStyle = '#4f46e5';
      ctx.font = '11.5px "Noto Sans JP", sans-serif';
      let aiText = r.aiMemo;
      if (aiText.length > 38) {
        aiText = aiText.substring(0, 37) + '…';
      }
      ctx.fillText(aiText, 1070, tableY + 27);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px "Noto Sans JP", sans-serif';
      ctx.fillText('ー', 1070, tableY + 27);
    }

    tableY += rowHeight;
  }
  ctx.textAlign = 'left';

  // ページ小計行
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(60, tableY, tableWidth, 36);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(60, tableY, tableWidth, 36);

  ctx.fillStyle = '#334155';
  ctx.font = 'bold 14px "Noto Sans JP", sans-serif';
  ctx.fillText(`本ページ小計（${receiptsSlice.length} 件）`, 80, tableY + 23);

  ctx.textAlign = 'right';
  ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillStyle = '#1e3a8a';
  ctx.fillText(`¥${pageSum.toLocaleString()}`, 1040, tableY + 24);
  ctx.textAlign = 'left';

  tableY += 36;

  // 最終明細ページの場合: 全件総合計サマリーバーを表示（横向きのゆったり配置）
  if (isLastDetailPage) {
    tableY += 12;
    ctx.fillStyle = '#eff6ff';
    ctx.fillRect(60, tableY, tableWidth, 50);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(60, tableY, tableWidth, 50);

    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
    ctx.fillText('■ 利用明細 全件累計', 80, tableY + 31);

    ctx.font = '13.5px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('前払い金支出:', 520, tableY + 31);
    ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#047857';
    ctx.fillText(`¥${advanceOutlayTotal.toLocaleString()}`, 620, tableY + 31);

    if (cashOutlayTotal > 0) {
      ctx.font = '13.5px "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#334155';
      ctx.fillText('個人立替:', 780, tableY + 31);
      ctx.font = 'bold 16px "Plus Jakarta Sans", sans-serif';
      ctx.fillStyle = '#b45309';
      ctx.fillText(`¥${cashOutlayTotal.toLocaleString()}`, 860, tableY + 31);
    }

    ctx.font = '13.5px "Noto Sans JP", sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText('経費総計(カード含):', 1060, tableY + 31);
    ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
    ctx.fillStyle = '#1e3a8a';
    ctx.fillText(`¥${grandTotal.toLocaleString()}`, 1210, tableY + 32);
  }

  // フッター注意書き
  ctx.fillStyle = '#94a3b8';
  ctx.font = '12px "Noto Sans JP", sans-serif';
  ctx.fillText(
    '※ 駐車場名・ホテル名などの各明細は、次ページ以降の原本レシート貼付台紙と照合可能です。',
    60,
    canvas.height - 40
  );

  return canvas;
}

/**
 * 科目表示用ラベルマッピング
 */
const CATEGORY_NAMES: Record<string, string> = {
  etc: 'ETC高速',
  toll: '有料道路',
  parking: '駐車場',
  fuel: '燃料代',
  breakfast: '朝食代',
  lunch: '昼食代',
  night_meal: '夜食代',
  tea: 'お茶代',
  water: 'ミネラル水',
  taxi: 'タクシー',
  lodging: '宿泊費',
  overtime: '残業手当',
  other: 'その他'
};

const PAYMENT_LABELS: Record<string, string> = {
  advance: '前払',
  cash: '立替',
  company_etc: '会社ETC',
  company_fuel: '燃料カード',
  company_card: '会社カード'
};

/**
 * 領収書貼付台紙の項目グループ定義
 * マサさん指定:
 * - 駐車場代
 * - 有料道路代（ETC含む）
 * - お茶代・食事代はまとめる
 * - 燃料・宿泊・タクシー・その他も各項目別
 */
export interface ReceiptGroupDef {
  key: string;
  title: string;
  shortLabel: string;
  categories: string[];
  accentColor: string;
}

export const RECEIPT_GROUPS: ReceiptGroupDef[] = [
  {
    key: 'toll_etc',
    title: '有料道路代・ETC 領収書貼付台紙',
    shortLabel: '有料道路代・ETC',
    categories: ['toll', 'etc'],
    accentColor: '#0284c7'
  },
  {
    key: 'parking',
    title: '駐車場代 領収書・レシート貼付台紙',
    shortLabel: '駐車場代',
    categories: ['parking'],
    accentColor: '#d97706'
  },
  {
    key: 'meals_drinks',
    title: '飲食・お茶代（食事・飲料費） 領収書貼付台紙',
    shortLabel: '飲食・お茶代',
    categories: ['breakfast', 'lunch', 'night_meal', 'tea', 'water'],
    accentColor: '#059669'
  },
  {
    key: 'fuel',
    title: '燃料・軽油代 領収書貼付台紙',
    shortLabel: '燃料・軽油代',
    categories: ['fuel'],
    accentColor: '#dc2626'
  },
  {
    key: 'lodging',
    title: '宿泊費・ホテル代 領収書貼付台紙',
    shortLabel: '宿泊代',
    categories: ['lodging'],
    accentColor: '#7c3aed'
  },
  {
    key: 'taxi',
    title: 'タクシー代 領収書貼付台紙',
    shortLabel: 'タクシー代',
    categories: ['taxi'],
    accentColor: '#4f46e5'
  },
  {
    key: 'other',
    title: 'その他・諸経費 領収書貼付台紙',
    shortLabel: 'その他経費',
    categories: ['overtime', 'other'],
    accentColor: '#475569'
  }
];

export interface PreparedReceiptItem {
  receipt: Receipt;
  img: HTMLImageElement | null;
  aspectRatio: number;
  isHandwritten: boolean; // 横長または手書き領収書（4枚/頁）なら true、縦長小さいレシート（12枚/頁）なら false
  originalIndex: number; // 利用明細書（詳細一覧）のNo.と一致させる番号 (0-indexed)
}

/**
 * 全レシートの画像をプリロードし、寸法と手書き/小レシート判定を行う
 */
async function prepareReceiptItems(receipts: Receipt[]): Promise<PreparedReceiptItem[]> {
  return Promise.all(
    receipts.map(async (r, index) => {
      const imgUrl = r.processedImageUrl || r.originalImageUrl || '';
      let img: HTMLImageElement | null = null;
      let aspectRatio = 0.5; // デフォルトは縦長レシート（幅/高さ < 1）

      if (imgUrl) {
        try {
          const loadedImg = new Image();
          loadedImg.crossOrigin = 'anonymous';
          await new Promise<void>((resolve) => {
            loadedImg.onload = () => resolve();
            loadedImg.onerror = () => resolve();
            loadedImg.src = imgUrl;
          });
          if (loadedImg.naturalWidth && loadedImg.naturalHeight) {
            img = loadedImg;
            aspectRatio = loadedImg.naturalWidth / loadedImg.naturalHeight;
          }
        } catch {
          img = null;
        }
      }

      // 手書き領収書判定:
      // コクヨなどの手書き領収証は典型的な横長（アスペクト比 1.15〜2.2）
      // 一方、レジロール紙のレシートは縦長（アスペクト比 0.3〜0.75）
      // 宿泊領収書（lodging）でほぼ正方形以上のものも手書き大判枠として扱う
      const isHandwritten = aspectRatio >= 1.15 || (r.category === 'lodging' && aspectRatio >= 0.95);

      return {
        receipt: r,
        img,
        aspectRatio,
        isHandwritten,
        originalIndex: index
      };
    })
  );
}

/**
 * 共通の貼付台紙ヘッダーを描画
 */
function drawReceiptPageHeader(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  group: ReceiptGroupDef,
  typeLabel: string,
  pageNumber: number,
  totalPages: number,
  tourCode: string,
  groupTotal: number,
  groupCount: number
) {
  // アクセントバー
  ctx.fillStyle = group.accentColor;
  ctx.fillRect(45, 38, canvasWidth - 90, 5);

  // タイトル
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 22px "Noto Sans JP", sans-serif';
  ctx.fillText(`【${group.shortLabel}】領収書・レシート貼付台紙 ${typeLabel}`, 45, 74);

  // サブ情報（ツアーコード・合計金額・件数）
  ctx.font = '13.5px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#475569';
  ctx.fillText(
    `ツアー: ${tourCode}  |  ${group.shortLabel}計: ¥${groupTotal.toLocaleString()} (${groupCount}件)`,
    45,
    96
  );

  // 右上: ページ番号
  ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
  ctx.fillStyle = '#1e3a8a';
  ctx.textAlign = 'right';
  ctx.fillText(`ページ ${pageNumber} / ${totalPages}`, canvasWidth - 45, 74);
  ctx.textAlign = 'left';
}

/**
 * 小さいレシート用貼付台紙ページを描画（A4あたり最大12枚：3列 × 4行）
 * 原寸換算で約62mm幅 × 66mm高となり、一般的な58mm感熱紙レシート原寸大で12枚綺麗に収まる
 */
async function renderSmallReceiptsPage(
  itemsSlice: PreparedReceiptItem[],
  pageNumber: number,
  totalPages: number,
  tourCode: string,
  group: ReceiptGroupDef,
  groupTotal: number,
  groupCount: number
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createA4Canvas();

  drawReceiptPageHeader(
    ctx,
    canvas.width,
    group,
    '(レシート原寸・12枚台紙)',
    pageNumber,
    totalPages,
    tourCode,
    groupTotal,
    groupCount
  );

  const cols = 3;
  const rows = 4;
  const marginX = 45;
  const startY = 110;
  const gapX = 18;
  const gapY = 16;
  const footerSpace = 45;

  const cardW = (canvas.width - marginX * 2 - gapX * (cols - 1)) / cols; // ≈ 371px
  const cardH = (canvas.height - startY - footerSpace - gapY * (rows - 1)) / rows; // ≈ 388px

  for (let idx = 0; idx < itemsSlice.length; idx++) {
    const item = itemsSlice[idx];
    const r = item.receipt;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // カード外枠
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, cardW, cardH);

    // カードヘッダー（高さ 28px）
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, y, cardW, 28);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(x, y, cardW, 28);

    // 明細表と一致する No.
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 13px "Noto Sans JP", sans-serif';
    ctx.fillText(`No.${item.originalIndex + 1}`, x + 8, y + 19);

    // 金額
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`¥${r.amount.toLocaleString()}`, x + 62, y + 20);

    // 支払区分
    ctx.fillStyle = r.paymentMethod === 'cash' ? '#047857' : '#475569';
    ctx.font = '11px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`(${PAYMENT_LABELS[r.paymentMethod] || '立替'})`, x + cardW - 8, y + 19);
    ctx.textAlign = 'left';

    // 画像描画領域
    const imgAreaX = x + 6;
    const imgAreaY = y + 32;
    const imgAreaW = cardW - 12;
    const imgAreaH = cardH - 74;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(imgAreaX, imgAreaY, imgAreaW, imgAreaH);

    if (item.img && item.img.naturalWidth && item.img.naturalHeight) {
      const scale = Math.min(imgAreaW / item.img.naturalWidth, imgAreaH / item.img.naturalHeight);
      const dw = item.img.naturalWidth * scale;
      const dh = item.img.naturalHeight * scale;
      const dx = imgAreaX + (imgAreaW - dw) / 2;
      const dy = imgAreaY + (imgAreaH - dh) / 2;
      ctx.drawImage(item.img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px "Noto Sans JP", sans-serif';
      ctx.fillText('画像なし', imgAreaX + imgAreaW / 2 - 24, imgAreaY + imgAreaH / 2 + 4);
    }

    // カード下部キャプション（高さ 38px）
    const capY = y + cardH - 38;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 4, capY, cardW - 8, 34);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 4, capY, cardW - 8, 34);

    // 店舗・施設名
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 12px "Noto Sans JP", sans-serif';
    let placeStr = r.place || '経費';
    if (placeStr.length > 17) {
      placeStr = placeStr.substring(0, 16) + '…';
    }
    ctx.fillText(placeStr, x + 8, capY + 16);

    // 利用日 & 備考
    ctx.fillStyle = '#64748b';
    ctx.font = '10.5px "Noto Sans JP", sans-serif';
    let subInfo = r.date;
    const memo = (r.memo && r.memo.trim()) || '';
    if (memo && !memo.startsWith('【購入品目】')) {
      const memoSnippet = memo.length > 11 ? memo.substring(0, 10) + '…' : memo;
      subInfo += ` | ${memoSnippet}`;
    }
    ctx.fillText(subInfo, x + 8, capY + 30);
  }

  // フッター注意書き
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11.5px "Noto Sans JP", sans-serif';
  ctx.fillText(
    `※ 小さいレシート原寸配置台紙（1頁最大12枚）。No.番号は運行経費利用明細書（詳細一覧）と完全一致しています。`,
    marginX,
    canvas.height - 20
  );

  return canvas;
}

/**
 * 手書き領収書・大判用貼付台紙ページを描画（A4あたり最大4枚：2列 × 2行）
 * 横長手書き領収証（小切手判など）や大判明細書をゆったり原寸で4枚鮮明に配置
 */
async function renderHandwrittenReceiptsPage(
  itemsSlice: PreparedReceiptItem[],
  pageNumber: number,
  totalPages: number,
  tourCode: string,
  group: ReceiptGroupDef,
  groupTotal: number,
  groupCount: number
): Promise<HTMLCanvasElement> {
  const { canvas, ctx } = createA4Canvas();

  drawReceiptPageHeader(
    ctx,
    canvas.width,
    group,
    '(手書き領収書・大判4枚台紙)',
    pageNumber,
    totalPages,
    tourCode,
    groupTotal,
    groupCount
  );

  const cols = 2;
  const rows = 2;
  const marginX = 55;
  const startY = 115;
  const gapX = 26;
  const gapY = 24;
  const footerSpace = 45;

  const cardW = (canvas.width - marginX * 2 - gapX * (cols - 1)) / cols; // ≈ 552px
  const cardH = (canvas.height - startY - footerSpace - gapY * (rows - 1)) / rows; // ≈ 770px

  for (let idx = 0; idx < itemsSlice.length; idx++) {
    const item = itemsSlice[idx];
    const r = item.receipt;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = marginX + col * (cardW + gapX);
    const y = startY + row * (cardH + gapY);

    // カード外枠
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, y, cardW, cardH);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, cardW, cardH);

    // カードヘッダー（高さ 38px）
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(x, y, cardW, 38);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(x, y, cardW, 38);

    // No. & 科目
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
    ctx.fillText(`No.${item.originalIndex + 1}  [${CATEGORY_NAMES[r.category] || '経費'}]`, x + 12, y + 25);

    // 金額
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 19px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`¥${r.amount.toLocaleString()}`, x + 180, y + 26);

    // 支払区分
    ctx.fillStyle = r.paymentMethod === 'cash' ? '#047857' : '#475569';
    ctx.font = '12px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`(${PAYMENT_LABELS[r.paymentMethod] || '立替'})`, x + cardW - 12, y + 25);
    ctx.textAlign = 'left';

    // 画像描画領域
    const imgAreaX = x + 10;
    const imgAreaY = y + 44;
    const imgAreaW = cardW - 20;
    const imgAreaH = cardH - 105;

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(imgAreaX, imgAreaY, imgAreaW, imgAreaH);

    if (item.img && item.img.naturalWidth && item.img.naturalHeight) {
      const scale = Math.min(imgAreaW / item.img.naturalWidth, imgAreaH / item.img.naturalHeight);
      const dw = item.img.naturalWidth * scale;
      const dh = item.img.naturalHeight * scale;
      const dx = imgAreaX + (imgAreaW - dw) / 2;
      const dy = imgAreaY + (imgAreaH - dh) / 2;
      ctx.drawImage(item.img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px "Noto Sans JP", sans-serif';
      ctx.fillText('画像なし', imgAreaX + imgAreaW / 2 - 30, imgAreaY + imgAreaH / 2 + 5);
    }

    // カード下部キャプション（高さ 54px）
    const capY = y + cardH - 56;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 8, capY, cardW - 16, 48);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 8, capY, cardW - 16, 48);

    // 施設・店名
    ctx.fillStyle = '#1e3a8a';
    ctx.font = 'bold 15px "Noto Sans JP", sans-serif';
    let placeStr = r.place || '経費';
    if (placeStr.length > 24) {
      placeStr = placeStr.substring(0, 23) + '…';
    }
    ctx.fillText(`発行元: ${placeStr}`, x + 16, capY + 22);

    // 利用日 & 備考
    ctx.fillStyle = '#475569';
    ctx.font = '12.5px "Noto Sans JP", sans-serif';
    let subStr = `利用日: ${r.date}`;
    const memo = (r.memo && r.memo.trim()) || '';
    if (memo && !memo.startsWith('【購入品目】')) {
      const memoSnippet = memo.length > 20 ? memo.substring(0, 19) + '…' : memo;
      subStr += `  |  但書・備考: ${memoSnippet}`;
    }
    ctx.fillText(subStr, x + 16, capY + 41);
  }

  // フッター注意書き
  ctx.fillStyle = '#94a3b8';
  ctx.font = '11.5px "Noto Sans JP", sans-serif';
  ctx.fillText(
    `※ 手書き領収書・大判証憑配置台紙（1頁最大4枚）。No.番号は運行経費利用明細書（詳細一覧）と完全一致しています。`,
    marginX,
    canvas.height - 20
  );

  return canvas;
}

/**
 * 台紙ページのタスク定義
 */
interface ReceiptPageTask {
  group: ReceiptGroupDef;
  isSmall: boolean;
  items: PreparedReceiptItem[];
  groupTotal: number;
  groupCount: number;
}

/**
 * 総合PDF生成メイン関数
 * 構成:
 *  1. 表紙・項目別集計表（鑑表）
 *  2. 運行経費利用明細書（駐車場名・ホテル名・ETC区間などを一覧化した詳細明細）
 *  3. 各項目別 レシート・手書き領収書貼付台紙
 *     - 駐車場代
 *     - 有料道路代・ETC
 *     - 飲食・お茶代（食事代とお茶代はまとめて1つの台紙）
 *     - 燃料・宿泊・タクシー・その他
 *     - 小さいレシート: A4に12枚（3×4）
 *     - 手書き領収書: A4に4枚（2×2）
 * 仕様書命名規則: [ツアーコード]_[精算日]_精算書.pdf
 */
export async function generateTourExpensePdf(
  tour: Tour,
  receipts: Receipt[],
  profile: DriverProfile
): Promise<PdfGenerationResult> {
  // 1ページ目の鑑表を日別項目別集計表（A4横向き 297mm x 210mm）として初期化
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pdfWidth = 210;
  const pdfHeight = 297;

  // 常に日付け順（時系列昇順）で整理。同日内は項目順・登録順
  const sortedReceipts = sortReceiptsByDate(receipts);
  const summary = calculateTourSummary(receipts, tour.advancePayment);

  // 1. レシート画像をプリロードし、寸法と手書き/小レシート判定
  const preparedItems = await prepareReceiptItems(sortedReceipts);

  // 2. 詳細明細書（A4横向き・16件で上下余白もスッキリ美しく収まる）: 1ページあたり16件
  const itemsPerDetailPage = 16;
  const detailPagesCount = Math.max(1, Math.ceil(sortedReceipts.length / itemsPerDetailPage));

  // 3. マサさんご指定の項目グループごとに台紙ページを構築
  //    - 駐車場代
  //    - 有料道路代
  //    - お茶代食事代（まとめる）
  //    - 燃料、宿泊、タクシー、その他
  //    - 小さいレシート: 最大12枚 / 手書き領収書: 最大4枚
  const receiptPageTasks: ReceiptPageTask[] = [];

  for (const grp of RECEIPT_GROUPS) {
    const grpItems = preparedItems.filter((item) => grp.categories.includes(item.receipt.category));
    if (grpItems.length === 0) continue;

    const groupTotal = grpItems.reduce((sum, item) => sum + item.receipt.amount, 0);
    const groupCount = grpItems.length;

    // 小さいレシート（12枚/頁）と手書き領収書（4枚/頁）に分別
    const smallItems = grpItems.filter((item) => !item.isHandwritten);
    const handwrittenItems = grpItems.filter((item) => item.isHandwritten);

    // 小さいレシート用ページ（A4用紙1枚に12枚）
    for (let i = 0; i < smallItems.length; i += 12) {
      receiptPageTasks.push({
        group: grp,
        isSmall: true,
        items: smallItems.slice(i, i + 12),
        groupTotal,
        groupCount
      });
    }

    // 手書き領収書用ページ（A4用紙1枚に4枚）
    for (let i = 0; i < handwrittenItems.length; i += 4) {
      receiptPageTasks.push({
        group: grp,
        isSmall: false,
        items: handwrittenItems.slice(i, i + 4),
        groupTotal,
        groupCount
      });
    }
  }

  const receiptPagesCount = receiptPageTasks.length;
  const totalPages = 1 + detailPagesCount + receiptPagesCount;

  // 1. 表紙・日別項目別集計表（鑑表）ページ生成（横向き A4: 297mm x 210mm）
  const dailyCanvas = await renderDailySummarySamplePage(tour, receipts, profile);
  const dailySummaryDataUrl = dailyCanvas.toDataURL('image/jpeg', 0.94);
  pdf.addImage(dailySummaryDataUrl, 'JPEG', 0, 0, 297, 210);

  // 旧鑑表（縦型）のプレビュー画像も生成（比較確認用）
  const summaryCanvas = await renderSummaryPage(tour, receipts, profile);
  const summaryDataUrl = summaryCanvas.toDataURL('image/jpeg', 0.92);

  // 2. 運行経費利用明細書（詳細明細一覧）ページ生成（横向き A4: 幅297mm x 高さ210mm で備考欄を大幅拡張）
  let currentPage = 2;
  for (let dp = 0; dp < detailPagesCount; dp++) {
    pdf.addPage('a4', 'landscape');
    const startIndex = dp * itemsPerDetailPage;
    const slice = sortedReceipts.slice(startIndex, startIndex + itemsPerDetailPage);
    const isLastDetailPage = dp === detailPagesCount - 1;

    const detailsCanvas = await renderDetailsPage(
      slice,
      currentPage,
      totalPages,
      tour,
      profile,
      startIndex,
      isLastDetailPage,
      summary.grandTotal,
      summary.cashOutlay,
      summary.advanceOutlay
    );
    const detailsDataUrl = detailsCanvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(detailsDataUrl, 'JPEG', 0, 0, 297, 210);
    currentPage++;
  }

  // 3. 各項目別 レシート・手書き領収書貼付台紙ページ生成（縦向き A4: 210mm x 297mm）
  for (const task of receiptPageTasks) {
    pdf.addPage('a4', 'portrait');
    const receiptCanvas = task.isSmall
      ? await renderSmallReceiptsPage(
          task.items,
          currentPage,
          totalPages,
          tour.code,
          task.group,
          task.groupTotal,
          task.groupCount
        )
      : await renderHandwrittenReceiptsPage(
          task.items,
          currentPage,
          totalPages,
          tour.code,
          task.group,
          task.groupTotal,
          task.groupCount
        );

    const receiptDataUrl = receiptCanvas.toDataURL('image/jpeg', 0.90);
    pdf.addImage(receiptDataUrl, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    currentPage++;
  }

  // 自動ファイル命名: [ツアーコード]_[精算日]_精算書.pdf
  const dateFormatted = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const cleanCode = tour.code.replace(/[^a-zA-Z0-9_\-]/g, '');
  const fileName = `${cleanCode}_${dateFormatted}_精算書.pdf`;

  const blob = pdf.output('blob');
  const dataUri = pdf.output('datauristring');

  return {
    blob,
    dataUri,
    fileName,
    summaryPreviewUrl: summaryDataUrl,
    dailySummaryPreviewUrl: dailySummaryDataUrl
  };
}

/**
 * Android標準共有機能（Web Share API / Intent連携）またはフォールバック送信
 */
export async function shareOrSendPdf(
  result: PdfGenerationResult,
  tour: Tour,
  profile: DriverProfile
): Promise<{ success: boolean; method: 'share' | 'download' }> {
  const file = new File([result.blob], result.fileName, { type: 'application/pdf' });

  // Web Share API でファイル共有が可能かチェック
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      const clientStr = tour.clientCompanyName
        ? `\n発注元(相手先): ${tour.clientCompanyName}${tour.clientContactName ? `（担当: ${tour.clientContactName}）` : ''}`
        : '';
      const companyStr = profile.companyName ? `\n運行会社: ${profile.companyName}` : '';

      await navigator.share({
        files: [file],
        title: `${tour.code} 精算書`,
        text: `【運行経費精算書】${companyStr}\n乗務員: ${profile.driverName}${clientStr}\nツアー: ${tour.code} ${tour.title}\nPDFファイルを添付いたしましたのでご確認ください。`
      });
      return { success: true, method: 'share' };
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.warn('Share API canceled or failed:', err);
      }
    }
  }

  // フォールバック: 直接ダウンロードとメーラー起動
  const url = URL.createObjectURL(result.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // mailto リンクの用意
  const compPrefix = profile.companyName ? `[${profile.companyName}] ` : '';
  const subject = encodeURIComponent(`【精算書】${compPrefix}${tour.code} ${profile.driverName}`);
  const clientLine = tour.clientCompanyName
    ? `\n発注元(相手先): ${tour.clientCompanyName}${tour.clientContactName ? `（担当: ${tour.clientContactName}）` : ''}`
    : '';
  const body = encodeURIComponent(
    `運行経費精算書（${result.fileName}）を添付して提出いたします。\n\n運行会社: ${profile.companyName || ''}\n乗務員: ${profile.driverName}${clientLine}\nツアー: ${tour.code} ${tour.title}`
  );
  window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');

  return { success: true, method: 'download' };
}
