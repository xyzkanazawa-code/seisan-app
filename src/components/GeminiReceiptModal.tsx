import React, { useState, useRef } from 'react';
import {
  X,
  Camera,
  UploadCloud,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Store,
  FileCode,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  analyzeReceiptWithGemini,
  fileToDataUrl,
  type GeminiReceiptResult,
  type GeminiReceiptItem
} from '../utils/geminiOcrService';
import { getAppConfig } from '../utils/configStorage';
import type { Tour } from '../db';

interface GeminiReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTour?: Tour;
  onOpenSettings: () => void;
  onOpenScannerCamera?: () => void;
  onSaveToExpense: (receiptData: {
    shopName: string;
    date: string;
    amount: number;
    category: string;
    items: GeminiReceiptItem[];
    receiptImage: string;
    invoiceNumber?: string;
    memo?: string;
  }) => Promise<void>;
}

export const GeminiReceiptModal: React.FC<GeminiReceiptModalProps> = ({
  isOpen,
  onClose,
  activeTour,
  onOpenSettings,
  onOpenScannerCamera,
  onSaveToExpense
}) => {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // 解析結果ステート
  const [result, setResult] = useState<GeminiReceiptResult | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editShopName, setEditShopName] = useState('');
  const [editTotalAmount, setEditTotalAmount] = useState<number>(0);
  const [editItems, setEditItems] = useState<GeminiReceiptItem[]>([]);
  const [editCategory, setEditCategory] = useState('食費');
  const [editMemo, setEditMemo] = useState('');
  const [showJsonView, setShowJsonView] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const config = getAppConfig();
  const hasApiKey = Boolean(config?.geminiApiKey?.trim());

  // 画像選択（ファイルまたはカメラ撮影）
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setAnalysisError(null);
      setSaveSuccess(false);
      const dataUrl = await fileToDataUrl(file);
      setSelectedImage(dataUrl);
      // 自動でGemini解析を実行
      runGeminiAnalysis(dataUrl);
    } catch (err: any) {
      setAnalysisError(err?.message || '画像の読み込みに失敗しました。');
    }
  };

  // Gemini 1.5 Flash 解析実行
  const runGeminiAnalysis = async (imageDataUrl: string) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const data = await analyzeReceiptWithGemini(imageDataUrl);
      setResult(data);
      setEditDate(data.date);
      setEditShopName(data.shopName);
      setEditTotalAmount(data.totalAmount);
      setEditItems(data.items);
      if (data.category) setEditCategory(data.category);
    } catch (err: any) {
      console.error('Gemini OCR 解析エラー:', err);
      setAnalysisError(err?.message || 'レシートの解析に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 品目の追加
  const handleAddItem = () => {
    setEditItems([...editItems, { name: '', price: 0 }]);
  };

  // 品目の変更
  const handleItemChange = (index: number, field: keyof GeminiReceiptItem, val: string | number) => {
    const updated = [...editItems];
    if (field === 'price') {
      updated[index].price = Number(val) || 0;
    } else {
      updated[index].name = String(val);
    }
    setEditItems(updated);

    // 品目の合計で合計金額を連動再計算（オプション）
    const newTotal = updated.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    if (newTotal > 0) {
      setEditTotalAmount(newTotal);
    }
  };

  // 品目の削除
  const handleRemoveItem = (index: number) => {
    const updated = editItems.filter((_, i) => i !== index);
    setEditItems(updated);
  };

  // 家計簿データへの登録
  const handleSave = async () => {
    if (!selectedImage) return;
    setIsSaving(true);
    try {
      await onSaveToExpense({
        shopName: editShopName || 'レシート経費',
        date: editDate || new Date().toISOString().split('T')[0],
        amount: Number(editTotalAmount) || 0,
        category: editCategory,
        items: editItems,
        receiptImage: selectedImage,
        invoiceNumber: result?.invoiceNumber,
        memo: editMemo.trim()
      });
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setAnalysisError(err?.message || '家計簿データへの保存に失敗しました。');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 999,
        background: 'rgba(5, 10, 25, 0.85)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="modal-content animate-fade-in"
        style={{
          maxWidth: '580px',
          width: '100%',
          maxHeight: '92vh',
          borderRadius: '24px',
          background: 'linear-gradient(145deg, #131b2e, #0e1526)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.6), 0 0 35px rgba(99, 102, 241, 0.2)',
          overflowY: 'auto',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* モーダルヘッダー */}
        <div
          style={{
            padding: '20px 24px',
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.18))',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 10,
            backdropFilter: 'blur(8px)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
              }}
            >
              <Sparkles size={22} color="#ffffff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0 }}>
                  Gemini レシートOCR
                </h2>
                <span
                  style={{
                    fontSize: '0.68rem',
                    padding: '2px 8px',
                    borderRadius: '20px',
                    background: 'rgba(168, 85, 247, 0.3)',
                    color: '#e9d5ff',
                    fontWeight: 700
                  }}
                >
                  gemini-1.5-flash
                </span>
              </div>
              <p style={{ margin: '3px 0 0', fontSize: '0.76rem', color: '#94a3b8' }}>
                {activeTour
                  ? `【${activeTour.code}】に紐付け・購入日/店名/品目リスト/合計金額をJSON抽出`
                  : 'AIが購入日・店名・品目リスト・合計金額をJSONで高精度抽出'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: 'none',
              color: '#94a3b8',
              borderRadius: '10px',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* コンテンツエリア */}
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* APIキー未設定警告 */}
          {!hasApiKey && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: '14px',
                background: 'rgba(234, 179, 8, 0.15)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={20} color="#facc15" shrink-0 />
                <div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#fef08a' }}>
                    Gemini APIキーが未登録です
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#fde047' }}>
                    Google AI Studioで取得したAPIキー（AQ... または AIzaSy...）を登録すると、Gemini AIでの運行経費OCR解析が可能になります。
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                style={{
                  padding: '6px 12px',
                  borderRadius: '10px',
                  background: '#eab308',
                  color: '#713f12',
                  fontSize: '0.76rem',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                キーを設定
              </button>
            </div>
          )}

          {/* 画像アップロード / 撮影選択エリア */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            {!selectedImage ? (
              <div
                style={{
                  padding: '30px 20px',
                  borderRadius: '18px',
                  border: '2px dashed rgba(99, 102, 241, 0.4)',
                  background: 'rgba(30, 41, 59, 0.4)',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '14px'
                }}
              >
                <div
                  style={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '20px',
                    background: 'rgba(99, 102, 241, 0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#818cf8'
                  }}
                >
                  <Camera size={30} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 4px', color: '#e2e8f0' }}>
                    レシート画像をアップロードまたはカメラ撮影
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0 }}>
                    レシート全体の文字がはっきり見える画像を選択してください
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
                  {/* リアルタイム縦長枠付きカメラ */}
                  {onOpenScannerCamera && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenScannerCamera();
                      }}
                      style={{
                        padding: '11px 18px',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                        border: 'none',
                        color: '#ffffff',
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 4px 14px rgba(168, 85, 247, 0.4)'
                      }}
                      title="縦長レシート専用枠でリアルタイム撮影"
                    >
                      <Sparkles size={16} color="#fef08a" />
                      <span>専用枠カメラで撮影</span>
                    </button>
                  )}

                  {/* 端末カメラアプリ */}
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    style={{
                      padding: '11px 16px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      color: '#ffffff',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px'
                    }}
                    title="スマートフォンの標準カメラを起動"
                  >
                    <Camera size={16} />
                    <span>端末カメラ</span>
                  </button>

                  {/* 画像ファイル選択 */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '11px 16px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#e2e8f0',
                      fontSize: '0.82rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px'
                    }}
                  >
                    <UploadCloud size={16} />
                    <span>写真から選択</span>
                  </button>
                </div>
              </div>
            ) : (
              /* 画像選択済みプレビュー */
              <div
                style={{
                  display: 'flex',
                  gap: '14px',
                  padding: '12px',
                  borderRadius: '16px',
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  alignItems: 'center'
                }}
              >
                <img
                  src={selectedImage}
                  alt="Receipt"
                  style={{
                    width: '74px',
                    height: '90px',
                    objectFit: 'cover',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>
                    レシート画像が選択されました
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '2px 0 8px' }}>
                    {isAnalyzing ? 'Gemini 1.5 Flash でOCR解析中...' : '解析結果を反映済み'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => runGeminiAnalysis(selectedImage)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '8px',
                        background: 'rgba(99, 102, 241, 0.25)',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        color: '#c7d2fe',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <RefreshCw size={12} className={isAnalyzing ? 'animate-spin' : ''} />
                      <span>再解析</span>
                    </button>
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '8px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: 'none',
                        color: '#94a3b8',
                        fontSize: '0.72rem',
                        cursor: 'pointer'
                      }}
                    >
                      変更
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 解析中ローディング表示 */}
          {isAnalyzing && (
            <div
              style={{
                padding: '24px',
                borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15))',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  border: '3px solid rgba(99, 102, 241, 0.2)',
                  borderTopColor: '#818cf8',
                  animation: 'spin 1s linear infinite'
                }}
              />
              <div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e0e7ff' }}>
                  Gemini 1.5 Flash がレシートをOCR解析中...
                </div>
                <div style={{ fontSize: '0.75rem', color: '#a5b4fc', marginTop: '4px' }}>
                  購入日、店名、品目ごとの金額、合計額をJSON抽出しています
                </div>
              </div>
            </div>
          )}

          {/* エラーメッセージ */}
          {analysisError && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '14px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <AlertCircle size={18} shrink-0 />
              <span>{analysisError}</span>
            </div>
          )}

          {/* 保存成功通知 */}
          {saveSuccess && (
            <div
              style={{
                padding: '12px 16px',
                borderRadius: '14px',
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#6ee7b7',
                fontSize: '0.85rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <CheckCircle2 size={18} />
              <span>運行経費データに正常に追加されました！</span>
            </div>
          )}

          {/* 解析結果表示＆編集フォーム */}
          {result && !isAnalyzing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* サマリーカード */}
              <div
                style={{
                  padding: '16px',
                  borderRadius: '18px',
                  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.9), rgba(15, 23, 42, 0.9))',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>合計金額</div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#38bdf8', letterSpacing: '-0.02em' }}>
                    ¥{Number(editTotalAmount || 0).toLocaleString()}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>抽出品目数</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#cbd5e1' }}>
                    {editItems.length} 点
                  </div>
                </div>
              </div>

              {/* 店名 & 日付 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                    <Store size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    店名・事業者名
                  </label>
                  <input
                    type="text"
                    value={editShopName}
                    onChange={(e) => setEditShopName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '0.85rem',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                    <Calendar size={12} style={{ display: 'inline', marginRight: '4px' }} />
                    購入日
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '0.85rem',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* カテゴリ & 合計金額 手修正 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                    カテゴリ
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '0.85rem',
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  >
                    <option value="食費">食費</option>
                    <option value="日用品">日用品</option>
                    <option value="交通費">交通費</option>
                    <option value="ETC">ETC / 有料道路</option>
                    <option value="駐車場">駐車場</option>
                    <option value="燃料">燃料・ガソリン</option>
                    <option value="外食">外食</option>
                    <option value="その他">その他</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
                    合計金額 (円)
                  </label>
                  <input
                    type="number"
                    value={editTotalAmount}
                    onChange={(e) => setEditTotalAmount(Number(e.target.value) || 0)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#ffffff',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              </div>

              {/* 品目リスト */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '16px',
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#cbd5e1' }}>
                    品目リスト（名前と金額）
                  </span>
                  <button
                    type="button"
                    onClick={handleAddItem}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '8px',
                      background: 'rgba(99, 102, 241, 0.25)',
                      border: '1px solid rgba(99, 102, 241, 0.4)',
                      color: '#c7d2fe',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <Plus size={12} />
                    <span>品目追加</span>
                  </button>
                </div>

                {editItems.length === 0 ? (
                  <p style={{ fontSize: '0.76rem', color: '#64748b', textAlign: 'center', margin: '8px 0' }}>
                    抽出された品目はありません（合計金額のみ記録）
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                    {editItems.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          background: 'rgba(30, 41, 59, 0.5)',
                          padding: '6px 8px',
                          borderRadius: '10px'
                        }}
                      >
                        <input
                          type="text"
                          value={item.name}
                          placeholder="品目名"
                          onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            background: 'rgba(15, 23, 42, 0.6)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            borderRadius: '8px',
                            color: '#ffffff',
                            fontSize: '0.8rem',
                            outline: 'none'
                          }}
                        />
                        <div style={{ position: 'relative', width: '90px' }}>
                          <input
                            type="number"
                            value={item.price}
                            placeholder="金額"
                            onChange={(e) => handleItemChange(idx, 'price', e.target.value)}
                            style={{
                              width: '100%',
                              padding: '6px 8px',
                              background: 'rgba(15, 23, 42, 0.6)',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              borderRadius: '8px',
                              color: '#ffffff',
                              fontSize: '0.8rem',
                              textAlign: 'right',
                              outline: 'none',
                              boxSizing: 'border-box'
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px'
                          }}
                          title="削除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 📝 手入力の備考欄（AI読み取り項目とは別に手動で記録） */}
              <div
                style={{
                  padding: '14px',
                  borderRadius: '16px',
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.08)'
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    color: '#93c5fd',
                    marginBottom: '6px'
                  }}
                >
                  <span>📝 手入力の備考・特記事項（任意）</span>
                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>AI読取とは別に記録</span>
                </label>
                <textarea
                  rows={2}
                  value={editMemo}
                  onChange={(e) => setEditMemo(e.target.value)}
                  placeholder="例: お客様依頼で迂回ルート利用、駐車場手書き領収書受領など（複数行入力可）"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    background: 'rgba(15, 23, 42, 0.7)',
                    border: '1px solid rgba(59, 130, 246, 0.25)',
                    borderRadius: '10px',
                    color: '#ffffff',
                    fontSize: '0.82rem',
                    lineHeight: 1.5,
                    resize: 'vertical',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              {/* 返却された生のJSON表示（アコーディオン） */}
              <div
                style={{
                  borderRadius: '14px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  overflow: 'hidden'
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowJsonView(!showJsonView)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    fontSize: '0.76rem',
                    fontWeight: 600
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <FileCode size={14} color="#818cf8" />
                    <span>Gemini 返却 JSON データ ({result.rawJson?.length || 0}文字)</span>
                  </div>
                  {showJsonView ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showJsonView && (
                  <div style={{ padding: '0 14px 14px' }}>
                    <pre
                      style={{
                        margin: 0,
                        padding: '10px',
                        background: '#090d16',
                        borderRadius: '8px',
                        fontSize: '0.72rem',
                        color: '#38bdf8',
                        fontFamily: 'monospace',
                        overflowX: 'auto',
                        maxHeight: '140px'
                      }}
                    >
                      {result.rawJson}
                    </pre>
                  </div>
                )}
              </div>

              {/* 登録確定ボタン */}
              <button
                type="button"
                disabled={isSaving}
                onClick={handleSave}
                style={{
                  padding: '14px',
                  borderRadius: '16px',
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '0.95rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)'
                }}
              >
                <CheckCircle2 size={18} />
                <span>{isSaving ? '保存中...' : '運行経費に登録する'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
