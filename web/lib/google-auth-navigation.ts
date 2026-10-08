import type { AuthTokenSession } from "@runacademy/shared";

type GoogleStartResponse =
  | { ok: true; authorizationUrl: string; handoffKey?: string; launchUrl?: string }
  | { ok: false; message?: string };

export type GoogleLoginTab = {
  opener: unknown;
  closed: boolean;
  location: { replace(url: string): void };
  close(): void;
  postMessage(message: unknown, targetOrigin: string): void;
};

export type GoogleLoginBrowser = {
  embedded: boolean;
  openTab(): GoogleLoginTab | null;
  redirect(url: string): void;
  popupOrigin?: string;
  pairTab?(tab: GoogleLoginTab, launchUrl: URL, handoffKey: string): () => void;
};

export function pairGoogleLoginTab(
  hub: Pick<Window, "addEventListener" | "removeEventListener">,
  tab: GoogleLoginTab,
  launchUrl: URL,
  handoffKey: string,
) {
  const state = launchUrl.searchParams.get("state");
  const listener = (event: MessageEvent) => {
    if (event.origin !== launchUrl.origin || event.source !== tab || event.data?.type !== "baegot:google-handoff-ready" || event.data?.state !== state) return;
    tab.postMessage({ type: "baegot:google-handoff-bind", state, handoffKey }, launchUrl.origin);
  };
  hub.addEventListener("message", listener);
  return () => hub.removeEventListener("message", listener);
}

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
  let unpair: (() => void) | undefined;

  try {
    const response = await authorize();
    if (!response.ok) throw new Error(response.message || "Google 로그인 연결을 시작하지 못했습니다.");
    const destination = new URL(response.authorizationUrl);
    if (destination.protocol !== "https:" || destination.hostname !== "accounts.google.com" || destination.pathname !== "/o/oauth2/v2/auth") {
      throw new Error("Google 로그인 주소를 확인하지 못했습니다. 다시 시도해 주세요.");
    }
    if (tab) {
      if (tab.closed) throw new Error("Google 로그인 탭이 닫혔습니다. 다시 로그인해 주세요.");
      if (!response.handoffKey || !response.launchUrl || !waitForSession || !browser.pairTab) {
        throw new Error("인트라넷 로그인 연결을 확인하지 못했습니다. 화면을 새로고침하고 다시 시도해 주세요.");
      }
      const launch = new URL(response.launchUrl);
      if (launch.protocol !== "https:" || launch.origin !== browser.popupOrigin || launch.pathname !== "/v1/auth/google/launch" || launch.searchParams.get("state") !== destination.searchParams.get("state")) {
        throw new Error("인트라넷 로그인 연결 주소를 확인하지 못했습니다. 다시 시도해 주세요.");
      }
      // Keep the trusted launcher connected until it pairs its first-party cookie.
      // The launcher drops opener before navigating to Google.
      unpair = browser.pairTab(tab, launch, response.handoffKey);
      tab.location.replace(launch.href);
      const session = await waitForSession(response.handoffKey);
      // COOP may sever the popup reference; the callback also closes itself.
      try { tab.close(); } catch { /* The login window may already be closed. */ }
      return { openedNewTab: true, session };
    }
    browser.redirect(destination.href);
    return { openedNewTab: false, session: undefined };
  } catch (error) {
    try { if (tab && !tab.closed) tab.close(); } catch { /* COOP may already detach the window. */ }
    throw error;
  } finally {
    unpair?.();
  }
}
