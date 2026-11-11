/**
 * Inline <head> script (plain ES5): on browsers without CSS cascade layers
 * (older TVs, car screens and phones), add the build's legacy stylesheet
 * (styles-<hash>.legacy.css, see vite-legacy-css.ts) right after the main one.
 */
export const LEGACY_CSS_LOADER =
  "(function(){if(window.CSSLayerBlockRule)return;function go(){var l=document.querySelector('link[rel=\"stylesheet\"][href*=\"/assets/styles-\"]');if(!l)return false;var n=document.createElement('link');n.rel='stylesheet';n.href=l.getAttribute('href').replace(/\\.css(\\?.*)?$/,'.legacy.css');l.parentNode.insertBefore(n,l.nextSibling);return true}if(!go())document.addEventListener('DOMContentLoaded',go)})();";
