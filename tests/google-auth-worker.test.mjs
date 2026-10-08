import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import worker from '../.local/baegot-worker/index.js';

const schema = readFileSync(new URL('../edge-api/schema.sql', import.meta.url), 'utf8');
const frontend = 'https://baegot-naver-trend.vercel.app';

function workerFixture(t, configured = true) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(schema);
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      let bindings = [];
      return {
        bind(...values) { bindings = values; return this; },
        async first() { return sqlite.prepare(sql).get(...bindings) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        async run() { return sqlite.prepare(sql).run(...bindings); },
      };
    },
  };
  const env = {
    DB: db,
    AUTH_ALLOWED_RETURN_ORIGINS: frontend,
    ...(configured ? { GOOGLE_OAUTH_CLIENT_ID: 'unit-test-client', GOOGLE_OAUTH_CLIENT_SECRET: 'unit-test-secret' } : {}),
  };
  return { env, sqlite };
}

function authRequest(returnTo, headers = {}) {
  const url = new URL('https://api.example/v1/auth/google/start');
  url.searchParams.set('return_to', returnTo);
  return new Request(url, { headers });
}

test('configured Google login creates one expiring state and returns the exact callback and minimum identity scopes', async t => {
  const { env, sqlite } = workerFixture(t);
  const response = await worker.fetch(authRequest(`${frontend}/sourcing/admin`), env, { waitUntil() {} });
  const result = await response.json();
  assert.equal(result.ok, true);
  const url = new URL(result.authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://api.example/v1/auth/google/callback');
  assert.equal(url.searchParams.get('scope'), 'openid email profile');
  const state = sqlite.prepare('SELECT * FROM auth_oauth_states').get();
  assert.equal(state.return_to, `${frontend}/sourcing/admin`);
  assert.equal(state.state, url.searchParams.get('state'));
  assert.ok(Date.parse(state.expires_at) > Date.now());
  assert.equal(state.used_at, null);
  assert.equal(JSON.stringify(result).includes('unit-test-secret'), false);
});

test('a forged Origin or Referer cannot send the completed login to an unapproved site', async t => {
  const { env, sqlite } = workerFixture(t);
  const response = await worker.fetch(authRequest('https://untrusted.example/capture', {
    Origin: 'https://untrusted.example', Referer: 'https://untrusted.example/login',
  }), env, { waitUntil() {} });
  const result = await response.json();
  assert.equal(result.code, 'INVALID_RETURN_URL');
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_oauth_states').get().count, 0);
});

test('an explicit company return allowlist does not inherit another service origin', async t => {
  const { env, sqlite } = workerFixture(t);
  const response = await worker.fetch(authRequest('https://hanirum-sourcing-maker-10.pages.dev/sourcing/admin'), env, { waitUntil() {} });
  assert.equal((await response.json()).code, 'INVALID_RETURN_URL');
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_oauth_states').get().count, 0);
});

test('an unconfigured provider cannot create an OAuth session', async t => {
  const { env, sqlite } = workerFixture(t, false);
  const response = await worker.fetch(authRequest(`${frontend}/sourcing/admin`), env, { waitUntil() {} });
  assert.equal((await response.json()).code, 'GOOGLE_AUTH_NOT_CONFIGURED');
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_oauth_states').get().count, 0);
});

test('the new service still rejects an anonymous request for work history', async t => {
  const { env } = workerFixture(t);
  const response = await worker.fetch(new Request('https://api.example/v1/trends/admin/board'), env, { waitUntil() {} });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTH_REQUIRED');
});
