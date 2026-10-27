import React, { useState, useEffect } from 'react';
import { X, Check, Scissors, RotateCcw, RotateCw, Sparkles } from 'lucide-react';
import {
  autoTightCrop,
  autoDeskewAndPerspective,
  transformAndCropReceiptImage
} from '../utils/imageProcessor';

interface ImageCropModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  onApplyCrop: (croppedDataUrl: string) => void | Promise<void>;
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  onApplyCrop
}) => {
  const [topInset, setTopInset] = useState(0);
  const [bottomInset, setBottomInset] = useState(0);
  const [leftInset, setLeftInset] = useState(0);
  const [rightInset, setRightInset] = useState(0);
  const [angleDeg, setAngleDeg] = useState(0);
  const [rotate90, setRotate90] = useState(0);
  const [keystoneV, setKeystoneV] = useState(0);
  const [keystoneH, setKeystoneH] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [baseImage, setBaseImage] = useState(imageUrl);
  const [previewImage, setPreviewImage] = useState(imageUrl);
  const [isSavedSuccess, setIsSavedSuccess] = useState(false);

  // モーダルオープン時にリセット
  useEffect(() => {
    if (isOpen) {
      setBaseImage(imageUrl);
      setPreviewImage(imageUrl);
      setTopInset(0);
      setBottomInset(0);
      setLeftInset(0);
      setRightInset(0);
      setAngleDeg(0);
      setRotate90(0);
      setKeystoneV(0);
      setKeystoneH(0);
      setIsSavedSuccess(false);
    }
  }, [isOpen, imageUrl]);

  // スライダー変更時に、台形・傾き補正＆切り取り結果のプレビュー画像を即時リアルタイム生成
  useEffect(() => {
    if (!isOpen) return;

    if (
      topInset === 0 &&
      bottomInset === 0 &&
      leftInset === 0 &&
      rightInset === 0 &&
      angleDeg === 0 &&
      rotate90 === 0 &&
      keystoneV === 0 &&
      keystoneH === 0
    ) {
      setPreviewImage(baseImage);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const transformed = await transformAndCropReceiptImage(
          baseImage,
          {
            top: topInset / 100,
            bottom: bottomInset / 100,
            left: leftInset / 100,
            right: rightInset / 100
          },
          {
            angleDeg,
            rotate90,
            keystoneV,
            keystoneH
          }
        );
        setPreviewImage(transformed);
      } catch (err) {
        console.warn('プレビュー生成失敗:', err);
      }
    }, 65);

    return () => clearTimeout(timer);
  }, [topInset, bottomInset, leftInset, rightInset, angleDeg, rotate90, keystoneV, keystoneH, baseImage, isOpen]);

  if (!isOpen) return null;

  const resetAllSliders = () => {
    setTopInset(0);
    setBottomInset(0);
    setLeftInset(0);
    setRightInset(0);
    setAngleDeg(0);
    setRotate90(0);
    setKeystoneV(0);
    setKeystoneH(0);
  };

  // 自動余白カットの実行
  const handleAutoTightCrop = async () => {
    setIsProcessing(true);
    try {
      const cropped = await autoTightCrop(previewImage || baseImage);
      setBaseImage(cropped);
      setPreviewImage(cropped);
      resetAllSliders();
    } catch (e) {
      console.warn('自動余白カット失敗:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 斜め・台形歪み＋余白のワンタップ自動補正
  const handleAutoDeskewAndPerspective = async () => {
    setIsProcessing(true);
    try {
      const res = await autoDeskewAndPerspective(previewImage || baseImage);
      setBaseImage(res.correctedDataUrl);
      setPreviewImage(res.correctedDataUrl);
      resetAllSliders();
    } catch (e) {
      console.warn('自動台形・斜め補正失敗:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 今のスライダー切り取り・歪み補正をベース画像に適用し、スライダーを0に戻してさらに追いカットできるようにする
  const handleApplyAndContinue = () => {
    if (!previewImage) return;
    setBaseImage(previewImage);
    resetAllSliders();
  };

  // リセット
  const handleReset = () => {
    setBaseImage(imageUrl);
    setPreviewImage(imageUrl);
    resetAllSliders();
  };

  // 確定
  const handleConfirm = async () => {
    setIsProcessing(true);
    try {
      const finalImg = previewImage || baseImage;
      await onApplyCrop(finalImg);
      setIsSavedSuccess(true);
      setTimeout(() => {
        onClose();
      }, 250);
    } catch (e) {
      console.warn('クロップ確定エラー:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  const hasActiveSliders =
    topInset > 0 ||
    bottomInset > 0 ||
    leftInset > 0 ||
    rightInset > 0 ||
    angleDeg !== 0 ||
    rotate90 !== 0 ||
    keystoneV !== 0 ||
    keystoneH !== 0;

  const hasCropChanges = hasActiveSliders || baseImage !== imageUrl;

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.88)' }}>
      <div
        className="modal-content"
        style={{
          maxWidth: '580px',
          width: '95%',
          maxHeight: '94vh',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
          background: '#0b1120',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          boxShadow: '0 20px 40px rgba(0,0,0,0.8)'
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.9)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: '0.95rem' }}>
            <Scissors size={18} color="var(--primary)" />
            <span>レシートの台形・傾き・余白切り取り調整</span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              display: 'flex',
              padding: 4
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* ボディ */}
        <div style={{ padding: '16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* クイックアクションバー */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleAutoDeskewAndPerspective}
              disabled={isProcessing}
              style={{
                flex: 1,
                minWidth: '175px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, #7c3aed, #a855f7)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(124, 58, 237, 0.35)'
              }}
              title="斜めに傾いたレシートや台形歪みを自動検知して真っ直ぐに補正します"
            >
              <Sparkles size={15} color="#fef08a" />
              <span>📐 斜め・台形＋余白を自動補正</span>
            </button>

            <button
              type="button"
              onClick={handleAutoTightCrop}
              disabled={isProcessing}
              style={{
                flex: 1,
                minWidth: '130px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.8rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
              }}
            >
              <Scissors size={14} color="#fef08a" />
              <span>余白のみ自動カット</span>
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={isProcessing || !hasCropChanges}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: hasCropChanges ? '#ffffff' : 'var(--text-muted)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: '0.78rem',
                cursor: 'pointer'
              }}
            >
              <RotateCcw size={14} />
              <span>最初に戻す</span>
            </button>
          </div>

          {/* リアルタイム・切り取り結果プレビュー領域 */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              height: '280px',
              background: '#030712',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: hasCropChanges ? '2px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
              padding: 8
            }}
          >
            <img
              src={previewImage}
              alt="切り取り後プレビュー"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'block',
                objectFit: 'contain',
                borderRadius: 4
              }}
            />

            {/* ステータスバッジ */}
            <div
              style={{
                position: 'absolute',
                top: 8,
                left: 8,
                padding: '3px 10px',
                borderRadius: 'var(--radius-full)',
                background: hasCropChanges ? 'rgba(56, 189, 248, 0.9)' : 'rgba(0, 0, 0, 0.65)',
                color: hasCropChanges ? '#041e42' : '#94a3b8',
                fontSize: '0.72rem',
                fontWeight: 700,
                backdropFilter: 'blur(4px)'
              }}
            >
              {hasCropChanges ? '✂️ 補正・切り取り後の仕上がりプレビュー' : '調整前（原本）'}
            </div>

            {hasCropChanges && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(0, 0, 0, 0.78)',
                  color: '#38bdf8',
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}
              >
                {angleDeg !== 0 || keystoneV !== 0 || keystoneH !== 0
                  ? `傾き${angleDeg > 0 ? `+${angleDeg}` : angleDeg}° / 縦台形${keystoneV > 0 ? `+${keystoneV}` : keystoneV} / 横台形${keystoneH > 0 ? `+${keystoneH}` : keystoneH} | `
                  : ''}
                カット: 上{topInset}% 下{bottomInset}% 左{leftInset}% 右{rightInset}%
              </div>
            )}
          </div>

          {/* 📐 斜め（傾き・回転）＆ 台形歪み補正コントロール */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '12px 14px',
              background: 'rgba(139, 92, 246, 0.07)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(168, 85, 247, 0.25)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: '#e9d5ff' }}>
                📐 斜め（傾き・回転）＆ 台形歪み補正
              </span>

              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setRotate90((prev) => (prev - 90 + 360) % 360)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer'
                  }}
                >
                  <RotateCcw size={12} />
                  <span>左90°回転</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRotate90((prev) => (prev + 90) % 360)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#f8fafc',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    cursor: 'pointer'
                  }}
                >
                  <RotateCw size={12} />
                  <span>右90°回転</span>
                </button>
                {(angleDeg !== 0 || rotate90 !== 0 || keystoneV !== 0 || keystoneH !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setAngleDeg(0);
                      setRotate90(0);
                      setKeystoneV(0);
                      setKeystoneH(0);
                    }}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      fontSize: '0.7rem',
                      background: 'rgba(239, 68, 68, 0.2)',
                      color: '#fca5a5',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      cursor: 'pointer'
                    }}
                  >
                    歪み0に戻す
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px 14px' }}>
              {/* 斜め傾き角度 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>🔄 斜め傾き</span>
                  <strong style={{ color: angleDeg !== 0 ? '#c084fc' : '#94a3b8' }}>
                    {angleDeg > 0 ? `+${angleDeg}` : angleDeg}°
                  </strong>
                </div>
                <input
                  type="range"
                  min="-25"
                  max="25"
                  step="0.5"
                  value={angleDeg}
                  onChange={(e) => setAngleDeg(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>

              {/* 縦の台形補正 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>↕ 縦の台形(奥/手前)</span>
                  <strong style={{ color: keystoneV !== 0 ? '#c084fc' : '#94a3b8' }}>
                    {keystoneV > 0 ? `+${keystoneV}` : keystoneV}
                  </strong>
                </div>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={keystoneV}
                  onChange={(e) => setKeystoneV(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>

              {/* 横の台形補正 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.73rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>↔ 横の台形(左/右)</span>
                  <strong style={{ color: keystoneH !== 0 ? '#c084fc' : '#94a3b8' }}>
                    {keystoneH > 0 ? `+${keystoneH}` : keystoneH}
                  </strong>
                </div>
                <input
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={keystoneH}
                  onChange={(e) => setKeystoneH(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#a855f7', cursor: 'pointer' }}
                />
              </div>
            </div>
          </div>

          {/* 手動微調整スライダーコントロール */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '12px 14px',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid rgba(255, 255, 255, 0.08)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>
                ✂️ 余白カットの手動調整（最大85%まで大幅に切り取り可能）
              </span>
              {hasActiveSliders && (
                <button
                  type="button"
                  onClick={handleApplyAndContinue}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: '0.73rem',
                    fontWeight: 800,
                    background: 'rgba(16, 185, 129, 0.22)',
                    color: '#6ee7b7',
                    border: '1px solid rgba(16, 185, 129, 0.45)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}
                  title="現在の台形・傾き補正や切り取りを適用してスライダーを0に戻し、さらに細かく追いカットします"
                >
                  <Scissors size={12} />
                  <span>今の位置で確定してさらに追いカット</span>
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>
              {/* 上余白 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>⬆ 上余白カット</span>
                  <strong style={{ color: topInset > 0 ? '#38bdf8' : '#94a3b8' }}>{topInset}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.min(85, 92 - bottomInset)}
                  value={topInset}
                  onChange={(e) => setTopInset(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>

              {/* 下余白 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>⬇ 下余白カット</span>
                  <strong style={{ color: bottomInset > 0 ? '#38bdf8' : '#94a3b8' }}>{bottomInset}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.min(85, 92 - topInset)}
                  value={bottomInset}
                  onChange={(e) => setBottomInset(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>

              {/* 左余白 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>⬅ 左余白カット</span>
                  <strong style={{ color: leftInset > 0 ? '#38bdf8' : '#94a3b8' }}>{leftInset}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.min(85, 92 - rightInset)}
                  value={leftInset}
                  onChange={(e) => setLeftInset(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>

              {/* 右余白 */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#cbd5e1', marginBottom: 4 }}>
                  <span>➡ 右余白カット</span>
                  <strong style={{ color: rightInset > 0 ? '#38bdf8' : '#94a3b8' }}>{rightInset}%</strong>
                </div>
                <input
                  type="range"
                  min="0"
                  max={Math.min(85, 92 - leftInset)}
                  value={rightInset}
                  onChange={(e) => setRightInset(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* クイックカットボタン */}
            <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.06)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>クイック指定:</span>
              {[
                { label: '周囲10%', top: 10, bottom: 10, left: 10, right: 10 },
                { label: '周囲20%', top: 20, bottom: 20, left: 20, right: 20 },
                { label: '上下30%カット', top: 30, bottom: 30, left: 5, right: 5 },
                { label: '下半分カット', top: 0, bottom: 55, left: 0, right: 0 },
                { label: '上半分カット', top: 55, bottom: 0, left: 0, right: 0 },
                { label: '0に戻す', top: 0, bottom: 0, left: 0, right: 0 }
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => {
                    setTopInset(btn.top);
                    setBottomInset(btn.bottom);
                    setLeftInset(btn.left);
                    setRightInset(btn.right);
                  }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 4,
                    fontSize: '0.7rem',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    cursor: 'pointer'
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* フッター */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.9)'
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              color: 'var(--text-muted)',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            キャンセル
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 22px',
              borderRadius: 'var(--radius-sm)',
              background: isSavedSuccess ? '#10b981' : 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              fontSize: '0.88rem',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)'
            }}
          >
            <Check size={18} />
            <span>{isSavedSuccess ? '切り取り完了！' : 'この範囲で切り取り確定＆保存'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
