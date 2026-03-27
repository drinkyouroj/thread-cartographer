// Custom error classes with HTTP status mapping
// Per DECISION-002 Required Change #8

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  toHttpResponse() {
    return {
      status: this.statusCode,
      body: {
        error: this.code,
        message: this.message,
      },
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, code: string = "INVALID_URL") {
    super(message, code, 400);
  }
}

export class RateLimitError extends AppError {
  public readonly retryAfter: number;

  constructor(retryAfter: number) {
    super("Too many requests.", "RATE_LIMITED", 429);
    this.retryAfter = retryAfter;
  }

  override toHttpResponse() {
    return {
      status: this.statusCode,
      body: {
        error: this.code,
        message: this.message,
        retryAfter: this.retryAfter,
      },
    };
  }
}

export class RedditApiError extends AppError {
  public readonly redditStatus: number;

  constructor(redditStatus: number) {
    const { code, message, status } = RedditApiError.classify(redditStatus);
    super(message, code, status);
    this.redditStatus = redditStatus;
  }

  private static classify(redditStatus: number) {
    if (redditStatus === 403 || redditStatus === 451) {
      return {
        code: "THREAD_INACCESSIBLE",
        message:
          "This thread is not accessible. It may be private, quarantined, or geo-restricted.",
        status: 502,
      };
    }
    if (redditStatus === 429) {
      return {
        code: "REDDIT_RATE_LIMITED",
        message: "Reddit rate limit reached. Try again shortly.",
        status: 503,
      };
    }
    return {
      code: "REDDIT_UNAVAILABLE",
      message: "Reddit is temporarily unavailable. Try again in a few minutes.",
      status: 502,
    };
  }
}

export class UpstreamError extends AppError {
  constructor(message: string = "This thread took too long to load. Try a smaller thread or try again.") {
    super(message, "TIMEOUT", 504);
  }
}
