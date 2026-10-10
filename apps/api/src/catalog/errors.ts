export class CatalogError extends Error {
  constructor(
    readonly code:
      | 'TIMEOUT'
      | 'CANCELLED'
      | 'UNAVAILABLE'
      | 'DISABLED'
      | 'NOT_FOUND'
      | 'BUSY',
  ) {
    super(code);
  }
}
