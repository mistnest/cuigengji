import { test, expect } from '@playwright/test';

test.describe('Import enabled/disabled state', () => {
  const cleanupIds = new Set<string>();

  test.afterAll(async ({ request }) => {
    for (const id of cleanupIds) {
      await request.delete(`/api/novels/${encodeURIComponent(id)}`);
    }
  });

  test('world book import preserves disabled and enabled fields', async ({ request }) => {
    const novel = await request.post('/api/novels', {
      data: { title: `enabled_state_world_${Date.now()}` },
    });
    const { id } = await novel.json();
    cleanupIds.add(id);

    const response = await request.post('/api/import/worldbook', {
      data: {
        novelId: id,
        name: 'state-test',
        data: {
          entries: {
            disabled_entry: {
              uid: 1,
              key: ['Hidden'],
              content: 'This should not activate.',
              disabled: true,
            },
            enabled_entry: {
              uid: 2,
              key: ['Visible'],
              content: 'This should activate.',
              enabled: true,
            },
          },
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.entries.disabled_entry.disable).toBe(true);
    expect(body.entries.disabled_entry.enabled).toBe(false);
    expect(body.entries.enabled_entry.disable).toBe(false);
    expect(body.entries.enabled_entry.enabled).toBe(true);
  });

  test('character import preserves disabled card and embedded book entries', async ({ request }) => {
    const novel = await request.post('/api/novels', {
      data: { title: `enabled_state_char_${Date.now()}` },
    });
    const { id } = await novel.json();
    cleanupIds.add(id);

    const response = await request.post('/api/import/character-json', {
      data: {
        novelId: id,
        data: {
          spec: 'chara_card_v3',
          data: {
            name: 'Dormant Character',
            description: 'Disabled card.',
            enabled: false,
            character_book: {
              entries: [{
                uid: 7,
                key: ['Secret'],
                content: 'Hidden embedded lore.',
                disabled: true,
              }],
            },
          },
        },
      },
    });

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.character.disabled).toBe(true);
    expect(body.character.enabled).toBe(false);
    expect(body.character.data.disabled).toBe(true);
    expect(body.character.data.character_book.entries[7].disable).toBe(true);
  });
});
