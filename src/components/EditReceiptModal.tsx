import React, { useState, useEffect } from 'react';
import { X, Save, Calendar, DollarSign, MapPin, Tag, CreditCard, Trash2, CheckCircle2, AlertCircle, Sparkles, FileText, Scissors } from 'lucide-react';
import { db, type ExpenseCategory, type PaymentMethod, type Receipt } from '../db';
import { extractInvoiceNumbers } from '../utils/invoiceValidator';
import { learnFromReceipt } from '../utils/learningService';
import { autoTightCrop } from '../utils/imageProcessor';
import { ImageCropModal } from './ImageCropModal';

interface EditReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  receipt: Receipt | null;
  onReceiptUpdated: () => void;
}

const CATEGORY_ITEMS: { id: ExpenseCategory; label: string; icon: string; defaultPay: PaymentMethod }[] = [
  { id: 'parking', label: '駐車場', icon: '🅿️', defaultPay: 'cash' },
  { id: 'etc', label: 'ETC', icon: '🚗', defaultPay: 'company_etc' },
  { id: 'toll', label: '有料道', icon: '🛣️', defaultPay: 'cash' },
  { id: 'fuel', label: '燃料', icon: '⛽', defaultPay: 'company_fuel' },
  { id: 'breakfast', label: '朝食代', icon: '🍙', defaultPay: 'cash' },
  { id: 'lunch', label: '昼食代', icon: '🍱', defaultPay: 'cash' },
  { id: 'night_meal', label: '夜食代', icon: '🌙', defaultPay: 'cash' },
  { id: 'tea', label: 'お茶代', icon: '🍵', defaultPay: 'cash' },
  { id: 'water', label: 'ミネラル水', icon: '💧', defaultPay: 'cash' },
  { id: 'overtime', label: '残業代', icon: '⏰', defaultPay: 'cash' },
  { id: 'taxi', label: 'タクシー', icon: '🚕', defaultPay: 'cash' },
  { id: 'lodging', label: '宿泊', icon: '🏨', defaultPay: 'cash' },
  { id: 'other', label: 'その他', icon: '📦', defaultPay: 'cash' }
];

