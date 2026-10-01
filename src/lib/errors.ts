// User-facing errors carry a German message and an HTTP status; everything
// else is logged server-side and mapped to a generic 500.

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Nicht gefunden oder kein Zugriff.") {
    super(message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class EmbeddingConfigMismatchError extends AppError {
  constructor(message: string) {
    super(message, 503);
  }
}

export class AiDisabledError extends AppError {
  constructor() {
    super("KI-Funktionen sind derzeit deaktiviert.", 503);
  }
}
