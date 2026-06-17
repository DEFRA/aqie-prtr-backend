import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'

import { convictValidateMongoUri } from '#src/common/helpers/convict/validate-mongo-uri.js'

convict.addFormat(convictValidateMongoUri)
convict.addFormats(convictFormatWithValidator)

const isProduction = process.env.NODE_ENV === 'production'
const isTest = process.env.NODE_ENV === 'test'

export const config = convict({
  serviceVersion: {
    doc: 'The service version, this variable is injected into your docker container in CDP environments',
    format: String,
    nullable: true,
    default: null,
    env: 'SERVICE_VERSION'
  },
  host: {
    doc: 'The IP address to bind',
    format: 'ipaddress',
    default: '0.0.0.0',
    env: 'HOST'
  },
  port: {
    doc: 'The port to bind',
    format: 'port',
    default: 3001,
    env: 'PORT'
  },
  serviceName: {
    doc: 'Api Service Name',
    format: String,
    default: 'aqie-prtr-backend'
  },
  cdpEnvironment: {
    doc: 'The CDP environment the app is running in. With the addition of "local" for local development',
    format: [
      'local',
      'infra-dev',
      'management',
      'dev',
      'test',
      'perf-test',
      'ext-test',
      'prod'
    ],
    default: 'local',
    env: 'ENVIRONMENT'
  },
  log: {
    isEnabled: {
      doc: 'Is logging enabled',
      format: Boolean,
      default: !isTest,
      env: 'LOG_ENABLED'
    },
    level: {
      doc: 'Logging level',
      format: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
      default: 'info',
      env: 'LOG_LEVEL'
    },
    format: {
      doc: 'Format to output logs in',
      format: ['ecs', 'pino-pretty'],
      default: isProduction ? 'ecs' : 'pino-pretty',
      env: 'LOG_FORMAT'
    },
    redact: {
      doc: 'Log paths to redact',
      format: Array,
      default: isProduction
        ? ['req.headers.authorization', 'req.headers.cookie', 'res.headers']
        : ['req', 'res', 'responseTime']
    }
  },
  mongo: {
    mongoUrl: {
      doc: 'URI for mongodb',
      format: String,
      default: 'mongodb://127.0.0.1:27017/',
      env: 'MONGO_URI'
    },
    databaseName: {
      doc: 'database for mongodb',
      format: String,
      default: 'aqie-prtr-backend',
      env: 'MONGO_DATABASE'
    },
    mongoOptions: {
      retryWrites: {
        doc: 'Enable Mongo write retries, overrides mongo URI when set.',
        format: Boolean,
        default: null,
        nullable: true,
        env: 'MONGO_RETRY_WRITES'
      },
      readPreference: {
        doc: 'Mongo read preference, overrides mongo URI when set.',
        format: [
          'primary',
          'primaryPreferred',
          'secondary',
          'secondaryPreferred',
          'nearest'
        ],
        default: null,
        nullable: true,
        env: 'MONGO_READ_PREFERENCE'
      }
    }
  },
  s3: {
    bucket: {
      doc: 'S3 bucket name for file (xmls) storage',
      format: String,
      default: '',
      env: 'S3_BUCKET'
    },
    region: {
      doc: 'AWS region for S3 bucket',
      format: String,
      default: '',
      env: 'AWS_REGION'
    }
  },
  OSPlaceApiUrl: {
    doc: 'Base URL of aqie-location-backend - internal service this BFF calls for the OS names lookups. The upstream service own the API Key',
    format: String,
    default: `https://aqie-location-backend.${process.env.ENVIRONMENT}.cdp-int.defra.cloud/osnameplaces`,
    env: 'OSPLACE_API_URL'
  },
  OSPlaceApiTimeoutMs: {
    doc: 'Request timeout (ms) for calls to aqie-location-backened',
    format: 'nat',
    default: 10000,
    env: 'OSPLACE_API_TIMEOUT_MS'
  },
  //TODO: replace this commented code before going to prod, keep till than for local dev
  // OSPlaceApiUrl: {
  //   doc: 'OSPlace API url',
  //   format: String,
  //   // default: `https://aqie-location-backend.dev.cdp-int.defra.cloud/osnameplaces`,
  //   default: `https://ephemeral-protected.api.dev.cdp-int.defra.cloud/aqie-location-backend/osnameplaces`,
  //   // default: `http://localhost:3001/osnameplaces`,
  //   env: 'OSPLACE_API_URL'
  // },
  OSPlaceApiKey: {
    doc: 'OSPlace API key',
    format: String,
    default: '',
    env: 'OSPLACE_API_KEY'
  },
  httpProxy: {
    doc: 'HTTP Proxy URL',
    format: String,
    nullable: true,
    default: null,
    env: 'HTTP_PROXY'
  },
  tracing: {
    header: {
      doc: 'CDP tracing header name',
      format: String,
      default: 'x-cdp-request-id',
      env: 'TRACING_HEADER'
    }
  },
  allowOriginUrl: {
    doc: 'URL to access-control-allow-origin',
    format: String,
    default: '',
    env: 'ACCESS_CONTROL_ALLOW_ORIGIN_URL'
  }
})

config.validate({ allowed: 'strict' })
