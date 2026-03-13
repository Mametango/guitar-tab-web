# Guitar Chord Sketch

録音ファイルからコード進行を推定し、ギターのTAB候補を表示する Web アプリの MVP です。

## 現在の状態

- 録音ファイルの選択
- フロントエンドからバックエンド API への音声アップロード
- `WAV (PCM 16-bit)` に対する簡易コード推定
- コードごとのTAB候補表示
- コードの手動修正
- TAB候補の切り替え
- ブラウザ内一時保存
- ブラウザ録音からの解析
- 小節ごとのコード配置
- 簡易リズム表示
- JSON エクスポート
- テキスト譜エクスポート
- MIDI エクスポート

## 次に差し込むもの

1. 本物のコード推定ロジック
2. 保存機能
3. ユーザー修正 UI
4. ログインとプロジェクト管理

## いまの解析仕様

- `WAV (PCM 16-bit)` はローカル解析を実行
- 2秒ごとの窓で基本周波数をざっくり拾い、メジャー/マイナーコード候補に寄せて判定
- `mp3` など未対応形式はフォールバック結果を返す
- ブラウザ録音はフロントエンド側で `WAV` にして送信
- 単音メロディやノイズが多い録音では精度が下がります

## 起動

```bash
npm.cmd install
npm.cmd run api
npm.cmd run dev
```

`npm.cmd run api` で `http://localhost:3001` に API が立ち上がり、Vite 側は `/api` をそのままプロキシします。

## 環境変数

フロントエンド:

```bash
copy .env.example .env
```

- `VITE_API_BASE_URL`
  - 開発時は空で OK
  - 本番では Render などに公開した API の URL を入れる

バックエンド:

```bash
copy server\\.env.example server\\.env
```

- `PORT`
  - API サーバーの待受ポート
- `CORS_ORIGIN`
  - 本番フロントの URL

## GitHub と公開

1. GitHub に新しいリポジトリを作る
2. このフォルダで `git add .`
3. `git commit -m "Initial web app MVP"`
4. `git branch -M main`
5. `git remote add origin <your-github-url>`
6. `git push -u origin main`

## フロント公開例

- Vercel に GitHub リポジトリを接続
- Build Command: `npm run build`
- Output Directory: `dist`
- Environment Variable:
  - `VITE_API_BASE_URL=https://your-render-api.onrender.com`

## API 公開例

- Render で Web Service を作成
- Root Directory: このリポジトリのルート
- Build Command: `npm install`
- Start Command: `npm run api`
- Environment Variable:
  - `CORS_ORIGIN=https://your-vercel-app.vercel.app`
