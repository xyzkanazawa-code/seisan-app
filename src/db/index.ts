import Dexie, { type Table } from 'dexie';

export type ExpenseCategory =
  | 'etc'
  | 'parking'
  | 'fuel'
  | 'taxi'
  | 'lodging'
  | 'toll'
  | 'breakfast'
  | 'lunch'
  | 'night_meal'
  | 'tea'
  | 'water'
  | 'overtime'
  | 'other';
export type PaymentMethod =
  | 'advance'       // 前払い金（仮払金から支払）
  | 'cash'          // 自腹・個人立替
  | 'company_etc'   // 会社ETCカード
  | 'company_fuel'  // 燃料掛けカード
  | 'company_card'; // 会社カード
export type TourStatus = 'active' | 'completed';

export interface Tour {
  id?: number;
  code: string;               // ツアー（運行）コード
  title: string;              // ツアー名・運行名称
  startDate: string;          // 開始日 (YYYY-MM-DD)
  endDate: string;            // 終了日 (YYYY-MM-DD)
  status: TourStatus;         // 進行中 / 完了
  advancePayment: number;     // 仮払金 / 前渡金（円）
  driverName?: string;        // 担当乗務員名
  vehicleNumber?: string;     // 車両登録番号（ナンバー）
  clientCompanyName?: string; // 相手方の会社名（旅行会社・発注元）
  clientContactName?: string; // 相手方の担当者名（添乗員・手配担当者）
  waterLoadedCount?: number;  // 水積込本数（本）
  waterRemainingCount?: number; // 水残本数（本）
  memo?: string;              // 備考
  createdAt: number;
  updatedAt: number;
}

export interface EtcDetails {
  entryGate?: string;         // 入口料金所
  exitGate?: string;          // 出口料金所
  splitIndex?: number;        // 分割連番
  totalOnReceipt?: number;    // 明細原本の合計額（照合用）
}

export interface Receipt {
  id?: number;
  tourId: number;             // 紐づくツアーID
  category: ExpenseCategory;  // ETC / 駐車場 / 燃料 / その他
  paymentMethod: PaymentMethod; // 現金立替 / 会社ETC / 燃料カード / 会社カード
  date: string;               // 発生日 (YYYY-MM-DD)
  time?: string;              // 発生時刻 (HH:mm)
  amount: number;             // 金額（税込）
  place: string;              // 店舗名 / 料金所名
  invoiceNumber?: string;     // 適格請求書番号 (T+13桁)
  isInvoiceValid?: boolean;   // 国税庁Modulus11妥当性判定結果
  hasInvoiceHighlight?: boolean; // ハイライト処理済みか
  originalImageUrl?: string;  // 元画像 (Data URL)
  processedImageUrl: string;  // 証拠画像（黄色ハイライト付きData URL）
  imageHash?: string;         // 二重登録防止用の画像知覚ハッシュ
  etcDetails?: EtcDetails;    // ETC分割情報
  etcType?: 'jissha' | 'kaiso'; // ETC分類: 'jissha' (実車) | 'kaiso' (回送)
  etcPaidByGuide?: boolean;   // ガイド預り金から引くかどうか (true: 預り金から引く, false: 引かない(会社ETC等))
  memo?: string;              // 備考（手入力）
  aiMemo?: string;            // AI読取項目（品目・OCR解析情報）
  isDuplicateDismissed?: boolean; // ユーザーが「重複ではない」と確認して警告を解除したフラグ
  createdAt: number;
}

export interface DriverProfile {
  id?: number;
  driverName: string;         // 乗務員氏名
  staffId: string;            // 社員番号
  officeName: string;         // 所属営業所
  vehicleNumber: string;      // 担当車両番号
  companyName?: string;       // 運転手の所属会社名（自社名）
  phoneNumber?: string;       // 自社/運転手の電話番号
  address?: string;           // 自社/運転手の所在地・住所
  updatedAt: number;
}

export class SeisanDatabase extends Dexie {
  tours!: Table<Tour, number>;
  receipts!: Table<Receipt, number>;
  profiles!: Table<DriverProfile, number>;

  constructor() {
    super('BusSeisanDB');
    this.version(1).stores({
      tours: '++id, &code, status, startDate, createdAt',
      receipts: '++id, tourId, category, paymentMethod, date, createdAt',
      profiles: '++id, staffId'
    });
  }
}

export const db = new SeisanDatabase();

// 初期プロファイルのシード取得関数
export async function getOrCreateProfile(): Promise<DriverProfile> {
  const profile = await db.profiles.toCollection().first();
  if (profile) return profile;

  const defaultProfile: DriverProfile = {
    driverName: '山田 太郎',
    staffId: 'D-1048',
    officeName: '東京営業所',
    vehicleNumber: '足立200 か 38-92',
    companyName: '大和観光バス株式会社',
    phoneNumber: '03-3456-7890',
    address: '東京都江東区新木場1-2-3',
    updatedAt: Date.now()
  };
  const id = await db.profiles.add(defaultProfile);
  return { ...defaultProfile, id };
}

// 過去のツアーから相手方会社名・担当者名の履歴リストを抽出
export async function getClientHistory(): Promise<{ companyNames: string[]; contactNames: string[] }> {
  try {
    const tours = await db.tours.toArray();
    const companySet = new Set<string>();
    const contactSet = new Set<string>();

    // 過去に入力された実績を収集
    for (const t of tours) {
      if (t.clientCompanyName && t.clientCompanyName.trim()) {
        companySet.add(t.clientCompanyName.trim());
      }
      if (t.clientContactName && t.clientContactName.trim()) {
        contactSet.add(t.clientContactName.trim());
      }
    }

    // 旅行業界でよく使われる定番会社を初期候補として追加
    const defaultCompanies = [
      'JTB 団体旅行部',
      'クラブツーリズム',
      '日本旅行',
      '阪急交通社',
      '読売旅行',
      '近畿日本ツーリスト',
      '名鉄観光サービス'
    ];
    defaultCompanies.forEach((c) => companySet.add(c));

    return {
      companyNames: Array.from(companySet),
      contactNames: Array.from(contactSet)
    };
  } catch (err) {
    console.error('相手方履歴取得エラー:', err);
    return {
      companyNames: ['JTB 団体旅行部', 'クラブツーリズム', '日本旅行'],
      contactNames: []
    };
  }
}

// 進行中のアクティブツアー取得、なければ新規作成支援
export async function getActiveTour(): Promise<Tour | undefined> {
  return await db.tours.where('status').equals('active').first();
}
