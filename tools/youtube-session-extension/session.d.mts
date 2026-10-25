export function exportSession(
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expirationDate?: number;
  }[],
  now?: number,
): string;
