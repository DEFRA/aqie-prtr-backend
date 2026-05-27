import { config } from '#src/config.js'
import { fetchWithRetry } from '#src/common/helpers/fetch-with-retry.js'
/**
 * Thrown when aqie-location-backend is unreachable, times out, returns non-2xx,
 * or returns malformed JSON. Lets the route map upstream failures to a clean 502.
 */
export class LocationBackendError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message)
    this.name = 'LocationBackendError'
    this.status = status ?? null
    if (cause) this.cause = cause
  }
}

/**
 * Call aqie-location-backend's POST /osnameplaces endpoint.
 *
 * Mirrors the request shape used by aqie-monitoringstation-backend:
 *   POST <OSPlaceApiUrl>
 *   Content-Type: application/json
 *   Body: { userLocation: <query> }
 *
 * The upstream owns OS_NAMES_API_KEY; this client never sees it. Returns the
 * raw upstream payload untouched — mapping/shaping is deferred to a later step.
 *
 * @param {string} query - Caller-validated location query (postcode/town/place).
 * @param {object} [opts]
 * @param {string} [opts.traceId] - CDP trace id to forward to the upstream.
 * @returns {Promise<object>} Raw upstream JSON.
 * @throws {LocationBackendError}
 */
export async function searchLocation(query, opts = {}) {
  const url = config.get('OSPlaceApiUrl')
  const timeoutMs = config.get('OSPlaceApiTimeoutMs')
  const tracingHeader = config.get('tracing.header')

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'Accept-Encoding': 'identity'
  }
  const cdpXApiKey = config.get('OSPlaceApiKey')

  //TODO: remove when going to PROD
  /* v8 ignore next 3 - local only x-api-key */
  if (cdpXApiKey) {
    headers['x-api-key'] = cdpXApiKey
  }

  if (opts.traceId) {
    headers[tracingHeader] = opts.traceId
  }

  let response
  try {
    response = await fetchWithRetry(
      (signal) =>
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ userLocation: query }),
          signal
        }),
      { operationName: 'searchLocation', timeoutMs }
    )
  } catch (err) {
    throw new LocationBackendError(
      `Failed to reach location backend at ${url}: ${err.message}`,
      { cause: err }
    )
  }

  if (!response.ok) {
    throw new LocationBackendError(
      `Location backend returned ${response.status}`,
      { status: response.status }
    )
  }

  try {
    return await response.json()
  } catch (err) {
    throw new LocationBackendError('Location backend returned invalid JSON', {
      cause: err
    })
  }
}
