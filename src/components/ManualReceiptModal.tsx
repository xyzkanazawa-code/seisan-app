import React, { useState, useEffect } from 'react';
import { X, Plus, Calendar, Clock, DollarSign, MapPin, Tag, CreditCard, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { db, type Tour, type ExpenseCategory, type PaymentMethod, type Receipt } from '../db';
import { extractInvoiceNumbers } from '../utils/invoiceValidator';
import { learnFromReceipt } from '../utils/learningService';
import { checkReceiptDuplicates, type DuplicateMatch } from '../utils/duplicateChecker';

interface ManualReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTour: Tour;
  onReceiptAdded: () => void;
}

export const ManualReceiptModal: React.FC<ManualReceiptModalProps> = ({
  isOpen,
  onClose,
  activeTour,
  onReceiptAdded
}) => {
  const [category, setCategory] = useState<ExpenseCategory>('parking');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('advance');
  const [etcType, setEtcType] = useState<'jissha' | 'kaiso'>('jissha');
  const [etcPaidByGuide, setEtcPaidByGuide] = useState<boolean>(false);
  const [advanceRemaining, setAdvanceRemaining] = useState<number | null>(null);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [place, setPlace] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [memo, setMemo] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);

  // モーダル表示時にフォームを初期化＆前払金の残高を計算
  useEffect(() => {
    if (!isOpen || !activeTour?.id) {
      setDuplicates([]);
      return;
    }
    setAmount('');
    setPlace('');
    setInvoiceNumber('');
    setMemo('');
    setEtcType('jissha');
    setEtcPaidByGuide(false);
    setDuplicates([]);
    db.receipts
      .where('tourId')
      .equals(activeTour.id)
      .toArray()
      .then((existing) => {
        const advanceSpent = existing
          .filter((r) =>
            r.category === 'etc' ? Boolean(r.etcPaidByGuide) : r.paymentMethod === 'advance'
          )
          .reduce((sum, r) => sum + r.amount, 0);
        const remaining = (activeTour.advancePayment || 0) - advanceSpent;
        setAdvanceRemaining(remaining);
        if (remaining <= 0) {
          setPaymentMethod('cash');
        } else {
          setPaymentMethod('advance');
        }
      });
  }, [isOpen, activeTour]);

  // 入力中のリアルタイム二重登録チェック
  useEffect(() => {
    if (!isOpen || !amount || Number(amount) <= 0) {
      setDuplicates([]);
      return;
    }

    let cancelled = false;
    const formattedInv = invoiceNumber.trim()
      ? invoiceNumber.trim().startsWith('T')
        ? invoiceNumber.trim()
        : `T${invoiceNumber.trim()}`
      : undefined;

    checkReceiptDuplicates({
      tourId: activeTour?.id,
      date,
      time: time.trim() || undefined,
      amount: Number(amount),
      place: place.trim(),
      category,
      invoiceNumber: formattedInv
    }).then((found) => {
      if (!cancelled) {
        setDuplicates(found);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, activeTour?.id, date, time, amount, place, category, invoiceNumber]);

  if (!isOpen) return null;

  const isCurrentCategoryEtc = category === 'etc';
  const hasExactImageDuplicate = duplicates.some(d => d.confidence === 'exact_image');
  const hasNonEtcDuplicate = duplicates.some(d => !d.isEtc && (d.confidence === 'exact_image' || d.confidence === 'high' || d.confidence === 'medium'));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0 || !activeTour.id || isSaving) return;

    // 二重登録の警告確認（ETC以外の重複、または同一画像のみ）
    if (hasNonEtcDuplicate || hasExactImageDuplicate) {
      const top = duplicates[0];
      const msg = [
        '⚠️ 二重登録の可能性があります！',
        '',
        '【既登録データ】',
        `・利用日: ${top.existingReceipt.date}`,
        `・場所/店名: ${top.existingReceipt.place}`,
        `・金額: ¥${top.existingReceipt.amount.toLocaleString()}`,
        `・判定理由: ${top.reasons.join(' / ')}`,
        '',
        '同じレシート・領収書が既に登録されている可能性があります。',
        '本当にこのまま追加登録してもよろしいですか？'
      ].join('\n');

      if (!window.confirm(msg)) {
        return;
      }
    }

    setIsSaving(true);
    try {
      let isInvoiceValid = false;
      if (invoiceNumber.trim()) {
        const validated = extractInvoiceNumbers(invoiceNumber);
        if (validated.length > 0) {
          isInvoiceValid = validated[0].isCheckDigitValid;
        }
      }

      // 手入力用のプレースホルダー画像Canvas生成（視認性の高いアイコン風）
      const canvas = document.createElement('canvas');
      canvas.width = 400;
      canvas.height = 300;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('手動登録 レシート', 200, 130);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px sans-serif';
        ctx.fillText(`¥${Number(amount).toLocaleString()}`, 200, 180);
      }
      const dummyImage = canvas.toDataURL('image/jpeg', 0.8);

      const formattedInvoice = invoiceNumber.trim()
        ? (invoiceNumber.trim().startsWith('T') ? invoiceNumber.trim() : `T${invoiceNumber.trim()}`)
        : undefined;

      const newReceipt: Omit<Receipt, 'id'> = {
        tourId: activeTour.id,
        category,
        paymentMethod:
          category === 'etc'
            ? etcPaidByGuide
              ? 'advance'
              : 'company_etc'
            : paymentMethod,
        date,
        time: time.trim() || undefined,
        amount: Number(amount),
        place: place.trim() || (category === 'etc' ? 'ETC高速料金' : 'その他経費'),
        invoiceNumber: formattedInvoice,
        isInvoiceValid,
        hasInvoiceHighlight: false,
        processedImageUrl: dummyImage,
        etcType: category === 'etc' ? etcType : undefined,
        etcPaidByGuide: category === 'etc' ? etcPaidByGuide : undefined,
        memo: memo.trim(),
        createdAt: Date.now()
      };

      await db.receipts.add(newReceipt as Receipt);

      // 🧠 手動登録した店舗名・科目を学習辞書に登録
      if (place.trim()) {
        await learnFromReceipt({
          place: place.trim(),
          category,
          paymentMethod,
          invoiceNumber: formattedInvoice,
          source: 'manual'
        });
      }

      onReceiptAdded();
      onClose();
    } catch (err) {
      console.error('手動追加エラー:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Plus size={20} color="var(--primary)" />
            経費レシートを手動入力
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {/* 二重登録お知らせ：ETCは控えめ、その他は目立つ */}
            {duplicates.length > 0 && (
              isCurrentCategoryEtc && !hasExactImageDuplicate && !hasNonEtcDuplicate ? (
                /* ETCの控えめなお知らせ */
                <div
                  style={{
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(59, 130, 246, 0.12)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    color: '#93c5fd',
                    fontSize: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <AlertCircle size={14} color="#60a5fa" />
                  <span>ℹ️ 同日の同一ETC区間の登録歴があります（※往復運行等は問題ありません）</span>
                </div>
              ) : (
                /* ETC以外の目立つ警告アラート（今と同じ） */
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(245, 158, 11, 0.16)',
                    border: '2px solid rgba(245, 158, 11, 0.65)',
                    color: '#fef3c7',
                    fontSize: '0.78rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, color: '#fbbf24', fontSize: '0.84rem' }}>
                    <AlertTriangle size={16} color="#fbbf24" />
                    <span>⚠️ 二重登録の可能性があります（類似明細 {duplicates.length}件）</span>
                  </div>
                  {duplicates.slice(0, 2).map((dup, i) => (
                    <div key={i} style={{ color: '#fde68a', lineHeight: 1.4 }}>
                      ・{dup.isSameTour ? '【現在のツアー】' : `【別ツアー ${dup.tourCode || ''}】`}{' '}
                      {dup.existingReceipt.date} / <strong>{dup.existingReceipt.place}</strong> /{' '}
                      ¥{dup.existingReceipt.amount.toLocaleString()}（{dup.reasons.join(' / ')}）
                    </div>
                  ))}
                </div>
              )
            )}

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
                    style={{ paddingLeft: 28, fontFamily: 'var(--font-num)', fontWeight: 800, fontSize: '1.1rem' }}
                    placeholder="1200"
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value) || '')}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
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
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={14} />
                    利用時刻
                  </label>
                  <input
                    type="time"
                    className="form-input"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    placeholder="例: 12:34"
                  />
                </div>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <MapPin size={14} />
                利用場所・料金所・店名 *
              </label>
              <input
                type="text"
                className="form-input"
                placeholder={isCurrentCategoryEtc ? "例: ETC (東京IC → 日光IC)" : "例: 日光東照宮前 観光バス駐車場"}
                value={place}
                onChange={(e) => setPlace(e.target.value)}
                required
              />
            </div>

            {/* 科目クイック選択ボタン */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Tag size={14} />
                  経費科目（タップで即切替）
                </span>
                <span style={{ fontSize: '0.72rem', color: 'var(--primary)', fontWeight: 700 }}>
                  選択中: {[
                    { id: 'parking', label: '駐車場' },
                    { id: 'etc', label: 'ETC' },
                    { id: 'toll', label: '有料道' },
                    { id: 'fuel', label: '燃料' },
                    { id: 'breakfast', label: '朝食代' },
                    { id: 'lunch', label: '昼食代' },
                    { id: 'night_meal', label: '夜食代' },
                    { id: 'tea', label: 'お茶代' },
                    { id: 'water', label: 'ミネラル水' },
                    { id: 'overtime', label: '残業代' },
                    { id: 'taxi', label: 'タクシー' },
                    { id: 'lodging', label: '宿泊' },
                    { id: 'other', label: 'その他' }
                  ].find((c) => c.id === category)?.label}
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
                {[
                  { id: 'parking', label: '駐車場', icon: '🅿️' },
                  { id: 'etc', label: 'ETC', icon: '🚗' },
                  { id: 'toll', label: '有料道', icon: '🛣️' },
                  { id: 'fuel', label: '燃料', icon: '⛽' },
                  { id: 'breakfast', label: '朝食代', icon: '🍙' },
                  { id: 'lunch', label: '昼食代', icon: '🍱' },
                  { id: 'night_meal', label: '夜食代', icon: '🌙' },
                  { id: 'tea', label: 'お茶代', icon: '🍵' },
                  { id: 'water', label: 'ミネラル水', icon: '💧' },
                  { id: 'overtime', label: '残業代', icon: '⏰' },
                  { id: 'taxi', label: 'タクシー', icon: '🚕' },
                  { id: 'lodging', label: '宿泊', icon: '🏨' },
                  { id: 'other', label: 'その他', icon: '📦' }
                ].map((cat) => {
                  const isSelected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => {
                        setCategory(cat.id as ExpenseCategory);
                        if (cat.id === 'etc') {
                          setPaymentMethod('company_etc');
                        } else if (cat.id === 'fuel') {
                          setPaymentMethod('company_fuel');
                        } else {
                          setPaymentMethod(advanceRemaining !== null && advanceRemaining > 0 ? 'advance' : 'cash');
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
                      <span style={{ fontSize: '0.88rem' }}>{cat.icon}</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ETC詳細（ETC選択時）: 実車/回送 ＆ 預り金から引く/引かない */}
            {isCurrentCategoryEtc && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                {/* 回送 / 実車 ボタン */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: '#60a5fa', fontWeight: 800, marginBottom: 6 }}>
                    🚗 ETC運行分類（実車 / 回送）
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => setEtcType('jissha')}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: etcType === 'jissha' ? '2px solid #3b82f6' : '1px solid var(--border-color)',
                        background: etcType === 'jissha' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(15,23,42,0.6)',
                        color: etcType === 'jissha' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <span>🚌 実車</span>
                      {etcType === 'jissha' && <CheckCircle2 size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEtcType('kaiso')}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: etcType === 'kaiso' ? '2px solid #f59e0b' : '1px solid var(--border-color)',
                        background: etcType === 'kaiso' ? 'rgba(245, 158, 11, 0.3)' : 'rgba(15,23,42,0.6)',
                        color: etcType === 'kaiso' ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <span>🔄 回送</span>
                      {etcType === 'kaiso' && <CheckCircle2 size={14} />}
                    </button>
                  </div>
                </div>

                {/* 預り金から引く / 引かない ボタン */}
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: '#60a5fa', fontWeight: 800, marginBottom: 6 }}>
                    👛 ガイド預り金精算（引く / 引かない）
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setEtcPaidByGuide(false);
                        setPaymentMethod('company_etc');
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: !etcPaidByGuide ? '2px solid #10b981' : '1px solid var(--border-color)',
                        background: !etcPaidByGuide ? 'rgba(16, 185, 129, 0.25)' : 'rgba(15,23,42,0.6)',
                        color: !etcPaidByGuide ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <span>🏢 引かない (会社ETC)</span>
                      {!etcPaidByGuide && <CheckCircle2 size={14} />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEtcPaidByGuide(true);
                        setPaymentMethod('advance');
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-sm)',
                        border: etcPaidByGuide ? '2px solid #a855f7' : '1px solid var(--border-color)',
                        background: etcPaidByGuide ? 'rgba(168, 85, 247, 0.3)' : 'rgba(15,23,42,0.6)',
                        color: etcPaidByGuide ? '#ffffff' : 'var(--text-muted)',
                        fontWeight: 800,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4
                      }}
                    >
                      <span>👛 預り金から引く</span>
                      {etcPaidByGuide && <CheckCircle2 size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            )}

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
                  <option value="advance">
                    前払い金（仮払金から支払）{advanceRemaining !== null && advanceRemaining > 0 ? ` [残:¥${advanceRemaining.toLocaleString()}]` : ' [残高なし]'}
                  </option>
                  <option value="cash">個人立替（自己現金）</option>
                  <option value="company_etc">会社ETCカード</option>
                  <option value="company_fuel">燃料掛けカード</option>
                  <option value="company_card">会社専用カード</option>
                </select>

                {/* 前払金残高連動ヒント */}
                {advanceRemaining !== null && (
                  <div
                    style={{
                      fontSize: '0.68rem',
                      marginTop: 4,
                      color: advanceRemaining <= 0 ? '#fbbf24' : '#34d399',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    {advanceRemaining <= 0 ? (
                      <span>⚠️ 前払金を使い切ったため、自動的に「個人立替」になります</span>
                    ) : (
                      <span>✓ 前払金残高: ¥{advanceRemaining.toLocaleString()}（使い切り次第、自動で個人立替）</span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">インボイス登録番号（あれば）</label>
              <input
                type="text"
                className="form-input"
                placeholder="例: T1234567890123"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">備考・特記（複数行・手入力メモ）</label>
              <textarea
                rows={3}
                className="form-input"
                style={{
                  resize: 'vertical',
                  minHeight: 75,
                  lineHeight: 1.5,
                  fontSize: '0.85rem'
                }}
                placeholder="領収書手書き受領、急遽高速利用など（複数行・改行可）"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              キャンセル
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving ? '登録中...' : '登録する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
