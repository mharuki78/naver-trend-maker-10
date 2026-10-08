import type { AuthTokenSession } from "@runacademy/shared";

type GoogleStartResponse =
  | { ok: true; authorizationUrl: string; handoffKey?: string }
  | { ok: false; message?: string };

export type GoogleLoginTab = {
  opener: unknown;
  closed: boolean;
  location: { replace(url: string): void };
  close(): void;
};

export type GoogleLoginBrowser = {
  embedded: boolean;
  openTab(): GoogleLoginTab | null;
  redirect(url: string): void;
};

export async function startGoogleLogin(
  browser: GoogleLoginBrowser,
  authorize: () => Promise<GoogleStartResponse>,
  waitForSession?: (handoffKey: string) => Promise<AuthTokenSession>,
) {
  // Open synchronously during the click: waiting for the API first loses
  // the browser's user activation and may trigger the popup blocker.
  const tab = browser.embedded ? browser.openTab() : null;
  if (browser.embedded && (!tab || tab.closed)) {
    throw new Error("새 탭을 열지 못했습니다. 팝업을 허용하거나 '새 탭에서 실행'으로 로그인해 주세요.");
  }
  if (tab) tab.opener = null;

  try {
    const response = await authorize();
    if (!response.ok) throw new Error(response.message || "Google 로그인 연결을 시작하지 못했습니다.");
    const destination = new URL(response.authorizationUrl);
    if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com" || destination.pathname !== "/o/oauth2/v2/auth") {
      throw new Error("Google 로그인 주소를 확인하지 못했습니다. 다시 시도해 주세요.");
    }
    if (tab) {
      if (tab.closed) throw new Error("Google 로그인 탭이 닫혔습니다. 다시 로그인해 주세요.");
      tab.location.replace(destination.href);
    } else {
      browser.redirect(destination.href);
    }
    if (tab) {
      if (!response.handoffKey || !waitForSession) {
        throw new Error("인트라넷 로그인 연결을 확인하지 못했습니다. 화면을 새로고침하고 다시 시도해 주세요.");
      }
      const session = await waitForSession(response.handoffKey);
      // COOP may sever the popup reference; the callback also closes itself.
      try { tab.close(); } catch { /* The login window may already be closed. */ }
      return { openedNewTab: true, session };
    }
    return { openedNewTab: false, session: undefined };
  } catch (error) {
    if (tab && !tab.closed) tab.close();
    throw error;
  }
}
