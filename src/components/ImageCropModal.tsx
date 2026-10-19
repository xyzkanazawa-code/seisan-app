import React, { useState, useEffect } from 'react';
import { X, Check, Scissors, RotateCcw, Sparkles } from 'lucide-react';
import { autoTightCrop, cropImageWithInsets } from '../utils/imageProcessor';

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
      setIsSavedSuccess(false);
    }
  }, [isOpen, imageUrl]);

  // スライダー変更時に、切り取られた結果のプレビュー画像を即時リアルタイム生成
  useEffect(() => {
    if (!isOpen) return;

    if (topInset === 0 && bottomInset === 0 && leftInset === 0 && rightInset === 0) {
      setPreviewImage(baseImage);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const cropped = await cropImageWithInsets(baseImage, {
          top: topInset / 100,
          bottom: bottomInset / 100,
          left: leftInset / 100,
          right: rightInset / 100
        });
        setPreviewImage(cropped);
      } catch (err) {
        console.warn('プレビュー生成失敗:', err);
      }
    }, 60);

    return () => clearTimeout(timer);
  }, [topInset, bottomInset, leftInset, rightInset, baseImage, isOpen]);

  if (!isOpen) return null;

  // 自動余白カットの実行
  const handleAutoTightCrop = async () => {
    setIsProcessing(true);
    try {
      const cropped = await autoTightCrop(previewImage || baseImage);
      setBaseImage(cropped);
      setPreviewImage(cropped);
      setTopInset(0);
      setBottomInset(0);
      setLeftInset(0);
      setRightInset(0);
    } catch (e) {
      console.warn('自動余白カット失敗:', e);
    } finally {
      setIsProcessing(false);
    }
  };

  // リセット
  const handleReset = () => {
    setBaseImage(imageUrl);
    setPreviewImage(imageUrl);
    setTopInset(0);
    setBottomInset(0);
    setLeftInset(0);
    setRightInset(0);
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

  const hasCropChanges = topInset > 0 || bottomInset > 0 || leftInset > 0 || rightInset > 0 || baseImage !== imageUrl;

  return (
    <div className="modal-overlay" style={{ zIndex: 9999, background: 'rgba(0,0,0,0.88)' }}>
      <div
        className="modal-content"
        style={{
          maxWidth: '560px',
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
            <span>レシートの余白切り取り調整</span>
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
              onClick={handleAutoTightCrop}
              disabled={isProcessing}
              style={{
                flex: 1,
                minWidth: '150px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37, 99, 235, 0.3)'
              }}
            >
              <Sparkles size={15} color="#fef08a" />
              <span>余白を自動カット</span>
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={isProcessing || !hasCropChanges}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '9px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255, 255, 255, 0.08)',
                color: hasCropChanges ? '#ffffff' : 'var(--text-muted)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: '0.8rem',
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
              height: '310px',
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
              {hasCropChanges ? '✂️ 切り取り後の仕上がりプレビュー' : '切り取り前（原本）'}
            </div>

            {hasCropChanges && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 8,
                  right: 8,
                  padding: '3px 10px',
                  borderRadius: 'var(--radius-full)',
                  background: 'rgba(0, 0, 0, 0.75)',
                  color: '#38bdf8',
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  border: '1px solid rgba(56, 189, 248, 0.3)'
                }}
              >
                カット量: 上{topInset}% 下{bottomInset}% 左{leftInset}% 右{rightInset}%
              </div>
            )}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0' }}>
                余白カットの手動微調整（スライダーで上下左右をカット）
              </span>
              <span style={{ fontSize: '0.72rem', color: '#38bdf8' }}>
                ※動かすと即座に切り取られます
              </span>
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
                  max="45"
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
                  max="45"
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
                  max="45"
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
                  max="45"
                  value={rightInset}
                  onChange={(e) => setRightInset(Number(e.target.value))}
                  style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                />
              </div>
            </div>

            {/* クイック均等カットボタン */}
            <div style={{ display: 'flex', gap: 6, paddingTop: 6, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', alignSelf: 'center' }}>クイック指定:</span>
              {[
                { label: '周囲5%', val: 5 },
                { label: '周囲10%', val: 10 },
                { label: '周囲15%', val: 15 },
                { label: 'リセット', val: 0 }
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={() => {
                    setTopInset(btn.val);
                    setBottomInset(btn.val);
                    setLeftInset(btn.val);
                    setRightInset(btn.val);
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
