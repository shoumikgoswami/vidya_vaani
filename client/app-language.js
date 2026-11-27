// Changing the app language, remembered on this phone and on the account.
import { setLanguage } from './lib/i18n.js';
import { patch } from './lib/api.js';
import { signedIn, navigate, refreshMe } from './lib/state.js';

export async function chooseLanguage(code) {
  await setLanguage(code);
  if (signedIn()) {
    await patch('/me', { uiLang: code }).catch(() => {});
    await refreshMe().catch(() => {});
  }
  navigate(location.pathname + location.search, { replace: true });
}
