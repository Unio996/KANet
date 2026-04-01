export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends AppError {
  constructor(msg = 'Not found') { super(msg, 404); }
}

export class BadRequestError extends AppError {
  constructor(msg = 'Bad request') { super(msg, 400); }
}

export class UnauthorizedError extends AppError {
  constructor(msg = 'Unauthorized') { super(msg, 401); }
}
