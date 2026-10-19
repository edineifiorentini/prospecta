/** Erro de domínio com status HTTP e código estável para o frontend. */
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

export const badRequest = (message: string, details?: unknown) => new AppError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Sessão inválida ou expirada.") => new AppError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "Você não tem permissão para esta ação.") => new AppError(403, "FORBIDDEN", message);
export const notFound = (message = "Registro não encontrado.") => new AppError(404, "NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) => new AppError(409, "CONFLICT", message, details);
export const unprocessable = (message: string, details?: unknown) => new AppError(422, "UNPROCESSABLE", message, details);
export const tooMany = (message = "Muitas tentativas. Aguarde e tente novamente.") => new AppError(429, "RATE_LIMITED", message);
export const unavailable = (message: string) => new AppError(503, "UNAVAILABLE", message);
