import { afterAll, beforeAll } from 'vitest'
import { setup, teardown } from 'vitest-mongodb'

beforeAll(async () => {
  // Setup mongo mock
  await setup({
    binary: {
      version: '7.0.28'
    },
    serverOptions: {}
  })
  process.env.MONGO_URI = globalThis.__MONGO_URI__
}, 120_000)

afterAll(async () => {
  await teardown()
})
