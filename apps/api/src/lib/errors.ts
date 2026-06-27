/**
 * Typed application errors. Controllers throw these; the global error handler
 * maps them to the `ApiError` envelope + correct HTTP status. Anything else
 * becomes an opaque 500 so we never leak internals.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, "BAD_REQUEST", message, details);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown, message = "Validation failed") {
    super(422, "VALIDATION_ERROR", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, "UNAUTHORIZED", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "FORBIDDEN", message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(404, "NOT_FOUND", `${resource} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(409, "CONFLICT", message, details);
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super(502, "PROVIDER_ERROR", `[${provider}] ${message}`, details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
