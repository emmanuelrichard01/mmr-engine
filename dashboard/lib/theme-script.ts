// Viewer preferences, applied to <html> before first paint so neither the
// theme nor the row density flashes or shifts. Shared by the server layout
// (inline script) and the client hooks, so this module must not be "use client".

export const THEME_STORAGE_KEY = 'mmr-theme';
export const DENSITY_STORAGE_KEY = 'mmr-density';

export type ThemePreference = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

/**
 * data-theme: the resolved theme (light | dark).
 * data-theme-pref: what the viewer chose (system | light | dark).
 * data-density: comfortable | compact.
 */
export const THEME_SCRIPT = `(function(){var d=document.documentElement;try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s!=='light'&&s!=='dark')s='system';var dark=s==='dark'||(s==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);d.setAttribute('data-theme',dark?'dark':'light');d.setAttribute('data-theme-pref',s);var n=localStorage.getItem('${DENSITY_STORAGE_KEY}');d.setAttribute('data-density',n==='compact'?'compact':'comfortable');}catch(e){d.setAttribute('data-theme','light');d.setAttribute('data-theme-pref','system');d.setAttribute('data-density','comfortable');}})();`;
