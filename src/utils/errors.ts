export class UserFacingError extends Error {
  public constructor(public readonly translationKey: string) {
    super(translationKey);
    this.name = 'UserFacingError';
  }
}
