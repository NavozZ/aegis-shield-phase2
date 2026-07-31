import { randomInt } from 'node:crypto';

/**
 * Synthetic prototype references. The alphabet omits I, O, 0 and 1 so a
 * reference can be read aloud without ambiguity. This is deliberately not a
 * real bank account number format and carries no routing meaning.
 */
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 4;
const GROUP_COUNT = 3;

function randomGroup(): string {
  let group = '';
  for (let index = 0; index < GROUP_LENGTH; index += 1) {
    group += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return group;
}

export function generatePublicAccountReference(): string {
  return `AEGIS-${Array.from({ length: GROUP_COUNT }, randomGroup).join('-')}`;
}

/**
 * Only the final group survives masking, so a masked reference cannot be used
 * to reconstruct the full reference.
 */
export function maskAccountReference(publicReference: string): string {
  const groups = publicReference.split('-');
  const lastGroup = groups.at(-1);
  if (groups.length !== GROUP_COUNT + 1 || !lastGroup) {
    throw new TypeError('Public account reference format is invalid.');
  }
  return `AEGIS-****-****-${lastGroup}`;
}
