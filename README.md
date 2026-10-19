# バス運行経費精算アプリ (seisan-app)

観光バス乗務員向けの運行経費精算・領収書OCR・精算書PDF出力アプリケーションです。

- **本番URL**: https://bus-seisan-2026.surge.sh
- **GitHubリポジトリ**: https://github.com/xyzkanazawa-code/seisan-app

---

## 1. 自宅のPCで初めて開発環境を準備する手順（初回のみ）

自宅のPCに [Git](https://git-scm.com/) と [Node.js](https://nodejs.org/) がインストールされている状態で、ターミナル（PowerShell など）を開いて以下を実行してください。

```powershell
# 1. 保存したいフォルダへ移動（例: C:\projects）
mkdir C:\projects -Force
cd C:\projects

# 2. GitHubからソースコードを取得（クローン）
git clone https://github.com/xyzkanazawa-code/seisan-app.git
cd seisan-app

# 3. パッケージのインストール
npm install

# 4. 開発サーバーの起動
npm run dev
```

---

## 2. 普段の編集・同期手順（自宅PC ⇔ 現在のPC）

### 作業を始める前（最新の変更を取り込む）
別のPCで編集した内容を反映するため、作業前に必ず以下を実行します。

```powershell
git pull origin main
```

### 作業を終えた後（変更をGitHubへ保存する）
編集が終わったら、以下のコマンドでGitHubにアップロードします。

```powershell
git add .
git commit -m "変更内容のメモ"
git push origin main
```

---

## 3. ビルド・本番デプロイ手順

Surge（https://bus-seisan-2026.surge.sh）へ最新版をデプロイする場合は以下を実行します。

```powershell
npm run deploy
```
