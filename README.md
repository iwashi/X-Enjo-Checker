# X Enjo Guardrails Checker

X への投稿前に `chakoshi Guardrails Apply API` を呼び出して、炎上リスクをチェックする Chrome 拡張（Manifest V3）です。

## 概要

- 投稿ボタン押下時に自動チェック
- 投稿欄の `🍵` アイコンボタンで手動チェック
- リスクが閾値以上のとき警告モーダルを表示
- chakoshi 側で事前に設定した既存の `Guardrail ID` を使って判定
- オプション画面から接続テスト可能

## 動作要件

- Google Chrome（拡張機能を読み込めること）
- chakoshi の `API Key`
- chakoshi で作成済みの `guardrail_id`
- `https://x.com/*` へのアクセス許可

## インストール

1. `chrome://extensions` を開く
2. 右上の `デベロッパーモード` を ON
3. `パッケージ化されていない拡張機能を読み込む` でこのフォルダを選択
4. 拡張の `設定` を開く

## 初期設定

オプション画面で以下を設定して `保存` してください。

- `Guardrails Apply API Endpoint`
- `API Key`
- `Guardrail ID`
- `閾値`（0.00 - 1.00）
- `タイムアウト (ms)`

`Guardrails Apply API Endpoint` はベースURLのみでも動作します。  
例: `https://api.beta.chakoshi.ntt.com`  

## chakoshi 側の事前設定（必須）

この拡張を使う前に、chakoshi ダッシュボードでガードレールを作成し、`トピックコントロール` を設定してください。  
作成後に表示される `guardrail_id` を拡張の設定画面へ入力します。

### トピックコントロール設定例

会話のテーマ: `X向けに色々と書くような場所である。トピックの内容は特に限ったものではない。`

許可トピック: 必要に応じて設定（未設定でも可）

禁止トピック:
- `時代錯誤なジェンダー観・役割の押し付け`
- `行き過ぎた自己責任論・弱者切り捨て`
- `無神経なマウント・上から目線のアドバイス`
- `職業差別・店員への態度`
- `主語が大きい（過度な一般化）`
- `クリエイター・技術へのリスペクト欠如（AI・金銭問題）`
- `過剰な「古参風」・新規排除（ゲートキーピング）`

## 使い方

1. X の投稿欄にテキストを入力
2. `チェックボタン` を押して手動チェック、または `ポストする` を押して自動チェック
3. 高リスクの場合はモーダルで `編集に戻る` または `このまま投稿` を選択

## スコア表示

モーダルでは次の形式で表示します。

- `炎上リスクスコア: 0.xx`
- `モデレーションリスクスコア: 0.xx`（該当時）

`炎上リスクスコア` は、受け取った判定結果から算出した 0.00〜1.00 の指標です。

## API リクエスト

拡張は以下の形式で `POST` します。

```json
{
  "input": "投稿本文",
  "guardrail_id": "your_guardrail_id"
}
```

ヘッダー:

- `Authorization: Bearer <API_KEY>`
- `Accept: application/json`
- `Content-Type: application/json`

## トラブルシューティング

- 接続テストが終わらない: `chrome://extensions` で拡張を再読み込みし、再実行してください。
- 404 が返る: `Guardrails Apply API Endpoint` を確認してください。`https://api.beta.chakoshi.ntt.com` または `https://api.beta.chakoshi.ntt.com/v1/guardrails/apply` を推奨します。
- X 上で `チェックボタン` が表示されない: ページをリロードし、拡張のサイトアクセス許可に `x.com` が含まれているか確認してください。

## ファイル構成

- `manifest.json`: Chrome 拡張定義 (MV3)
- `background.js`: API 呼び出しとレスポンス正規化
- `content.js`: X 画面へのボタン挿入と投稿前チェック
- `content.css`: モーダル・トースト・ボタンスタイル
- `options.html` / `options.js`: 設定画面
- `popup.html` / `popup.js`: 簡易状態表示

## 補足

- `guardrail_id` は chakoshi ダッシュボードで作成・確認してください。
- X の DOM 変更により、将来的にセレクタ調整が必要になる場合があります。
