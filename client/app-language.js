// One preferred language for the screens, the notes and their sound. It is remembered on this phone
// and on the account.
import { setLanguage, language } from './lib/i18n.js';
import { patch } from './lib/api.js';
import { store, signedIn, navigate, refreshMe } from './lib/state.js';

/** Set when someone picks a language before signing in, so signing in does not undo the choice. */
const PICKED = 'vv.lang.picked';

const save = async (code) => {
  await patch('/me', { uiLang: code }).catch(() => {});
  await refreshMe().catch(() => {});
};

export async function chooseLanguage(code) {
  await setLanguage(code);
  if (signedIn()) await save(code);
  else sessionStorage.setItem(PICKED, code);
  navigate(location.pathname + location.search, { replace: true });
}

/** A demo person brings their own language, whatever was picked before. */
export const forgetPickedLanguage = () => sessionStorage.removeItem(PICKED);

/** After signing in, or on opening the app signed in: show it in the account's preferred language. */
export async function followAccountLanguage() {
  if (!signedIn()) return;
  const picked = sessionStorage.getItem(PICKED);
  forgetPickedLanguage();
  const preferred = picked || store.me.user.uiLang || language();
  if (preferred !== language()) await setLanguage(preferred);
  if (preferred !== store.me.user.uiLang) await save(preferred);
}
