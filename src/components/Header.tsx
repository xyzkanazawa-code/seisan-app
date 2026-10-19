import React from 'react';
import { Bus, User, PlusCircle, Sparkles, Settings } from 'lucide-react';
import type { Tour, DriverProfile } from '../db';
import type { HouseholdAppConfig } from '../utils/configStorage';

interface HeaderProps {
  activeTour?: Tour;
  profile?: DriverProfile;
  appConfig?: HouseholdAppConfig | null;
  onOpenProfile: () => void;
  onOpenNewTour: () => void;
  onSelectTour: (tour: Tour) => void;
  onOpenGeminiOcr: () => void;
  onOpenHouseholdConfig: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTour,
  profile,
  appConfig,
  onOpenProfile,
  onOpenNewTour,
  onSelectTour,
  onOpenGeminiOcr,
  onOpenHouseholdConfig
}) => {
  const displayName = appConfig?.name || profile?.driverName || 'マサ';

  return (
    <header className="app-header">
      <div className="brand-title" onClick={() => activeTour && onSelectTour(activeTour)}>
        <div className="brand-icon">
          <Bus size={22} />
        </div>
        <div>
          <div>バス精算プロ</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            乗務員: {displayName}
            {appConfig?.userId ? ` (@${appConfig.userId})` : ''}
          </div>
        </div>
      </div>

      <div className="header-actions">
        {/* Gemini OCR 起動ボタン */}
        <button
          className="icon-btn"
          onClick={onOpenGeminiOcr}
          title="Gemini 1.5 Flash レシートOCR"
          aria-label="Gemini レシートOCR"
          style={{
            background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.25))',
            borderColor: 'rgba(99, 102, 241, 0.5)',
            color: '#a5b4fc'
          }}
        >
          <Sparkles size={19} />
        </button>

        {/* 新規ツアー作成ボタン */}
        <button
          className="icon-btn"
          onClick={onOpenNewTour}
          title="新規ツアー作成"
          aria-label="新規ツアー作成"
        >
          <PlusCircle size={20} />
        </button>

        {/* 家計簿・APIキー設定ボタン（いつでも再編集可能） */}
        <button
          className="icon-btn"
          onClick={onOpenHouseholdConfig}
          title="初期設定・Gemini APIキー編集"
          aria-label="設定"
        >
          <Settings size={19} />
        </button>

        {/* 乗務員プロファイルボタン */}
        <button
          className="icon-btn"
          onClick={onOpenProfile}
          title="乗務員プロファイル設定"
          aria-label="乗務員設定"
        >
          <User size={19} />
        </button>
      </div>
    </header>
  );
};

