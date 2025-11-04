# Backlog API 設定手順

1. `config/backlog-config.example.json` を参考に、Backlog スペースのサブドメイン (`spaceDomain`) と個人用 API キー (`apiKey`) を用意します。`host` は `backlog.com` または `backlog.jp` を指定してください。
2. 開発中に即座に動作確認したい場合は、Chrome 拡張のオプションページから認証情報を登録できます。
   - 拡張を読み込んだ後、オプションページにアクセスし、フォームへ `spaceDomain` と `apiKey` を入力して保存してください。
   - 保存された値は `chrome.storage.local` に暗号化されずに保管されるため、共有マシンでは使用を控えてください。
3. CI や配布用ビルドでは、`config/backlog-config.json` をリポジトリに含めず、オプションページ経由で認証情報を入力する運用を推奨します。
