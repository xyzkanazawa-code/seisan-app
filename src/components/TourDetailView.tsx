import React, { useState, useEffect } from 'react';
import {
  ArrowLeft,
  Plus,
  Trash2,
  FileText,
  Sparkles,
  Camera,
  Edit3,
  Scissors,
  Droplet,
  AlertTriangle
} from 'lucide-react';
import {
  db,
  type Tour,
  type TourStatus,
  type Receipt,
  type DriverProfile
} from '../db';
import { calculateTourSummary, calculateDailyBreakdown, generateTourExpensePdf, type PdfGenerationResult } from '../utils/pdfGenerator';
import { sortReceiptsByDate } from '../utils/receiptSort';
import { findDuplicateGroupsInTour } from '../utils/duplicateChecker';
import { PdfPreviewModal } from './PdfPreviewModal';
import { ManualReceiptModal } from './ManualReceiptModal';
import { EditTourModal } from './EditTourModal';
import { EditReceiptModal } from './EditReceiptModal';
import { ImageCropModal } from './ImageCropModal';

interface TourDetailViewProps {
  tour: Tour;
  profile: DriverProfile;
  refreshTrigger?: number;
  onBack: () => void;
  onOpenScanner: () => void;
  onOpenGeminiOcr?: () => void;
  onTourUpdated: (updatedTour: Tour) => void;
}

