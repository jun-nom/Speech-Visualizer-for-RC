# OpenAI APIプロンプト - スピーチフローに追加機能

システムプロンプトの実体は `src/app/utils/systemPrompt.ts` で管理しています。
このファイルを編集するとSupabaseへのデプロイなしに即反映されます。

## 仕組み

1. クライアント（`api.ts`）がプロンプトを組み立ててサーバーへ送信
2. サーバー（Supabase Edge Function）はプロンプトをそのままOpenAI APIに転送
3. OpenAI APIキーはサーバー側に保持されるため、セキュリティは維持

## プロンプト編集方法

`src/app/utils/systemPrompt.ts` を直接編集してください。
`buildSystemPrompt(textDensityLimit)` 関数の中のテンプレートリテラルがプロンプト本体です。
