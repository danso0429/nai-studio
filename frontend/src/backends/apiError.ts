// HTTP 실패를 문자열 파싱에만 의존하지 않고 호출자가 상태별로 분기할 수 있게 보존한다.
// message 형식은 기존 `API error <status>:` 소비처와 호환되도록 유지한다.
export class BackendApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`API error ${status}: ${responseBody}`);
    this.name = 'BackendApiError';
  }
}

export function isBackendNotFoundError(error: unknown): boolean {
  if (error instanceof BackendApiError) return error.status === 404;
  return /^API error 404\b/.test(String((error as any)?.message || ''));
}
