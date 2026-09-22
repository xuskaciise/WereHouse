/** An error whose message is safe to show to the client, with its HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "HttpError"
  }
}
