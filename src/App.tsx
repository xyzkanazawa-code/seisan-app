import { useState, useEffect } from 'react';
import {
  db,
  getOrCreateProfile,
  type Tour,
  type DriverProfile,
  type Receipt
} from './db';
import { Header } from './components/Header';
import { HomeView } from './components/HomeView';
import { TourDetailView } from './components/TourDetailView';
import { ScannerModal } from './components/ScannerModal';
import { BatchReviewModal } from './components/BatchReviewModal';
import { NewTourModal } from './components/NewTourModal';
import { EditTourModal } from './components/EditTourModal';
import { ProfileModal } from './components/ProfileModal';
import { HouseholdConfigModal } from './components/HouseholdConfigModal';
import { GeminiReceiptModal } from './components/GeminiReceiptModal';
import type { ParsedReceiptItem } from './utils/ocrService';
import { applyInvoiceHighlight } from './utils/imageProcessor';
import {
  getAppConfig,
  isAppConfigured,
  type HouseholdAppConfig
} from './utils/configStorage';
import {
  type GeminiReceiptItem,
  mapAiCategoryToExpenseCategory,
  mapAiPaymentMethodToPaymentMethod
} from './utils/geminiOcrService';
import { learnFromReceipt } from './utils/learningService';
import { computeImageHash } from './utils/duplicateChecker';

