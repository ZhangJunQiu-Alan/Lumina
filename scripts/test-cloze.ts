import assert from 'node:assert/strict';
import { buildClozePrompt, CLOZE_BLANK } from '../src/lib/cloze.js';

function sense(example: string, translation = ''): { example_sentence: string; example_translation_zh: string } {
  return { example_sentence: example, example_translation_zh: translation };
}

function run() {
  // Base form
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [sense('They decided to abandon the plan.', '他们决定放弃计划。')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'abandon');
    assert.equal(prompt.formLabel, '原型');
    assert.equal(prompt.blankedSentence, `They decided to ${CLOZE_BLANK} the plan.`);
    assert.equal(prompt.translation, '他们决定放弃计划。');
    assert.equal(prompt.senseIndex, 0);
  }

  // -ed past tense (regular)
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [sense('The town was abandoned after the flood.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'abandoned');
    assert.equal(prompt.formLabel, '过去式 / 过去分词');
    assert.equal(prompt.blankedSentence, `The town was ${CLOZE_BLANK} after the flood.`);
  }

  // -ing form with e-drop
  {
    const prompt = buildClozePrompt({
      word: 'make',
      senses: [sense('She is making dinner.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'making');
    assert.equal(prompt.formLabel, '-ing 形式');
  }

  // -s plural / 3rd person
  {
    const prompt = buildClozePrompt({
      word: 'book',
      senses: [sense('He reads two books every week.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'books');
    assert.equal(prompt.formLabel, '-s / -es 形式');
  }

  // y → ied
  {
    const prompt = buildClozePrompt({
      word: 'try',
      senses: [sense('She tried her best to finish on time.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'tried');
    assert.equal(prompt.formLabel, '过去式 / 过去分词');
  }

  // Consonant doubling
  {
    const prompt = buildClozePrompt({
      word: 'run',
      senses: [sense('He was running toward the station.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'running');
    assert.equal(prompt.formLabel, '-ing 形式');
  }

  // Irregular past
  {
    const prompt = buildClozePrompt({
      word: 'run',
      senses: [sense('She ran five kilometers yesterday.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'ran');
    assert.equal(prompt.formLabel, '过去式');
  }

  // Irregular past participle
  {
    const prompt = buildClozePrompt({
      word: 'write',
      senses: [sense('He has written three novels.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'written');
    assert.equal(prompt.formLabel, '过去分词');
  }

  // Strip **bold** markers
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [sense('They **abandoned** the ship at dawn.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'abandoned');
    assert.equal(prompt.blankedSentence, `They ${CLOZE_BLANK} the ship at dawn.`);
  }

  // All occurrences replaced
  {
    const prompt = buildClozePrompt({
      word: 'run',
      senses: [sense('Run fast or run slow, just run.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'run');
    assert.equal(
      prompt.blankedSentence,
      `${CLOZE_BLANK} fast or ${CLOZE_BLANK} slow, just ${CLOZE_BLANK}.`,
    );
  }

  // Case-insensitive match, expectedForm lowercased
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [sense('Abandon hope, all ye who enter here.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'abandon');
    assert.equal(prompt.blankedSentence, `${CLOZE_BLANK} hope, all ye who enter here.`);
  }

  // Skip sense with empty example, use next
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [
        sense('', ''),
        sense('They abandoned the idea.', '他们放弃了这个想法。'),
      ],
    });
    assert.ok(prompt);
    assert.equal(prompt.senseIndex, 1);
    assert.equal(prompt.expectedForm, 'abandoned');
  }

  // Skip sense that doesn't contain the word, use next
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [
        sense('Nothing relevant here.', 'no match'),
        sense('They abandoned the idea.', 'match'),
      ],
    });
    assert.ok(prompt);
    assert.equal(prompt.senseIndex, 1);
    assert.equal(prompt.translation, 'match');
  }

  // Fallback: no sense contains the word → null
  {
    const prompt = buildClozePrompt({
      word: 'abandon',
      senses: [sense('Nothing related at all.'), sense('Still nothing.')],
    });
    assert.equal(prompt, null);
  }

  // Fallback: no senses at all → null
  {
    const prompt = buildClozePrompt({ word: 'abandon', senses: [] });
    assert.equal(prompt, null);
  }

  // Fallback: empty word → null
  {
    const prompt = buildClozePrompt({ word: '', senses: [sense('anything')] });
    assert.equal(prompt, null);
  }

  // No partial-word matches (must be word boundary)
  {
    const prompt = buildClozePrompt({
      word: 'run',
      senses: [sense('The brunch was great.')], // contains "run" substring
    });
    assert.equal(prompt, null);
  }

  // Earliest-position wins when multiple forms appear
  {
    const prompt = buildClozePrompt({
      word: 'run',
      senses: [sense('She ran until the runners caught up.')],
    });
    assert.ok(prompt);
    assert.equal(prompt.expectedForm, 'ran');
  }

  console.log('cloze tests passed');
}

run();
