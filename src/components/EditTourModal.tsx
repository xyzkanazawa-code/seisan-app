import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Save,
  Calendar,
  FileText,
  Bus,
  Sparkles,
  Camera,
  AlertCircle,
  Truck,
  User,
  DollarSign,
  Building2,
  UserCheck,
  Droplet
} from 'lucide-react';
import { db, getClientHistory, type Tour } from '../db';
import { extractTourCodeFromText } from '../utils/ocrService';

interface EditTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  tour: Tour;
  onTourUpdated: (updatedTour: Tour) => void;
}

export const EditTourModal: React.FC<EditTourModalProps> = ({
  isOpen,
  onClose,
  tour,
  onTourUpdated
}) => {
  const [code, setCode] = useState(tour.code || '');
  const [title, setTitle] = useState(tour.title || '');
  const [clientCompanyName, setClientCompanyName] = useState(tour.clientCompanyName || '');
  const [clientContactName, setClientContactName] = useState(tour.clientContactName || '');
  const [startDate, setStartDate] = useState(tour.startDate || '');
  const [endDate, setEndDate] = useState(tour.endDate || '');
  const [advancePayment, setAdvancePayment] = useState<number | ''>(
    typeof tour.advancePayment === 'number' ? tour.advancePayment : 0
  );
  const [driverName, setDriverName] = useState(tour.driverName || '');
  const [vehicleNumber, setVehicleNumber] = useState(tour.vehicleNumber || '');
  const [waterLoadedCount, setWaterLoadedCount] = useState<number | ''>(
    typeof tour.waterLoadedCount === 'number' ? tour.waterLoadedCount : ''
  );
  const [waterRemainingCount, setWaterRemainingCount] = useState<number | ''>(
    typeof tour.waterRemainingCount === 'number' ? tour.waterRemainingCount : ''
  );
  const [memo, setMemo] = useState(tour.memo || '');
  const [isSaving, setIsSaving] = useState(false);

  // 過去入力済みの相手先履歴（プルダウン用）
  const [historyCompanies, setHistoryCompanies] = useState<string[]>([]);
  const [historyContacts, setHistoryContacts] = useState<string[]>([]);

  // 指示書OCR再読取用
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ツアーが変更された場合にフォーム状態を同期 & 履歴取得
  useEffect(() => {
    setCode(tour.code || '');
    setTitle(tour.title || '');
    setClientCompanyName(tour.clientCompanyName || '');
    setClientContactName(tour.clientContactName || '');
    setStartDate(tour.startDate || '');
    setEndDate(tour.endDate || '');
    setAdvancePayment(typeof tour.advancePayment === 'number' ? tour.advancePayment : 0);
    setDriverName(tour.driverName || '');
    setVehicleNumber(tour.vehicleNumber || '');
    setWaterLoadedCount(typeof tour.waterLoadedCount === 'number' ? tour.waterLoadedCount : '');
    setWaterRemainingCount(typeof tour.waterRemainingCount === 'number' ? tour.waterRemainingCount : '');
    setMemo(tour.memo || '');
    setScanMessage('');

    if (isOpen) {
      loadClientHistory();
    }
  }, [tour, isOpen]);

  const loadClientHistory = async () => {
    const history = await getClientHistory();
    setHistoryCompanies(history.companyNames);
    setHistoryContacts(history.contactNames);
  };

  if (!isOpen) return null;

  // 運行指示書の撮影・OCRスキャンで再取得
  const handleInstructionScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    setScanMessage('運行指示書を解析中...');

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        try {
          const { createWorker } = await import('tesseract.js');
          const worker = await createWorker('jpn+eng');
          const ret = await worker.recognize(dataUrl);
          await worker.terminate();

          const text = ret.data.text || '';
          const detectedCode = extractTourCodeFromText(text);

          if (detectedCode) {
            setCode(detectedCode);
            setScanMessage(`ツアーコード [${detectedCode}] を読み取りました！`);
          } else {
            setScanMessage('コードが見つかりませんでした。');
          }

          // ツアー名らしき行の抽出
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          const tourTitleLine = lines.find((l) => l.includes('ツアー') || l.includes('運行') || l.includes('行先'));
          if (tourTitleLine) {
            const detectedTitle = tourTitleLine.replace(/ツアー名|運行名称|行先|[:：]/g, '').trim();
            if (detectedTitle) {
              setTitle(detectedTitle);
              setScanMessage((prev) => `${prev} 名称を更新しました。`);
            }
          }

          // 相手先会社名の抽出
          const compLine = lines.find((l) => l.includes('主催') || l.includes('旅行') || l.includes('会社') || l.includes('手配'));
          if (compLine) {
            const extractedComp = compLine.replace(/主催|手配|会社|旅行会社|[:：]/g, '').trim();
            if (extractedComp) setClientCompanyName(extractedComp);
          }
        } catch {
          setScanMessage('スキャン中にエラーが発生しました。');
        } finally {
          setIsScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsScanning(false);
    }
  };

  // ワンタップでクイックコード再生成
  const generateQuickCode = () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 90 + 10);
    setCode(`T${today}-${rand}`);
  };

  // クイック金額加算
  const addAmount = (delta: number) => {
    const cur = typeof advancePayment === 'number' ? advancePayment : 0;
    setAdvancePayment(Math.max(0, cur + delta));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tour.id) return;

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      alert('ツアーコードを入力してください。');
      return;
    }

    setIsSaving(true);
    try {
      const finalPayment = typeof advancePayment === 'number' ? advancePayment : 0;
      const updatedData: Partial<Tour> = {
        code: trimmedCode,
        title: title.trim() || '運行経費',
        clientCompanyName: clientCompanyName.trim(),
        clientContactName: clientContactName.trim(),
        startDate,
        endDate,
        advancePayment: finalPayment,
        driverName: driverName.trim() || tour.driverName,
        vehicleNumber: vehicleNumber.trim() || tour.vehicleNumber,
        waterLoadedCount: typeof waterLoadedCount === 'number' ? waterLoadedCount : undefined,
        waterRemainingCount: typeof waterRemainingCount === 'number' ? waterRemainingCount : undefined,
        memo: memo.trim(),
        updatedAt: Date.now()
      };

      await db.tours.update(tour.id, updatedData);
      const updatedTour: Tour = { ...tour, ...updatedData };
      onTourUpdated(updatedTour);
      onClose();
    } catch (err) {
      console.error('ツアー情報の更新エラー:', err);
      alert('ツアー情報の保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  // 統一入力枠スタイル
  const inputStyle: React.CSSProperties = {
    color: '#ffffff',
    backgroundColor: '#1a2238',
    borderColor: '#37476c',
    fontSize: '0.98rem',
    fontWeight: 600,
    width: '100%'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        {/* モーダルヘッダー（右上にも常時保存ボタンを配置） */}
        <div className="modal-header">
          <div className="modal-title">
            <Bus size={22} color="var(--primary)" />
            ツアー情報・運行の訂正
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary"
              disabled={isSaving}
              style={{
                height: 36,
                padding: '0 14px',
                fontSize: '0.84rem',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                alignItems: 'center',
                gap: 5
              }}
              title="変更内容を保存"
            >
              <Save size={15} />
              {isSaving ? '保存中...' : '保存'}
            </button>
            <button className="icon-btn" onClick={onClose} title="閉じる">
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 運行指示書スキャン案内 */}
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.08)',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                border: '1px dashed rgba(59, 130, 246, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Sparkles size={16} color="var(--accent-amber)" />
                  指示書から自動再読取
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  指示書の撮影でコードや名称を自動補正
                </div>
              </div>

              <button
                type="button"
                className="btn-secondary"
                style={{ height: 36, padding: '0 12px', fontSize: '0.82rem' }}
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
              >
                <Camera size={15} />
                {isScanning ? '解析中...' : '撮影スキャン'}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={handleInstructionScan}
              />
            </div>

            {scanMessage && (
              <div
                style={{
                  fontSize: '0.78rem',
                  color: '#60a5fa',
                  background: 'rgba(59, 130, 246, 0.1)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <AlertCircle size={14} />
                {scanMessage}
              </div>
            )}

            {/* ツアーコード訂正欄 */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label className="form-label" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <FileText size={15} color="var(--primary)" />
                  ツアー（運行）コード *
                </label>
                <button
                  type="button"
                  onClick={generateQuickCode}
                  style={{
                    fontSize: '0.74rem',
                    color: '#60a5fa',
                    fontWeight: 700,
                    background: 'rgba(59, 130, 246, 0.15)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: 'none',
                    cursor: 'pointer'
                  }}
                >
                  コード再採番
                </button>
              </div>
              <input
                type="text"
                className="form-input"
                style={inputStyle}
                placeholder="例: T20261004-01"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                required
              />
            </div>

            {/* ツアー運行名称訂正欄 */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bus size={15} color="var(--primary)" />
                ツアー運行名称
              </label>
              <input
                type="text"
                className="form-input"
                style={inputStyle}
                placeholder="例: 秋の日光東照宮・中禅寺湖 団体観光ツアー"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 相手方の会社名（旅行会社・発注元） */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Building2 size={15} color="var(--primary)" />
                  相手方の会社名（旅行会社・発注元）
                </label>
                {historyCompanies.length > 0 && (
                  <select
                    style={{
                      fontSize: '0.72rem',
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      cursor: 'pointer'
                    }}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setClientCompanyName(e.target.value);
                    }}
                  >
                    <option value="">▼ 履歴から選ぶ</option>
                    {historyCompanies.map((c, i) => (
                      <option key={i} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <input
                type="text"
                list="edit-tour-client-companies"
                className="form-input"
                style={inputStyle}
                placeholder="例: JTB 団体旅行部、クラブツーリズムなど"
                value={clientCompanyName}
                onChange={(e) => setClientCompanyName(e.target.value)}
              />
              <datalist id="edit-tour-client-companies">
                {historyCompanies.map((c, i) => (
                  <option key={i} value={c} />
                ))}
              </datalist>
            </div>

            {/* 相手方の担当者名 */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <UserCheck size={15} color="var(--primary)" />
                  相手方担当者名（添乗員・手配担当者）
                </label>
                {historyContacts.length > 0 && (
                  <select
                    style={{
                      fontSize: '0.72rem',
                      background: 'rgba(59, 130, 246, 0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      borderRadius: 4,
                      padding: '2px 6px',
                      cursor: 'pointer'
                    }}
                    value=""
                    onChange={(e) => {
                      if (e.target.value) setClientContactName(e.target.value);
                    }}
                  >
                    <option value="">▼ 履歴から選ぶ</option>
                    {historyContacts.map((contact, i) => (
                      <option key={i} value={contact}>
                        {contact}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <input
                type="text"
                list="edit-tour-client-contacts"
                className="form-input"
                style={inputStyle}
                placeholder="例: 鈴木添乗員、佐藤様など"
                value={clientContactName}
                onChange={(e) => setClientContactName(e.target.value)}
              />
              <datalist id="edit-tour-client-contacts">
                {historyContacts.map((contact, i) => (
                  <option key={i} value={contact} />
                ))}
              </datalist>
            </div>

            {/* 運行期間 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} />
                  運行開始日
                </label>
                <input
                  type="date"
                  className="form-input"
                  style={inputStyle}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} />
                  運行終了日
                </label>
                <input
                  type="date"
                  className="form-input"
                  style={inputStyle}
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* 仮払金（前渡金）設定 */}
            <div
              style={{
                background: 'linear-gradient(145deg, rgba(59, 130, 246, 0.1) 0%, rgba(30, 58, 138, 0.15) 100%)',
                border: '1.5px solid rgba(59, 130, 246, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: 14
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--primary-light)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <DollarSign size={16} />
                  仮払金（前渡金）
                </label>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  会社から受領した現金
                </span>
              </div>

              <div style={{ position: 'relative', marginBottom: 10 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 14,
                    top: 11,
                    fontSize: '1.2rem',
                    fontWeight: 800,
                    color: '#60a5fa',
                    pointerEvents: 'none'
                  }}
                >
                  ¥
                </span>
                <input
                  type="number"
                  className="form-input"
                  style={{
                    paddingLeft: 34,
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    color: '#60a5fa',
                    backgroundColor: '#1a2238',
                    borderColor: '#3b82f680',
                    width: '100%',
                    fontFamily: 'var(--font-num)'
                  }}
                  value={advancePayment}
                  onChange={(e) => setAdvancePayment(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0"
                  min="0"
                  step="1000"
                />
              </div>

              {/* クイック加算ボタン */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', height: 32, borderRadius: 'var(--radius-sm)' }}
                  onClick={() => addAmount(10000)}
                >
                  +1万円
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', height: 32, borderRadius: 'var(--radius-sm)' }}
                  onClick={() => addAmount(30000)}
                >
                  +3万円
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', height: 32, borderRadius: 'var(--radius-sm)' }}
                  onClick={() => addAmount(50000)}
                >
                  +5万円
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.74rem', padding: '4px 10px', height: 32, borderRadius: 'var(--radius-sm)', color: '#94a3b8' }}
                  onClick={() => setAdvancePayment(0)}
                >
                  0円リセット
                </button>
              </div>
            </div>

            {/* 乗務員名 & 車両番号 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={14} />
                  担当乗務員名
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="例: 山田 太郎"
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Truck size={14} />
                  車両番号
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  placeholder="例: 足立200 か 38-92"
                />
              </div>
            </div>

            {/* ミネラルウォーター本数（PDF鑑表に自動印字） */}
            <div
              style={{
                background: 'rgba(59, 130, 246, 0.08)',
                border: '1px solid rgba(59, 130, 246, 0.25)',
                borderRadius: 'var(--radius-md)',
                padding: 12
              }}
            >
              <label style={{ fontSize: '0.84rem', fontWeight: 800, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Droplet size={15} color="#60a5fa" />
                ミネラルウォーター本数（PDF鑑表に自動印字）
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    水積込本数
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      min="0"
                      className="form-input"
                      style={inputStyle}
                      value={waterLoadedCount}
                      onChange={(e) => setWaterLoadedCount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="例: 48"
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>本</span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    水残本数
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                      type="number"
                      min="0"
                      className="form-input"
                      style={inputStyle}
                      value={waterRemainingCount}
                      onChange={(e) => setWaterRemainingCount(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="例: 12"
                    />
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>本</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 備考メモ */}
            <div className="form-group">
              <label className="form-label">備考・特記事項（精算書PDFに印字）</label>
              <textarea
                className="form-input"
                style={{
                  ...inputStyle,
                  minHeight: 70,
                  padding: 10,
                  lineHeight: 1.5,
                  resize: 'vertical'
                }}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="配車場所、運行連絡事項など"
              />
            </div>
          </div>

          {/* フッターアクション（常に最下部に固定表示） */}
          <div
            className="modal-footer"
            style={{
              flexShrink: 0,
              padding: '14px 20px',
              borderTop: '1px solid var(--border-color)',
              background: '#0d1322',
              display: 'flex',
              gap: 12
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 48, padding: '0 20px', fontSize: '0.9rem' }}
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isSaving}
              style={{
                height: 48,
                fontSize: '1rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
              }}
            >
              <Save size={18} />
              {isSaving ? '保存中...' : '変更を保存する'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
