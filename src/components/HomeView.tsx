import React from 'react';
import {
  Camera,
  Calendar,
  ChevronRight,
  PlusCircle,
  Bus,
  Clock,
  Sparkles,
  Edit3
} from 'lucide-react';
import type { Tour, DriverProfile } from '../db';

interface HomeViewProps {
  activeTour?: Tour;
  recentTours: Tour[];
  profile?: DriverProfile;
  receiptCount: number;
  totalExpense: number;
  onOpenScanner: () => void;
  onOpenNewTour: () => void;
  onSelectTour: (tour: Tour) => void;
  onEditTour?: (tour: Tour) => void;
  onOpenGeminiOcr?: () => void;
}

export const HomeView: React.FC<HomeViewProps> = ({
  activeTour,
  recentTours,
  receiptCount,
  totalExpense,
  onOpenScanner,
  onOpenNewTour,
  onSelectTour,
  onEditTour,
  onOpenGeminiOcr
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 進行中ツアーがあれば表示、なければ新規ツアー作成案内 */}
      {activeTour ? (
        <div className="active-tour-card" onClick={() => onSelectTour(activeTour)} style={{ cursor: 'pointer' }}>
          <div className="tour-header" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tour-badge badge-active">
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34d399', display: 'inline-block' }} />
                現在運行中
              </span>
              <span className="tour-code">{activeTour.code}</span>
            </div>

            {onEditTour && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTour(activeTour);
                }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  background: 'rgba(59, 130, 246, 0.15)',
                  color: '#60a5fa',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer'
                }}
                title="ツアーコード・名称・前渡金の訂正"
              >
                <Edit3 size={12} />
                情報訂正
              </button>
            )}
          </div>

          <div className="tour-title" style={{ marginTop: 6 }}>
            {activeTour.title || '運行経費精算'}
          </div>

          {(activeTour.clientCompanyName || activeTour.clientContactName) && (
            <div style={{ fontSize: '0.78rem', color: '#93c5fd', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
              <span>発注元: {activeTour.clientCompanyName || '会社名未設定'}</span>
              {activeTour.clientContactName && (
                <span>(担当: {activeTour.clientContactName})</span>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={14} />
              {activeTour.startDate}
            </span>
            <span>•</span>
            <span>登録済: {receiptCount} 枚</span>
          </div>

          {/* 会計サマリー */}
          <div className="finance-grid">
            <div className="finance-item">
              <span className="finance-label">前渡金</span>
              <span className="finance-value val-primary">
                ¥{activeTour.advancePayment.toLocaleString()}
              </span>
            </div>

            <div className="finance-item">
              <span className="finance-label">実費合計</span>
              <span className="finance-value val-amber">
                ¥{totalExpense.toLocaleString()}
              </span>
            </div>

            <div className="finance-item">
              <span className="finance-label">差引残金</span>
              <span className="finance-value val-green">
                ¥{(activeTour.advancePayment - totalExpense).toLocaleString()}
              </span>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 4,
              fontSize: '0.78rem',
              color: 'var(--primary)',
              fontWeight: 700
            }}
          >
            詳細・集計・PDF出力を見る
            <ChevronRight size={16} />
          </div>
        </div>
      ) : (
        <div
          className="glass-card"
          style={{
            padding: 24,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            background: 'linear-gradient(145deg, #152038 0%, #101728 100%)'
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--radius-full)',
              background: 'rgba(59, 130, 246, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)'
            }}
          >
            <Bus size={28} />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', marginBottom: 4 }}>
              運行中のツアーがありません
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              運行指示書をスキャンするか、ツアーコードを入力して運行を開始してください。
            </div>
          </div>

          <button
            className="btn-primary"
            style={{ marginTop: 8, padding: '0 24px' }}
            onClick={onOpenNewTour}
          >
            <PlusCircle size={18} />
            新しいツアーを開始
          </button>
        </div>
      )}

      {/* スキャン＆AIレシートOCRセクション */}
      {/* スキャン＆AIレシートOCRセクション（縦並び2段：両方フルサイズ100%） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* 1. Gemini 1.5 Flash レシートOCRボタン */}
        {onOpenGeminiOcr && (
          <button
            type="button"
            className="giant-gemini-btn"
            onClick={onOpenGeminiOcr}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-start',
              gap: 16,
              padding: '16px 20px',
              borderRadius: 'var(--radius-lg)',
              boxSizing: 'border-box'
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 'var(--radius-md)',
                background: 'rgba(255, 255, 255, 0.22)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <Sparkles size={26} color="#fef08a" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ffffff' }}>
                Gemini AI レシート読取
              </div>
              <div style={{ fontSize: '0.75rem', color: '#e0e7ff', fontWeight: 600 }}>
                高精度AI解析・品目明細・手書きも自動抽出
              </div>
            </div>
          </button>
        )}

        {/* 2. 通常の高速バッチスキャンボタン */}
        <button
          type="button"
          className="giant-scan-btn"
          onClick={onOpenScanner}
          disabled={!activeTour}
          style={{
            width: '100%',
            maxWidth: '100%',
            opacity: activeTour ? 1 : 0.6,
            filter: activeTour ? 'none' : 'grayscale(0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 16,
            padding: '16px 20px',
            borderRadius: 'var(--radius-lg)',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 'var(--radius-md)',
              background: 'rgba(255, 255, 255, 0.22)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            <Camera size={26} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#ffffff' }}>
              通常カメラスキャン
            </div>
            <div style={{ fontSize: '0.75rem', color: '#bfdbfe', fontWeight: 600 }}>
              連続撮影・高速OCR・インボイスT番号自動検出
            </div>
          </div>
        </button>

        <div className="giant-scan-subtext" style={{ textAlign: 'center', justifyContent: 'center' }}>
          <Sparkles size={14} color="var(--accent-amber)" />
          <span>Gemini 1.5 Flash 高精度AI ＆ 高速連続カメラスキャン 両対応</span>
        </div>
      </div>

      {/* 過去・完了済みのツアー履歴 */}
      {recentTours.length > 0 && (
        <div>
          <div
            style={{
              fontSize: '0.92rem',
              fontWeight: 800,
              marginBottom: 10,
              color: 'var(--text-main)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            <Clock size={16} color="var(--text-muted)" />
            最近の運行ツアー履歴
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {recentTours.map((t) => (
              <div
                key={t.id}
                className="glass-card"
                onClick={() => onSelectTour(t)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  cursor: 'pointer'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span className="tour-code" style={{ fontSize: '0.95rem' }}>
                      {t.code}
                    </span>
                    <span
                      className={`tour-badge ${
                        t.status === 'active' ? 'badge-active' : 'badge-completed'
                      }`}
                      style={{ fontSize: '0.68rem', padding: '2px 6px' }}
                    >
                      {t.status === 'active' ? '進行中' : '完了'}
                    </span>
                  </div>

                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {t.title || '運行経費'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-sub)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>運行日: {t.startDate}</span>
                    {t.clientCompanyName && <span>• {t.clientCompanyName}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {onEditTour && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTour(t);
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        background: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4
                      }}
                      title="ツアー情報の訂正"
                    >
                      <Edit3 size={12} />
                      訂正
                    </button>
                  )}
                  <ChevronRight size={18} color="var(--text-sub)" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
