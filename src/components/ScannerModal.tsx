import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Camera,
  Layers,
  Image as ImageIcon,
  Zap,
  ZapOff,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Smartphone,
  CreditCard,
  Maximize2,
  AlertCircle,
  Clock
} from 'lucide-react';
import { analyzeReceiptImage, type ParsedReceiptItem } from '../utils/ocrService';
import {
  analyzeReceiptsWithGemini,
  mapAiCategoryToExpenseCategory,
  mapAiPaymentMethodToPaymentMethod
} from '../utils/geminiOcrService';
import { getAppConfig } from '../utils/configStorage';
import { applyInvoiceHighlight, cropReceiptRegions, sliceImageVerticalSegments } from '../utils/imageProcessor';
import { extractInvoiceNumbers } from '../utils/invoiceValidator';
import { getLearningStats } from '../utils/learningService';
import { sortReceiptsByDate } from '../utils/receiptSort';
import type { Tour } from '../db';
import { ClockTimePickerModal } from './ClockTimePickerModal';

interface ScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTour?: Tour;
  onScanCompleted: (items: ParsedReceiptItem[]) => void;
  onSwitchToGeminiOcr?: () => void;
  initialEngine?: 'gemini' | 'standard';
  onOpenSettings?: () => void;
}

export const ScannerModal: React.FC<ScannerModalProps> = ({
  isOpen,
  onClose,
  activeTour,
  onScanCompleted,
  onSwitchToGeminiOcr,
  initialEngine = 'gemini',
  onOpenSettings
}) => {
  const [isBatchMode, setIsBatchMode] = useState(false); // 連続撮影モード
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [presetTime, setPresetTime] = useState<string | undefined>(undefined); // 撮影時刻（時計入力）
  const [imageTimes, setImageTimes] = useState<Record<number, string>>({}); // 撮影画像ごとの指定時刻
  const [isClockPickerOpen, setIsClockPickerOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [hasTorchSupport, setHasTorchSupport] = useState(false);
  const [learnedCount, setLearnedCount] = useState<number>(0);

  // スキャンエンジン: 'gemini' (Gemini 1.5 Flash AI) または 'standard' (ローカル高速OCR)
  const [scanEngine, setScanEngine] = useState<'gemini' | 'standard'>('gemini');

  // ガイド枠の形状: 'tall' (縦長レシート・標準) | 'wide' (横長領収書・ETC) | 'free' (枠なし・全体)
  const [frameShape, setFrameShape] = useState<'tall' | 'wide' | 'free'>('tall');

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const appConfig = getAppConfig();
  const hasGeminiKey = Boolean(appConfig?.geminiApiKey?.trim());

  // カメラの起動とクリーンアップ
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCapturedImages([]);
      setImageTimes({});
      setPresetTime(undefined);
      setIsProcessing(false);
      return;
    }

    // 初期エンジン設定
    if (initialEngine) {
      setScanEngine(initialEngine);
    } else {
      setScanEngine(hasGeminiKey ? 'gemini' : 'standard');
    }

    startCamera();
    getLearningStats()
      .then((s) => setLearnedCount(s.totalPatterns))
      .catch((e) => console.warn('学習統計取得失敗:', e));

    return () => {
      stopCamera();
    };
  }, [isOpen, initialEngine, hasGeminiKey]);

  const startCamera = async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // トーチ（ライト）のサポートチェック
      const track = stream.getVideoTracks()[0];
      const capabilities = (track.getCapabilities ? track.getCapabilities() : {}) as any;
      if (capabilities.torch) {
        setHasTorchSupport(true);
      }
    } catch (err) {
      console.warn('カメラ直接起動不可。ファイル選択UIへ切り替え:', err);
    }
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
  };

  const toggleTorch = async () => {
    if (!mediaStreamRef.current) return;
    const track = mediaStreamRef.current.getVideoTracks()[0];
    if (track) {
      try {
        const newTorch = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: newTorch }]
        });
        setTorchOn(newTorch);
      } catch (err) {
        console.warn('トーチ切替エラー:', err);
      }
    }
  };

  // シャッターを切って撮影（選択中のガイド枠 frameShape に合わせて外側の余計な余白を最初からカット）
  const captureCurrentFrame = (): string | null => {
    if (!videoRef.current) return null;
    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    const vw = video.videoWidth;
    const vh = video.videoHeight;

    // ガイド枠に応じたクロップ領域（少しだけ安全マージンを持たせて枠内のレシートが切れないようにする）
    let topPct = 0;
    let bottomPct = 1;
    let leftPct = 0;
    let rightPct = 1;

    if (frameShape === 'tall') {
      // 縦長レシート枠 (top: 6%, bottom: 10%, left: 16%, right: 16%) -> 安全マージン込み
      topPct = 0.03;
      bottomPct = 0.94;
      leftPct = 0.10;
      rightPct = 0.90;
    } else if (frameShape === 'wide') {
      // 横長・ETC枠 (top: 25%, bottom: 25%, left: 6%, right: 6%) -> 上下の広大な背景を最初からカット
      topPct = 0.18;
      bottomPct = 0.82;
      leftPct = 0.03;
      rightPct = 0.97;
    }

    const sx = Math.round(vw * leftPct);
    const sy = Math.round(vh * topPct);
    const sw = Math.max(100, Math.round(vw * (rightPct - leftPct)));
    const sh = Math.max(100, Math.round(vh * (bottomPct - topPct)));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const handleShutter = () => {
    const dataUrl = captureCurrentFrame();
    if (!dataUrl) return;

    if (isBatchMode) {
      // 連続撮影モード: リストにストックして撮影継続
      const nextIdx = capturedImages.length;
      if (presetTime) {
        setImageTimes((prev) => ({ ...prev, [nextIdx]: presetTime }));
      }
      setCapturedImages((prev) => [...prev, dataUrl]);
    } else {
      // 単一撮影モード: 直ちにOCR解析へ
      const singleTimes: Record<number, string> = presetTime ? { 0: presetTime } : {};
      processImages([dataUrl], singleTimes);
    }
  };

  // 端末の写真ライブラリ・ファイル選択
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const urls: string[] = [];
    let loadedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const reader = new FileReader();
      reader.onload = () => {
        urls.push(reader.result as string);
        loadedCount++;
        if (loadedCount === files.length) {
          if (isBatchMode) {
            setCapturedImages((prev) => [...prev, ...urls]);
          } else {
            const singleTimes: Record<number, string> = presetTime ? { 0: presetTime } : {};
            processImages(urls, singleTimes);
          }
        }
      };
      reader.readAsDataURL(files[i]);
    }
  };

  // 画像の自動切り抜き・総合OCR・分割・インボイスハイライト解析
  const processImages = async (imagesToProcess: string[], timesMap: Record<number, string> = imageTimes) => {
    if (imagesToProcess.length === 0) return;

    setIsProcessing(true);
    stopCamera();

    const allParsedItems: ParsedReceiptItem[] = [];

    // ステップ1: 各撮影画像からレシート・チケットの輪郭を自動検出して個別切り抜き
    setProcessingStatus('レシート・領収書の輪郭を自動検出中...');
    const croppedImages: string[] = [];

    for (let i = 0; i < imagesToProcess.length; i++) {
      const original = imagesToProcess[i];
      try {
        const detectedRegions = await cropReceiptRegions(original);
        if (detectedRegions.length > 1) {
          setProcessingStatus(`1枚の写真から ${detectedRegions.length} 枚のレシートを自動切り抜きしました！`);
          await new Promise((r) => setTimeout(r, 400));
        }
        croppedImages.push(...detectedRegions);
      } catch (e) {
        console.warn('自動クロップ失敗、元画像を使用:', e);
        croppedImages.push(original);
      }
    }

    // ステップ2: OCR解析（Gemini AIモードまたはローカルAI）
    const useGemini = scanEngine === 'gemini' && hasGeminiKey;

    for (let i = 0; i < croppedImages.length; i++) {
      const img = croppedImages[i];
      let itemParsed = false;

      // Gemini AI が有効な場合
      if (useGemini) {
        setProcessingStatus(`[${i + 1}/${croppedImages.length}] ✨ Gemini Flashで高精度AI解析中（ETC連続明細自動分離）...`);
        try {
          const geminiResults = await analyzeReceiptsWithGemini(img);

          // 縦連続明細（複数件）の場合、画像を分割スライス
          let sliceImages: string[] = [img];
          if (geminiResults.length > 1) {
            const segs = geminiResults.map((r, segIdx) => {
              if (r.splitBox && typeof r.splitBox.topPct === 'number' && typeof r.splitBox.bottomPct === 'number') {
                return r.splitBox;
              }
              const segSize = 1 / geminiResults.length;
              return {
                topPct: segIdx * segSize,
                bottomPct: (segIdx + 1) * segSize
              };
            });
            sliceImages = await sliceImageVerticalSegments(img, segs);
          }

          for (let k = 0; k < geminiResults.length; k++) {
            const geminiResult = geminiResults[k];
            const pieceImage = sliceImages[k] || img;
            const detectedCategory = mapAiCategoryToExpenseCategory(geminiResult.category);
            const detectedPayment = mapAiPaymentMethodToPaymentMethod(geminiResult.paymentMethod, detectedCategory);

            const invoiceNum = geminiResult.invoiceNumber?.trim() || undefined;
            const validatedInvoice = invoiceNum ? extractInvoiceNumbers(invoiceNum) : [];
            const primaryInvoice = validatedInvoice.length > 0 ? validatedInvoice[0] : undefined;
            const highlightedImg = primaryInvoice ? await applyInvoiceHighlight(pieceImage) : pieceImage;

            const designatedTime = timesMap[i] || presetTime;
            const finalTime = designatedTime || geminiResult.time;

            allParsedItems.push({
              id: `gemini-${Date.now()}-${i}-${k}`,
              category: detectedCategory,
              paymentMethod: detectedPayment,
              date: geminiResult.date,
              time: finalTime,
              amount: geminiResult.totalAmount,
              place: geminiResult.shopName,
              invoiceNumber: primaryInvoice?.normalizedNumber || invoiceNum,
              isInvoiceValid: primaryInvoice?.isCheckDigitValid,
              hasInvoiceHighlight: !!primaryInvoice,
              originalImageUrl: pieceImage,
              processedImageUrl: highlightedImg,
              etcDetails: detectedCategory === 'etc' ? {
                entryGate: geminiResult.entryGate,
                exitGate: geminiResult.exitGate,
                splitIndex: geminiResults.length > 1 ? k + 1 : undefined
              } : undefined,
              etcType: detectedCategory === 'etc' ? (geminiResult.etcType || 'jissha') : undefined,
              etcPaidByGuide: false, // 初期値は会社ETC（引かない）
              rawText: geminiResult.rawJson || ''
            });
          }
          itemParsed = true;
        } catch (geminiErr) {
          console.warn('Gemini AI解析失敗、ローカル推論エンジンへフォールバック:', geminiErr);
        }
      }

      // ローカルAIエンジン（通常モード、またはGemini失敗時）
      if (!itemParsed) {
        setProcessingStatus(`[${i + 1}/${croppedImages.length}] レシート解析中 (高速ローカル推論)...`);
        try {
          const items = await analyzeReceiptImage(img, (status) => {
            setProcessingStatus(`[${i + 1}/${croppedImages.length}] ${status}`);
          });
          const designatedTime = timesMap[i] || presetTime;
          const itemsWithTime = designatedTime
            ? items.map((it) => ({ ...it, time: it.time || designatedTime }))
            : items;
          allParsedItems.push(...itemsWithTime);
        } catch (err) {
          console.error('ローカルOCR解析エラー:', err);
        }
      }
    }

    setIsProcessing(false);
    // 常に日付順（時系列昇順）に整列して確認画面へ
    const sortedParsedItems = sortReceiptsByDate(allParsedItems);
    onScanCompleted(sortedParsedItems);
  };

  if (!isOpen) return null;

  const isGeminiMode = scanEngine === 'gemini';
  const themeColor = isGeminiMode ? '#a855f7' : '#3b82f6';
  const themeBg = isGeminiMode
    ? 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)'
    : 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';

  // ガイド枠の動的スタイル計算
  const getFrameStyle = (): React.CSSProperties => {
    if (frameShape === 'tall') {
      // 縦長レシート用（細長く上下に広い、一般的なレシートに最適）
      return {
        position: 'absolute',
        top: '6%',
        bottom: '10%',
        left: '16%',
        right: '16%',
        maxWidth: '360px',
        margin: '0 auto',
        border: `2px solid ${isGeminiMode ? 'rgba(168, 85, 247, 0.85)' : 'rgba(255, 255, 255, 0.75)'}`,
        borderRadius: '20px',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.32)',
        pointerEvents: 'none'
      };
    } else if (frameShape === 'wide') {
      // 横長領収書・ETC用
      return {
        position: 'absolute',
        top: '25%',
        bottom: '25%',
        left: '6%',
        right: '6%',
        maxWidth: '540px',
        margin: '0 auto',
        border: `2px solid ${isGeminiMode ? 'rgba(168, 85, 247, 0.85)' : 'rgba(255, 255, 255, 0.75)'}`,
        borderRadius: '20px',
        boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.32)',
        pointerEvents: 'none'
      };
    } else {
      // フリー・枠なし全体
      return {
        position: 'absolute',
        inset: '5%',
        border: '1.5px dashed rgba(255, 255, 255, 0.35)',
        borderRadius: '20px',
        boxShadow: 'none',
        pointerEvents: 'none'
      };
    }
  };

  return (
    <div className="modal-overlay" style={{ background: '#000000', alignItems: 'stretch' }}>
      <div
        className="modal-content"
        style={{
          maxWidth: '100%',
          height: '100dvh',
          maxHeight: '100dvh',
          borderRadius: 0,
          background: '#040711',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* スキャナー上部コントロールバー */}
        <div
          style={{
            padding: '12px 16px',
            background: 'rgba(9, 13, 22, 0.92)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: 10
          }}
        >
          {/* 上段: タイトル・モード切替・閉じるボタン */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {/* モード切替タブ (Gemini AI ↔ 通常) & ツアー情報 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  display: 'inline-flex',
                  background: 'rgba(255, 255, 255, 0.08)',
                  padding: '3px',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid rgba(255, 255, 255, 0.12)'
                }}
              >
                <button
                  type="button"
                  onClick={() => setScanEngine('gemini')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 12px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
                    background: isGeminiMode ? 'linear-gradient(135deg, #6366f1, #a855f7)' : 'transparent',
                    color: isGeminiMode ? '#ffffff' : '#94a3b8',
                    boxShadow: isGeminiMode ? '0 2px 8px rgba(168, 85, 247, 0.4)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Sparkles size={13} color={isGeminiMode ? '#fef08a' : '#94a3b8'} />
                  <span>Gemini AI</span>
                </button>

                <button
                  type="button"
                  onClick={() => setScanEngine('standard')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '5px 12px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    border: 'none',
                    cursor: 'pointer',
                    background: !isGeminiMode ? 'var(--primary)' : 'transparent',
                    color: !isGeminiMode ? '#ffffff' : '#94a3b8',
                    boxShadow: !isGeminiMode ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <Zap size={13} />
                  <span>通常スキャン</span>
                </button>
              </div>

              {activeTour && (
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: '#93c5fd',
                    background: 'rgba(59, 130, 246, 0.15)',
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontWeight: 600,
                    whiteSpace: 'nowrap'
                  }}
                  title={activeTour.title}
                >
                  {activeTour.code}
                </span>
              )}
            </div>

            {/* 右側アクション（連続モード、ライト、閉じる） */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* 連続撮影切替 */}
              <button
                type="button"
                onClick={() => setIsBatchMode(!isBatchMode)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  background: isBatchMode ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255, 255, 255, 0.06)',
                  color: isBatchMode ? '#60a5fa' : 'var(--text-muted)',
                  border: `1px solid ${isBatchMode ? '#60a5fa' : 'rgba(255, 255, 255, 0.15)'}`,
                  cursor: 'pointer'
                }}
              >
                <Layers size={13} />
                {isBatchMode ? '連続ON' : '単発'}
              </button>

              {/* トーチライト */}
              {hasTorchSupport && (
                <button
                  className="icon-btn"
                  onClick={toggleTorch}
                  style={{ width: 34, height: 34, color: torchOn ? '#fbbf24' : 'var(--text-muted)' }}
                  title="フラッシュライト"
                >
                  {torchOn ? <Zap size={16} /> : <ZapOff size={16} />}
                </button>
              )}

              {/* 閉じる */}
              <button
                className="icon-btn"
                onClick={onClose}
                style={{ width: 34, height: 34 }}
                title="閉じる"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* 下段: ガイド枠の形状切り替えピルバー */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>撮影枠:</span>
              <div
                style={{
                  display: 'inline-flex',
                  gap: 4,
                  background: 'rgba(0, 0, 0, 0.4)',
                  padding: '2px 4px',
                  borderRadius: '8px'
                }}
              >
                <button
                  type="button"
                  onClick={() => setFrameShape('tall')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: frameShape === 'tall' ? 800 : 500,
                    background: frameShape === 'tall' ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                    color: frameShape === 'tall' ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  title="縦長の一般的なレシートに最適"
                >
                  <Smartphone size={12} />
                  縦長レシート
                </button>

                <button
                  type="button"
                  onClick={() => setFrameShape('wide')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: frameShape === 'wide' ? 800 : 500,
                    background: frameShape === 'wide' ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                    color: frameShape === 'wide' ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  title="ETC利用証明書や横長の領収書に最適"
                >
                  <CreditCard size={12} />
                  横長・ETC
                </button>

                <button
                  type="button"
                  onClick={() => setFrameShape('free')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    padding: '3px 8px',
                    borderRadius: '6px',
                    fontSize: '0.72rem',
                    fontWeight: frameShape === 'free' ? 800 : 500,
                    background: frameShape === 'free' ? 'rgba(255, 255, 255, 0.18)' : 'transparent',
                    color: frameShape === 'free' ? '#ffffff' : '#94a3b8',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  title="枠なしで全体を広々と撮影"
                >
                  <Maximize2 size={12} />
                  枠なし全体
                </button>
              </div>
            </div>

            {/* Gemini APIキー未登録の警告またはモード案内 */}
            {isGeminiMode && !hasGeminiKey ? (
              <button
                type="button"
                onClick={onOpenSettings}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.7rem',
                  color: '#fbbf24',
                  background: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                  padding: '2px 8px',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                <AlertCircle size={12} />
                APIキー未設定
              </button>
            ) : isGeminiMode ? (
              <span style={{ fontSize: '0.7rem', color: '#c084fc', fontWeight: 600 }}>
                ✨ gemini-1.5-flash 高精度AI
              </span>
            ) : (
              learnedCount > 0 && (
                <span style={{ fontSize: '0.7rem', color: '#6ee7b7' }}>
                  🧠 学習済: {learnedCount}件
                </span>
              )
            )}
          </div>
        </div>

        {/* カメラビュー / ガイド枠 / 解析ローディング */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#000000' }}>
          {isProcessing ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                textAlign: 'center',
                background: 'rgba(4, 7, 15, 0.95)',
                zIndex: 20
              }}
            >
              <RefreshCw
                size={48}
                color={themeColor}
                style={{ animation: 'spin 1.5s linear infinite' }}
              />
              <div style={{ fontWeight: 800, fontSize: '1.2rem', marginTop: 20, color: '#ffffff' }}>
                {isGeminiMode ? '✨ Gemini AI 解析中' : '高速OCR 解析中'}
              </div>
              <div
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--text-muted)',
                  marginTop: 8,
                  maxWidth: 320
                }}
              >
                {processingStatus || 'レシートとインボイス番号を解析しています...'}
              </div>
              <div
                style={{
                  marginTop: 20,
                  fontSize: '0.75rem',
                  color: isGeminiMode ? '#c084fc' : '#10b981',
                  background: isGeminiMode ? 'rgba(168, 85, 247, 0.12)' : 'rgba(16, 185, 129, 0.1)',
                  padding: '6px 14px',
                  borderRadius: 'var(--radius-full)'
                }}
              >
                {isGeminiMode
                  ? '✓ 店名・日付・購入品目・インボイスを自動抽出'
                  : '✓ 外部送信なし・端末内高速処理'}
              </div>
            </div>
          ) : (
            <>
              {/* ビデオストリーム */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
                }}
              />

              {/* 撮影ガイドフレーム（ファインダー枠） */}
              <div style={getFrameStyle()}>
                {/* 四隅のL字アクセントマーカー */}
                {frameShape !== 'free' && (
                  <>
                    <div style={{ position: 'absolute', top: -2, left: -2, width: 22, height: 22, borderTop: `4px solid ${themeColor}`, borderLeft: `4px solid ${themeColor}`, borderTopLeftRadius: 18 }} />
                    <div style={{ position: 'absolute', top: -2, right: -2, width: 22, height: 22, borderTop: `4px solid ${themeColor}`, borderRight: `4px solid ${themeColor}`, borderTopRightRadius: 18 }} />
                    <div style={{ position: 'absolute', bottom: -2, left: -2, width: 22, height: 22, borderBottom: `4px solid ${themeColor}`, borderLeft: `4px solid ${themeColor}`, borderBottomLeftRadius: 18 }} />
                    <div style={{ position: 'absolute', bottom: -2, right: -2, width: 22, height: 22, borderBottom: `4px solid ${themeColor}`, borderRight: `4px solid ${themeColor}`, borderBottomRightRadius: 18 }} />
                  </>
                )}

                {/* ガイドテキスト */}
                <div
                  style={{
                    position: 'absolute',
                    top: 10,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    textShadow: '0 1px 4px rgba(0,0,0,0.9)'
                  }}
                >
                  {frameShape === 'tall'
                    ? '細長いレシートをここに合わせます'
                    : frameShape === 'wide'
                    ? 'ETC明細・横長領収書を合わせます'
                    : '1枚でも複数枚並べて撮影もOK'}
                </div>

                <div
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: '0.7rem',
                    color: isGeminiMode ? '#e9d5ff' : '#93c5fd',
                    textShadow: '0 1px 4px rgba(0,0,0,0.9)'
                  }}
                >
                  ✓ 枠からはみ出てもAIが自動切り抜きします
                </div>
              </div>
            </>
          )}
        </div>

        {/* 連続撮影時のストックサムネイルバー */}
        {isBatchMode && capturedImages.length > 0 && !isProcessing && (
          <div
            style={{
              padding: '10px 16px',
              background: '#090d16',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              overflowX: 'auto'
            }}
          >
            <div style={{ fontSize: '0.78rem', color: themeColor, fontWeight: 700, minWidth: 60 }}>
              {capturedImages.length} 枚撮影中
            </div>
            {capturedImages.map((src, i) => (
              <div
                key={i}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: `2px solid ${themeColor}`,
                  position: 'relative'
                }}
              >
                <img src={src} alt="thumb" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {imageTimes[i] && (
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'rgba(0,0,0,0.85)',
                      color: '#60a5fa',
                      fontSize: 8,
                      fontWeight: 700,
                      textAlign: 'center',
                      fontFamily: 'var(--font-num)'
                    }}
                  >
                    {imageTimes[i]}
                  </div>
                )}
                <button
                  onClick={() => {
                    setCapturedImages((prev) => prev.filter((_, idx) => idx !== i));
                    setImageTimes((prev) => {
                      const next = { ...prev };
                      delete next[i];
                      return next;
                    });
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    background: 'rgba(0,0,0,0.7)',
                    borderRadius: '50%',
                    width: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontSize: 10
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 撮影時刻指定バー（あとからまとめて撮影するときに時計を出して時間・分を設定） */}
        {!isProcessing && (
          <div
            style={{
              padding: '6px 16px',
              background: '#090d16',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            <button
              type="button"
              onClick={() => setIsClockPickerOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: 'var(--radius-full)',
                background: presetTime ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                border: presetTime ? '1.5px solid #3b82f6' : '1px solid rgba(255, 255, 255, 0.15)',
                color: presetTime ? '#60a5fa' : '#cbd5e1',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: presetTime ? '0 0 12px rgba(59, 130, 246, 0.3)' : 'none'
              }}
            >
              <Clock size={15} color={presetTime ? '#60a5fa' : '#94a3b8'} />
              {presetTime ? `撮影時刻: ${presetTime} (時計で変更)` : '🕒 撮影時刻を時計で入力'}
            </button>

            {presetTime && (
              <button
                type="button"
                title="自動読み取りに戻す"
                onClick={() => setPresetTime(undefined)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: 'none',
                  borderRadius: '50%',
                  width: 22,
                  height: 22,
                  color: '#94a3b8',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* コントロール・シャッターボタンバー */}
        {!isProcessing && (
          <div
            style={{
              padding: '16px 24px calc(20px + var(--safe-bottom)) 24px',
              background: '#090d16',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16
            }}
          >
            {/* ギャラリーから選択 */}
            <button
              className="icon-btn"
              style={{ width: 50, height: 50 }}
              onClick={() => galleryInputRef.current?.click()}
              title="写真フォルダから選択"
            >
              <ImageIcon size={22} />
            </button>
            <input
              type="file"
              ref={galleryInputRef}
              accept="image/*"
              multiple={isBatchMode}
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />

            {/* シャッターボタン */}
            <button
              onClick={handleShutter}
              style={{
                width: 76,
                height: 76,
                borderRadius: '50%',
                background: themeBg,
                border: '4px solid #ffffff',
                boxShadow: isGeminiMode
                  ? '0 0 24px rgba(168, 85, 247, 0.6)'
                  : '0 0 20px var(--primary-glow)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                transform: 'scale(1)',
                transition: 'transform 0.15s ease',
                cursor: 'pointer'
              }}
              onPointerDown={(e) => (e.currentTarget.style.transform = 'scale(0.92)')}
              onPointerUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              title={isGeminiMode ? 'Gemini AIで撮影・解析' : '撮影'}
            >
              {isGeminiMode ? <Sparkles size={32} /> : <Camera size={32} />}
            </button>

            {/* 連続モード完了・解析開始ボタン または Gemini詳細モーダルへの切替 */}
            {isBatchMode ? (
              <button
                onClick={() => processImages(capturedImages)}
                disabled={capturedImages.length === 0}
                style={{
                  height: 48,
                  padding: '0 14px',
                  borderRadius: 'var(--radius-md)',
                  background: capturedImages.length > 0 ? 'var(--accent-emerald)' : 'var(--bg-surface)',
                  color: capturedImages.length > 0 ? '#ffffff' : 'var(--text-muted)',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  opacity: capturedImages.length > 0 ? 1 : 0.5
                }}
              >
                <CheckCircle2 size={16} />
                解析 ({capturedImages.length})
              </button>
            ) : onSwitchToGeminiOcr && !isGeminiMode ? (
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onClose();
                  onSwitchToGeminiOcr();
                }}
                className="icon-btn"
                style={{
                  width: 50,
                  height: 50,
                  color: '#c084fc',
                  background: 'rgba(168, 85, 247, 0.15)'
                }}
                title="Gemini品目明細モーダルを開く"
              >
                <Sparkles size={20} />
              </button>
            ) : (
              <div style={{ width: 50 }} />
            )}
          </div>
        )}
      </div>

      {/* 撮影時刻指定用の時計モーダル */}
      {isClockPickerOpen && (
        <ClockTimePickerModal
          isOpen={isClockPickerOpen}
          initialTime={presetTime}
          title="撮影レシートの利用時刻を設定"
          onSelect={(time) => {
            setPresetTime(time);
            setIsClockPickerOpen(false);
          }}
          onClose={() => setIsClockPickerOpen(false)}
          onClear={() => {
            setPresetTime(undefined);
            setIsClockPickerOpen(false);
          }}
        />
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