export function App() {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [appConfig, setAppConfig] = useState<HouseholdAppConfig | null>(null);
  const [activeTour, setActiveTour] = useState<Tour | undefined>(undefined);
  const [recentTours, setRecentTours] = useState<Tour[]>([]);
  const [selectedTour, setSelectedTour] = useState<Tour | null>(null);
  const [editingTour, setEditingTour] = useState<Tour | null>(null);

  // アクティブツアーの集計状態
  const [activeReceiptsCount, setActiveReceiptsCount] = useState<number>(0);
  const [activeTotalExpense, setActiveTotalExpense] = useState<number>(0);
  const [receiptsRefreshKey, setReceiptsRefreshKey] = useState<number>(0);

  // モーダル状態
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scannerEngine, setScannerEngine] = useState<'gemini' | 'standard'>('gemini');
  const [isNewTourOpen, setIsNewTourOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [scannedItemsToReview, setScannedItemsToReview] = useState<ParsedReceiptItem[]>([]);

  // 家計簿初回設定 & Gemini OCRモーダル状態
  const [isHouseholdConfigOpen, setIsHouseholdConfigOpen] = useState(false);
  const [isHouseholdInitialSetup, setIsHouseholdInitialSetup] = useState(false);
  const [isGeminiOcrOpen, setIsGeminiOcrOpen] = useState(false);

  const openScanner = (engine: 'gemini' | 'standard' = 'gemini') => {
    setScannerEngine(engine);
    setIsScannerOpen(true);
  };

  // 初期ロード＆初回設定確認
  useEffect(() => {
    initApp();
  }, []);

  const initApp = async () => {
    // 1. 初回設定（household_app_config）の確認
    const configured = isAppConfigured();
    const config = getAppConfig();
    setAppConfig(config);

    if (!configured) {
      // 設定データが存在しない場合は自動で設定モーダルを表示
      setIsHouseholdInitialSetup(true);
      setIsHouseholdConfigOpen(true);
    }

    // 2. プロファイル読み込み
    const prof = await getOrCreateProfile();
    setProfile(prof);

    // 3. ツアー一覧取得
    await refreshTours();
  };

  const refreshTours = async () => {
    const allTours = await db.tours.orderBy('createdAt').reverse().toArray();

    // デモ用ツアーがまだ1度も投入されておらず0件の場合のみ初期シード
    const hasSeeded = localStorage.getItem('seisan_demo_seeded');
    if (allTours.length === 0 && !hasSeeded) {
      localStorage.setItem('seisan_demo_seeded', 'true');
      await seedDemoData();
      return refreshTours();
    }

    setRecentTours(allTours);
    const active = allTours.find((t) => t.status === 'active');
    setActiveTour(active);

    if (active && active.id) {
      const receipts = await db.receipts.where('tourId').equals(active.id).toArray();
      setActiveReceiptsCount(receipts.length);
      // 前払い金および個人立替の実費合計（前渡金から引き算される対象：ETCのガイド預り金引当分も含む）
      const advanceOutlay = receipts
        .filter((r) =>
          r.category === 'etc'
            ? Boolean(r.etcPaidByGuide)
            : r.paymentMethod === 'advance' || r.paymentMethod === 'cash'
        )
        .reduce((sum, r) => sum + r.amount, 0);
      setActiveTotalExpense(advanceOutlay);
    } else {
      setActiveReceiptsCount(0);
      setActiveTotalExpense(0);
    }
  };

  // 初期デモ用データの投入（ETC利用証明書分割、インボイスハイライト済みレシート）
  const seedDemoData = async () => {
    const today = new Date().toISOString().split('T')[0];
    const demoTour: Tour = {
      code: `T${today.replace(/-/g, '')}-01`,
      title: '秋の日光東照宮・中禅寺湖 団体観光ツアー',
      startDate: today,
      endDate: today,
      status: 'active',
      advancePayment: 30000,
      driverName: '山田 太郎',
      vehicleNumber: '足立200 か 38-92',
      clientCompanyName: 'JTB 団体旅行部',
      clientContactName: '佐藤 添乗員',
      waterLoadedCount: 48,
      waterRemainingCount: 12,
      memo: '配車：東京駅鍛冶橋駐車場 07:30発',
      createdAt: Date.now() - 3600000 * 5,
      updatedAt: Date.now()
    };

    const tourId = await db.tours.add(demoTour);

    // デモ用の模擬レシート画像Canvas生成
    const makeDemoReceiptCanvas = (title: string, amount: number, tNumber?: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 440;
      canvas.height = 360;
      const ctx = canvas.getContext('2d')!;

      // レシート用紙のテクスチャ風背景
      ctx.fillStyle = '#fafafa';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 上部ギザギザ
      ctx.strokeStyle = '#e2e8f0';
      ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);

      ctx.fillStyle = '#1e293b';
      ctx.font = 'bold 20px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(title, canvas.width / 2, 50);

      ctx.font = '14px "Noto Sans JP", sans-serif';
      ctx.fillText(`利用日時: ${today} 11:45`, canvas.width / 2, 85);

      if (tNumber) {
        ctx.fillStyle = '#334155';
        ctx.font = 'bold 15px "Plus Jakarta Sans", sans-serif';
        ctx.fillText(`登録番号: ${tNumber}`, canvas.width / 2, 120);
      }

      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 32px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(`¥${amount.toLocaleString()}`, canvas.width / 2, 190);

      ctx.font = '13px "Noto Sans JP", sans-serif';
      ctx.fillStyle = '#64748b';
      ctx.fillText('上記正に領収いたしました（内税）', canvas.width / 2, 230);

      return canvas.toDataURL('image/jpeg', 0.88);
    };

    const etcImg = makeDemoReceiptCanvas('ETC高速道路利用証明書 (東京→日光)', 4850, 'T8010401023456');
    const highlightedEtcImg = await applyInvoiceHighlight(etcImg);

    const parkImg = makeDemoReceiptCanvas('日光東照宮 観光バス駐車場', 2500, 'T5010001098765');
    const highlightedParkImg = await applyInvoiceHighlight(parkImg);

    const fuelImg = makeDemoReceiptCanvas('ENEOS 日光インター給油所', 18400, 'T1010001012345');
    const highlightedFuelImg = await applyInvoiceHighlight(fuelImg);

    const demoReceipts: Omit<Receipt, 'id'>[] = [
      {
        tourId,
        category: 'etc',
        paymentMethod: 'company_etc',
        date: today,
        amount: 4850,
        place: 'ETC: 東京IC → 日光IC',
        invoiceNumber: 'T8010401023456',
        isInvoiceValid: true,
        hasInvoiceHighlight: true,
        processedImageUrl: highlightedEtcImg,
        etcDetails: { entryGate: '東京', exitGate: '日光', splitIndex: 1 },
        createdAt: Date.now() - 3600000 * 3
      },
      {
        tourId,
        category: 'parking',
        paymentMethod: 'advance',
        date: today,
        amount: 2500,
        place: '日光東照宮 観光バス駐車場',
        invoiceNumber: 'T5010001098765',
        isInvoiceValid: true,
        hasInvoiceHighlight: true,
        processedImageUrl: highlightedParkImg,
        createdAt: Date.now() - 3600000 * 2
      },
      {
        tourId,
        category: 'fuel',
        paymentMethod: 'company_fuel',
        date: today,
        amount: 18400,
        place: 'ENEOS 日光インター給油所 (軽油120L)',
        invoiceNumber: 'T1010001012345',
        isInvoiceValid: true,
        hasInvoiceHighlight: true,
        processedImageUrl: highlightedFuelImg,
        createdAt: Date.now() - 3600000 * 1
      },
      {
        tourId,
        category: 'breakfast',
        paymentMethod: 'advance',
        date: today,
        amount: 850,
        place: 'セブン-イレブン 日光駅前店 (朝食・おにぎり)',
        invoiceNumber: 'T2010001000001',
        isInvoiceValid: true,
        hasInvoiceHighlight: false,
        processedImageUrl: makeDemoReceiptCanvas('セブン-イレブン (朝食代)', 850, 'T2010001000001'),
        createdAt: Date.now() - 3600000 * 4
      },
      {
        tourId,
        category: 'tea',
        paymentMethod: 'advance',
        date: today,
        amount: 320,
        place: 'いろは坂PA 自販機 (乗務員お茶・飲料代)',
        createdAt: Date.now() - 3600000 * 5,
        processedImageUrl: makeDemoReceiptCanvas('PA売店 (お茶代)', 320)
      }
    ];

    await db.receipts.bulkAdd(demoReceipts as Receipt[]);
  };

  // スキャン完了時のハンドラ（確認・編集モーダルへ移行）
  const handleScanCompleted = (items: ParsedReceiptItem[]) => {
    setIsScannerOpen(false);
    if (items.length > 0) {
      setScannedItemsToReview(items);
      setIsReviewOpen(true);
    }
  };

  // 一括確定完了時
  const handleReviewCommitted = async () => {
    await refreshTours();
    setReceiptsRefreshKey((prev) => prev + 1);
  };

  // Gemini OCRレシートを家計簿・精算データとして保存
  const handleSaveGeminiReceipt = async (receiptData: {
    shopName: string;
    date: string;
    time?: string;
    amount: number;
    category: string;
    items: GeminiReceiptItem[];
    receiptImage: string;
    invoiceNumber?: string;
    memo?: string;
    etcType?: 'jissha' | 'kaiso';
    etcPaidByGuide?: boolean;
    etcDetails?: any;
  }) => {
    // 紐付けるツアーを特定（selectedTour または activeTour があればそれを使用、なければ自動作成）
    let targetTourId = selectedTour?.id || activeTour?.id;
    if (!targetTourId) {
      const today = new Date().toISOString().split('T')[0];
      const newTour: Tour = {
        code: `T${today.replace(/-/g, '')}-01`,
        title: `${receiptData.date} 運行経費・精算`,
        startDate: receiptData.date,
        endDate: receiptData.date,
        status: 'active',
        advancePayment: 0,
        driverName: appConfig?.name || profile?.driverName || 'マサ',
        vehicleNumber: profile?.vehicleNumber || '担当車両',
        memo: 'Gemini Flash レシートOCRにより自動生成',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      targetTourId = await db.tours.add(newTour);
    }

    // カテゴリおよび支払方法のマッピング（ETCでガイド預り金とした場合は仮払金: advance として差し引く）
    const mappedCategory = mapAiCategoryToExpenseCategory(receiptData.category);
    const isEtcGuide = mappedCategory === 'etc' && Boolean(receiptData.etcPaidByGuide);
    const mappedPayment = isEtcGuide
      ? 'advance'
      : mapAiPaymentMethodToPaymentMethod(undefined, mappedCategory);

    // 品目メモ（AI読取項目）を生成
    const itemsMemo = receiptData.items.length > 0
      ? `【購入品目】\n` + receiptData.items.map(it => `・${it.name}: ¥${it.price.toLocaleString()}`).join('\n')
      : '';

    const imageHash = await computeImageHash(receiptData.receiptImage);

    const newRecord: Omit<Receipt, 'id'> = {
      tourId: targetTourId,
      category: mappedCategory,
      paymentMethod: mappedPayment,
      date: receiptData.date,
      time: receiptData.time,
      amount: receiptData.amount,
      place: receiptData.shopName,
      invoiceNumber: receiptData.invoiceNumber,
      isInvoiceValid: Boolean(receiptData.invoiceNumber),
      hasInvoiceHighlight: false,
      originalImageUrl: receiptData.receiptImage,
      processedImageUrl: receiptData.receiptImage,
      imageHash,
      etcType: mappedCategory === 'etc' ? (receiptData.etcType || 'jissha') : undefined,
      etcPaidByGuide: mappedCategory === 'etc' ? Boolean(receiptData.etcPaidByGuide) : undefined,
      etcDetails: receiptData.etcDetails,
      memo: receiptData.memo || undefined, // 📝 手打ちで入力した備考
      aiMemo: itemsMemo || undefined,     // 🤖 AIが読み取った品目（別項目）
      createdAt: Date.now()
    };

    await db.receipts.add(newRecord as Receipt);

    // 🧠 Geminiで読み取った店舗名・科目を学習辞書に登録（次回の通常スキャンでも活用可能に）
    await learnFromReceipt({
      place: receiptData.shopName,
      category: mappedCategory,
      paymentMethod: mappedPayment,
      invoiceNumber: receiptData.invoiceNumber,
      source: 'gemini'
    });

    await refreshTours();
    setReceiptsRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="app-container">
      {/* 共通ヘッダー */}
      <Header
        activeTour={activeTour}
        profile={profile || undefined}
        appConfig={appConfig}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenNewTour={() => setIsNewTourOpen(true)}
        onSelectTour={(t) => setSelectedTour(t)}
        onOpenGeminiOcr={() => setIsGeminiOcrOpen(true)}
        onOpenHouseholdConfig={() => {
          setIsHouseholdInitialSetup(false);
          setIsHouseholdConfigOpen(true);
        }}
      />

      {/* メインコンテンツ */}
      <main className="main-content">
        {selectedTour ? (
          <TourDetailView
            tour={selectedTour}
            refreshTrigger={receiptsRefreshKey}
            profile={
              profile || {
                driverName: appConfig?.name || 'マサ',
                staffId: appConfig?.userId || 'D-1048',
                officeName: '東京営業所',
                vehicleNumber: '足立200 か 38-92',
                companyName: '大和観光バス株式会社',
                phoneNumber: '03-3456-7890',
                address: '東京都江東区新木場1-2-3',
                updatedAt: Date.now()
              }
            }
            onBack={() => {
              setSelectedTour(null);
              refreshTours();
            }}
            onOpenScanner={() => openScanner('standard')}
            onOpenGeminiOcr={() => setIsGeminiOcrOpen(true)}
            onTourUpdated={(t) => {
              setSelectedTour(t);
              refreshTours();
            }}
          />
        ) : (
          <HomeView
            activeTour={activeTour}
            recentTours={recentTours}
            profile={
              profile || {
                driverName: appConfig?.name || 'マサ',
                staffId: appConfig?.userId || '',
                officeName: '',
                vehicleNumber: '',
                companyName: '',
                phoneNumber: '',
                address: '',
                updatedAt: Date.now()
              }
            }
            receiptCount={activeReceiptsCount}
            totalExpense={activeTotalExpense}
            onOpenScanner={() => openScanner('standard')}
            onOpenNewTour={() => setIsNewTourOpen(true)}
            onSelectTour={(t) => setSelectedTour(t)}
            onEditTour={(t) => setEditingTour(t)}
            onOpenGeminiOcr={() => setIsGeminiOcrOpen(true)}
          />
        )}
      </main>

      {/* 初回設定 / ユーザー設定モーダル（localStorage: household_app_config） */}
      <HouseholdConfigModal
        isOpen={isHouseholdConfigOpen}
        onClose={() => setIsHouseholdConfigOpen(false)}
        isInitialSetup={isHouseholdInitialSetup}
        onSaved={(cfg) => {
          setAppConfig(cfg);
          refreshTours();
        }}
      />

      {/* Gemini 1.5 Flash レシートOCRモーダル */}
      <GeminiReceiptModal
        isOpen={isGeminiOcrOpen}
        onClose={() => setIsGeminiOcrOpen(false)}
        activeTour={selectedTour || activeTour}
        onOpenSettings={() => {
          setIsGeminiOcrOpen(false);
          setIsHouseholdInitialSetup(false);
          setIsHouseholdConfigOpen(true);
        }}
        onOpenScannerCamera={() => openScanner('gemini')}
        onSaveToExpense={handleSaveGeminiReceipt}
      />

      {/* ツアー編集モーダル（HomeViewなどから呼び出し可能） */}
      {editingTour && (
        <EditTourModal
          isOpen={!!editingTour}
          onClose={() => setEditingTour(null)}
          tour={editingTour}
          onTourUpdated={async (updatedTour) => {
            setEditingTour(null);
            if (selectedTour?.id === updatedTour.id) {
              setSelectedTour(updatedTour);
            }
            await refreshTours();
          }}
        />
      )}

      {/* スキャナーモーダル */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        activeTour={selectedTour || activeTour}
        initialEngine={scannerEngine}
        onScanCompleted={handleScanCompleted}
        onSwitchToGeminiOcr={() => setIsGeminiOcrOpen(true)}
        onOpenSettings={() => {
          setIsScannerOpen(false);
          setIsHouseholdInitialSetup(false);
          setIsHouseholdConfigOpen(true);
        }}
      />

      {/* スキャン確認・編集 ＆ 「全部OK」一括確定モーダル */}
      {(selectedTour || activeTour) && (
        <BatchReviewModal
          isOpen={isReviewOpen}
          onClose={() => setIsReviewOpen(false)}
          activeTour={(selectedTour || activeTour)!}
          initialItems={scannedItemsToReview}
          onCommitted={handleReviewCommitted}
        />
      )}

      {/* 新規ツアー作成モーダル */}
      <NewTourModal
        isOpen={isNewTourOpen}
        onClose={() => setIsNewTourOpen(false)}
        onTourCreated={(t) => {
          refreshTours();
          setSelectedTour(t);
        }}
        profile={profile || undefined}
      />

      {/* 乗務員プロファイルモーダル */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        currentProfile={profile || undefined}
        onProfileUpdated={(p) => setProfile(p)}
      />
    </div>
  );
}
export default App;
