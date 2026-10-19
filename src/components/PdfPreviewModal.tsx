import React, { useState, useEffect } from 'react';
import {
  X,
  Share2,
  Download,
  FileCheck,
  CheckCircle,
  ExternalLink,
  Eye,
  FileText
} from 'lucide-react';
import {
  shareOrSendPdf,
  type PdfGenerationResult
} from '../utils/pdfGenerator';
import type { Tour, DriverProfile } from '../db';

interface PdfPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfResult: PdfGenerationResult | null;
  tour: Tour;
  profile: DriverProfile;
}

export const PdfPreviewModal: React.FC<PdfPreviewModalProps> = ({
  isOpen,
  onClose,
  pdfResult,
  tour,
  profile
}) => {
  const [isSharing, setIsSharing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [blobUrl, setBlobUrl] = useState<string>('');
  // 表示モード: 'summary'（現行鑑表）または 'daily_sample'（新日別集計サンプル）または 'pdf'（全ページPDF）
  const [viewMode, setViewMode] = useState<'summary' | 'daily_sample' | 'pdf'>('daily_sample');

  // Blob URL の生成とクリーンアップ
  useEffect(() => {
    if (!pdfResult?.blob) {
      setBlobUrl('');
      return;
    }
    const url = URL.createObjectURL(pdfResult.blob);
    setBlobUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [pdfResult]);

  if (!isOpen || !pdfResult) return null;

  // 別タブまたはスマホの標準PDFアプリで直接開く
  const handleOpenExternal = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    }
  };

  const handleShare = async () => {
    setIsSharing(true);
    setStatusMessage('');
    try {
      const res = await shareOrSendPdf(pdfResult, tour, profile);
      if (res.method === 'share') {
        setStatusMessage('共有シートを起動しました。メールアプリを選択して送信してください。');
      } else {
        setStatusMessage('PDFを保存し、メールアプリ起動用リンクを開きました。');
      }
    } catch (err) {
      console.error('共有エラー:', err);
      setStatusMessage('共有処理中にエラーが発生しました。直接ダウンロードをお試しください。');
    } finally {
      setIsSharing(false);
    }
  };

  const handleDirectDownload = () => {
    const url = blobUrl || URL.createObjectURL(pdfResult.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pdfResult.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatusMessage(`「${pdfResult.fileName}」を端末にダウンロードしました。`);
  };

  return (
    <div className="modal-overlay" style={{ alignItems: 'center', padding: 12 }}>
      <div
        className="modal-content"
        style={{
          height: '92dvh',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* ヘッダー */}
        <div className="modal-header" style={{ paddingBottom: 10 }}>
          <div>
            <div className="modal-title">
              <FileCheck size={20} color="var(--primary)" />
              運行経費精算書 プレビュー
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              {pdfResult.fileName}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* タブ切り替え & 別タブで開くバー */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 16px',
            background: 'rgba(15, 23, 42, 0.6)',
            borderBottom: '1px solid var(--border-color)',
            flexWrap: 'wrap'
          }}
        >
          {/* 表示切替タブ */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setViewMode('daily_sample')}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: viewMode === 'daily_sample' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.08)',
                color: viewMode === 'daily_sample' ? '#ffffff' : 'var(--text-muted)'
              }}
            >
              <Eye size={14} />
              ★ 新案: 日別集計サンプル (画像)
            </button>

            <button
              type="button"
              onClick={() => setViewMode('summary')}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: viewMode === 'summary' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.08)',
                color: viewMode === 'summary' ? '#ffffff' : 'var(--text-muted)'
              }}
            >
              <Eye size={14} />
              現行鑑表 (画像)
            </button>

            <button
              type="button"
              onClick={() => setViewMode('pdf')}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                background: viewMode === 'pdf' ? 'var(--primary)' : 'rgba(255, 255, 255, 0.08)',
                color: viewMode === 'pdf' ? '#ffffff' : 'var(--text-muted)'
              }}
            >
              <FileText size={14} />
              全ページPDF
            </button>
          </div>

          {/* 別タブ/外部ビューアで開くボタン */}
          <button
            type="button"
            onClick={handleOpenExternal}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              fontWeight: 700,
              background: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#93c5fd',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}
            title="スマホのPDFビューアや別タブで全画面表示"
          >
            <ExternalLink size={13} />
            全画面で開く
          </button>
        </div>

        {/* プレビュー本体 */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: '#1e293b',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'flex-start'
          }}
        >
          {viewMode === 'daily_sample' ? (
            /* 送付画像フォーマットに基づく日別集計表サンプル */
            pdfResult.dailySummaryPreviewUrl ? (
              <div
                style={{
                  width: '100%',
                  padding: 12,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10
                }}
              >
                <div
                  style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.35)',
                    borderRadius: 'var(--radius-md)',
                    padding: '8px 14px',
                    fontSize: '0.76rem',
                    color: '#bfdbfe',
                    textAlign: 'center',
                    maxWidth: 800,
                    lineHeight: 1.5
                  }}
                >
                  ✨ <strong>【新案 日別項目別集計表 サンプル】</strong><br />
                  送付いただいた「全日本交通 清算書」のフォーマットに基づき、1日ごとの項目別集計（預り金・高速実車/回送・給油・有料道・駐車・食事・宿泊等）をA4横向きで構成したサンプルです。
                </div>

                <div style={{ width: '100%', overflowX: 'auto', textAlign: 'center' }}>
                  <img
                    src={pdfResult.dailySummaryPreviewUrl}
                    alt="新案 日別集計表サンプル"
                    style={{
                      width: '100%',
                      maxWidth: 960,
                      borderRadius: 8,
                      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
                      background: '#ffffff',
                      display: 'inline-block'
                    }}
                  />
                </div>

                {/* サンプル画像保存ボタン */}
                <a
                  href={pdfResult.dailySummaryPreviewUrl}
                  download={`${tour.code}_日別集計表_サンプル.jpg`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid var(--border-color)',
                    color: '#ffffff',
                    fontSize: '0.78rem',
                    textDecoration: 'none',
                    fontWeight: 600,
                    marginBottom: 12
                  }}
                >
                  <Download size={14} />
                  日別集計サンプル画像を保存
                </a>
              </div>
            ) : (
              <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>
                日別集計サンプル画像がありません
              </div>
            )
          ) : viewMode === 'summary' ? (
            /* 鑑表（画像）プレビュー：全スマホ環境で100%確実に表示可能 */
            pdfResult.summaryPreviewUrl ? (
              <div
                style={{
                  width: '100%',
                  padding: 12,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <div
                  style={{
                    fontSize: '0.72rem',
                    color: '#94a3b8',
                    textAlign: 'center'
                  }}
                >
                  💡 鑑表（項目別集計）の確認用プレビューです。駐車場代・有料道路代・飲食お茶代等の項目別A4貼付台紙（小レシート12枚・手書き4枚原寸配置）を含む全ページの確認は「全ページPDF」または「全画面で開く」をご利用ください。
                </div>
                <img
                  src={pdfResult.summaryPreviewUrl}
                  alt="鑑表プレビュー"
                  style={{
                    width: '100%',
                    maxWidth: 700,
                    borderRadius: 8,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
                    background: '#ffffff'
                  }}
                />
              </div>
            ) : (
              <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>
                鑑表プレビュー画像がありません
              </div>
            )
          ) : (
            /* 全ページPDF表示（iframe / Blob URL） */
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              {blobUrl ? (
                <iframe
                  src={blobUrl}
                  title="精算書PDF"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 'none',
                    display: 'block'
                  }}
                />
              ) : (
                <div style={{ color: '#94a3b8', padding: 40, textAlign: 'center' }}>
                  PDFを読み込み中...
                </div>
              )}
              {/* スマホ等でPDFが表示されない場合のフローティング案内 */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 12,
                  left: 12,
                  right: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  fontSize: '0.72rem',
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8
                }}
              >
                <span>⚠️ スマホ等で画面が白い場合は右ボタンを押してください</span>
                <button
                  type="button"
                  onClick={handleOpenExternal}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 4,
                    background: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap'
                  }}
                >
                  全画面表示
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ステータスメッセージ */}
        {statusMessage && (
          <div
            style={{
              padding: '8px 16px',
              background: 'rgba(16, 185, 129, 0.15)',
              borderTop: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              fontSize: '0.78rem',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <CheckCircle size={14} />
            {statusMessage}
          </div>
        )}

        {/* アクションフッター */}
        <div className="modal-footer" style={{ gap: 10 }}>
          <button
            className="btn-secondary"
            onClick={handleDirectDownload}
            style={{ flex: '0 0 auto', padding: '0 16px' }}
            title="端末に直接保存"
          >
            <Download size={18} />
            保存
          </button>

          <button
            className="btn-primary"
            onClick={handleShare}
            disabled={isSharing}
            style={{ flex: 1 }}
          >
            <Share2 size={18} />
            {isSharing ? '連携中...' : 'Gmail・メール送信 (共有Intent)'}
          </button>
        </div>
      </div>
    </div>
  );
};

