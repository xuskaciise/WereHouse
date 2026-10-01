/**
 * An error whose message is safe to show to the client, with its HTTP status.
 * `details` (also safe to show) is added to the JSON body, e.g. per-row errors.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = "HttpError"
  }
}
