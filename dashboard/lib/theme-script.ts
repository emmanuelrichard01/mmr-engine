// Shared by the server layout (inline pre-paint script) and the client theme
// hook. Kept out of any "use client" module so the server can read the string.

export const THEME_STORAGE_KEY = 'mmr-theme';

/** Runs before first paint: applies the stored or system theme to <html>. */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');var d=s==='dark'||(s!=='light'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){}})();`;
