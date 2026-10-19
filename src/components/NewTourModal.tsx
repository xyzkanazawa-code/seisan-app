import React, { useState, useRef, useEffect } from 'react';
import { X, Camera, Plus, Sparkles, AlertCircle, Building2, UserCheck, Droplet } from 'lucide-react';
import { db, getClientHistory, type Tour, type DriverProfile } from '../db';
import { extractTourCodeFromText } from '../utils/ocrService';

interface NewTourModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTourCreated: (tour: Tour) => void;
  profile?: DriverProfile;
}

export const NewTourModal: React.FC<NewTourModalProps> = ({
  isOpen,
  onClose,
  onTourCreated,
  profile
}) => {
  const [code, setCode] = useState('');
  const [title, setTitle] = useState('');
  const [clientCompanyName, setClientCompanyName] = useState('');
  const [clientContactName, setClientContactName] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [advancePayment, setAdvancePayment] = useState<number>(30000);
  const [waterLoadedCount, setWaterLoadedCount] = useState<number | ''>('');
  const [memo, setMemo] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');

  // 過去入力済みの相手先履歴（プルダウン用）
  const [historyCompanies, setHistoryCompanies] = useState<string[]>([]);
  const [historyContacts, setHistoryContacts] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // モーダルオープン時に過去履歴を取得
  useEffect(() => {
    if (isOpen) {
      loadClientHistory();
    }
  }, [isOpen]);

  const loadClientHistory = async () => {
    const history = await getClientHistory();
    setHistoryCompanies(history.companyNames);
    setHistoryContacts(history.contactNames);
  };

  if (!isOpen) return null;

  // 運行指示書の撮影・OCRスキャン
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
            setScanMessage(`ツアーコード [${detectedCode}] を自動検出しました！`);
          } else {
            const fallbackCode = `T${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`;
            setCode(fallbackCode);
            setScanMessage(`コードを自動生成しました: ${fallbackCode}`);
          }

          // ツアー名らしき行の抽出試行
          const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
          const tourTitleLine = lines.find((l) => l.includes('ツアー') || l.includes('運行') || l.includes('行先'));
          if (tourTitleLine) {
            setTitle(tourTitleLine.replace(/ツアー名|運行名称|行先|[:：]/g, '').trim());
          }

          // 相手先会社名（主催社等）の抽出試行
          const companyLine = lines.find((l) => l.includes('主催') || l.includes('旅行') || l.includes('会社') || l.includes('手配'));
          if (companyLine) {
            const extractedComp = companyLine.replace(/主催|手配|会社|旅行会社|[:：]/g, '').trim();
            if (extractedComp) setClientCompanyName(extractedComp);
          }
        } catch {
          const fallbackCode = `T${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-01`;
          setCode(fallbackCode);
          setScanMessage(`コードを自動生成しました: ${fallbackCode}`);
        } finally {
          setIsScanning(false);
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setIsScanning(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const tourCode = code.trim() || `T${Date.now().toString().slice(-6)}`;

    // 既存の進行中ツアーがあれば確認
    const existingActive = await db.tours.where('status').equals('active').toArray();
    const newTour: Tour = {
      code: tourCode,
      title: title.trim() || '新規運行ツアー',
      startDate,
      endDate,
      status: 'active',
      advancePayment: Number(advancePayment) || 0,
      driverName: profile?.driverName,
      vehicleNumber: profile?.vehicleNumber,
      clientCompanyName: clientCompanyName.trim(),
      clientContactName: clientContactName.trim(),
      waterLoadedCount: typeof waterLoadedCount === 'number' ? waterLoadedCount : undefined,
      waterRemainingCount: undefined,
      memo: memo.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    // 他のアクティブツアーを完了扱いにする
    for (const act of existingActive) {
      await db.tours.update(act.id!, { status: 'completed' });
    }

    const id = await db.tours.add(newTour);
    newTour.id = id;

    onTourCreated(newTour);
    onClose();
  };

  // ワンタップでクイックコード生成
  const generateQuickCode = () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.floor(Math.random() * 90 + 10);
    setCode(`T${today}-${rand}`);
  };

  const inputStyle: React.CSSProperties = {
    color: '#ffffff',
    backgroundColor: '#1a2238',
    borderColor: '#37476c',
    fontSize: '0.95rem',
    fontWeight: 600,
    width: '100%'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div className="modal-title">
            <Plus size={22} color="var(--primary)" />
            新しいツアー（運行）を開始
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleSubmit}
              className="btn-primary"
              style={{
                height: 36,
                padding: '0 14px',
                fontSize: '0.84rem',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              開始
            </button>
            <button className="icon-btn" onClick={onClose} title="閉じる">
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 運行指示書スキャンボタン */}
            <div style={{ background: 'var(--bg-surface)', padding: 14, borderRadius: 'var(--radius-md)', border: '1px dashed var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={16} color="var(--accent-amber)" />
                    運行指示書をカメラでスキャン
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    ツアーコードや運行名を自動読取
                  </div>
                </div>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{ height: 38, padding: '0 12px', fontSize: '0.82rem' }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanning}
                >
                  <Camera size={16} />
                  {isScanning ? '読取中...' : '撮影スキャン'}
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
                <div style={{ marginTop: 8, fontSize: '0.78rem', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <AlertCircle size={14} />
                  {scanMessage}
                </div>
              )}
            </div>

            {/* ツアーコード手動入力 */}
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className="form-label" style={{ fontWeight: 700 }}>ツアー（運行）コード *</label>
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
                  自動生成
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

            {/* ツアー名称 */}
            <div className="form-group">
              <label className="form-label" style={{ fontWeight: 700 }}>ツアー運行名称</label>
              <input
                type="text"
                className="form-input"
                style={inputStyle}
                placeholder="例: 秋の紅葉 日光日帰りツアー"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 相手方の会社名（毎回変更可能 & 過去入力済みはプルダウンで選択可能） */}
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
                list="new-tour-client-companies"
                className="form-input"
                style={inputStyle}
                placeholder="例: JTB 団体旅行部、クラブツーリズムなど"
                value={clientCompanyName}
                onChange={(e) => setClientCompanyName(e.target.value)}
              />
              <datalist id="new-tour-client-companies">
                {historyCompanies.map((c, i) => (
                  <option key={i} value={c} />
                ))}
              </datalist>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                ※ 毎回直接入力も可能。一度入力した会社名は次回以降プルダウンから選べます
              </div>
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
                list="new-tour-client-contacts"
                className="form-input"
                style={inputStyle}
                placeholder="例: 鈴木添乗員、佐藤様など"
                value={clientContactName}
                onChange={(e) => setClientContactName(e.target.value)}
              />
              <datalist id="new-tour-client-contacts">
                {historyContacts.map((contact, i) => (
                  <option key={i} value={contact} />
                ))}
              </datalist>
            </div>

            {/* 運行期間 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label">開始日</label>
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
                <label className="form-label">終了日</label>
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

            {/* 仮払金（前渡金） */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>仮払金（前渡金）</span>
                <span style={{ color: 'var(--accent-amber)', fontSize: '0.75rem' }}>現金手渡し預かり分</span>
              </label>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-muted)', fontWeight: 700 }}>
                  ¥
                </span>
                <input
                  type="number"
                  className="form-input"
                  style={{ ...inputStyle, paddingLeft: 34, fontFamily: 'var(--font-num)', fontWeight: 700 }}
                  placeholder="30000"
                  value={advancePayment}
                  onChange={(e) => setAdvancePayment(Number(e.target.value))}
                />
              </div>
            </div>

            {/* ミネラルウォーター積込本数 */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, color: '#93c5fd' }}>
                  <Droplet size={15} color="#60a5fa" />
                  水積込本数（精算書PDFに自動印字）
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>出発時の本数（任意）</span>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  className="form-input"
                  style={{ ...inputStyle, width: 120, fontFamily: 'var(--font-num)', fontWeight: 700 }}
                  placeholder="例: 48"
                  value={waterLoadedCount}
                  onChange={(e) => setWaterLoadedCount(e.target.value === '' ? '' : Number(e.target.value))}
                />
                <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>本</span>
              </div>
            </div>

            {/* 備考 */}
            <div className="form-group">
              <label className="form-label">備考・特記事項</label>
              <input
                type="text"
                className="form-input"
                style={inputStyle}
                placeholder="例: 配車場所：東京駅鍛冶橋駐車場 07:30発"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

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
              style={{
                height: 48,
                fontSize: '1rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
              }}
            >
              ツアーを開始する
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
