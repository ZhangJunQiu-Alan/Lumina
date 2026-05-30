import { Word } from './types';

export const MOCK_WORDS: Word[] = [
  {
    id: '1',
    word: 'Pragmatic',
    phonetic: '/præɡˈmætɪk/',
    pos_tags: ['Adjective'],
    ner_entities: [{ label: 'Concept', text: 'Philosophy' }],
    chinese_definition: '务实的，实事求是的',
    senses: [
      {
        pos: 'Adjective',
        meaning_zh: '务实的，实事求是的',
        example_sentence: 'The council took a **pragmatic** approach to the problem of street crime.',
        example_translation_zh: '',
      },
    ],
    example_sentences: [
      'The council took a **pragmatic** approach to the problem of street crime.',
      'In business, it is often necessary to be **pragmatic** rather than idealistic.',
    ],
    morphology: {
      summaryZh: 'pragmat- 常和“实际行动、结果导向”相关，帮助记住这个词强调务实效果。',
      parts: [
        { text: 'pragmat', kind: 'root', meaningZh: '行动；实践', noteZh: '联想到 practical 的实操感' },
        { text: '-ic', kind: 'suffix', meaningZh: '形容词后缀', noteZh: '表示“具有……性质的”' },
      ],
    },
    derivedWords: [
      { word: 'pragmatism', meaningZh: '实用主义；务实作风', noteZh: '名词形式' },
      { word: 'pragmatically', meaningZh: '务实地', noteZh: '副词形式' },
    ],
    synonyms: [
      { word: 'practical', meaningZh: '实际的', noteZh: '强调可操作性' },
      { word: 'realistic', meaningZh: '现实的', noteZh: '强调符合现实条件' },
    ],
    antonyms: [{ word: 'idealistic', meaningZh: '理想化的', noteZh: '更偏理想而非结果' }],
    confusingPairs: [
      {
        word: 'Practical',
        difference: 'Pragmatic 更强调结果导向和权衡利弊；practical 更强调实际可行、好用。',
      },
    ],
    confusing_pair: {
      word: 'Practical',
      difference:
        'Pragmatic implies a focus on results and consequences, while practical simply means useful or capable of being put into effect.',
    },
  },
  {
    id: '2',
    word: 'Mitigate',
    phonetic: '/ˈmɪtɪɡeɪt/',
    pos_tags: ['Verb'],
    ner_entities: [{ label: 'Action', text: 'Reduction' }],
    chinese_definition: '减轻，缓和',
    senses: [
      {
        pos: 'Verb',
        meaning_zh: '减轻，缓和',
        example_sentence: 'Drainage schemes have helped to **mitigate** the effects of the flooding.',
        example_translation_zh: '',
      },
    ],
    example_sentences: [
      'Drainage schemes have helped to **mitigate** the effects of the flooding.',
      'The government is implementing measures to **mitigate** the impact of the economic crisis in **London**.',
    ],
    morphology: {
      summaryZh: 'mitig- 可联想到“让力度变轻”，帮助记住它表示减轻、缓和。',
      parts: [
        { text: 'mitig', kind: 'root', meaningZh: '减轻', noteZh: '抓住“使没那么严重”' },
        { text: '-ate', kind: 'suffix', meaningZh: '动词后缀', noteZh: '表示使成为、使发生' },
      ],
    },
    derivedWords: [
      { word: 'mitigation', meaningZh: '缓解；减轻', noteZh: '名词形式，学术写作常见' },
      { word: 'mitigating', meaningZh: '减轻的；缓和的', noteZh: '现在分词或形容词用法' },
    ],
    synonyms: [
      { word: 'alleviate', meaningZh: '缓解', noteZh: '常搭配 pain, pressure' },
      { word: 'ease', meaningZh: '减轻', noteZh: '更口语化' },
    ],
    antonyms: [{ word: 'aggravate', meaningZh: '加重', noteZh: '使情况更糟' }],
    confusingPairs: [
      {
        word: 'Militate',
        difference: 'mitigate 是“减轻”；militate against 是“对……起阻碍作用”。',
      },
    ],
    confusing_pair: {
      word: 'Militate',
      difference:
        'Mitigate means to make less severe; militate (usually with "against") means to be a powerful factor in preventing something.',
    },
  },
  {
    id: '3',
    word: 'Ubiquitous',
    phonetic: '/juːˈbɪkwɪtəs/',
    pos_tags: ['Adjective'],
    ner_entities: [{ label: 'State', text: 'Pervasive' }],
    chinese_definition: '无所不在的，普遍的',
    senses: [
      {
        pos: 'Adjective',
        meaning_zh: '无所不在的，普遍的',
        example_sentence: 'The **ubiquitous** spread of English as a global language is undeniable.',
        example_translation_zh: '',
      },
    ],
    example_sentences: [
      'The **ubiquitous** spread of English as a global language is undeniable.',
      'Coffee shops are **ubiquitous** in major cities like **New York** and **Tokyo**.',
    ],
    morphology: {
      summaryZh: 'ubi- 可联想到“到处都是”，帮助记住 ubiquitous 表示无处不在。',
      parts: [
        { text: 'ubi', kind: 'root', meaningZh: '到处', noteZh: '抓住 everywhere 的感觉' },
        { text: '-ous', kind: 'suffix', meaningZh: '形容词后缀', noteZh: '表示“具有……特征的”' },
      ],
    },
    derivedWords: [{ word: 'ubiquity', meaningZh: '无处不在', noteZh: '名词形式' }],
    synonyms: [
      { word: 'omnipresent', meaningZh: '无所不在的', noteZh: '语气更正式' },
      { word: 'pervasive', meaningZh: '遍布的', noteZh: '强调广泛渗透' },
    ],
    antonyms: [{ word: 'rare', meaningZh: '罕见的', noteZh: '出现频率低' }],
    confusingPairs: [
      {
        word: 'Pervasive',
        difference: 'ubiquitous 强调“到处都有”；pervasive 强调“广泛渗透、蔓延”。',
      },
    ],
    confusing_pair: {
      word: 'Pervasive',
      difference:
        'Ubiquitous means existing everywhere at once; pervasive means spreading widely throughout an area or a group of people.',
    },
  },
  {
    id: '4',
    word: 'Ambivalent',
    phonetic: '/æmˈbɪvələnt/',
    pos_tags: ['Adjective'],
    ner_entities: [{ label: 'Emotion', text: 'Conflict' }],
    chinese_definition: '矛盾的，犹豫不决的',
    senses: [
      {
        pos: 'Adjective',
        meaning_zh: '矛盾的，犹豫不决的',
        example_sentence: 'She remained **ambivalent** about her marriage.',
        example_translation_zh: '',
      },
    ],
    example_sentences: [
      'She remained **ambivalent** about her marriage.',
      'Many people are **ambivalent** about the use of nuclear energy.',
    ],
    morphology: {
      summaryZh: 'ambi- 表示“两边”，帮助记住 ambivalent 是两种感受并存、拿不定主意。',
      parts: [
        { text: 'ambi-', kind: 'prefix', meaningZh: '两边；双重', noteZh: '联想到 dual / both' },
        { text: 'val', kind: 'root', meaningZh: '力量；价值取向', noteZh: '这里帮助记住态度摇摆' },
      ],
    },
    derivedWords: [{ word: 'ambivalence', meaningZh: '矛盾心理', noteZh: '名词形式' }],
    synonyms: [
      { word: 'conflicted', meaningZh: '矛盾的', noteZh: '强调内心冲突' },
      { word: 'uncertain', meaningZh: '犹豫的', noteZh: '强调不确定' },
    ],
    antonyms: [{ word: 'decisive', meaningZh: '果断的', noteZh: '态度明确' }],
    confusingPairs: [
      {
        word: 'Ambiguous',
        difference: 'ambivalent 形容人有矛盾情绪；ambiguous 形容信息或表达有歧义。',
      },
    ],
    confusing_pair: {
      word: 'Ambiguous',
      difference:
        'Ambivalent refers to having mixed feelings; ambiguous refers to something having more than one possible meaning.',
    },
  },
];

export const MOCK_ESSAY = `
The rise of **ubiquitous** technology in the 21st century has fundamentally altered human interaction. While some argue that these advancements **mitigate** the distance between people, others remain **ambivalent** about the loss of physical presence. A **pragmatic** view suggests that we must embrace these tools while remaining conscious of their impact on our social fabric. In cities like **London**, the integration of smart technology is seen as a way to improve efficiency, yet the human element remains irreplaceable.
`;
