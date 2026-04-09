export interface ApiError {
  /** Upper-snake-case error code (e.g. ENDPOINT_NOT_IMPLEMENTED) */
  code: string;
  /** Human-readable description */
  message: string;
  /** Corresponding HTTP status code */
  status: number;
}

/** Base response envelope — every API response conforms to this shape. */
export interface ApiResponse<T> {
  data: T | null;
  error?: ApiError;
  /** Unix timestamp in milliseconds at the time of the response */
  time: number;
  /** Original request path */
  request: string;
}

/** Successful response — data is always present, error is absent. */
export interface ApiSuccessResponse<T> extends ApiResponse<T> {
  data: T;
  error?: never;
}

/** Error response — data is null, error is always present. */
export interface ApiErrorResponse<T = null> extends ApiResponse<T> {
  data: T;
  error: ApiError;
}
