import {
  cleanLibrary,
  isLocalLibrary,
  type LocalLibrary,
} from '@musicbit/shared';

export function parseBackup(raw: string): LocalLibrary {
  if (raw.length > 5_000_000)
    throw new Error('Il backup supera il limite di 5 MB.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Il file non contiene un backup JSON valido.');
  }
  const data =
    value && typeof value === 'object' && 'library' in value
      ? (value as { library: unknown }).library
      : value;
  if (!isLocalLibrary(data))
    throw new Error(
      'Backup non valido o incompatibile. La tua libreria non è stata modificata.',
    );
  return cleanLibrary(data);
}
export function downloadBackup(library: LocalLibrary, label = 'libreria') {
  const blob = new Blob(
    [
      JSON.stringify(
        {
          format: 'musicbit-library',
          exportedAt: new Date().toISOString(),
          library: cleanLibrary(library),
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `musicbit-${label.replace(/[^a-z0-9_-]/gi, '_')}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
