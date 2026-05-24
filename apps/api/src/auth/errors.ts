// Named auth errors. Mapped to HTTP status codes in auth.controller.ts and
// recognized by tests so the failure mode is explicit (no string-matching on
// generic Error messages).

export class DuplicateEmailError extends Error {
  constructor(public readonly email: string) {
    super('A user with this email already exists');
    this.name = 'DuplicateEmailError';
  }
}

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid email or password');
    this.name = 'InvalidCredentialsError';
  }
}
