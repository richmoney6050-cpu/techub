export class HttpError extends Error {
  status: number;
  code?: string;
  details?: any;
  constructor(status: number, message: string, code?: string, details?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const bad = (m: string, d?: any) => new HttpError(400, m, 'bad_request', d);
export const notFound = (m = 'Not found') => new HttpError(404, m, 'not_found');
export const forbidden = (m = 'You do not have permission to do this') => new HttpError(403, m, 'forbidden');
export const conflict = (m: string, code = 'conflict', d?: any) => new HttpError(409, m, code, d);
