/**
 * One track at a time: any player that starts calls claimAudio(el), which
 * pauses whichever player had the floor (and the background music).
 */
let current: HTMLAudioElement | null = null;

export function claimAudio(el: HTMLAudioElement) {
  if (current && current !== el && !current.paused) current.pause();
  current = el;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("og:background-music-pause"));
  }
}
