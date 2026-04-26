export function buildSystemPrompt(textDensity: string, informationLevel: string, nodeQuantity: string): string {
  const topicConfig = TOPIC_CONFIGS[informationLevel] ?? TOPIC_CONFIGS.high;
  const nodeConfig = NODE_CONFIGS[nodeQuantity] ?? NODE_CONFIGS.medium;
  const densityConfig = DENSITY_CONFIGS[textDensity] ?? DENSITY_CONFIGS.medium;
  return buildPrompt(topicConfig, nodeConfig, densityConfig);
}

interface TopicConfig {
  maxTopics: string;
}

interface NodeConfig {
  factsPerTopic: string;
  insightsPerTopic: string;
  exampleFacts: string[];
  exampleInsights: string[];
}

interface DensityConfig {
  charRange: string;
  description: string;
}

const TOPIC_CONFIGS: Record<string, TopicConfig> = {
  low:    { maxTopics: '1つのみ' },
  medium: { maxTopics: '最大3つ' },
  high:   { maxTopics: '制限なし' },
};

const NODE_CONFIGS: Record<string, NodeConfig> = {
  low: {
    factsPerTopic: '1個のみ',
    insightsPerTopic: '1個のみ',
    exampleFacts: ['20名でA/Bテスト実施、完了率40%→75%に改善'],
    exampleInsights: ['認知負荷の軽減が最重要課題'],
  },
  medium: {
    factsPerTopic: '1〜3個',
    insightsPerTopic: '1個のみ',
    exampleFacts: ['20名の参加者でA/Bテストを実施し完了率を計測', 'タスク完了率が40%から75%に向上'],
    exampleInsights: ['認知負荷の軽減が最も重要な改善ポイント'],
  },
  high: {
    factsPerTopic: '5個まで',
    insightsPerTopic: '1〜3個',
    exampleFacts: [
      '20名対象にA/Bテスト実施→タスク完了率40%→75%に改善、定性データで3課題を特定',
      '認知負荷の高い箇所でユーザーが操作停止するパターンを発見・ヒートマップで可視化',
      'プロトタイプv3でエラー率12%→3%に低減、平均操作時間も45秒短縮',
    ],
    exampleInsights: [
      '認知負荷軽減が最優先課題：ナビ簡略化だけでCV率8%向上の可能性',
      '想定外の操作経路が全体の30%→既存フローの前提を見直す必要がある',
    ],
  },
};

const DENSITY_CONFIGS: Record<string, DensityConfig> = {
  high: {
    charRange: '制限なし（後処理で調整）',
    description: `情報を余さず抽出することを最優先とする。文字数は気にせず、語られた内容をすべて記述すること。
- 数字・割合・固有名詞・手法名・ツール名は省略せずそのまま使う
- 「〜について話した」「〜が重要」のような抽象表現は禁止。何を・どう・どれだけ、を具体的に書く
- 記号（→・/・:）や略語を積極的に使い、情報密度を高める`,
  },
  medium: {
    charRange: '24〜56文字',
    description: `必ず24文字以上で記述すること。短くなりすぎないよう注意し、いくらか詳しめに書く。
意味・文脈・具体的な内容が正確に伝わるよう心がけること。`,
  },
  low: {
    charRange: '2〜32文字',
    description: '不要な修飾語・接続詞を省いてコンパクトにまとめる。ただし意味が伝わることを最優先とし、必要な情報は省かないこと。',
  },
};

function buildPrompt(topic: TopicConfig, node: NodeConfig, density: DensityConfig): string {
  const exampleJson = JSON.stringify(
    {
      topics: [
        {
          title: 'ユーザビリティテスト設計',
          facts: node.exampleFacts,
          insights: node.exampleInsights,
        },
      ],
    },
    null,
    2
  );

  return `あなたはRESeARCH Conference「POTENTIAL」でのUXリサーチ・デザインリサーチセッションの内容を、視聴者の質問促進と理解向上を目的としたスピーチフローノードに変換する専門アシスタントです。

## カンファレンス背景
RESEARCH Conferenceは、リサーチをテーマとした日本発のカンファレンスです。より良いサービスづくりの土壌を育むために、デザインリサーチやUXリサーチの実践知を共有し、リサーチの価値や可能性を広く伝えることを目的としています。

2025年のテーマ「POTENTIAL」：技術の急速な発展によって人間が持つ独自の価値が問われる時代において、人にしかできないリサーチの本質的価値を探求します。

## 処理方針
1. **質問促進最優先**: 視聴者が「これについて詳しく聞きたい」と思うキーワードや論点を明確に抽出
2. **実践知の詳細化**: リサーチの具体的な手法、工夫、失敗、学びを記述
3. **共感ポイント抽出**: 登壇者の体験や感情、葛藤など、視聴者の共感を深める内容
4. **余談は省略**: セッション内容に直結しない雑談や挨拶は除外

## 生成ルール

### トピック数
テキストを複数のトピックに分割する。生成するトピック数は **${topic.maxTopics}** とする。

### 各トピックのノード構成
各トピックは以下の3種類のノードで構成する：

1. **title（トピックタイトル）**: 1トピックにつき必ず1つ。具体的で質問を誘発する表現（5〜15文字）。「〜について」などの抽象的表現は避ける。

2. **facts（客観的事実）**: 語られている事実・背景・データ・結果を記述する。1トピックにつき **${node.factsPerTopic}** 生成する。各factは配列の独立した1要素とする。

3. **insights（主観的洞察）**: スピーカーの感想・洞察・結論・学びを記述する。1トピックにつき **${node.insightsPerTopic}** 生成する。各insightは配列の独立した1要素とする。

### テキスト量
facts・insightsの各要素（配列の1要素 = 画面上の1ノード分）は **${density.charRange}** で記述する。
範囲の下限を下回ることも、上限を超えることも禁止。
${density.description}

## 語彙・専門用語
デザインリサーチ・UXリサーチ分野の正しい専門用語に統一すること：
- 「デザイン志向」→「デザイン思考」
- 「ユーザビリティー」→「ユーザビリティ」
- 「アクセシビリティー」→「アクセシビリティ」
- 「ペルソナ作成」→「ペルソナ開発」
- 「カスタマージャーニー」→「カスタマージャーニーマップ」

## 制約
- 発言されていない内容の捏造は厳禁
- 理解を助けるための適度な言い換えや関連事項の付与は可

必ずこの形式のJSONのみを返してください：
${exampleJson}`;
}

export const TEXT_DENSITY_LIMITS: Record<string, number> = {
  high: 90,
  medium: 56,
  low: 32,
};
