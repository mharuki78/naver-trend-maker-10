import assert from 'node:assert/strict';
import test from 'node:test';
import { startGoogleLogin, pairGoogleLoginTab } from '../web/lib/google-auth-navigation.ts';

const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=test-state';
const launchUrl = 'https://api.example/v1/auth/google/launch?state=test-state';

function browserFixture(embedded = true) {
  const events = [];
  const tab = {
    opener: {}, closed: false,
    location: { replace(url) { events.push(['tab-navigation', url]); } },
    close() { tab.closed = true; events.push(['close']); },
  };
  const browser = {
    embedded,
    openTab() { events.push(['open']); return tab; },
    redirect(url) { events.push(['frame-navigation', url]); },
    popupOrigin: 'https://api.example',
    pairTab() { events.push(['pair']); return () => events.push(['unpair']); },
  };
  return { browser, tab, events };
}

test('embedded login opens a separate tab before the network wait and keeps Google out of the iframe', async () => {
  const { browser, tab, events } = browserFixture();
  const result = await startGoogleLogin(browser, async () => {
    assert.deepEqual(events, [['open']]);
    assert.notEqual(tab.opener, null);
    return { ok: true, authorizationUrl, launchUrl, handoffKey: 'private-proof' };
  }, async () => ({ authenticated: true, token: 'test-session', user: { id: 'u1', email: 'frame@example.com', name: 'Frame User' }, expiresAt: '2099-01-01' }));
  assert.deepEqual(events, [['open'], ['pair'], ['tab-navigation', launchUrl], ['close'], ['unpair']]);
  assert.equal(result.openedNewTab, true);
});

test('a blocked popup stops login before creating an unusable OAuth session', async () => {
  let requested = false;
  const { browser, events } = browserFixture();
  browser.openTab = () => null;
  await assert.rejects(startGoogleLogin(browser, async () => {
    requested = true;
    return { ok: true, authorizationUrl };
  }), /새 탭|팝업/);
  assert.equal(requested, false);
  assert.deepEqual(events, []);
});

test('an API failure closes the pending tab and preserves its readable error', async () => {
  const { browser, tab, events } = browserFixture();
  await assert.rejects(startGoogleLogin(browser, async () => ({ ok: false, message: '설정 확인이 필요합니다.' })), /설정 확인/);
  assert.equal(tab.closed, true);
  assert.deepEqual(events, [['open'], ['close']]);
});

test('standalone login redirects the current page without opening an extra tab', async () => {
  const { browser, events } = browserFixture(false);
  const result = await startGoogleLogin(browser, async () => ({ ok: true, authorizationUrl }));
  assert.deepEqual(events, [['frame-navigation', authorizationUrl]]);
  assert.equal(result.openedNewTab, false);
});

test('an unexpected authorization destination never receives the login window', async () => {
  const { browser, tab, events } = browserFixture();
  await assert.rejects(startGoogleLogin(browser, async () => ({ ok: true, authorizationUrl: 'https://untrusted.example/oauth' })), /주소/);
  assert.equal(tab.closed, true);
  assert.deepEqual(events, [['open'], ['close']]);
});

test('closing the pending tab while the API is responding stops navigation', async () => {
  const { browser, tab, events } = browserFixture();
  await assert.rejects(startGoogleLogin(browser, async () => {
    tab.closed = true;
    return { ok: true, authorizationUrl };
  }), /닫/);
  assert.equal(events.some(([event]) => event.includes('navigation')), false);
});

test('embedded authentication closes its temporary window and delivers the completed session to the iframe', async () => {
  const { browser, tab, events } = browserFixture();
  const session = { authenticated: true, token: 'iframe-session-token', user: { id: 'u1', email: 'iframe@example.com', name: 'Iframe User' }, expiresAt: '2099-01-01' };
  const result = await startGoogleLogin(browser, async () => ({ ok: true, authorizationUrl, launchUrl, handoffKey: 'private-iframe-proof' }), async key => {
    assert.equal(key, 'private-iframe-proof');
    assert.deepEqual(events, [['open'], ['pair'], ['tab-navigation', launchUrl]]);
    return session;
  });
  assert.deepEqual(result.session, session);
  assert.equal(tab.closed, true);
});

test('only the known launcher window and origin receive the private pairing proof', () => {
  let listener;
  let removed = false;
  const posted = [];
  const tab = { postMessage(message, origin) { posted.push({ message, origin }); } };
  const hub = {
    addEventListener(type, callback) { assert.equal(type, 'message'); listener = callback; },
    removeEventListener(type, callback) { assert.equal(callback, listener); removed = true; },
  };
  const cleanUp = pairGoogleLoginTab(hub, tab, new URL(launchUrl), 'private-proof');
  const ready = { type: 'baegot:google-handoff-ready', state: 'test-state' };
  listener({ origin: 'https://other.example', source: tab, data: ready });
  listener({ origin: 'https://api.example', source: {}, data: ready });
  listener({ origin: 'https://api.example', source: tab, data: { ...ready, state: 'other-state' } });
  assert.equal(posted.length, 0);
  listener({ origin: 'https://api.example', source: tab, data: ready });
  assert.deepEqual(posted, [{ origin: 'https://api.example', message: { type: 'baegot:google-handoff-bind', state: 'test-state', handoffKey: 'private-proof' } }]);
  cleanUp();
  assert.equal(removed, true);
});

test('a forged launcher origin is rejected before sending a pairing proof', async () => {
  const { browser, tab, events } = browserFixture();
  await assert.rejects(startGoogleLogin(browser, async () => ({ ok: true, authorizationUrl, launchUrl: 'https://other.example/v1/auth/google/launch?state=test-state', handoffKey: 'private-proof' }), async () => ({})), /연결/);
  assert.equal(events.some(([event]) => event === 'pair' || event === 'tab-navigation'), false);
  assert.equal(tab.closed, true);
});
