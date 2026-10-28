/**
 * Optional native UI is available only inside a Telegram launch. This guard is
 * not authentication: the API independently validates initData before login.
 * Minimum versions follow https://core.telegram.org/bots/webapps.
 */
export function telegramUi(minVersion?: string): TelegramWebApp | undefined {
  const app = window.Telegram?.WebApp;
  if (!app?.initData) return undefined;
  if (minVersion && !app.isVersionAtLeast?.(minVersion)) return undefined;
  return app;
}
