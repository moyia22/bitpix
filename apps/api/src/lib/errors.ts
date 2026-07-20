export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () =>
  new AppError(401, "AUTH_INVALID", "E-mail ou senha inválidos.");

export const forbidden = () =>
  new AppError(403, "AUTH_FORBIDDEN", "Você não possui permissão para esta ação.");