export const TourDetailView: React.FC<TourDetailViewProps> = ({
  tour,
  profile,
  refreshTrigger,
  onBack,
  onOpenScanner,
  onOpenGeminiOcr,
  onTourUpdated
}) => {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all');
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isEditTourModalOpen, setIsEditTourModalOpen] = useState(false);
  const [isEditReceiptModalOpen, setIsEditReceiptModalOpen] = useState(false);
  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [cropTargetReceipt, setCropTargetReceipt] = useState<Receipt | null>(null);
  const [pdfResult, setPdfResult] = useState<PdfGenerationResult | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  // ツアーに紐づくレシート一覧を取得（常に日付順でソート）
  const loadReceipts = async () => {
    if (!tour.id) return;
    const items = await db.receipts.where('tourId').equals(tour.id).toArray();
    // 常に日付順（時系列昇順・同日内は登録順）でソート
    const sorted = sortReceiptsByDate(items);
    setReceipts(sorted);
  };

  useEffect(() => {
    loadReceipts();
  }, [tour.id, refreshTrigger]);

  // レシート削除
  const handleDeleteReceipt = async (id?: number) => {
    if (!id) return;
    if (window.confirm('このレシート明細を削除してもよろしいですか？')) {
      await db.receipts.delete(id);
      loadReceipts();
    }
  };

  // ETCの実車・回送の切り替え（ワンタップ）
  const handleToggleEtcType = async (receipt: Receipt) => {
    if (!receipt.id) return;
    const newType = receipt.etcType === 'kaiso' ? 'jissha' : 'kaiso';
    await db.receipts.update(receipt.id, { etcType: newType });
    loadReceipts();
  };

  // ETCの預り金から引く/引かないの切り替え（ワンタップ）
  // 「ガイド預り金から引く」にした場合は仮払金（前払い金: advance）からマイナスされるよう連動更新
  const handleToggleEtcGuide = async (receipt: Receipt) => {
    if (!receipt.id) return;
    const newStatus = !receipt.etcPaidByGuide;
    await db.receipts.update(receipt.id, {
      etcPaidByGuide: newStatus,
      paymentMethod: newStatus ? 'advance' : 'company_etc'
    });
    loadReceipts();
  };

  // 運行ステータス（進行中 ⇔ 完了）切り替え
  const toggleTourStatus = async () => {
    if (!tour.id) return;
    const newStatus: TourStatus = tour.status === 'active' ? 'completed' : 'active';
    await db.tours.update(tour.id, { status: newStatus, updatedAt: Date.now() });
    const updated: Tour = { ...tour, status: newStatus };
    onTourUpdated(updated);
  };

  // ツアー自体の削除（デモデータや不要なツアーの削除用）
  const handleDeleteTour = async () => {
    if (!tour.id) return;
    if (window.confirm(`ツアー「${tour.code}」および紐づくレシート（全${receipts.length}件）を完全に削除しますか？`)) {
      // 紐づくレシートを全削除
      await db.receipts.where('tourId').equals(tour.id).delete();
      // ツアー本体を削除
      await db.tours.delete(tour.id);
      onBack();
    }
  };

  // PDF帳票生成の実行
  const handleGeneratePdf = async () => {
    setIsGeneratingPdf(true);
    try {
      const latestTour = tour.id ? (await db.tours.get(tour.id)) || tour : tour;
      const res = await generateTourExpensePdf(latestTour, receipts, profile);
      setPdfResult(res);
      setIsPdfModalOpen(true);
    } catch (err) {
      console.error('PDF生成エラー:', err);
      alert('PDFの生成中にエラーが発生しました。');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const summary = calculateTourSummary(receipts, tour.advancePayment);
  const dailyBreakdown = calculateDailyBreakdown(receipts);

  // ツアー内の登録済みレシート同士で二重登録（重複）の疑いがあるものを自動検出
  const duplicateMap = findDuplicateGroupsInTour(receipts);
  // ETCのみの重複（往復など）を除いた、目立つべき重複件数
  const severeDuplicateCount = Array.from(duplicateMap.values()).filter((v) => !v.isEtcOnly).length;

  // フィルタリングされたレシート
  const filteredReceipts =
    activeCategoryFilter === 'all'
      ? receipts
      : activeCategoryFilter === 'duplicate'
      ? receipts.filter((r) => r.id && duplicateMap.has(r.id))
      : receipts.filter((r) => r.category === activeCategoryFilter);

  // カテゴリ別件数
  const counts = {
    all: receipts.length,
    etc: receipts.filter((r) => r.category === 'etc').length,
    toll: receipts.filter((r) => r.category === 'toll').length,
    parking: receipts.filter((r) => r.category === 'parking').length,
    fuel: receipts.filter((r) => r.category === 'fuel').length,
    breakfast: receipts.filter((r) => r.category === 'breakfast').length,
    lunch: receipts.filter((r) => r.category === 'lunch').length,
    night_meal: receipts.filter((r) => r.category === 'night_meal').length,
    tea: receipts.filter((r) => r.category === 'tea').length,
    water: receipts.filter((r) => r.category === 'water').length,
    overtime: receipts.filter((r) => r.category === 'overtime').length,
    taxi: receipts.filter((r) => r.category === 'taxi').length,
    lodging: receipts.filter((r) => r.category === 'lodging').length,
    other: receipts.filter((r) => r.category === 'other').length
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ナビゲーションバー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--text-muted)',
            fontSize: '0.88rem',
            fontWeight: 600
          }}
        >
          <ArrowLeft size={18} />
          一覧へ戻る
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleTourStatus}
            style={{
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.72rem',
              fontWeight: 700,
              background: tour.status === 'active' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
              color: tour.status === 'active' ? '#34d399' : '#94a3b8',
              border: `1px solid ${tour.status === 'active' ? 'rgba(16, 185, 129, 0.4)' : 'rgba(148, 163, 184, 0.4)'}`
            }}
          >
            {tour.status === 'active' ? '● 進行中' : '✓ 完了'}
          </button>

          <button
            onClick={handleDeleteTour}
            style={{
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.72rem',
              fontWeight: 600,
              background: 'rgba(239, 68, 68, 0.1)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            title="ツアーを削除"
          >
            <Trash2 size={13} />
            ツアー削除
          </button>
        </div>
      </div>

      {/* ツアー概要カード */}
      <div className="active-tour-card">
        <div className="tour-header" style={{ alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <span
                className="tour-code"
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}
                onClick={() => setIsEditTourModalOpen(true)}
                title="クリックしてツアーコードを訂正"
              >
                {tour.code}
                <Edit3 size={12} color="var(--primary)" />
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {tour.startDate} 〜 {tour.endDate}
              </span>
              {tour.vehicleNumber && (
                <span style={{ fontSize: '0.72rem', color: 'var(--text-sub)', background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>
                  {tour.vehicleNumber}
                </span>
              )}
            </div>

            <div
              className="tour-title"
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              onClick={() => setIsEditTourModalOpen(true)}
              title="クリックしてツアー名称を訂正"
            >
              <span>{tour.title}</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  color: '#60a5fa',
                  background: 'rgba(59, 130, 246, 0.15)',
                  padding: '2px 7px',
                  borderRadius: 4,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3
                }}
              >
                <Edit3 size={11} />
                訂正
              </span>
            </div>

            {(tour.clientCompanyName || tour.clientContactName) && (
              <div
                style={{
                  fontSize: '0.8rem',
                  color: '#93c5fd',
                  marginTop: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
                onClick={() => setIsEditTourModalOpen(true)}
                title="クリックして相手先情報を訂正"
              >
                <span>発注元（相手先）: {tour.clientCompanyName || '会社名未設定'}</span>
                {tour.clientContactName && (
                  <span>／ 担当: {tour.clientContactName}</span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => setIsEditTourModalOpen(true)}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.8rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.2) 100%)',
              color: '#93c5fd',
              border: '1px solid rgba(59, 130, 246, 0.45)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              flexShrink: 0
            }}
            title="ツアーコード・ツアー名・運行期間・仮払金の訂正"
          >
            <Edit3 size={15} />
            ツアー情報・仮払金を訂正
          </button>
        </div>

        {tour.memo && (
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 12 }}>
            {tour.memo}
          </div>
        )}

        {/* 会計サマリー（前払い金・実費・返納額） */}
        <div className="finance-grid">
          <div
            className="finance-item"
            style={{ position: 'relative', cursor: 'pointer' }}
            onClick={() => setIsEditTourModalOpen(true)}
            title="クリックして前払い金（仮払金）を変更"
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span className="finance-label">前払い金（仮払金）</span>
              <span
                style={{
                  fontSize: '0.68rem',
                  color: '#60a5fa',
                  background: 'rgba(59, 130, 246, 0.18)',
                  padding: '1px 6px',
                  borderRadius: 4,
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3
                }}
              >
                <Edit3 size={10} />
                変更
              </span>
            </div>
            <span className="finance-value val-primary">
              ¥{tour.advancePayment.toLocaleString()}
            </span>
          </div>

          <div className="finance-item">
            <span className="finance-label">
              前払い金実費計
              {summary.etcGuidePaid > 0 && (
                <span style={{ fontSize: '0.65rem', color: '#c084fc', display: 'block', fontWeight: 700, marginTop: 1 }}>
                  (うち預りETC: ¥{summary.etcGuidePaid.toLocaleString()})
                </span>
              )}
            </span>
            <span className="finance-value val-amber">
              ¥{summary.totalDriverPaid.toLocaleString()}
            </span>
          </div>

          <div className="finance-item">
            <span className="finance-label">
              {summary.balance >= 0 ? '差引残金（返納額）' : '不足立替額（請求）'}
            </span>
            <span className={`finance-value ${summary.balance >= 0 ? 'val-green' : 'val-rose'}`}>
              ¥{Math.abs(summary.balance).toLocaleString()}
            </span>
          </div>
        </div>

        {/* 総経費（カード払い・立替含む） */}
        <div
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(255,255,255,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.8rem'
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>
            総支出（会社ETC・給油含）:
            {summary.cashOutlay > 0 && (
              <span style={{ color: '#fbbf24', marginLeft: 6 }}>
                (うち個人立替: ¥{summary.cashOutlay.toLocaleString()})
              </span>
            )}
          </span>
          <span style={{ fontFamily: 'var(--font-num)', fontWeight: 800, color: '#f8fafc' }}>
            ¥{summary.grandTotal.toLocaleString()} ({receipts.length}件)
          </span>
        </div>

        {/* 🚗 ETC最終計算内訳（回送・実車・ガイド預り金引当 分離表示） */}
        <div
          style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 800, color: '#93c5fd' }}>
            <span>🚗 ETC最終計算内訳:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: '0.82rem', flexWrap: 'wrap' }}>
            <span style={{ color: '#cbd5e1' }}>
              実車計: <strong style={{ color: '#38bdf8', fontFamily: 'var(--font-num)' }}>¥{summary.etcJissha.toLocaleString()}</strong>
            </span>
            <span style={{ color: '#cbd5e1' }}>
              回送計: <strong style={{ color: '#f59e0b', fontFamily: 'var(--font-num)' }}>¥{summary.etcKaiso.toLocaleString()}</strong>
            </span>
            {summary.etcGuidePaid > 0 && (
              <span style={{ color: '#c084fc', fontWeight: 700 }}>
                (うちガイド預り金精算: ¥{summary.etcGuidePaid.toLocaleString()})
              </span>
            )}
          </div>
        </div>

        {/* ミネラルウォーター本数管理（PDF鑑表印字連動） */}
        <div
          style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '1px solid rgba(59, 130, 246, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, color: '#93c5fd' }}>
            <Droplet size={15} color="#60a5fa" />
            <span>水管理（PDF鑑表自動印字）:</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>積込:</span>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={tour.waterLoadedCount ?? ''}
                onChange={async (e) => {
                  const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  const updated: Tour = { ...tour, waterLoadedCount: val, updatedAt: Date.now() };
                  if (tour.id) await db.tours.update(tour.id, { waterLoadedCount: val, updatedAt: Date.now() });
                  onTourUpdated(updated);
                }}
                style={{
                  width: 58,
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  textAlign: 'center'
                }}
              />
              <span style={{ color: 'var(--text-muted)' }}>本</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>残:</span>
              <input
                type="number"
                min="0"
                placeholder="0"
                value={tour.waterRemainingCount ?? ''}
                onChange={async (e) => {
                  const val = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                  const updated: Tour = { ...tour, waterRemainingCount: val, updatedAt: Date.now() };
                  if (tour.id) await db.tours.update(tour.id, { waterRemainingCount: val, updatedAt: Date.now() });
                  onTourUpdated(updated);
                }}
                style={{
                  width: 58,
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  textAlign: 'center'
                }}
              />
              <span style={{ color: 'var(--text-muted)' }}>本</span>
            </div>

            {typeof tour.waterLoadedCount === 'number' && typeof tour.waterRemainingCount === 'number' && (
              <span style={{ fontSize: '0.75rem', color: '#6ee7b7', fontWeight: 600 }}>
                (消費: {Math.max(0, tour.waterLoadedCount - tour.waterRemainingCount)}本)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* アクションボタンバー */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {onOpenGeminiOcr && (
          <button
            type="button"
            className="btn-primary"
            onClick={onOpenGeminiOcr}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              boxShadow: '0 4px 14px rgba(124, 58, 237, 0.35)',
              border: 'none',
              padding: '12px 14px',
              fontSize: '0.92rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: 'var(--radius-md)'
            }}
            title="Gemini 1.5 Flash 高精度AIでレシート読取"
          >
            <Sparkles size={18} color="#fef08a" />
            <span>Gemini AI レシート読取</span>
          </button>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button
            className="btn-primary"
            onClick={onOpenScanner}
            style={{
              padding: '10px 8px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
            title="縦長枠付きリアルタイムカメラで撮影"
          >
            <Camera size={16} />
            通常カメラスキャン
          </button>

          <button
            className="btn-success"
            onClick={handleGeneratePdf}
            disabled={isGeneratingPdf || receipts.length === 0}
            style={{
              padding: '10px 8px',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6
            }}
          >
            <FileText size={16} />
            {isGeneratingPdf ? '生成中...' : 'PDF精算書'}
          </button>
        </div>
      </div>

      {/* 科目別小計カード一覧 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(68px, 1fr))',
          gap: 6
        }}
      >
        {[
          { key: 'etc_jissha', label: 'ETC実車', sum: summary.etcJissha, cls: 'cat-etc' },
          { key: 'etc_kaiso', label: 'ETC回送', sum: summary.etcKaiso, cls: 'cat-etc' },
          { key: 'toll', label: '有料道', sum: summary.categoryTotals.toll, cls: 'cat-toll' },
          { key: 'parking', label: '駐車', sum: summary.categoryTotals.parking, cls: 'cat-parking' },
          { key: 'fuel', label: '燃料', sum: summary.categoryTotals.fuel, cls: 'cat-fuel' },
          { key: 'breakfast', label: '朝食', sum: summary.categoryTotals.breakfast, cls: 'cat-breakfast' },
          { key: 'lunch', label: '昼食', sum: summary.categoryTotals.lunch, cls: 'cat-lunch' },
          { key: 'night_meal', label: '夜食', sum: summary.categoryTotals.night_meal, cls: 'cat-night_meal' },
          { key: 'tea', label: 'お茶', sum: summary.categoryTotals.tea, cls: 'cat-tea' },
          { key: 'water', label: '水', sum: summary.categoryTotals.water, cls: 'cat-water' },
          { key: 'taxi', label: 'タクシー', sum: summary.categoryTotals.taxi, cls: 'cat-taxi' },
          { key: 'lodging', label: '宿泊', sum: summary.categoryTotals.lodging, cls: 'cat-lodging' },
          { key: 'overtime', label: '残業', sum: summary.categoryTotals.overtime, cls: 'cat-overtime' },
          { key: 'other', label: '他', sum: summary.categoryTotals.other, cls: 'cat-other' }
        ].map((c) => (
          <div
            key={c.key}
            className={`glass-card ${c.cls}`}
            style={{
              padding: '10px 4px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: 2
            }}
          >
            <span style={{ fontSize: '0.66rem', fontWeight: 700 }}>{c.label}</span>
            <span
              style={{
                fontFamily: 'var(--font-num)',
                fontWeight: 800,
                fontSize: '0.84rem'
              }}
            >
              ¥{c.sum.toLocaleString()}
            </span>
          </div>
        ))}
      </div>

      {/* 📅 日々の計算（日別集計・実車回送ETC分離） */}
      {dailyBreakdown.length > 0 && (
        <div
          className="glass-card"
          style={{
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.75))',
            border: '1px solid rgba(59, 130, 246, 0.25)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '0.86rem', fontWeight: 800, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>📅 日々の計算（日別集計・実車＆回送ETC別）</span>
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>全 {dailyBreakdown.length} 日間</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {dailyBreakdown.map((day) => (
              <div
                key={day.date}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '0.78rem',
                  flexWrap: 'wrap',
                  gap: 8
                }}
              >
                <div style={{ fontWeight: 800, color: '#f8fafc', minWidth: 90 }}>
                  {day.date}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ color: '#cbd5e1' }}>
                    実車ETC: <strong style={{ color: '#38bdf8', fontFamily: 'var(--font-num)' }}>¥{day.etcJissha.toLocaleString()}</strong>
                  </span>
                  <span style={{ color: '#cbd5e1' }}>
                    回送ETC: <strong style={{ color: '#f59e0b', fontFamily: 'var(--font-num)' }}>¥{day.etcKaiso.toLocaleString()}</strong>
                  </span>
                  {day.etcGuidePaid > 0 && (
                    <span style={{ color: '#c084fc', fontWeight: 700 }}>
                      (預り引: ¥{day.etcGuidePaid.toLocaleString()})
                    </span>
                  )}
                  <span style={{ color: 'var(--text-muted)' }}>
                    他経費: ¥{day.otherTotal.toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 800, color: '#ffffff', fontFamily: 'var(--font-num)', marginLeft: 'auto' }}>
                    日計: ¥{day.dayTotal.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 登録レシート見出し & フィルター & 手動追加 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 6
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: '0.95rem' }}>
          <span>登録済みレシート ({receipts.length})</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: 'rgba(37, 99, 235, 0.12)',
              color: 'var(--primary)',
              border: '1px solid rgba(37, 99, 235, 0.25)'
            }}
          >
            新しい順
          </span>
        </div>

        <button
          onClick={() => setIsManualModalOpen(true)}
          style={{
            fontSize: '0.78rem',
            color: 'var(--primary)',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          <Plus size={15} />
          手動追加
        </button>
      </div>

      {/* 二重登録検知バナー：ETC以外の重複がある時は目立つ警告、ETCのみの重複は控えめ案内 */}
      {severeDuplicateCount > 0 ? (
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(245, 158, 11, 0.16)',
            border: '2px solid rgba(245, 158, 11, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            boxShadow: '0 4px 18px rgba(245, 158, 11, 0.2)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem', color: '#fef3c7', fontWeight: 800 }}>
            <AlertTriangle size={18} color="#fbbf24" style={{ flexShrink: 0 }} />
            <span>
              ⚠️ 二重登録の疑いがあるレシートが <strong>{severeDuplicateCount}件</strong> あります！（同じ日付・金額・店舗または画像）
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              setActiveCategoryFilter(activeCategoryFilter === 'duplicate' ? 'all' : 'duplicate')
            }
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.74rem',
              fontWeight: 800,
              background: activeCategoryFilter === 'duplicate' ? '#f59e0b' : 'rgba(245, 158, 11, 0.3)',
              color: activeCategoryFilter === 'duplicate' ? '#0f172a' : '#fef08a',
              border: '1px solid rgba(245, 158, 11, 0.6)',
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {activeCategoryFilter === 'duplicate' ? 'すべて表示に戻す' : `重複候補のみ表示 (${severeDuplicateCount})`}
          </button>
        </div>
      ) : duplicateMap.size > 0 ? (
        /* ETCのみの同一区間重複（控えめなお知らせ） */
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            background: 'rgba(59, 130, 246, 0.1)',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            fontSize: '0.74rem',
            color: '#93c5fd'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>ℹ️ 同一ETC高速区間の利用が {duplicateMap.size} 件あります（往復等は正常な利用です）</span>
          </div>
        </div>
      ) : null}

      {/* カテゴリタブ */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
        {[
          { id: 'all', label: `すべて (${counts.all})` },
          ...(duplicateMap.size > 0
            ? [{ id: 'duplicate', label: `⚠️ 重複注意 (${duplicateMap.size})` }]
            : []),
          { id: 'etc', label: `ETC (${counts.etc})` },
          { id: 'toll', label: `有料道 (${counts.toll})` },
          { id: 'parking', label: `駐車場 (${counts.parking})` },
          { id: 'fuel', label: `燃料 (${counts.fuel})` },
          { id: 'breakfast', label: `朝食 (${counts.breakfast})` },
          { id: 'lunch', label: `昼食 (${counts.lunch})` },
          { id: 'night_meal', label: `夜食 (${counts.night_meal})` },
          { id: 'tea', label: `お茶 (${counts.tea})` },
          { id: 'water', label: `ミネラル水 (${counts.water})` },
          { id: 'overtime', label: `残業代 (${counts.overtime})` },
          { id: 'taxi', label: `タクシー (${counts.taxi})` },
          { id: 'lodging', label: `宿泊 (${counts.lodging})` },
          { id: 'other', label: `その他 (${counts.other})` }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveCategoryFilter(tab.id)}
            style={{
              padding: '5px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: activeCategoryFilter === tab.id ? 'var(--primary)' : 'var(--bg-surface)',
              color: activeCategoryFilter === tab.id ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border-color)',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* レシートリスト */}
      {filteredReceipts.length === 0 ? (
        <div
          className="glass-card"
          style={{
            padding: 32,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: '0.85rem'
          }}
        >
          レシートがまだ登録されていません。「レシート撮影」または「手動追加」から登録してください。
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredReceipts.map((r) => {
            // 既存データ救済: もし memo に【購入品目】が含まれていて aiMemo がない場合、自動で aiMemo に移して手打ち備考と分離
            let displayMemo = r.memo || '';
            let displayAiMemo = r.aiMemo || '';
            if (!displayAiMemo && displayMemo.startsWith('【購入品目】')) {
              displayAiMemo = displayMemo;
              displayMemo = '';
            }
            const dupEntry = r.id ? duplicateMap.get(r.id) : undefined;

            return (
              <div
                key={r.id}
                className="glass-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  padding: '12px 14px',
                  border: dupEntry
                    ? dupEntry.isEtcOnly
                      ? '1px solid rgba(59, 130, 246, 0.4)'
                      : '1.5px solid rgba(245, 158, 11, 0.7)'
                    : undefined
                }}
              >
                {dupEntry && (
                  dupEntry.isEtcOnly ? (
                    // ETC同区間重複: 控えめ表示（往復利用などで頻出するため）
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '5px 9px',
                        borderRadius: 6,
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        fontSize: '0.72rem',
                        color: '#93c5fd'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span>ℹ️</span>
                        <span>同区間ETC利用（往復・連続等）: {dupEntry.reasons.join(' / ')}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteReceipt(r.id)}
                        style={{
                          padding: '2px 7px',
                          borderRadius: 4,
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#fca5a5',
                          fontSize: '0.68rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        削除
                      </button>
                    </div>
                  ) : (
                    // その他経費の重複: 目立つ警告
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 10px',
                        borderRadius: 6,
                        background: 'rgba(245, 158, 11, 0.14)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        fontSize: '0.73rem',
                        color: '#fde68a'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 700, color: '#fbbf24' }}>
                        <AlertTriangle size={13} color="#fbbf24" />
                        ⚠️ 二重登録注意: {dupEntry.reasons.join(' / ')}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteReceipt(r.id)}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.45)',
                          color: '#fca5a5',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        この明細を削除
                      </button>
                    </div>
                  )
                )}

                {/* 上段: サムネイル + 店舗/科目情報 + 金額/アクション */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', width: '100%' }}>
                  {/* サムネイル */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setCropTargetReceipt(r);
                    }}
                    style={{
                      width: 58,
                      height: 58,
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      background: '#040711',
                      flexShrink: 0,
                      border: '1px solid var(--border-color)',
                      position: 'relative',
                      cursor: 'pointer'
                    }}
                    title="クリックして余白を切り取り・トリミング調整"
                  >
                    <img
                      src={r.processedImageUrl || r.originalImageUrl}
                      alt="サムネイル"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                    {r.hasInvoiceHighlight && (
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 4,
                          background: '#facc15'
                        }}
                        title="T番号ハイライト済"
                      />
                    )}
                  </div>

                  {/* 明細情報 */}
                  <div
                    style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                    onClick={() => {
                      setEditingReceipt(r);
                      setIsEditReceiptModalOpen(true);
                    }}
                    title="クリックしてレシート・科目を編集"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span className={`category-badge cat-${r.category}`}>
                        {r.category === 'etc'
                          ? 'ETC'
                          : r.category === 'toll'
                          ? '有料道'
                          : r.category === 'parking'
                          ? '駐車場'
                          : r.category === 'fuel'
                          ? '燃料'
                          : r.category === 'breakfast'
                          ? '朝食代'
                          : r.category === 'lunch'
                          ? '昼食代'
                          : r.category === 'night_meal'
                          ? '夜食代'
                          : r.category === 'tea'
                          ? 'お茶代'
                          : r.category === 'water'
                          ? 'ミネラル水'
                          : r.category === 'taxi'
                          ? 'タクシー'
                          : r.category === 'lodging'
                          ? '宿泊'
                          : r.category === 'overtime'
                          ? '残業代'
                          : 'その他'}
                      </span>
                      {r.category === 'etc' && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 700,
                            background: r.etcType === 'kaiso' ? 'rgba(245, 158, 11, 0.18)' : 'rgba(59, 130, 246, 0.18)',
                            color: r.etcType === 'kaiso' ? '#fbbf24' : '#60a5fa',
                            border: `1px solid ${r.etcType === 'kaiso' ? 'rgba(245, 158, 11, 0.35)' : 'rgba(59, 130, 246, 0.35)'}`
                          }}
                        >
                          {r.etcType === 'kaiso' ? '回送' : '実車'}
                        </span>
                      )}
                      {r.category === 'etc' && r.etcPaidByGuide && (
                        <span
                          style={{
                            fontSize: '0.68rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontWeight: 700,
                            background: 'rgba(168, 85, 247, 0.2)',
                            color: '#d8b4fe',
                            border: '1px solid rgba(168, 85, 247, 0.4)'
                          }}
                        >
                          👛 預り金
                        </span>
                      )}
                      <span
                        className="method-tag"
                        style={{
                          background:
                            (r.category === 'etc' ? r.etcPaidByGuide : r.paymentMethod === 'advance')
                              ? 'rgba(16, 185, 129, 0.15)'
                              : r.paymentMethod === 'cash'
                              ? 'rgba(245, 158, 11, 0.15)'
                              : 'rgba(59, 130, 246, 0.12)',
                          color:
                            (r.category === 'etc' ? r.etcPaidByGuide : r.paymentMethod === 'advance')
                              ? '#34d399'
                              : r.paymentMethod === 'cash'
                              ? '#fbbf24'
                              : '#93c5fd',
                          border: `1px solid ${
                            (r.category === 'etc' ? r.etcPaidByGuide : r.paymentMethod === 'advance')
                              ? 'rgba(16, 185, 129, 0.35)'
                              : r.paymentMethod === 'cash'
                              ? 'rgba(245, 158, 11, 0.35)'
                              : 'rgba(59, 130, 246, 0.25)'
                          }`
                        }}
                      >
                        {r.category === 'etc'
                          ? r.etcPaidByGuide
                            ? '仮払金引当'
                            : '会社ETC'
                          : r.paymentMethod === 'advance'
                          ? '前払い金'
                          : r.paymentMethod === 'cash'
                          ? '個人立替'
                          : r.paymentMethod === 'company_etc'
                          ? '会社ETC'
                          : r.paymentMethod === 'company_fuel'
                          ? '燃料カード'
                          : '会社カード'}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-sub)' }}>
                        {r.date}
                      </span>
                    </div>

                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '0.92rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <span>{r.place}</span>
                      <Edit3 size={11} color="var(--primary)" style={{ flexShrink: 0 }} />
                    </div>

                    {r.invoiceNumber && (
                      <div style={{ marginTop: 2 }}>
                        <span className="invoice-tag" style={{ fontSize: '0.68rem', padding: '1px 5px' }}>
                          {r.invoiceNumber}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 金額 & 編集・削除ボタン */}
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-num)',
                        fontWeight: 800,
                        fontSize: '1.05rem',
                        color: '#ffffff',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        setEditingReceipt(r);
                        setIsEditReceiptModalOpen(true);
                      }}
                      title="クリックして編集"
                    >
                      ¥{r.amount.toLocaleString()}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCropTargetReceipt(r);
                        }}
                        style={{
                          color: '#38bdf8',
                          padding: '4px 6px',
                          borderRadius: 4,
                          background: 'rgba(56, 189, 248, 0.12)',
                          border: '1px solid rgba(56, 189, 248, 0.25)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                          cursor: 'pointer'
                        }}
                        title="レシートの余白を切り取り・トリミング調整"
                      >
                        <Scissors size={13} />
                        切り取り
                      </button>

                      <button
                        onClick={() => {
                          setEditingReceipt(r);
                          setIsEditReceiptModalOpen(true);
                        }}
                        style={{
                          color: 'var(--primary)',
                          padding: '4px 6px',
                          borderRadius: 4,
                          background: 'rgba(59, 130, 246, 0.12)',
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3
                        }}
                        title="科目や金額を編集"
                      >
                        <Edit3 size={13} />
                        編集
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteReceipt(r.id);
                        }}
                        style={{ color: 'var(--text-sub)', padding: 4 }}
                        title="削除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>

                {/* 🚌 ETCワンタップ切替バー（実車/回送 & ガイド預り金から引く/引かない） */}
                {r.category === 'etc' && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: 'rgba(59, 130, 246, 0.06)',
                      border: '1px solid rgba(59, 130, 246, 0.18)'
                    }}
                  >
                    {/* 実車 / 回送 切替 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>区分:</span>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.etcType === 'kaiso') handleToggleEtcType(r);
                          }}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 4,
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: '1px solid',
                            background: r.etcType !== 'kaiso' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.05)',
                            borderColor: r.etcType !== 'kaiso' ? '#3b82f6' : 'rgba(255, 255, 255, 0.15)',
                            color: r.etcType !== 'kaiso' ? '#93c5fd' : 'var(--text-sub)'
                          }}
                          title="実車として計算"
                        >
                          🚌 実車
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.etcType !== 'kaiso') handleToggleEtcType(r);
                          }}
                          style={{
                            padding: '3px 9px',
                            borderRadius: 4,
                            fontSize: '0.73rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            border: '1px solid',
                            background: r.etcType === 'kaiso' ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                            borderColor: r.etcType === 'kaiso' ? '#f59e0b' : 'rgba(255, 255, 255, 0.15)',
                            color: r.etcType === 'kaiso' ? '#fde68a' : 'var(--text-sub)'
                          }}
                          title="回送として計算"
                        >
                          🔄 回送
                        </button>
                      </div>
                    </div>

                    {/* ガイド預り金 引く / 引かない 切替 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>精算:</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleEtcGuide(r);
                        }}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 4,
                          fontSize: '0.73rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          border: '1px solid',
                          background: r.etcPaidByGuide
                            ? 'rgba(168, 85, 247, 0.25)'
                            : 'rgba(255, 255, 255, 0.05)',
                          borderColor: r.etcPaidByGuide
                            ? '#a855f7'
                            : 'rgba(255, 255, 255, 0.2)',
                          color: r.etcPaidByGuide ? '#e9d5ff' : 'var(--text-sub)'
                        }}
                        title="クリックしてガイド預り金精算を切り替え"
                      >
                        {r.etcPaidByGuide ? '👛 ガイド預り金から引く' : '🏢 引かない (通常精算)'}
                      </button>
                    </div>
                  </div>
                )}

                {/* 📝 手入力の備考欄（幅を広げ、2段・3段でも文字を全部表示） */}
                {displayMemo && (
                  <div
                    onClick={() => {
                      setEditingReceipt(r);
                      setIsEditReceiptModalOpen(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(56, 189, 248, 0.08)',
                      borderLeft: '3px solid #38bdf8',
                      borderTop: '1px solid rgba(56, 189, 248, 0.15)',
                      borderRight: '1px solid rgba(56, 189, 248, 0.15)',
                      borderBottom: '1px solid rgba(56, 189, 248, 0.15)',
                      fontSize: '0.84rem',
                      color: '#f8fafc',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.55,
                      boxSizing: 'border-box',
                      cursor: 'pointer'
                    }}
                    title="クリックして備考を編集"
                  >
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#38bdf8',
                        fontWeight: 700,
                        marginBottom: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5
                      }}
                    >
                      <FileText size={12} />
                      <span>備考（手入力）</span>
                    </div>
                    <div>{displayMemo}</div>
                  </div>
                )}

                {/* 🤖 AI読取項目（手入力備考とは別の項目として独立表示） */}
                {displayAiMemo && (
                  <div
                    onClick={() => {
                      setEditingReceipt(r);
                      setIsEditReceiptModalOpen(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(124, 58, 237, 0.08)',
                      borderLeft: '3px solid #a855f7',
                      borderTop: '1px solid rgba(168, 85, 247, 0.15)',
                      borderRight: '1px solid rgba(168, 85, 247, 0.15)',
                      borderBottom: '1px solid rgba(168, 85, 247, 0.15)',
                      fontSize: '0.8rem',
                      color: '#e2e8f0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      lineHeight: 1.5,
                      boxSizing: 'border-box',
                      cursor: 'pointer'
                    }}
                    title="クリックして確認・編集"
                  >
                    <div
                      style={{
                        fontSize: '0.7rem',
                        color: '#c084fc',
                        fontWeight: 700,
                        marginBottom: 3,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5
                      }}
                    >
                      <Sparkles size={12} />
                      <span>AI読取項目（品目・レシート解析）</span>
                    </div>
                    <div>{displayAiMemo}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 手動追加モーダル */}
      <ManualReceiptModal
        isOpen={isManualModalOpen}
        onClose={() => setIsManualModalOpen(false)}
        activeTour={tour}
        onReceiptAdded={loadReceipts}
      />

      {/* レシート編集モーダル */}
      <EditReceiptModal
        isOpen={isEditReceiptModalOpen}
        onClose={() => {
          setIsEditReceiptModalOpen(false);
          setEditingReceipt(null);
        }}
        receipt={editingReceipt}
        onReceiptUpdated={loadReceipts}
      />

      {/* PDFプレビュー＆メール送信モーダル */}
      <PdfPreviewModal
        isOpen={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        pdfResult={pdfResult}
        tour={tour}
        profile={profile}
      />

      {/* 仮払金・ツアー情報編集モーダル */}
      <EditTourModal
        isOpen={isEditTourModalOpen}
        onClose={() => setIsEditTourModalOpen(false)}
        tour={tour}
        onTourUpdated={onTourUpdated}
      />

      {/* レシート余白切り取り・トリミング調整モーダル */}
      {cropTargetReceipt && (
        <ImageCropModal
          isOpen={!!cropTargetReceipt}
          onClose={() => setCropTargetReceipt(null)}
          imageUrl={cropTargetReceipt.processedImageUrl || cropTargetReceipt.originalImageUrl || ''}
          onApplyCrop={async (croppedUrl) => {
            if (cropTargetReceipt.id) {
              await db.receipts.update(cropTargetReceipt.id, { processedImageUrl: croppedUrl });
              loadReceipts();
            }
          }}
        />
      )}
    </div>
  );
};
