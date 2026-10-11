import { afterEach, describe, expect, it } from 'vitest';
import { createClientId } from './client-id';

const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterEach(() => {
  if (cryptoDescriptor)
    Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
});

describe('createClientId', () => {
  it('uses a UUID when the secure-context API is available', () => {
    expect(createClientId()).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('creates a UUID-shaped ID when a LAN HTTP origin lacks randomUUID', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (values: Uint8Array) => values.fill(12) },
    });
    expect(createClientId()).toBe('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c');
  });
});
