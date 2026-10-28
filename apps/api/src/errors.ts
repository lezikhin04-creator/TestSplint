export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const invalid = (message = 'Проверьте данные запроса.') => new ApiError(400, 'INVALID_REQUEST', message);
export const missing = () => new ApiError(404, 'NOT_FOUND', 'Объект недоступен.');
