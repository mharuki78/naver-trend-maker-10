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

function completionRequest(handoffKey) {
  return new Request('https://api.example/v1/auth/google/complete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handoffKey }),
  });
}

async function embeddedStart(env) {
  const request = authRequest(`${frontend}/sourcing/admin`);
  const url = new URL(request.url);
  url.searchParams.set('embedded', '1');
  return (await worker.fetch(new Request(url), env, { waitUntil() {} })).json();
}

async function bindEmbeddedBrowser(env, started) {
  const launched = await worker.fetch(new Request(started.launchUrl), env, { waitUntil() {} });
  assert.equal(launched.status, 200);
  const setCookie = launched.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  const bound = await worker.fetch(new Request('https://api.example/v1/auth/google/bind', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://api.example' },
    body: JSON.stringify({ state, handoffKey: started.handoffKey }),
  }), env, { waitUntil() {} });
  assert.equal((await bound.json()).ok, true);
  return cookie;
}

test('embedded login issues a private proof separate from the Google URL and keeps a pending iframe unsigned in', async t => {
  const { env, sqlite } = workerFixture(t);
  const started = await embeddedStart(env);
  assert.equal(typeof started.handoffKey, 'string');
  assert.ok(started.handoffKey.length >= 43);
  assert.equal(started.authorizationUrl.includes(started.handoffKey), false);
  const state = sqlite.prepare('SELECT * FROM auth_oauth_states').get();
  assert.notEqual(state.handoff_secret_hash, started.handoffKey);
  const pending = await worker.fetch(completionRequest(started.handoffKey), env, { waitUntil() {} });
  assert.deepEqual(await pending.json(), { ok: true, pending: true });
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
});

test('Google success returns one session to the initiating iframe and never opens an analysis redirect', async t => {
  const { env, sqlite } = workerFixture(t);
  const started = await embeddedStart(env);
  assert.equal(typeof started.handoffKey, 'string');
  const cookie = await bindEmbeddedBrowser(env, started);
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'provider-only-test-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' });
    }
    assert.equal(String(url), 'https://openidconnect.googleapis.com/v1/userinfo');
    return Response.json({ sub: 'test-google-subject', email: 'iframe@example.com', email_verified: true, name: 'Iframe User' });
  });
  const callback = await worker.fetch(new Request(`https://api.example/v1/auth/google/callback?state=${state}&code=valid-test-code`, { headers: { Cookie: cookie } }), env, { waitUntil() {} });
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get('location'), null);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
  const wrongProof = await worker.fetch(completionRequest(state), env, { waitUntil() {} });
  assert.equal((await wrongProof.json()).ok, false);
  // Another member starting login must not purge a completed, unclaimed handoff.
  await embeddedStart(env);
  const completed = await worker.fetch(completionRequest(started.handoffKey), env, { waitUntil() {} });
  const result = await completed.json();
  assert.equal(result.ok, true);
  assert.equal(result.session.authenticated, true);
  assert.equal(result.session.user.email, 'iframe@example.com');
  const session = await worker.fetch(new Request('https://api.example/v1/auth/session', {
    headers: { Authorization: `Bearer ${result.session.token}` },
  }), env, { waitUntil() {} });
  assert.equal((await session.json()).session.authenticated, true);
  const replay = await worker.fetch(completionRequest(started.handoffKey), env, { waitUntil() {} });
  assert.equal((await replay.json()).ok, false);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 1);
});

test('cancelled or expired Google login cannot leave the iframe waiting or create a session', async t => {
  const { env, sqlite } = workerFixture(t);
  const started = await embeddedStart(env);
  assert.equal(typeof started.handoffKey, 'string');
  const cookie = await bindEmbeddedBrowser(env, started);
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  await worker.fetch(new Request(`https://api.example/v1/auth/google/callback?state=${state}&error=access_denied`, { headers: { Cookie: cookie } }), env, { waitUntil() {} });
  const denied = await worker.fetch(completionRequest(started.handoffKey), env, { waitUntil() {} });
  assert.equal((await denied.json()).code, 'GOOGLE_ACCESS_DENIED');
  const expired = await embeddedStart(env);
  sqlite.prepare("UPDATE auth_oauth_states SET expires_at='2000-01-01T00:00:00.000Z' WHERE state=?").run(new URL(expired.authorizationUrl).searchParams.get('state'));
  const timeout = await worker.fetch(completionRequest(expired.handoffKey), env, { waitUntil() {} });
  assert.equal((await timeout.json()).ok, false);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
});

test('embedded callback requires the same browser that paired its trusted popup', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('An unpaired callback must not contact Google'); });
  const { env, sqlite } = workerFixture(t);
  const started = await embeddedStart(env);
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  const callbackUrl = `https://api.example/v1/auth/google/callback?state=${state}&code=valid-test-code`;
  const unbound = await worker.fetch(new Request(callbackUrl), env, { waitUntil() {} });
  assert.equal(unbound.status, 400);
  const cookie = await bindEmbeddedBrowser(env, started);
  const anotherBrowser = await worker.fetch(new Request(callbackUrl), env, { waitUntil() {} });
  assert.equal(anotherBrowser.status, 400);
  const wrongCookie = await worker.fetch(new Request(callbackUrl, { headers: { Cookie: cookie.replace(/=.*/, '=wrong-browser') } }), env, { waitUntil() {} });
  assert.equal(wrongCookie.status, 400);
  assert.equal(sqlite.prepare('SELECT used_at FROM auth_oauth_states WHERE state=?').get(state).used_at, null);
  assert.deepEqual(await (await worker.fetch(completionRequest(started.handoffKey), env, { waitUntil() {} })).json(), { ok: true, pending: true });
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
});

test('a browser binding cannot be overwritten by another launcher and legacy unbound results cannot issue sessions', async t => {
  const { env, sqlite } = workerFixture(t);
  const started = await embeddedStart(env);
  await bindEmbeddedBrowser(env, started);
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  const launchedAgain = await worker.fetch(new Request(started.launchUrl), env, { waitUntil() {} });
  const replacementCookie = launchedAgain.headers.get('set-cookie').split(';')[0];
  const rebound = await worker.fetch(new Request('https://api.example/v1/auth/google/bind', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: replacementCookie, Origin: 'https://api.example' },
    body: JSON.stringify({ state, handoffKey: started.handoffKey }),
  }), env, { waitUntil() {} });
  assert.equal((await rebound.json()).ok, false);
  const legacy = await embeddedStart(env);
  sqlite.prepare("UPDATE auth_oauth_states SET handoff_error='GOOGLE_ACCESS_DENIED' WHERE state=?").run(new URL(legacy.authorizationUrl).searchParams.get('state'));
  const rejected = await worker.fetch(completionRequest(legacy.handoffKey), env, { waitUntil() {} });
  assert.equal((await rejected.json()).ok, false);
  assert.equal(sqlite.prepare('SELECT count(*) AS count FROM auth_sessions').get().count, 0);
});
