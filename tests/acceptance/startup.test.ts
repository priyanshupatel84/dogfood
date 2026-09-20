import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..', '..')
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')
const dockerignore = readFileSync(join(root, '.dockerignore'), 'utf8')

describe('single-command startup (docker compose up)', () => {
  it('installs dependencies and builds inside the image, so no local npm install is needed', () => {
    expect(dockerfile).toMatch(/npm ci --include=dev/)
    expect(dockerfile).toMatch(/npm run build/)
    expect(dockerfile).toMatch(/db:migrate/)
  })

  it('builds hermetically: host node_modules can never leak into or be required by the image', () => {
    expect(dockerignore).toMatch(/^node_modules$/m)
    expect(compose).toMatch(/app:\n\s+build: \./)
    expect(compose).toMatch(/seed:\n\s+build: \./)
    expect(compose).toMatch(/cli:\n\s+build: \./)
  })

  it('does NOT execute the test suite on boot', () => {
    expect(compose).not.toMatch(/vitest/)
    expect(compose).not.toMatch(/npm", "run", "acceptance"/)
    expect(compose).not.toMatch(/npm run (test|acceptance)/)
  })

  it('seeds automatically once postgres and seaweedfs are healthy', () => {
    expect(compose).toMatch(/seed:\n\s+build: \./)
    expect(compose).toMatch(/command: \["npm", "run", "db:seed"\]/)
  })

  it('serves the app only after seeding succeeds', () => {
    expect(compose).toMatch(/seed:\n\s+condition: service_completed_successfully/)
  })

  it('keeps the CLI toolchain runnable with zero local setup', () => {
    expect(compose).toMatch(/cli:\n\s+build: \./)
    expect(compose).toMatch(/command: \["npm", "run", "cli"\]/)
  })
})