export const EditReceiptModal: React.FC<EditReceiptModalProps> = ({
  isOpen,
  onClose,
  receipt,
  onReceiptUpdated
}) => {
  const [category, setCategory] = useState<ExpenseCategory>('parking');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [place, setPlace] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [aiMemo, setAiMemo] = useState('');
  const [entryGate, setEntryGate] = useState('');
  const [exitGate, setExitGate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [currentProcessedImageUrl, setCurrentProcessedImageUrl] = useState('');
  const [isCroppingModalOpen, setIsCroppingModalOpen] = useState(false);
  const [isTightening, setIsTightening] = useState(false);

  // レシート情報が渡されたらフォームステートを初期化
  useEffect(() => {
    if (receipt) {
      setCategory(receipt.category);
      setPaymentMethod(receipt.paymentMethod);
      setDate(receipt.date || new Date().toISOString().split('T')[0]);
      setAmount(receipt.amount);
      setPlace(receipt.place || '');
      setInvoiceNumber(receipt.invoiceNumber || '');
      setCurrentProcessedImageUrl(receipt.processedImageUrl || receipt.originalImageUrl || '');

      // 既存データの救済：もし memo に 【購入品目】 が含まれていて aiMemo がない場合、自動で aiMemo に移して memo（手打ち用）を空にする
      let m = receipt.memo || '';
      let aim = receipt.aiMemo || '';
      if (!aim && m.startsWith('【購入品目】')) {
        aim = m;
        m = '';
      }
      setMemo(m);
      setAiMemo(aim);

      setEntryGate(receipt.etcDetails?.entryGate || '');
      setExitGate(receipt.etcDetails?.exitGate || '');
    }
  }, [receipt]);

  // ワンタップ余白自動カット（即座にDB保存＆一覧更新）
  const handleAutoTighten = async () => {
    if (!currentProcessedImageUrl || !receipt?.id) return;
    setIsTightening(true);
    try {
      const tightened = await autoTightCrop(currentProcessedImageUrl);
      setCurrentProcessedImageUrl(tightened);
      await db.receipts.update(receipt.id, { processedImageUrl: tightened });
      onReceiptUpdated();
    } catch (e) {
      console.warn('余白自動カット失敗:', e);
    } finally {
      setIsTightening(false);
    }
  };

  if (!isOpen || !receipt) return null;

  // インボイス番号の妥当性チェック
  const invoiceValidation = invoiceNumber.trim() ? extractInvoiceNumbers(invoiceNumber) : [];
  const isInvoiceValid = invoiceValidation.length > 0 ? invoiceValidation[0].isCheckDigitValid : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receipt.id || !amount || Number(amount) <= 0) return;

    setIsSaving(true);
    try {
      let finalInvoiceValid = false;
      if (invoiceNumber.trim()) {
        const validated = extractInvoiceNumbers(invoiceNumber);
        if (validated.length > 0) {
          finalInvoiceValid = validated[0].isCheckDigitValid;
        }
      }

      const formattedInvoice = invoiceNumber.trim()
        ? (invoiceNumber.trim().startsWith('T') ? invoiceNumber.trim() : `T${invoiceNumber.trim()}`)
        : undefined;

      const etcDetails = category === 'etc' || entryGate || exitGate
        ? {
            ...receipt.etcDetails,
            entryGate: entryGate.trim() || undefined,
            exitGate: exitGate.trim() || undefined
          }
        : receipt.etcDetails;

      await db.receipts.update(receipt.id, {
        category,
        paymentMethod,
        date,
        amount: Number(amount),
        place: place.trim() || '経費',
        invoiceNumber: formattedInvoice,
        isInvoiceValid: finalInvoiceValid,
        etcDetails,
        processedImageUrl: currentProcessedImageUrl || receipt.processedImageUrl,
        memo: memo.trim(),
        aiMemo: aiMemo.trim() || undefined
      });

      // 🧠 ユーザーの編集・修正を自動学習に反映
      await learnFromReceipt({
        place: place.trim(),
        category,
        paymentMethod,
        invoiceNumber: formattedInvoice,
        source: 'manual'
      });

      onReceiptUpdated();
      onClose();
    } catch (err) {
      console.error('レシート更新エラー:', err);
      alert('レシートの更新中にエラーが発生しました。');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!receipt.id) return;
    if (window.confirm('このレシート明細を削除してもよろしいですか？')) {
      await db.receipts.delete(receipt.id);
      onReceiptUpdated();
      onClose();
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div className="modal-title">
            <Save size={20} color="var(--primary)" />
            レシート明細・科目の編集
          </div>
          <button className="icon-btn" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ maxHeight: '72vh', overflowY: 'auto' }}>
            {/* プレビュー画像と基本情報・余白カット機能 */}
            {(currentProcessedImageUrl || receipt.processedImageUrl || receipt.originalImageUrl) && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-color)',
                  marginBottom: 12
                }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                  <div
                    style={{
                      width: 84,
                      height: 104,
                      borderRadius: 'var(--radius-sm)',
                      overflow: 'hidden',
                      background: '#040711',
                      flexShrink: 0,
                      border: '1.5px solid #38bdf8',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 2
                    }}
                  >
                    <img
                      src={currentProcessedImageUrl || receipt.processedImageUrl || receipt.originalImageUrl}
                      alt="レシート原本"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    <div style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.9rem', marginBottom: 2 }}>
                      登録済みレシート #{receipt.id}
                    </div>
                    <div>余白カットやトリミングを行うと、即座に保存・反映されます。</div>
                    {receipt.hasInvoiceHighlight && (
                      <div style={{ color: '#fbbf24', fontSize: '0.72rem', marginTop: 2 }}>
                        ✓ 適格請求書（T番号）ハイライト処理済み
                      </div>
                    )}
                  </div>
                </div>

                {/* 余白カット・切り取り調整アクションボタン */}
                <div style={{ display: 'flex', gap: 6, paddingTop: 4, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button
                    type="button"
                    onClick={handleAutoTighten}
                    disabled={isTightening}
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
                    {isTightening ? '余白カット中...' : '余白を自動カット'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsCroppingModalOpen(true)}
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
              </div>
            )}

            {/* 金額 & 利用日 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <DollarSign size={14} />
                  支払金額 (税込) *
                </label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 12, top: 13, color: '#60a5fa', fontWeight: 700 }}>
                    ¥
                  </span>
                  <input
                    type="number"
                    className="form-input"
                    style={{ paddingLeft: 28, fontFamily: 'var(--font-num)', fontWeight: 800, fontSize: '1.15rem' }}
                    placeholder="1200"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value) || '')}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={14} />
                  利用日 *
                </label>
                <input
                  type="date"
                  className="form-input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* 利用場所 */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={14} />
                利用場所・料金所・店名 *
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="例: 日光東照宮前 観光バス駐車場"
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                required
              />
            </div>

            {/* 科目クイック選択ボタン（全11科目） */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={14} />
                  経費科目（タップで即切替）
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700 }}>
                  選択中: {CATEGORY_ITEMS.find((c) => c.id === category)?.label}
                </span>
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))',
                  gap: 4,
                  marginBottom: 8
                }}
              >
                {CATEGORY_ITEMS.map((cat) => {
                  const isSelected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setCategory(cat.id);
                        if (!isSelected && cat.id === 'etc') {
                          setPaymentMethod('company_etc');
                        } else if (!isSelected && cat.id === 'fuel') {
                          setPaymentMethod('company_fuel');
                        } else if (!isSelected && (cat.id === 'breakfast' || cat.id === 'lunch' || cat.id === 'night_meal' || cat.id === 'tea' || cat.id === 'parking' || cat.id === 'toll')) {
                          setPaymentMethod('advance');
                        }
                      }}
                      style={{
                        padding: '6px 2px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.7rem',
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
                      <span style={{ fontSize: '0.9rem' }}>{cat.icon}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 科目プルダウン & 支払手段 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={14} />
                  科目詳細
                </label>
                <select
                  className="form-input"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
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
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CreditCard size={14} />
                  支払手段
                </label>
                <select
                  className="form-input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  <option value="advance">前払い金（仮払金から支払）</option>
                  <option value="cash">個人立替（自己現金）</option>
                  <option value="company_etc">会社ETCカード</option>
                  <option value="company_fuel">燃料掛けカード</option>
                  <option value="company_card">会社専用カード</option>
                </select>
              </div>
            </div>

            {/* ETC詳細（ETC選択時） */}
            {category === 'etc' && (
              <div
                style={{
                  padding: 10,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  marginBottom: 12
                }}
              >
                <div style={{ fontSize: '0.74rem', color: '#60a5fa', fontWeight: 700, marginBottom: 6 }}>
                  🚗 ETC料金所区間
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>入口料金所</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="例: 東京"
                      value={entryGate}
                      onChange={(e) => setEntryGate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>出口料金所</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="例: 日光"
                      value={exitGate}
                      onChange={(e) => setExitGate(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* インボイス番号 */}
            <div className="form-group">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label className="form-label">インボイス登録番号（T+13桁）</label>
                {invoiceNumber.trim() && (
                  <span
                    style={{
                      fontSize: '0.7rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      color: isInvoiceValid ? '#34d399' : '#f87171'
                    }}
                  >
                    {isInvoiceValid ? (
                      <>
                        <CheckCircle2 size={12} />
                        国税庁Modulus11合格
                      </>
                    ) : (
                      <>
                        <AlertCircle size={12} />
                        番号形式要確認
                      </>
                    )}
                  </span>
                )}
              </div>
              <input
                type="text"
                className="form-input"
                placeholder="例: T1234567890123"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            {/* 備考（手入力） */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#38bdf8' }}>
                  <FileText size={14} /> 備考・手入力メモ
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>文字は全部表示（複数行・改行可）</span>
              </label>
              <textarea
                rows={3}
                className="form-input"
                style={{
                  resize: 'vertical',
                  minHeight: 75,
                  lineHeight: 1.5,
                  fontSize: '0.85rem'
                }}
                placeholder="手入力の備考（例: お客様要望で迂回、急遽高速利用、駐車場手書き領収書受領など）"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            {/* AI読取項目（手入力備考とは別の項目） */}
            <div className="form-group" style={{ marginTop: 12 }}>
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#c084fc' }}>
                  <Sparkles size={14} /> AI読取項目（品目・レシート解析）
                </span>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>手入力備考とは別の項目</span>
              </label>
              <textarea
                rows={3}
                className="form-input"
                style={{
                  resize: 'vertical',
                  minHeight: 70,
                  lineHeight: 1.5,
                  fontSize: '0.82rem',
                  background: 'rgba(124, 58, 237, 0.08)',
                  borderColor: 'rgba(168, 85, 247, 0.3)',
                  color: '#e2e8f0'
                }}
                placeholder="AIがレシートから自動解析した品目・情報（手入力備考とは分けて管理されます）"
                value={aiMemo}
                onChange={(e) => setAiMemo(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              onClick={handleDelete}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: 'rgba(239, 68, 68, 0.1)',
                color: '#f87171',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer'
              }}
            >
              <Trash2 size={14} />
              削除
            </button>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-secondary" onClick={onClose}>
                キャンセル
              </button>
              <button type="submit" className="btn-primary" disabled={isSaving}>
                {isSaving ? '保存中...' : '更新を保存'}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* レシート余白・切り取り調整モーダル */}
      {isCroppingModalOpen && (
        <ImageCropModal
          isOpen={isCroppingModalOpen}
          onClose={() => setIsCroppingModalOpen(false)}
          imageUrl={currentProcessedImageUrl || receipt.processedImageUrl || receipt.originalImageUrl || ''}
          onApplyCrop={async (croppedUrl) => {
            setCurrentProcessedImageUrl(croppedUrl);
            if (receipt.id) {
              await db.receipts.update(receipt.id, { processedImageUrl: croppedUrl });
              onReceiptUpdated();
            }
          }}
        />
      )}
    </div>
  );
};
