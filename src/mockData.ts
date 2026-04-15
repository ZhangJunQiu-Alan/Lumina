import { Word } from './types';

export const MOCK_WORDS: Word[] = [
  {
    id: '1',
    word: 'Pragmatic',
    phonetic: '/præɡˈmætɪk/',
    pos_tags: ['Adjective'],
    ner_entities: [
      { label: 'Concept', text: 'Philosophy' }
    ],
    chinese_definition: '务实的，实事求是的',
    example_sentences: [
      'The council took a **pragmatic** approach to the problem of street crime.',
      'In business, it is often necessary to be **pragmatic** rather than idealistic.'
    ],
    confusing_pair: {
      word: 'Practical',
      difference: 'Pragmatic implies a focus on results and consequences, while practical simply means useful or capable of being put into effect.'
    }
  },
  {
    id: '2',
    word: 'Mitigate',
    phonetic: '/ˈmɪtɪɡeɪt/',
    pos_tags: ['Verb'],
    ner_entities: [
      { label: 'Action', text: 'Reduction' }
    ],
    chinese_definition: '减轻，缓和',
    example_sentences: [
      'Drainage schemes have helped to **mitigate** the effects of the flooding.',
      'The government is implementing measures to **mitigate** the impact of the economic crisis in **London**.'
    ],
    confusing_pair: {
      word: 'Militate',
      difference: 'Mitigate means to make less severe; militate (usually with "against") means to be a powerful factor in preventing something.'
    }
  },
  {
    id: '3',
    word: 'Ubiquitous',
    phonetic: '/juːˈbɪkwɪtəs/',
    pos_tags: ['Adjective'],
    ner_entities: [
      { label: 'State', text: 'Pervasive' }
    ],
    chinese_definition: '无所不在的，普遍的',
    example_sentences: [
      'The **ubiquitous** spread of English as a global language is undeniable.',
      'Coffee shops are **ubiquitous** in major cities like **New York** and **Tokyo**.'
    ],
    confusing_pair: {
      word: 'Pervasive',
      difference: 'Ubiquitous means existing everywhere at once; pervasive means spreading widely throughout an area or a group of people.'
    }
  },
  {
    id: '4',
    word: 'Ambivalent',
    phonetic: '/æmˈbɪvələnt/',
    pos_tags: ['Adjective'],
    ner_entities: [
      { label: 'Emotion', text: 'Conflict' }
    ],
    chinese_definition: '矛盾的，犹豫不决的',
    example_sentences: [
      'She remained **ambivalent** about her marriage.',
      'Many people are **ambivalent** about the use of nuclear energy.'
    ],
    confusing_pair: {
      word: 'Ambiguous',
      difference: 'Ambivalent refers to having mixed feelings; ambiguous refers to something having more than one possible meaning.'
    }
  }
];

export const MOCK_ESSAY = `
The rise of **ubiquitous** technology in the 21st century has fundamentally altered human interaction. While some argue that these advancements **mitigate** the distance between people, others remain **ambivalent** about the loss of physical presence. A **pragmatic** view suggests that we must embrace these tools while remaining conscious of their impact on our social fabric. In cities like **London**, the integration of smart technology is seen as a way to improve efficiency, yet the human element remains irreplaceable.
`;
