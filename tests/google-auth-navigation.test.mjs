import assert from 'node:assert/strict';
import test from 'node:test';
import { startGoogleLogin } from '../web/lib/google-auth-navigation.ts';

const authorizationUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test&state=test-state';

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
  };
  return { browser, tab, events };
}

test('embedded login opens a separate tab before the network wait and keeps Google out of the iframe', async () => {
  const { browser, tab, events } = browserFixture();
  const result = await startGoogleLogin(browser, async () => {
    assert.deepEqual(events, [['open']]);
    assert.equal(tab.opener, null);
    return { ok: true, authorizationUrl };
  });
  assert.deepEqual(events, [['open'], ['tab-navigation', authorizationUrl]]);
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
