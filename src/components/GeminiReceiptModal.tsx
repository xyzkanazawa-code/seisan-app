import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Camera,
  UploadCloud,
  Sparkles,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Calendar,
  Store,
  FileCode,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import {
  analyzeReceiptsWithGemini,
  fileToDataUrl,
  mapAiCategoryToExpenseCategory,
  type GeminiReceiptResult,
  type GeminiReceiptItem
} from '../utils/geminiOcrService';
import { sliceImageVerticalSegments } from '../utils/imageProcessor';
import { getAppConfig } from '../utils/configStorage';
import { checkReceiptDuplicates, type DuplicateMatch } from '../utils/duplicateChecker';
import { ImageCropModal } from './ImageCropModal';
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
    etcType?: 'jissha' | 'kaiso';
    etcPaidByGuide?: boolean;
    etcDetails?: any;
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

  // 解析結果ステート（複数件対応）
  const [resultsList, setResultsList] = useState<{ result: GeminiReceiptResult; image: string }[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const [editDate, setEditDate] = useState('');
  const [editShopName, setEditShopName] = useState('');
  const [editTotalAmount, setEditTotalAmount] = useState<number>(0);
  const [editItems, setEditItems] = useState<GeminiReceiptItem[]>([]);
  const [editCategory, setEditCategory] = useState('食費');
  const [editMemo, setEditMemo] = useState('');
  const [etcType, setEtcType] = useState<'jissha' | 'kaiso'>('jissha');
  const [etcPaidByGuide, setEtcPaidByGuide] = useState<boolean>(false);

  const [showJsonView, setShowJsonView] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // モーダルが閉じた時に状態を初期化
  useEffect(() => {
    if (!isOpen) {
      setSelectedImage(null);
      setResultsList([]);
      setActiveIndex(0);
      setEditDate('');
      setEditShopName('');
      setEditTotalAmount(0);
      setEditItems([]);
      setEditMemo('');
      setEtcType('jissha');
      setEtcPaidByGuide(false);
      setDuplicates([]);
      setAnalysisError(null);
      setSaveSuccess(false);
      setIsSaving(false);
    }
  }, [isOpen]);

  const currentEntry = resultsList[activeIndex] || null;
  const currentResult = currentEntry?.result || null;
  const currentImage = currentEntry?.image || selectedImage;

  // アクティブなインデックスが切り替わった時にフォームに反映
  const syncFormWithEntry = (entry: { result: GeminiReceiptResult; image: string }) => {
    const data = entry.result;
    setEditDate(data.date);
    setEditShopName(data.shopName);
    setEditTotalAmount(data.totalAmount);
    setEditItems(data.items);
    if (data.category) setEditCategory(data.category);
    setEditMemo(data.memo || '');
    setEtcType(data.etcType || 'jissha');
    setEtcPaidByGuide(Boolean(data.etcPaidByGuide));
  };

  // フォームで編集中の内容を resultsList[activeIndex] に常時同期（タブ切替や一括登録で消えないようにする）
  const updateCurrentEntryResult = (patch: Partial<GeminiReceiptResult>, newImage?: string) => {
    setResultsList((prev) => {
      if (activeIndex < 0 || activeIndex >= prev.length) return prev;
      const next = [...prev];
      next[activeIndex] = {
        result: { ...next[activeIndex].result, ...patch },
        image: newImage ?? next[activeIndex].image
      };
      return next;
    });
  };

  // 入力値・解析結果が変わるたびに二重登録チェックを実行
  useEffect(() => {
    if (!isOpen || !currentResult || isAnalyzing) {
      setDuplicates([]);
      return;
    }

    let cancelled = false;
    checkReceiptDuplicates({
      tourId: activeTour?.id,
      date: editDate,
      amount: Number(editTotalAmount) || 0,
      place: editShopName,
      category: mapAiCategoryToExpenseCategory(editCategory),
      invoiceNumber: currentResult.invoiceNumber,
      imageUrl: currentImage || undefined
    }).then((found) => {
      if (!cancelled) {
        setDuplicates(found);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, currentResult, isAnalyzing, editDate, editTotalAmount, editShopName, editCategory, currentImage, activeTour?.id]);

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

  // Gemini 解析実行（縦連続ETC明細を自動分離）
  const runGeminiAnalysis = async (imageDataUrl: string) => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const dataList = await analyzeReceiptsWithGemini(imageDataUrl);

      // 複数件ある場合は画像を縦スライス
      let sliceImages: string[] = [imageDataUrl];
      if (dataList.length > 1) {
        const segs = dataList.map((r, segIdx) => {
          if (r.splitBox && typeof r.splitBox.topPct === 'number' && typeof r.splitBox.bottomPct === 'number') {
            return r.splitBox;
          }
          const segSize = 1 / dataList.length;
          return {
            topPct: segIdx * segSize,
            bottomPct: (segIdx + 1) * segSize
          };
        });
        sliceImages = await sliceImageVerticalSegments(imageDataUrl, segs);
      }

      const list = dataList.map((d, i) => ({
        result: d,
        image: sliceImages[i] || imageDataUrl
      }));

      setResultsList(list);
      setActiveIndex(0);
      if (list.length > 0) {
        syncFormWithEntry(list[0]);
      }
    } catch (err: any) {
      console.error('Gemini OCR 解析エラー:', err);
      setAnalysisError(err?.message || 'レシートの解析に失敗しました。');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 品目の追加
  const handleAddItem = () => {
    const updated = [...editItems, { name: '', price: 0 }];
    setEditItems(updated);
    updateCurrentEntryResult({ items: updated });
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

    // 金額欄を変更した場合のみ、品目合計が正かつETCでない場合（または合計金額が未入力の場合）に反映
    if (field === 'price') {
      const newTotal = updated.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
      const isEtc = mapAiCategoryToExpenseCategory(editCategory) === 'etc';
      if (newTotal > 0 && (!isEtc || updated.length === 1)) {
        setEditTotalAmount(newTotal);
        updateCurrentEntryResult({ items: updated, totalAmount: newTotal });
        return;
      }
    }
    updateCurrentEntryResult({ items: updated });
  };

  // 品目の削除
  const handleRemoveItem = (index: number) => {
    const updated = editItems.filter((_, i) => i !== index);
    setEditItems(updated);
    updateCurrentEntryResult({ items: updated });
  };

  const isCurrentCategoryEtc = mapAiCategoryToExpenseCategory(editCategory) === 'etc';
  // ETCのみの重複か、それ以外の目立つ重複かを判定
  const hasExactImageDuplicate = duplicates.some(d => d.confidence === 'exact_image');
  const hasNonEtcDuplicate = duplicates.some(d => !d.isEtc && (d.confidence === 'exact_image' || d.confidence === 'high' || d.confidence === 'medium'));

  // 現在の1件を登録
  const handleSaveCurrent = async () => {
    if (!currentImage || isSaving || saveSuccess) return;

    // 二重登録の警告確認（ETC以外の重複、または完全同一画像の場合のみ確認）
    if (hasNonEtcDuplicate || hasExactImageDuplicate) {
      const topMatch = duplicates[0];
      const msg = [
        '⚠️ 二重登録の可能性があります！',
        '',
        `【既登録データ】`,
        `・利用日: ${topMatch.existingReceipt.date}`,
        `・場所/店名: ${topMatch.existingReceipt.place}`,
        `・金額: ¥${topMatch.existingReceipt.amount.toLocaleString()}`,
        `・判定理由: ${topMatch.reasons.join(' / ')}`,
        '',
        '同じレシート・領収書ではありませんか？',
        '本当にこのまま追加登録してもよろしいですか？'
      ].join('\n');

      if (!window.confirm(msg)) {
        return;
      }
    }

    setIsSaving(true);
    try {
      await onSaveToExpense({
        shopName: editShopName || 'レシート経費',
        date: editDate || new Date().toISOString().split('T')[0],
        amount: Number(editTotalAmount) || 0,
        category: editCategory,
        items: editItems,
        receiptImage: currentImage,
        invoiceNumber: currentResult?.invoiceNumber,
        memo: editMemo.trim(),
        etcType: isCurrentCategoryEtc ? etcType : undefined,
        etcPaidByGuide: isCurrentCategoryEtc ? etcPaidByGuide : undefined,
        etcDetails: isCurrentCategoryEtc ? {
          entryGate: currentResult?.entryGate,
          exitGate: currentResult?.exitGate,
          splitIndex: resultsList.length > 1 ? activeIndex + 1 : undefined
        } : undefined
      });

      // 複数件ある場合、まだ未登録の次の明細へ進むか完了
      if (resultsList.length > 1 && activeIndex < resultsList.length - 1) {
        const nextIdx = activeIndex + 1;
        setActiveIndex(nextIdx);
        syncFormWithEntry(resultsList[nextIdx]);
        setIsSaving(false);
      } else {
        setSaveSuccess(true);
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (err: any) {
      setAnalysisError(err?.message || '運行経費データへの保存に失敗しました。');
      setIsSaving(false);
    }
  };

  // 全て一括登録（複数件分離された場合：各タブで編集した金額・実車/回送・預り金から引く/引かないを完全保持）
  const handleSaveAll = async () => {
    if (resultsList.length === 0 || isSaving) return;

    if (hasNonEtcDuplicate || hasExactImageDuplicate) {
      if (!window.confirm('⚠️ 二重登録の疑いがある明細が含まれています。すべて保存してもよろしいですか？')) {
        return;
      }
    }

    setIsSaving(true);
    try {
      for (let i = 0; i < resultsList.length; i++) {
        const item = resultsList[i];
        // 現在開いているタブは最新のstate値を優先、それ以外のタブはresultsListに保存された編集値を参照
        const isCurrentTab = i === activeIndex;
        const res = item.result;
        const catStr = isCurrentTab ? editCategory : (res.category || 'ETC');
        const isEtc = mapAiCategoryToExpenseCategory(catStr) === 'etc';
        const finalShopName = isCurrentTab ? (editShopName || res.shopName) : res.shopName;
        const finalDate = isCurrentTab ? (editDate || res.date) : res.date;
        const finalAmount = isCurrentTab ? (Number(editTotalAmount) || 0) : (Number(res.totalAmount) || 0);
        const finalItems = isCurrentTab ? editItems : res.items;
        const finalMemo = isCurrentTab ? editMemo.trim() : (res.memo || '');
        const finalEtcType = isCurrentTab ? etcType : (res.etcType || 'jissha');
        const finalEtcPaidByGuide = isCurrentTab ? etcPaidByGuide : Boolean(res.etcPaidByGuide);

        await onSaveToExpense({
          shopName: finalShopName || 'レシート経費',
          date: finalDate || new Date().toISOString().split('T')[0],
          amount: finalAmount,
          category: catStr,
          items: finalItems,
          receiptImage: item.image,
          invoiceNumber: res.invoiceNumber,
          memo: finalMemo || undefined,
          etcType: isEtc ? finalEtcType : undefined,
          etcPaidByGuide: isEtc ? finalEtcPaidByGuide : undefined,
          etcDetails: isEtc ? {
            entryGate: res.entryGate,
            exitGate: res.exitGate,
            splitIndex: i + 1
          } : undefined
        });
      }
      setSaveSuccess(true);
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err: any) {
      setAnalysisError(err?.message || '一括保存に失敗しました。');
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
                  src={currentImage || selectedImage}
                  alt="Receipt"
                  onClick={() => setIsCropModalOpen(true)}
                  style={{
                    width: '74px',
                    height: '90px',
                    objectFit: 'contain',
                    background: '#020617',
                    borderRadius: '10px',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer'
                  }}
                  title="クリックして切り取り調整"
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9' }}>
                    レシート画像が選択されました
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8', margin: '2px 0 8px' }}>
                    {isAnalyzing ? 'Gemini 1.5 Flash でOCR解析中...' : '解析結果を反映済み'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      disabled={isAnalyzing}
                      onClick={() => setIsCropModalOpen(true)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '8px',
                        background: 'rgba(56, 189, 248, 0.2)',
                        border: '1px solid rgba(56, 189, 248, 0.4)',
                        color: '#7dd3fc',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px'
                      }}
                    >
                      <span>✂️ 切り取り調整</span>
                    </button>
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
          {currentResult && !isAnalyzing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* 複数件分離された場合のナビゲーションセレクター */}
              {resultsList.length > 1 && (
                <div
                  style={{
                    padding: '12px 14px',
                    borderRadius: '16px',
                    background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2))',
                    border: '1.5px solid rgba(168, 85, 247, 0.45)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f5d0fe', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={16} color="#f0abfc" />
                      <span>ETCレシート {resultsList.length} 件を1枚ずつ自動分離しました！</span>
                    </div>
                    <span style={{ fontSize: '0.74rem', color: '#c084fc', fontWeight: 700 }}>
                      {activeIndex + 1} / {resultsList.length} 件目
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '2px' }}>
                    {resultsList.map((entry, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveIndex(idx);
                          syncFormWithEntry(entry);
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '10px',
                          border: activeIndex === idx ? '2px solid #c084fc' : '1px solid rgba(255, 255, 255, 0.12)',
                          background: activeIndex === idx ? 'rgba(168, 85, 247, 0.45)' : 'rgba(15, 23, 42, 0.65)',
                          color: activeIndex === idx ? '#ffffff' : '#94a3b8',
                          fontSize: '0.74rem',
                          fontWeight: activeIndex === idx ? 800 : 600,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5
                        }}
                      >
                        <span>{idx + 1}.</span>
                        <span style={{ maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entry.result.shopName}
                        </span>
                        <span style={{ color: activeIndex === idx ? '#fef08a' : '#cbd5e1' }}>
                          ¥{entry.result.totalAmount.toLocaleString()}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ⚠️ 二重登録検知アラート：ETCは控えめ、その他は目立つ */}
              {duplicates.length > 0 && (
                isCurrentCategoryEtc && !hasExactImageDuplicate && !hasNonEtcDuplicate ? (
                  /* ETCの控えめなお知らせ */
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: '12px',
                      background: 'rgba(59, 130, 246, 0.12)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                      color: '#bfdbfe',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.76rem'
                    }}
                  >
                    <AlertCircle size={16} color="#60a5fa" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 700, color: '#93c5fd' }}>同区間の利用履歴あり:</span>{' '}
                      <span>{duplicates[0].reasons[0] || '同日の同一ETC区間'}</span>
                      <span style={{ color: '#94a3b8', marginLeft: 6 }}>（※往復運行等は問題ありません）</span>
                    </div>
                  </div>
                ) : (
                  /* ETC以外の目立つ警告アラート（今と同じ） */
                  <div
                    style={{
                      padding: '14px 16px',
                      borderRadius: '16px',
                      background: 'rgba(245, 158, 11, 0.16)',
                      border: '2px solid rgba(245, 158, 11, 0.65)',
                      color: '#fef3c7',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 4px 18px rgba(245, 158, 11, 0.2)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 800, fontSize: '0.9rem', color: '#fbbf24' }}>
                      <AlertTriangle size={20} color="#fbbf24" style={{ flexShrink: 0 }} />
                      <span>⚠️ 二重登録の可能性があります！（類似明細 {duplicates.length}件）</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#fde68a', lineHeight: 1.45 }}>
                      すでに同じ日付・金額・店舗（または同一画像）のレシートが登録されています。二重登録でないかご確認ください。
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {duplicates.slice(0, 2).map((dup, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            padding: '8px 10px',
                            borderRadius: '10px',
                            background: 'rgba(15, 23, 42, 0.75)',
                            border: '1px solid rgba(251, 191, 36, 0.35)',
                            fontSize: '0.76rem'
                          }}
                        >
                          {(dup.existingReceipt.processedImageUrl || dup.existingReceipt.originalImageUrl) && (
                            <img
                              src={dup.existingReceipt.processedImageUrl || dup.existingReceipt.originalImageUrl}
                              alt="既登録レシート"
                              style={{
                                width: '38px',
                                height: '44px',
                                objectFit: 'cover',
                                borderRadius: '6px',
                                border: '1px solid rgba(255,255,255,0.2)',
                                flexShrink: 0
                              }}
                            />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, color: '#ffffff' }}>
                              <span>{dup.existingReceipt.date}</span>
                              <span>・</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {dup.existingReceipt.place}
                              </span>
                              <span style={{ marginLeft: 'auto', color: '#fbbf24', fontFamily: 'var(--font-num)' }}>
                                ¥{dup.existingReceipt.amount.toLocaleString()}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: '2px' }}>
                              {dup.isSameTour ? '【現在のツアー内で登録済】' : `【別ツアー ${dup.tourCode || ''} で登録済】`}{' '}
                              {dup.reasons.join(' / ')}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}

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

              {/* ETCの場合のボタン設置: 実車/回送 ＆ 預り金から引く/引かない */}
              {isCurrentCategoryEtc && (
                <div
                  style={{
                    padding: '14px',
                    borderRadius: '16px',
                    background: 'rgba(30, 41, 59, 0.7)',
                    border: '1.5px solid rgba(59, 130, 246, 0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                  }}
                >
                  {/* 回送 / 実車 ボタン */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#93c5fd', marginBottom: 6 }}>
                      ETC 運行分類（実車 / 回送）
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEtcType('jissha');
                          updateCurrentEntryResult({ etcType: 'jissha' });
                        }}
                        style={{
                          padding: '10px',
                          borderRadius: '12px',
                          border: etcType === 'jissha' ? '2px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.15)',
                          background: etcType === 'jissha' ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'rgba(15, 23, 42, 0.7)',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <span>🚌 実車</span>
                        {etcType === 'jissha' && <CheckCircle2 size={15} />}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEtcType('kaiso');
                          updateCurrentEntryResult({ etcType: 'kaiso' });
                        }}
                        style={{
                          padding: '10px',
                          borderRadius: '12px',
                          border: etcType === 'kaiso' ? '2px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.15)',
                          background: etcType === 'kaiso' ? 'linear-gradient(135deg, #d97706, #b45309)' : 'rgba(15, 23, 42, 0.7)',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '0.85rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <span>🔄 回送</span>
                        {etcType === 'kaiso' && <CheckCircle2 size={15} />}
                      </button>
                    </div>
                  </div>

                  {/* 預り金から引く / 引かない ボタン */}
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 800, color: '#93c5fd', marginBottom: 6 }}>
                      ETC 精算区分（ガイドの預り金から引くか）
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setEtcPaidByGuide(false);
                          updateCurrentEntryResult({ etcPaidByGuide: false });
                        }}
                        style={{
                          padding: '10px',
                          borderRadius: '12px',
                          border: !etcPaidByGuide ? '2px solid #10b981' : '1px solid rgba(255, 255, 255, 0.15)',
                          background: !etcPaidByGuide ? 'linear-gradient(135deg, #059669, #047857)' : 'rgba(15, 23, 42, 0.7)',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <span>🏢 引かない (会社ETC)</span>
                        {!etcPaidByGuide && <CheckCircle2 size={15} />}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setEtcPaidByGuide(true);
                          updateCurrentEntryResult({ etcPaidByGuide: true });
                        }}
                        style={{
                          padding: '10px',
                          borderRadius: '12px',
                          border: etcPaidByGuide ? '2px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.15)',
                          background: etcPaidByGuide ? 'linear-gradient(135deg, #7c3aed, #6d28d9)' : 'rgba(15, 23, 42, 0.7)',
                          color: '#ffffff',
                          fontWeight: 800,
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 6
                        }}
                      >
                        <span>👛 預り金から引く</span>
                        {etcPaidByGuide && <CheckCircle2 size={15} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}

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
                    onChange={(e) => {
                      setEditShopName(e.target.value);
                      updateCurrentEntryResult({ shopName: e.target.value });
                    }}
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
                    onChange={(e) => {
                      setEditDate(e.target.value);
                      updateCurrentEntryResult({ date: e.target.value });
                    }}
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
                    onChange={(e) => {
                      setEditCategory(e.target.value);
                      updateCurrentEntryResult({ category: e.target.value });
                    }}
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
                    onChange={(e) => {
                      const num = Number(e.target.value) || 0;
                      setEditTotalAmount(num);
                      updateCurrentEntryResult({ totalAmount: num });
                    }}
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
                  onChange={(e) => {
                    setEditMemo(e.target.value);
                    updateCurrentEntryResult({ memo: e.target.value });
                  }}
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
                    <span>Gemini 返却 JSON データ ({currentResult?.rawJson?.length || 0}文字)</span>
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
                      {currentResult?.rawJson}
                    </pre>
                  </div>
                )}
              </div>

              {/* 登録確定ボタン群 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleSaveCurrent}
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
                  <span>
                    {isSaving
                      ? '保存中...'
                      : resultsList.length > 1
                      ? `この明細を登録して次へ (${activeIndex + 1}/${resultsList.length})`
                      : '運行経費に登録する'}
                  </span>
                </button>

                {resultsList.length > 1 && (
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleSaveAll}
                    style={{
                      padding: '12px',
                      borderRadius: '14px',
                      background: 'linear-gradient(135deg, #6366f1, #a855f7)',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: '0.88rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)'
                    }}
                  >
                    <Sparkles size={16} color="#fef08a" />
                    <span>全 {resultsList.length} 件の明細を一括登録する</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* レシート余白・切り取り調整モーダル */}
      {(currentImage || selectedImage) && (
        <ImageCropModal
          isOpen={isCropModalOpen}
          onClose={() => setIsCropModalOpen(false)}
          imageUrl={(currentImage || selectedImage)!}
          onApplyCrop={(croppedUrl) => {
            if (resultsList.length > 0) {
              updateCurrentEntryResult({}, croppedUrl);
            } else {
              setSelectedImage(croppedUrl);
            }
          }}
        />
      )}
    </div>
  );
};
