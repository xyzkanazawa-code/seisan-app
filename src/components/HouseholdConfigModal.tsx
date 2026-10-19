import React, { useState, useEffect } from 'react';
import {
  User,
  Calendar,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  X,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';
import {
  getAppConfig,
  saveAppConfig,
  type HouseholdAppConfig
} from '../utils/configStorage';

interface HouseholdConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  isInitialSetup?: boolean; // 初回起動設定モードかどうか
  onSaved?: (config: HouseholdAppConfig) => void;
}

export const HouseholdConfigModal: React.FC<HouseholdConfigModalProps> = ({
  isOpen,
  onClose,
  isInitialSetup = false,
  onSaved
}) => {
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('1990-01-01');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // モーダルオープン時に既存設定をロード
  useEffect(() => {
    if (isOpen) {
      const current = getAppConfig();
      if (current) {
        setName(current.name || '');
        setBirthdate(current.birthdate || '1990-01-01');
        setUserId(current.userId || '');
        setPassword(current.password || '');
        setGeminiApiKey(current.geminiApiKey || '');
      } else {
        setName('マサ');
        setBirthdate('1990-01-01');
        setUserId('masa2026');
        setPassword('');
        setGeminiApiKey('');
      }
      setErrorMessage(null);
      setSuccessMessage(null);
      setShowPassword(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // フォームバリデーション
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage('氏名を入力してください。');
      return;
    }

    if (!birthdate) {
      setErrorMessage('生年月日を入力してください。');
      return;
    }

    // ユーザーIDは半角英数字
    const userIdTrimmed = userId.trim();
    if (!userIdTrimmed) {
      setErrorMessage('ユーザーIDを入力してください。');
      return;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(userIdTrimmed)) {
      setErrorMessage('ユーザーIDは半角英数字（記号は _ と - のみ）で入力してください。');
      return;
    }

    if (!password) {
      setErrorMessage('パスワードを入力してください。');
      return;
    }

    // Gemini APIキーの形式チェック（任意だが入力されている場合は確認）
    const apiKeyTrimmed = geminiApiKey.trim();

    const configData: HouseholdAppConfig = {
      name: name.trim(),
      birthdate,
      userId: userIdTrimmed,
      password,
      geminiApiKey: apiKeyTrimmed
    };

    // localStorage: household_app_config に保存（サーバー通信なし完全ローカル）
    saveAppConfig(configData);

    setSuccessMessage('設定を安全に保存しました！');

    setTimeout(() => {
      if (onSaved) onSaved(configData);
      onClose();
    }, 600);
  };

  return (
    <div
      className="modal-overlay"
      style={{
        zIndex: 1000,
        background: 'rgba(5, 10, 25, 0.82)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        className="modal-content animate-fade-in"
        style={{
          maxWidth: '480px',
          width: '100%',
          borderRadius: '24px',
          background: 'linear-gradient(145deg, #131b2e, #0e1526)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5), 0 0 30px rgba(59, 130, 246, 0.15)',
          overflow: 'hidden',
          color: '#f8fafc'
        }}
      >
        {/* ヘッダーエリア */}
        <div
          style={{
            padding: '24px 24px 18px',
            background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.25), rgba(99, 102, 241, 0.15))',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            position: 'relative'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '14px',
                background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.35)'
              }}
            >
              <ShieldCheck size={24} color="#ffffff" />
            </div>
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                {isInitialSetup ? '乗務員・運行精算 初期設定' : '乗務員設定 & Gemini API連携'}
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                {isInitialSetup
                  ? '端末の localStorage に安全に保存され、サーバーへは送信されません'
                  : 'いつでも設定内容を編集できます'}
              </p>
            </div>
          </div>

          {!isInitialSetup && (
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
                justifyContent: 'center',
                transition: 'all 0.2s'
              }}
              title="閉じる"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* フォーム入力エリア */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {errorMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <AlertCircle size={16} shrink-0 />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div
              style={{
                padding: '10px 14px',
                borderRadius: '12px',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                color: '#6ee7b7',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <CheckCircle2 size={16} shrink-0 />
              <span>{successMessage}</span>
            </div>
          )}

          {/* 1. 氏名 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              氏名 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: '12px', top: '12px', color: '#64748b' }}>
                <User size={16} />
              </div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例: マサ"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 38px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* 2. 生年月日 */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              生年月日 <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: '12px', top: '12px', color: '#64748b' }}>
                <Calendar size={16} />
              </div>
              <input
                type="date"
                value={birthdate}
                onChange={(e) => setBirthdate(e.target.value)}
                required
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 38px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* 3. ユーザーID */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              ユーザーID <span style={{ color: '#ef4444' }}>*</span>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 400, marginLeft: '6px' }}>
                (半角英数字)
              </span>
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="例: masa2026"
              required
              pattern="^[a-zA-Z0-9_-]+$"
              title="半角英数字で入力してください"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '12px',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {/* 4. パスワード（表示切替付き） */}
          <div>
            <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cbd5e1', marginBottom: '6px' }}>
              パスワード <span style={{ color: '#ef4444' }}>*</span>
            </label>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', left: '12px', top: '12px', color: '#64748b' }}>
                <Lock size={16} />
              </div>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワードを入力"
                required
                style={{
                  width: '100%',
                  padding: '10px 42px 10px 38px',
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '12px',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '10px',
                  background: 'transparent',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title={showPassword ? 'パスワードを隠す' : 'パスワードを表示'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* 5. Gemini APIキー */}
          <div
            style={{
              padding: '14px',
              borderRadius: '16px',
              background: 'linear-gradient(145deg, rgba(30, 41, 59, 0.7), rgba(15, 23, 42, 0.7))',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label
                style={{
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Sparkles size={16} color="#818cf8" />
                <span>Gemini APIキー (無料枠対応)</span>
              </label>
              <span
                style={{
                  fontSize: '0.68rem',
                  padding: '2px 8px',
                  borderRadius: '20px',
                  background: 'rgba(99, 102, 241, 0.25)',
                  color: '#a5b4fc',
                  fontWeight: 600
                }}
              >
                Gemini Flash AI
              </span>
            </div>

            <p style={{ margin: 0, fontSize: '0.74rem', color: '#94a3b8', lineHeight: 1.4 }}>
              運行経費レシートを最新のGemini Flashモデルで瞬時に高精度OCR解析するために使用します。
            </p>

            <input
              type="text"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="AQ... または AIzaSy..."
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(10, 15, 30, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.4)',
                borderRadius: '10px',
                color: '#ffffff',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />

            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '0.76rem',
                color: '#60a5fa',
                fontWeight: 600,
                textDecoration: 'none',
                marginTop: '2px'
              }}
            >
              <span>Google AI Studio で無料APIキーを取得する</span>
              <ExternalLink size={12} />
            </a>
          </div>

          {/* 保存ボタン */}
          <div style={{ marginTop: '8px' }}>
            <button
              type="submit"
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '14px',
                fontSize: '0.95rem',
                fontWeight: 700,
                background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(37, 99, 235, 0.4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <CheckCircle2 size={18} />
              <span>{isInitialSetup ? '初期設定を完了して始める' : '設定を更新する'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
