import React, { useState, useEffect } from 'react';
import { X, Check, UserCircle, Truck, Building, Hash, Trash2, Phone, MapPin } from 'lucide-react';
import { db, type DriverProfile } from '../db';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProfileUpdated: (profile: DriverProfile) => void;
  currentProfile?: DriverProfile;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  onProfileUpdated,
  currentProfile
}) => {
  const [driverName, setDriverName] = useState('');
  const [staffId, setStaffId] = useState('');
  const [officeName, setOfficeName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');

  useEffect(() => {
    if (currentProfile) {
      setDriverName(currentProfile.driverName || '');
      setStaffId(currentProfile.staffId || '');
      setOfficeName(currentProfile.officeName || '');
      setVehicleNumber(currentProfile.vehicleNumber || '');
      setCompanyName(currentProfile.companyName || '');
      setPhoneNumber(currentProfile.phoneNumber || '');
      setAddress(currentProfile.address || '');
    }
  }, [currentProfile, isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const updated: DriverProfile = {
      id: currentProfile?.id,
      driverName: driverName.trim() || '乗務員',
      staffId: staffId.trim() || 'D-0001',
      officeName: officeName.trim() || '本社営業所',
      vehicleNumber: vehicleNumber.trim() || '品川200 か 12-34',
      companyName: companyName.trim() || '観光バス株式会社',
      phoneNumber: phoneNumber.trim() || '',
      address: address.trim() || '',
      updatedAt: Date.now()
    };

    if (currentProfile?.id) {
      await db.profiles.update(currentProfile.id, updated);
    } else {
      const id = await db.profiles.add(updated);
      updated.id = id;
    }

    onProfileUpdated(updated);
    onClose();
  };

  const inputStyle: React.CSSProperties = {
    color: '#ffffff',
    backgroundColor: '#1a2238',
    borderColor: '#37476c',
    fontSize: '0.95rem',
    fontWeight: 600,
    width: '100%'
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 500 }}>
        <div className="modal-header">
          <div className="modal-title">
            <UserCircle size={22} color="var(--primary)" />
            乗務員・会社プロファイル設定
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={handleSave}
              className="btn-primary"
              style={{
                height: 36,
                padding: '0 14px',
                fontSize: '0.84rem',
                borderRadius: 'var(--radius-sm)'
              }}
            >
              保存
            </button>
            <button className="icon-btn" onClick={onClose} title="閉じる">
              <X size={18} />
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              一度入力して保存すると、次回から自動で設定されます。精算書PDFの表紙や社名欄に自動印字されます。
            </p>

            {/* 運転手の会社名（自社名） */}
            <div className="form-group">
              <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <Building size={15} color="var(--primary)" />
                所属会社名（運転手の会社名）*
              </label>
              <input
                type="text"
                className="form-input"
                style={inputStyle}
                placeholder="例: 大和観光バス株式会社"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </div>

            {/* 自社電話番号 & 住所 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Phone size={15} color="var(--primary)" />
                  電話番号（会社または連絡先）
                </label>
                <input
                  type="tel"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: 03-3456-7890"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <MapPin size={15} color="var(--primary)" />
                  住所・所在地（会社または営業所）
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: 東京都江東区新木場1-2-3"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>
            </div>

            {/* 乗務員氏名 & 社員番号 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <UserCircle size={15} />
                  乗務員氏名 *
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: 山田 太郎"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Hash size={15} />
                  社員番号
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: D-1048"
                  value={staffId}
                  onChange={(e) => setStaffId(e.target.value)}
                />
              </div>
            </div>

            {/* 所属営業所 & 車両番号 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Building size={15} />
                  所属営業所
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: 東京営業所"
                  value={officeName}
                  onChange={(e) => setOfficeName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Truck size={15} />
                  担当車両番号 *
                </label>
                <input
                  type="text"
                  className="form-input"
                  style={inputStyle}
                  placeholder="例: 足立200 か 38-92"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* データ初期化（デモデータ消去）エリア */}
            <div style={{ marginTop: 10, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                初期デモデータ（日光ツアーサンプル）を消去して初期化する場合：
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (window.confirm('初期デモデータ（すべてのツアーとレシート）を完全に消去してリセットしますか？')) {
                    await db.receipts.clear();
                    await db.tours.clear();
                    localStorage.setItem('seisan_demo_seeded', 'true');
                    window.location.reload();
                  }
                }}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'rgba(239, 68, 68, 0.12)',
                  color: '#f87171',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6
                }}
              >
                <Trash2 size={14} />
                デモデータ（ツアー・レシート）を全消去してリセット
              </button>
            </div>
          </div>

          <div
            className="modal-footer"
            style={{
              flexShrink: 0,
              padding: '14px 20px',
              borderTop: '1px solid var(--border-color)',
              background: '#0d1322',
              display: 'flex',
              gap: 12
            }}
          >
            <button
              type="button"
              className="btn-secondary"
              style={{ height: 48, padding: '0 20px', fontSize: '0.9rem' }}
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              type="submit"
              className="btn-primary"
              style={{
                height: 48,
                fontSize: '1rem',
                fontWeight: 800,
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
              }}
            >
              <Check size={18} />
              設定を保存する
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
