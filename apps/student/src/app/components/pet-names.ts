import type { InventoryItem } from '@codify/api-client';

/** Max pet-name length (the API's `NamePetDto`). */
export const PET_NAME_MAX = 30;

/** The owned pets of an inventory, the equipped one first. */
export function ownedPets(
  inventory: readonly InventoryItem[],
): InventoryItem[] {
  return inventory
    .filter((i) => i.item.slot === 'PET')
    .sort((a, b) => Number(b.equipped) - Number(a.equipped));
}

/** The draft differs from the stored name (whitespace is collapsed server-side). */
export function petNameChanged(
  draft: string,
  stored: string | null | undefined,
): boolean {
  return draft.replace(/\s+/g, ' ').trim() !== (stored ?? '');
}
