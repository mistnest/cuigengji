import { test, expect } from '@playwright/test';
import { buildWritingContext } from '../../src/services/context-orchestrator.js';
import { createMemoryManager } from '../../src/services/memory-manager.js';

const longWorldContent = 'FULL WORLD ENTRY DETAIL. '.repeat(40);
const longCharacterDescription = 'FULL CHARACTER DESCRIPTION. '.repeat(40);

function retrieveWorldContent(compactReference = false) {
  const memory = createMemoryManager({
    worldBook: {
      entries: {
        1: {
          uid: 1,
          comment: 'Cache Beacon',
          key: ['Beacon'],
          content: longWorldContent,
          constant: true,
          disable: false,
        },
      },
    },
    compactReference,
  });
  return memory.retrieve('Beacon')[0]?.content || '';
}

function retrieveCharacterContent(compactReference = false) {
  const memory = createMemoryManager({
    characters: [{
      data: {
        name: 'Ada',
        description: longCharacterDescription,
        personality: 'Precise',
      },
    }],
    compactReference,
  });
  return memory.retrieve('Ada enters the room.')[0]?.content || '';
}

test.describe('Reference injection mode', () => {
  test('keeps full reference text by default for imported presets', () => {
    expect(retrieveWorldContent()).toBe(longWorldContent);
    expect(retrieveCharacterContent()).toContain(longCharacterDescription);
  });

  test('uses compact summaries only when compactReference is enabled', () => {
    const worldContent = retrieveWorldContent(true);
    const characterContent = retrieveCharacterContent(true);

    expect(worldContent.length).toBeLessThan(longWorldContent.length);
    expect(worldContent).toContain('FULL WORLD ENTRY DETAIL');
    expect(characterContent.length).toBeLessThan(longCharacterDescription.length + 30);
    expect(characterContent).toContain('summary:');
  });

  test('does not inject disabled characters into writing context', async () => {
    const prompt = await buildWritingContext({
      message: 'Continue.',
      context: {
        novelId: 'disabled-character-context-test',
        currentText: 'Ada speaks. Bert speaks.',
        characters: [
          { data: { name: 'Ada', description: 'Visible character.' } },
          { data: { name: 'Bert', description: 'Disabled character.', enabled: false } },
        ],
      },
      config: { model: 'gpt-4o', maxTokens: 512 },
      promptTemplates: [],
      promptOrder: [],
    });

    expect(prompt.debug.referencedCounts.characters).toBe(1);
    expect(prompt.debug.layers.characterState.content).toContain('Ada');
    expect(prompt.debug.layers.characterState.content).not.toContain('Bert');
  });

  test('compact reference mode keeps role card examples out of prompt imports and still injects character summaries', async () => {
    const prompt = await buildWritingContext({
      message: 'Ada enters the archive.',
      context: {
        novelId: 'compact-reference-marker-test',
        compactReference: true,
        currentText: 'Ada enters the archive.',
        characters: [{
          data: {
            name: 'Ada',
            description: 'Ada is a precise archivist with a silver lantern.',
            first_mes: 'This is a long role-card opening message that should not be injected.',
            mes_example: 'This is a role-card dialogue example that should not be injected.',
          },
        }],
      },
      config: { model: 'gpt-4o', maxTokens: 512, compactReference: true },
      promptTemplates: [
        { identifier: 'charDescription', isMarker: true, markerId: 'charDescription' },
        { identifier: 'dialogueExamples', isMarker: true, markerId: 'dialogueExamples' },
      ],
      promptOrder: [],
    });

    const serialized = JSON.stringify(prompt.messages);
    expect(serialized).toContain('char_description_import');
    expect(serialized).not.toContain('character_state_import');
    expect(serialized).not.toContain('dialogue_examples_import');
    expect(serialized).not.toContain('role-card opening message');
    expect(serialized).toContain('[character:Ada]');
  });

  test('prompt history drops transient API errors and duplicate disconnected retries', async () => {
    const prompt = await buildWritingContext({
      message: 'Continue.',
      history: [
        { role: 'user', content: 'Ada goes to the door.' },
        { role: 'assistant', content: '❌ API key required' },
        { role: 'user', content: 'Ada goes to the door.' },
        { role: 'assistant', content: 'Valid reply.' },
      ],
      context: {
        novelId: 'history-cleanup-test',
        currentText: 'Ada waits.',
      },
      config: { model: 'gpt-4o', maxTokens: 512 },
      promptTemplates: [],
      promptOrder: [],
    });

    const historyMessages = prompt.messages.filter(message => ['user', 'assistant'].includes(message.role));
    const serialized = JSON.stringify(historyMessages);
    expect(serialized).not.toContain('API key required');
    expect(serialized.match(/Ada goes to the door/g)).toHaveLength(1);
    expect(serialized).toContain('Valid reply.');
  });
});
