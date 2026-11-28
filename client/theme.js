// Light unless this phone's owner chose dark. Loaded before the styles paint, so the screen never
// flashes the other colours.
(() => {
  const KEY = 'vv.theme';
  const BARS = { light: '#f6f7fb', dark: '#0b0e1c' };
  const read = () => {
    try {
      return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  };
  const apply = (theme) => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BARS[theme]);
  };
  apply(read());
  window.vvTheme = {
    current: read,
    set(theme) {
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        // Private browsing: the choice lasts until the app closes.
      }
      apply(theme);
    },
  };
})();
