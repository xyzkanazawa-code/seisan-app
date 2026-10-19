import React, { useState } from 'react';
import {
  CheckCircle2,
  Trash2,
  Calendar,
  DollarSign,
  MapPin,
  Tag,
  CreditCard,
  Sparkles,
  AlertCircle,
  X,
  Scissors
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { db, type Tour, type ExpenseCategory, type PaymentMethod, type Receipt } from '../db';
import { detectCategoryAndPlace, type ParsedReceiptItem } from '../utils/ocrService';
import { learnFromReceipt } from '../utils/learningService';
import { sortReceiptsByDate } from '../utils/receiptSort';
import { autoTightCrop } from '../utils/imageProcessor';
import { ImageCropModal } from './ImageCropModal';

interface BatchReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTour: Tour;
  initialItems: ParsedReceiptItem[];
  onCommitted: () => void;
}

export const BatchReviewModal: React.FC<BatchReviewModalProps> = ({
  isOpen,
  onClose,
  activeTour,
  initialItems,
  onCommitted
}) => {
  const [items, setItems] = useState<ParsedReceiptItem[]>(initialItems);
  const [isSaving, setIsSaving] = useState(false);
  const [initialAdvanceRemaining, setInitialAdvanceRemaining] = useState<number>(0);
  const [cropTargetItem, setCropTargetItem] = useState<{ id: string; url: string } | null>(null);
  const [tighteningId, setTighteningId] = useState<string | null>(null);

  // ワンタップ余白自動カット
  const handleQuickTighten = async (item: ParsedReceiptItem) => {
    setTighteningId(item.id);
    try {
      const tightened = await autoTightCrop(item.processedImageUrl);
      updateItem(item.id, { processedImageUrl: tightened });
    } catch (e) {
      console.warn('余白自動カット失敗:', e);
    } finally {
      setTighteningId(null);
    }
  };

  // 初回マウント時または項目更新時：常に日付順（時系列昇順）に整列し、前払金残高を計算して順次充当
  React.useEffect(() => {
    const sortedInitial = sortReceiptsByDate(initialItems);
    if (!activeTour?.id) {
      setItems(sortedInitial);
      return;
    }

    db.receipts
      .where('tourId')
      .equals(activeTour.id)
      .toArray()
      .then((existing) => {
        const advanceSpent = existing
          .filter((r) => r.paymentMethod === 'advance')
          .reduce((sum, r) => sum + r.amount, 0);
        const tourAdvance = activeTour.advancePayment || 0;
        let remainingAdvance = Math.max(0, tourAdvance - advanceSpent);
        setInitialAdvanceRemaining(remainingAdvance);

        // 各アイテムに前払金枠を日付順に順次充当
        const adjustedItems = sortedInitial.map((item) => {
          // 会社カード（ETC、燃料、会社カード）はそのまま
          if (
            item.paymentMethod === 'company_etc' ||
            item.paymentMethod === 'company_fuel' ||
            item.paymentMethod === 'company_card'
          ) {
            return item;
          }

          // もしすでに前払金枠が0円なら自動で個人立替
          if (remainingAdvance <= 0) {
            return {
              ...item,
              paymentMethod: 'cash' as PaymentMethod,
              autoSwitchedToCash: true
            };
          }

          const amt = Number(item.amount) || 0;
          if (amt <= remainingAdvance) {
            // 前払金枠内で収まる
            remainingAdvance -= amt;
            return {
              ...item,
              paymentMethod: 'advance' as PaymentMethod,
              autoSwitchedToCash: false
            };
          } else {
            // 前払金枠を超過：超過したアイテム以降は個人立替に自動変更
            remainingAdvance = 0;
            return {
              ...item,
              paymentMethod: 'cash' as PaymentMethod,
              autoSwitchedToCash: true
            };
          }
        });

        setItems(adjustedItems);
      })
      .catch((err) => {
        console.error('前払金残高取得エラー:', err);
        setItems(sortedInitial);
      });
  }, [initialItems, activeTour]);

  if (!isOpen || items.length === 0) return null;

  // 1件の編集ハンドラ
  const updateItem = (id: string, updates: Partial<ParsedReceiptItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  // 1件削除
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    if (items.length <= 1) {
      onClose();
    }
  };

  // 「全部OK」一括確定処理
  const handleCommitAll = async () => {
    if (items.length === 0 || !activeTour.id) return;

    setIsSaving(true);
    // 常に日付順（時系列昇順）に並び替えてからDBへ確定保存
    const sortedItems = sortReceiptsByDate(items);
    const baseNow = Date.now();
    try {
      const recordsToInsert: Omit<Receipt, 'id'>[] = sortedItems.map((item, index) => ({
        tourId: activeTour.id!,
        category: item.category,
        paymentMethod: item.paymentMethod,
        date: item.date,
        amount: Number(item.amount) || 0,
        place: item.place || '経費',
        invoiceNumber: item.invoiceNumber,
        isInvoiceValid: item.isInvoiceValid,
        hasInvoiceHighlight: item.hasInvoiceHighlight,
        originalImageUrl: item.originalImageUrl,
        processedImageUrl: item.processedImageUrl,
        etcDetails: item.etcDetails,
        memo: item.memo,
        createdAt: baseNow + index
      }));

      // 一括トランザクションでローカルIndexedDBに保存
      await db.receipts.bulkAdd(recordsToInsert as Receipt[]);

      // 🧠 確定した各レシートの内容を自動学習（次回の通常スキャンが賢くなる）
      for (const item of items) {
        if (item.place && item.place.trim()) {
          try {
            await learnFromReceipt({
              place: item.place.trim(),
              category: item.category,
              paymentMethod: item.paymentMethod,
              invoiceNumber: item.invoiceNumber,
              source: item.isLearned ? 'ocr' : 'manual'
            });
          } catch (e) {
            console.warn('アイテム学習エラー:', e);
          }
        }
      }

      // 祝賀コンフェッティ（確定演出）
      confetti({
        particleCount: 60,
        spread: 60,
        origin: { y: 0.85 }
      });

      onCommitted();
      onClose();
    } catch (err) {
      console.error('一括保存エラー:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  return (
    <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: 30 }}>
      <div
        className="modal-content"
        style={{
          maxHeight: '92dvh',
          borderRadius: 'var(--radius-lg)'
        }}
      >
        {/* ヘッダー */}
        <div className="modal-header">
          <div>
            <div className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={20} color="var(--accent-amber)" />
              <span>スキャン結果の確認 ({items.length} 件)</span>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}
              >
                新しい順
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              ツアー: {activeTour.code} | 読取合計: ¥{totalAmount.toLocaleString()}
              {activeTour.advancePayment ? (
                <> | 前払金残高: <strong style={{ color: initialAdvanceRemaining > 0 ? '#38bdf8' : '#f87171' }}>¥{initialAdvanceRemaining.toLocaleString()}</strong></>
              ) : null}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* カード縦並びプレビューリスト（仕様書準拠） */}
        <div className="modal-body" style={{ gap: 20 }}>
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              fontSize: '0.8rem',
              color: '#93c5fd',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              flexWrap: 'wrap'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Sparkles size={16} color="#fbbf24" style={{ flexShrink: 0 }} />
              <span>
                <strong>🤖 AI科目自動判定済み:</strong> 昼食代・朝食代・夜食代・お茶代・ETC・駐車場等を自動判別しました。
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setItems((prev) =>
                  prev.map((it) => {
                    const textToAnalyze = `${it.place} ${it.rawText || ''} ${it.date}`;
                    const detected = detectCategoryAndPlace(textToAnalyze);
                    return {
                      ...it,
                      category: detected.category,
                      paymentMethod: it.paymentMethod || detected.paymentMethod
                    };
                  })
                );
              }}
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(255, 255, 255, 0.12)',
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
              title="店名・品目・時間帯から科目をAI再判定"
            >
              🔄 AI科目再判定
            </button>
          </div>

          {items.map((item, index) => (
            <div
              key={item.id}
              className="glass-card"
              style={{
                padding: 16,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                position: 'relative'
              }}
            >
              {/* カード上部：通番 & 削除ボタン */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      background: 'var(--primary)',
                      color: 'white',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)'
                    }}
                  >
                    #{index + 1}
                  </span>

                  {item.isLearned && (
                    <span
                      style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.25), rgba(99, 102, 241, 0.25))',
                        color: '#c4b5fd',
                        border: '1px solid rgba(139, 92, 246, 0.4)',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                      title={`過去の履歴「${item.learnedKeyword || ''}」から自動学習して判定しました`}
                    >
                      🧠 過去から学習済
                    </span>
                  )}

                  {item.etcDetails && (
                    <span className="category-badge cat-etc" style={{ fontSize: '0.7rem' }}>
                      ETC区間明細
                    </span>
                  )}

                  {item.autoSwitchedToCash && (
                    <span
                      style={{
                        background: 'rgba(239, 68, 68, 0.18)',
                        color: '#f87171',
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3
                      }}
                      title="前払金を使い切ったため、支払方法を「個人立替」に自動変更しました"
                    >
                      ⚠️ 前払金消化 → 個人立替
                    </span>
                  )}
                </div>

                <button
                  onClick={() => removeItem(item.id)}
                  style={{
                    color: 'var(--text-sub)',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.75rem'
                  }}
                  title="このレシートを除外"
                >
                  <Trash2 size={16} />
                  削除
                </button>
              </div>

              {/* 上部：ハイライト済みレシート切り抜き画像プレビュー（仕様書準拠） */}
              <div
                style={{
                  width: '100%',
                  height: 180,
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                  background: '#090d16',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 14,
                  border: '1px solid var(--border-color)',
                  position: 'relative'
                }}
              >
                <img
                  src={item.processedImageUrl}
                  alt="証拠レシート"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain'
                  }}
                />

                {/* インボイスハイライト通知バッジ */}
                {item.hasInvoiceHighlight && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      background: 'rgba(250, 204, 21, 0.95)',
                      color: '#000000',
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-full)',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    <Sparkles size={12} />
                    T番号 蛍光ペン強調済
                  </div>
                )}
              </div>

              {/* 余白カット・切り取り調整アクションバー */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button
                  type="button"
                  onClick={() => handleQuickTighten(item)}
                  disabled={tighteningId === item.id}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(59, 130, 246, 0.12)',
                    color: '#60a5fa',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                  title="周囲の余白・机を自動検出してタイトに切り詰めます"
                >
                  <Scissors size={13} />
                  {tighteningId === item.id ? '余白カット中...' : '余白を自動カット'}
                </button>

                <button
                  type="button"
                  onClick={() => setCropTargetItem({ id: item.id, url: item.processedImageUrl })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: 'var(--text-muted)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="手動で上下左右の切り取り位置を微調整します"
                >
                  <span>📐 切り取り調整</span>
                </button>
              </div>

              {/* 科目クイック切替（OCR自動判定の確認＆1タップ変更） */}
              <div style={{ marginBottom: 14 }}>
                <div
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-muted)',
                    fontWeight: 700,
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Tag size={12} />
                    判定科目 (タップで即変更)
                  </span>
                  <span style={{ color: 'var(--primary)', fontSize: '0.68rem', fontWeight: 600 }}>
                    自動判定完了
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))', gap: 4 }}>
                  {[
                    { id: 'parking' as const, label: '駐車場', icon: '🅿️', defaultPay: 'advance' as const },
                    { id: 'etc' as const, label: 'ETC', icon: '🚗', defaultPay: 'company_etc' as const },
                    { id: 'toll' as const, label: '有料道', icon: '🛣️', defaultPay: 'advance' as const },
                    { id: 'fuel' as const, label: '燃料', icon: '⛽', defaultPay: 'company_fuel' as const },
                    { id: 'breakfast' as const, label: '朝食代', icon: '🍙', defaultPay: 'advance' as const },
                    { id: 'lunch' as const, label: '昼食代', icon: '🍱', defaultPay: 'advance' as const },
                    { id: 'night_meal' as const, label: '夜食代', icon: '🌙', defaultPay: 'advance' as const },
                    { id: 'tea' as const, label: 'お茶代', icon: '🍵', defaultPay: 'advance' as const },
                    { id: 'water' as const, label: 'ミネラル水', icon: '💧', defaultPay: 'advance' as const },
                    { id: 'overtime' as const, label: '残業代', icon: '⏰', defaultPay: 'cash' as const },
                    { id: 'taxi' as const, label: 'タクシー', icon: '🚕', defaultPay: 'advance' as const },
                    { id: 'lodging' as const, label: '宿泊', icon: '🏨', defaultPay: 'advance' as const },
                    { id: 'other' as const, label: 'その他', icon: '📦', defaultPay: 'advance' as const },
                  ].map((cat) => {
                    const isSelected = item.category === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() =>
                          updateItem(item.id, {
                            category: cat.id,
                            paymentMethod: isSelected ? item.paymentMethod : cat.defaultPay
                          })
                        }
                        style={{
                          padding: '6px 1px',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.67rem',
                          fontWeight: isSelected ? 800 : 600,
                          background: isSelected ? 'var(--primary)' : 'rgba(255, 255, 255, 0.04)',
                          color: isSelected ? '#ffffff' : 'var(--text-muted)',
                          border: isSelected
                            ? '1px solid var(--primary)'
                            : '1px solid var(--border-color)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <span style={{ fontSize: '0.85rem' }}>{cat.icon}</span>
                        <span style={{ whiteSpace: 'nowrap' }}>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 中段：編集可能な項目（金額、日付、場所、科目、支払種別） */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {/* 金額 & 日付 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label
                      className="form-label"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <DollarSign size={14} />
                      支払金額 (税込)
                    </label>
                    <div style={{ position: 'relative' }}>
                      <span
                        style={{
                          position: 'absolute',
                          left: 12,
                          top: 13,
                          fontFamily: 'var(--font-num)',
                          fontWeight: 700,
                          color: '#60a5fa'
                        }}
                      >
                        ¥
                      </span>
                      <input
                        type="number"
                        className="form-input"
                        style={{
                          paddingLeft: 28,
                          fontFamily: 'var(--font-num)',
                          fontSize: '1.15rem',
                          fontWeight: 800,
                          color: item.amount === 0 ? '#f87171' : '#ffffff',
                          borderColor: item.amount === 0 ? '#ef4444' : undefined
                        }}
                        placeholder="0"
                        value={item.amount || ''}
                        onChange={(e) => updateItem(item.id, { amount: Number(e.target.value) })}
                      />
                    </div>
                    {(!item.amount || item.amount === 0) && (
                      <div
                        style={{
                          fontSize: '0.7rem',
                          color: '#f87171',
                          marginTop: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <AlertCircle size={12} />
                        金額を入力してください
                      </div>
                    )}
                  </div>

                  <div className="form-group">
                    <label
                      className="form-label"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Calendar size={14} />
                      利用日
                    </label>
                    <input
                      type="date"
                      className="form-input"
                      value={item.date}
                      onChange={(e) => updateItem(item.id, { date: e.target.value })}
                    />
                  </div>
                </div>

                {/* 場所・店舗名 */}
                <div className="form-group">
                  <label
                    className="form-label"
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <MapPin size={14} />
                    利用場所・料金所・店名
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={item.place}
                    onChange={(e) => updateItem(item.id, { place: e.target.value })}
                  />
                </div>

                {/* 科目 & 支払種別 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-group">
                    <label
                      className="form-label"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Tag size={14} />
                      経費科目
                    </label>
                    <select
                      className="form-input"
                      value={item.category}
                      onChange={(e) =>
                        updateItem(item.id, { category: e.target.value as ExpenseCategory })
                      }
                    >
                      <option value="breakfast">朝食代（食事・弁当）</option>
                      <option value="lunch">昼食代（食事・弁当）</option>
                      <option value="night_meal">夜食代（夜食・食事）</option>
                      <option value="tea">お茶代・飲料費</option>
                      <option value="water">ミネラルウォーター</option>
                      <option value="parking">駐車場代</option>
                      <option value="etc">ETC高速料金</option>
                      <option value="toll">有料道路代（非ETC）</option>
                      <option value="fuel">燃料・給油</option>
                      <option value="taxi">タクシー代</option>
                      <option value="lodging">宿泊代・ホテル</option>
                      <option value="overtime">残業代・時間外手当</option>
                      <option value="other">その他・雑費</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label
                      className="form-label"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <CreditCard size={14} />
                      支払手段
                    </label>
                    <select
                      className="form-input"
                      value={item.paymentMethod}
                      onChange={(e) =>
                        updateItem(item.id, { paymentMethod: e.target.value as PaymentMethod })
                      }
                    >
                      <option value="advance">前払い金（仮払金から支払）</option>
                      <option value="cash">個人立替（自己現金）</option>
                      <option value="company_etc">会社ETCカード</option>
                      <option value="company_fuel">燃料掛けカード</option>
                      <option value="company_card">会社専用カード</option>
                    </select>
                  </div>
                </div>

                {/* インボイス番号の確認と検証ステータス */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(10, 15, 28, 0.6)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.78rem'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--text-muted)' }}>適格請求書:</span>
                    {item.invoiceNumber ? (
                      <span className="invoice-tag">
                        {item.invoiceNumber}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-sub)' }}>なし / 免税事業者等</span>
                    )}
                  </div>

                  {item.invoiceNumber && (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: item.isInvoiceValid ? '#34d399' : '#fbbf24',
                        fontWeight: 700
                      }}
                    >
                      {item.isInvoiceValid ? (
                        <>
                          <CheckCircle2 size={14} />
                          適格（Mod11合致）
                        </>
                      ) : (
                        <>
                          <AlertCircle size={14} />
                          形式確認
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* フッター：「全部OK」一括確定ボタン（仕様書最重要アクション） */}
        <div className="modal-footer" style={{ flexDirection: 'column', gap: 10 }}>
          <button
            className="btn-success"
            style={{ width: '100%', height: 56, fontSize: '1.15rem' }}
            onClick={handleCommitAll}
            disabled={isSaving}
          >
            <CheckCircle2 size={24} />
            {isSaving ? '保存中...' : `「全部OK」一括確定 (${items.length} 件保存)`}
          </button>
        </div>
      </div>

      {/* レシート余白・切り取り調整モーダル */}
      {cropTargetItem && (
        <ImageCropModal
          isOpen={!!cropTargetItem}
          onClose={() => setCropTargetItem(null)}
          imageUrl={cropTargetItem.url}
          onApplyCrop={(croppedUrl) => {
            updateItem(cropTargetItem.id, { processedImageUrl: croppedUrl });
          }}
        />
      )}
    </div>
  );
};
