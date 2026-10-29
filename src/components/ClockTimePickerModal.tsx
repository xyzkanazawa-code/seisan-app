import React, { useState, useEffect } from 'react';
import { Clock, Check, X, RotateCcw } from 'lucide-react';

interface ClockTimePickerModalProps {
  isOpen: boolean;
  initialTime?: string; // "HH:mm"
  title?: string;
  onSelect: (time: string) => void;
  onClose: () => void;
  onClear?: () => void;
}

export const ClockTimePickerModal: React.FC<ClockTimePickerModalProps> = ({
  isOpen,
  initialTime,
  title = 'レシートの利用時刻を入力',
  onSelect,
  onClose,
  onClear
}) => {
  const [hour, setHour] = useState<number>(12);
  const [minute, setMinute] = useState<number>(0);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');

  // 初期値のロード
  useEffect(() => {
    if (!isOpen) return;
    if (initialTime && initialTime.includes(':')) {
      const parts = initialTime.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      setHour(isNaN(h) ? 12 : Math.max(0, Math.min(23, h)));
      setMinute(isNaN(m) ? 0 : Math.max(0, Math.min(59, m)));
    } else {
      // 未入力の場合は現在時刻を初期値にセット
      const now = new Date();
      setHour(now.getHours());
      setMinute(now.getMinutes());
    }
    setMode('hour');
  }, [isOpen, initialTime]);

  if (!isOpen) return null;

  const formattedHour = String(hour).padStart(2, '0');
  const formattedMinute = String(minute).padStart(2, '0');
  const timeString = `${formattedHour}:${formattedMinute}`;

  const handleHourClick = (h: number) => {
    setHour(h);
    // 時を選択したら自然に「分」モードへ遷移
    setMode('minute');
  };

  const handleMinuteClick = (m: number) => {
    setMinute(m);
  };

  const adjustMinute = (delta: number) => {
    setMinute((prev) => {
      let next = prev + delta;
      if (next < 0) next = 59;
      if (next > 59) next = 0;
      return next;
    });
  };

  const setNow = () => {
    const now = new Date();
    setHour(now.getHours());
    setMinute(now.getMinutes());
  };

  const handleConfirm = () => {
    onSelect(timeString);
    onClose();
  };

  // 時計盤の計算
  const CLOCK_SIZE = 250;
  const CENTER = CLOCK_SIZE / 2;
  const OUTER_RADIUS = 96;
  const INNER_RADIUS = 62;

  // 1〜12時（外周）と 13〜24/00時（内周）の座標計算
  const hoursOuter = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const hoursInner = [0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

  // 分の5分刻み
  const minutesList = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  // 針の角度計算
  let handAngle = 0;
  let handLength = OUTER_RADIUS;
  if (mode === 'hour') {
    const isInner = hoursInner.includes(hour);
    handLength = isInner ? INNER_RADIUS : OUTER_RADIUS;
    const hourMod12 = hour % 12;
    handAngle = hourMod12 * 30; // 360 / 12 = 30度
  } else {
    handAngle = minute * 6; // 360 / 60 = 6度
    handLength = OUTER_RADIUS;
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: '360px',
          background: '#0d1322',
          border: '1.5px solid rgba(59, 130, 246, 0.4)',
          borderRadius: '24px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6), 0 0 30px rgba(59, 130, 246, 0.2)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'modalSlideUp 0.2s ease-out'
        }}
      >
        {/* ヘッダー */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Clock size={18} color="#60a5fa" />
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#f8fafc' }}>
              {title}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex'
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* 大きなデジタル時刻ディスプレイ（タップで時/分モード切替） */}
        <div
          style={{
            padding: '16px 20px 12px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            background: 'rgba(15, 23, 42, 0.6)'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {/* 時ボタン */}
            <button
              type="button"
              onClick={() => setMode('hour')}
              style={{
                fontFamily: 'var(--font-num, monospace)',
                fontSize: '2.5rem',
                fontWeight: 800,
                color: mode === 'hour' ? '#ffffff' : '#64748b',
                background: mode === 'hour' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                border: mode === 'hour' ? '2px solid #3b82f6' : '2px solid transparent',
                borderRadius: '12px',
                padding: '4px 14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: mode === 'hour' ? '0 0 16px rgba(59, 130, 246, 0.4)' : 'none'
              }}
            >
              {formattedHour}
            </button>

            <span
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: '#60a5fa',
                userSelect: 'none'
              }}
            >
              :
            </span>

            {/* 分ボタン */}
            <button
              type="button"
              onClick={() => setMode('minute')}
              style={{
                fontFamily: 'var(--font-num, monospace)',
                fontSize: '2.5rem',
                fontWeight: 800,
                color: mode === 'minute' ? '#ffffff' : '#64748b',
                background: mode === 'minute' ? 'rgba(59, 130, 246, 0.25)' : 'transparent',
                border: mode === 'minute' ? '2px solid #3b82f6' : '2px solid transparent',
                borderRadius: '12px',
                padding: '4px 14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: mode === 'minute' ? '0 0 16px rgba(59, 130, 246, 0.4)' : 'none'
              }}
            >
              {formattedMinute}
            </button>
          </div>

          <div
            style={{
              fontSize: '0.75rem',
              color: '#94a3b8',
              marginTop: '6px',
              display: 'flex',
              gap: '12px',
              fontWeight: 600
            }}
          >
            <span style={{ color: mode === 'hour' ? '#60a5fa' : '#64748b' }}>
              ● {mode === 'hour' ? '「時」を選択中' : '時'}
            </span>
            <span style={{ color: mode === 'minute' ? '#60a5fa' : '#64748b' }}>
              ● {mode === 'minute' ? '「分」を選択中' : '分'}
            </span>
          </div>
        </div>

        {/* 円形時計盤 (Clock Face) */}
        <div
          style={{
            padding: '16px',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            position: 'relative'
          }}
        >
          <div
            style={{
              width: `${CLOCK_SIZE}px`,
              height: `${CLOCK_SIZE}px`,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(30, 41, 69, 0.8) 0%, rgba(15, 23, 42, 0.95) 100%)',
              border: '2px solid rgba(255, 255, 255, 0.12)',
              position: 'relative',
              boxShadow: 'inset 0 4px 12px rgba(0, 0, 0, 0.5), 0 4px 16px rgba(0, 0, 0, 0.4)',
              userSelect: 'none'
            }}
          >
            {/* 中心軸ピン */}
            <div
              style={{
                position: 'absolute',
                top: `${CENTER - 4}px`,
                left: `${CENTER - 4}px`,
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#60a5fa',
                zIndex: 10,
                boxShadow: '0 0 8px #3b82f6'
              }}
            />

            {/* 時計の針 (Pointer Line) */}
            <div
              style={{
                position: 'absolute',
                top: `${CENTER}px`,
                left: `${CENTER}px`,
                width: `${handLength}px`,
                height: '2px',
                background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
                transformOrigin: '0 0',
                transform: `rotate(${handAngle - 90}deg)`,
                pointerEvents: 'none',
                zIndex: 5,
                transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              {/* 針先端のサークル */}
              <div
                style={{
                  position: 'absolute',
                  right: '-14px',
                  top: '-13px',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'rgba(59, 130, 246, 0.35)',
                  border: '2px solid #60a5fa',
                  boxShadow: '0 0 10px rgba(59, 130, 246, 0.6)'
                }}
              />
            </div>

            {/* モードに応じた数字ボタンの配置 */}
            {mode === 'hour' ? (
              <>
                {/* 外周: 1〜12時 */}
                {hoursOuter.map((h, i) => {
                  const angle = (i * 30 - 60) * (Math.PI / 180);
                  const x = CENTER + OUTER_RADIUS * Math.cos(angle);
                  const y = CENTER + OUTER_RADIUS * Math.sin(angle);
                  const isSelected = hour === h;

                  return (
                    <button
                      key={`h-out-${h}`}
                      type="button"
                      onClick={() => handleHourClick(h)}
                      style={{
                        position: 'absolute',
                        left: `${x}px`,
                        top: `${y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        border: 'none',
                        background: isSelected ? '#3b82f6' : 'transparent',
                        color: isSelected ? '#ffffff' : '#e2e8f0',
                        fontSize: '0.86rem',
                        fontWeight: isSelected ? 800 : 600,
                        fontFamily: 'var(--font-num, sans-serif)',
                        cursor: 'pointer',
                        zIndex: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isSelected ? '0 0 10px #3b82f6' : 'none'
                      }}
                    >
                      {h}
                    </button>
                  );
                })}

                {/* 内周: 13〜24/00時 */}
                {hoursInner.map((h, i) => {
                  const angle = (i * 30 - 60) * (Math.PI / 180);
                  const x = CENTER + INNER_RADIUS * Math.cos(angle);
                  const y = CENTER + INNER_RADIUS * Math.sin(angle);
                  const isSelected = hour === h;

                  return (
                    <button
                      key={`h-in-${h}`}
                      type="button"
                      onClick={() => handleHourClick(h)}
                      style={{
                        position: 'absolute',
                        left: `${x}px`,
                        top: `${y}px`,
                        transform: 'translate(-50%, -50%)',
                        width: '24px',
                        height: '24px',
                        borderRadius: '50%',
                        border: 'none',
                        background: isSelected ? '#2563eb' : 'transparent',
                        color: isSelected ? '#ffffff' : '#94a3b8',
                        fontSize: '0.72rem',
                        fontWeight: isSelected ? 800 : 500,
                        fontFamily: 'var(--font-num, sans-serif)',
                        cursor: 'pointer',
                        zIndex: 8,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isSelected ? '0 0 8px #2563eb' : 'none'
                      }}
                    >
                      {h === 0 ? '00' : h}
                    </button>
                  );
                })}
              </>
            ) : (
              /* 分モード: 00〜55 (5分刻み) */
              minutesList.map((m, i) => {
                const angle = (i * 30 - 60) * (Math.PI / 180);
                const x = CENTER + OUTER_RADIUS * Math.cos(angle);
                const y = CENTER + OUTER_RADIUS * Math.sin(angle);
                const isSelected = minute === m;

                return (
                  <button
                    key={`m-${m}`}
                    type="button"
                    onClick={() => handleMinuteClick(m)}
                    style={{
                      position: 'absolute',
                      left: `${x}px`,
                      top: `${y}px`,
                      transform: 'translate(-50%, -50%)',
                      width: '30px',
                      height: '30px',
                      borderRadius: '50%',
                      border: 'none',
                      background: isSelected ? '#3b82f6' : 'transparent',
                      color: isSelected ? '#ffffff' : '#e2e8f0',
                      fontSize: '0.82rem',
                      fontWeight: isSelected ? 800 : 600,
                      fontFamily: 'var(--font-num, sans-serif)',
                      cursor: 'pointer',
                      zIndex: 8,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isSelected ? '0 0 10px #3b82f6' : 'none'
                    }}
                  >
                    {String(m).padStart(2, '0')}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* 便利なクイック調整ボタン */}
        <div
          style={{
            padding: '4px 16px 12px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          {/* 分モード時の微調整コントロール */}
          {mode === 'minute' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <button
                type="button"
                onClick={() => adjustMinute(-5)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#cbd5e1',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                -5分
              </button>
              <button
                type="button"
                onClick={() => adjustMinute(-1)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#cbd5e1',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                -1分
              </button>
              <span
                style={{
                  fontFamily: 'var(--font-num)',
                  fontWeight: 700,
                  color: '#60a5fa',
                  fontSize: '0.9rem',
                  minWidth: '40px',
                  textAlign: 'center'
                }}
              >
                {formattedMinute}分
              </span>
              <button
                type="button"
                onClick={() => adjustMinute(1)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#cbd5e1',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                +1分
              </button>
              <button
                type="button"
                onClick={() => adjustMinute(5)}
                style={{
                  padding: '4px 8px',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#cbd5e1',
                  fontSize: '0.75rem',
                  cursor: 'pointer'
                }}
              >
                +5分
              </button>
            </div>
          )}

          {/* クイック分ショートカット (:00, :15, :30, :45) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '6px'
            }}
          >
            {[0, 15, 30, 45].map((m) => (
              <button
                key={`quick-m-${m}`}
                type="button"
                onClick={() => {
                  setMinute(m);
                  setMode('minute');
                }}
                style={{
                  padding: '5px 0',
                  borderRadius: '8px',
                  background: minute === m ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                  border: minute === m ? '1px solid rgba(59, 130, 246, 0.5)' : '1px solid rgba(255, 255, 255, 0.08)',
                  color: minute === m ? '#60a5fa' : '#94a3b8',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontFamily: 'var(--font-num)'
                }}
              >
                :{String(m).padStart(2, '0')}
              </button>
            ))}
          </div>
        </div>

        {/* フッターアクションバー */}
        <div
          style={{
            padding: '12px 16px 16px 16px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            background: 'rgba(15, 23, 42, 0.4)'
          }}
        >
          <div style={{ display: 'flex', gap: '6px' }}>
            {/* 現在時刻ボタン */}
            <button
              type="button"
              onClick={setNow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 10px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: '0.78rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              <RotateCcw size={12} />
              現在時刻
            </button>

            {/* クリアボタン */}
            {onClear && (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  onClose();
                }}
                style={{
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                クリア
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: '8px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#94a3b8',
                fontSize: '0.82rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              キャンセル
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'var(--primary, #3b82f6)',
                border: 'none',
                color: '#ffffff',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontWeight: 700,
                boxShadow: '0 0 12px rgba(59, 130, 246, 0.4)'
              }}
            >
              <Check size={16} />
              決定 ({timeString})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
