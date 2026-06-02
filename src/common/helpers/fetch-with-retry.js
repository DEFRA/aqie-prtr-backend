import { createLogger } from './logging/logger.js'
import { randomInt } from 'node:crypto'

const logger = createLogger()

export const DEFAULT_MAX_RETRIES = 0
export const DEFAULT_RETRY_DELAY_MS = 500
export const DEFAULT_TIMEOUT_MS = 10_000

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getBackoffDelay(attempt, baseMs) {
  const jitterMs = randomInt(0, 100)
  return baseMs * 2 ** attempt + jitterMs
}

function createTimeoutController(timeoutMs) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, clear: () => clearTimeout(timeoutId) }
}

/**
 * Run a fetch with structured timing/error logging, abort-on-timeout, and
 * optional retry-with-backoff. Returns the raw Response — the caller still
 * checks `response.ok` and parses the body.
 *
 * Example log lines:
 *   [searchLocation] 200 in 234ms (attempt 1/1)
 *   [searchLocation] failed after 1 attempts in 5012ms: AbortError
 *
 * @param {(signal: AbortSignal) => Promise<Response>} fetchFn
 *   A function that performs the fetch and accepts the AbortSignal.
 * @param {object} options
 * @param {string} options.operationName - Identifier used in log lines.
 * @param {number} [options.maxRetries=0] - Total attempts = maxRetries + 1.
 * @param {number} [options.retryDelayMs=500] - Base for exponential backoff.
 * @param {number} [options.timeoutMs=10000]
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(fetchFn, options) {
  const {
    operationName,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options

  let lastError

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now()
    const { controller, clear } = createTimeoutController(timeoutMs)

    try {
      const response = await fetchFn(controller.signal)
      const duration = Date.now() - startTime
      logger.info(
        `[${operationName}] ${response.status} in ${duration}ms (attempt ${attempt + 1}/${maxRetries + 1})`
      )
      return response
    } catch (error) {
      lastError = error
      const duration = Date.now() - startTime
      const isLastAttempt = attempt === maxRetries

      if (isLastAttempt) {
        logger.error(
          `[${operationName}] failed after ${attempt + 1} attempts in ${duration}ms: ${error.message}`
        )
        break
      }

      const backoffMs = getBackoffDelay(attempt, retryDelayMs)
      logger.warn(
        `[${operationName}] attempt ${attempt + 1}/${maxRetries + 1} failed in ${duration}ms: ${error.message}; retrying in ${Math.round(backoffMs)}ms`
      )
      await delay(backoffMs)
    } finally {
      clear()
    }
  }
  throw lastError
}
