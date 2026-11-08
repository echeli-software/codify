import type { InventoryItem } from '@codify/api-client';
import { ownedPets, petNameChanged } from './pet-names';

const inv = (id: string, slot: string, equipped = false): InventoryItem =>
  ({
    item: { id, slot },
    equipped,
    acquiredAt: '2026-01-01T00:00:00Z',
    source: 'PURCHASE',
    nickname: null,
  }) as unknown as InventoryItem;

describe('ownedPets', () => {
  it('keeps only pets, the equipped one first', () => {
    const pets = ownedPets([
      inv('dog', 'PET'),
      inv('hat', 'HAT', true),
      inv('cat', 'PET', true),
    ]);
    expect(pets.map((p) => p.item.id)).toEqual(['cat', 'dog']);
  });
});

describe('petNameChanged', () => {
  it('compares the cleaned draft with the stored name', () => {
    expect(petNameChanged('  Rex ', 'Rex')).toBe(false);
    expect(petNameChanged('Rex  Jr', 'Rex Jr')).toBe(false);
    expect(petNameChanged('Rex', null)).toBe(true);
    expect(petNameChanged('', undefined)).toBe(false);
    expect(petNameChanged('', 'Rex')).toBe(true);
  });
});
