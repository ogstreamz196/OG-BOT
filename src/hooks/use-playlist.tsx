import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LoopMode = "off" | "all" | "one";

interface TrackControls {
  title: string;
  /** Starts playback (fetching the signed URL if needed). */
  play: () => Promise<void> | void;
  pause: () => void;
  /** The live <audio> element, once mounted. */
  el: () => HTMLAudioElement | null;
}

interface PlaylistApi {
  order: string[];
  currentId: string | null;
  loop: LoopMode;
  setLoop: (m: LoopMode) => void;
  shuffle: boolean;
  setShuffle: (v: boolean) => void;
  setOrder: (ids: string[]) => void;
  register: (id: string, controls: TrackControls) => () => void;
  markCurrent: (id: string) => void;
  playId: (id: string) => void;
  next: () => void;
  prev: () => void;
  /** Called by a track when it finishes: loops or rolls onto the next one. */
  handleEnded: (id: string) => void;
  getControls: (id: string) => TrackControls | undefined;
}

const PlaylistContext = createContext<PlaylistApi | null>(null);

export function PlaylistProvider({ children }: { children: ReactNode }) {
  const registry = useRef(new Map<string, TrackControls>());
  const [order, setOrderState] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loop, setLoop] = useState<LoopMode>("all");

  const orderRef = useRef<string[]>([]);
  orderRef.current = order;
  const currentRef = useRef<string | null>(null);
  currentRef.current = currentId;
  const loopRef = useRef<LoopMode>("all");
  loopRef.current = loop;
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  shuffleRef.current = shuffle;

  const setOrder = useCallback((ids: string[]) => {
    setOrderState((prev) =>
      prev.length === ids.length && prev.every((v, i) => v === ids[i]) ? prev : ids,
    );
  }, []);

  const register = useCallback((id: string, controls: TrackControls) => {
    registry.current.set(id, controls);
    return () => {
      if (registry.current.get(id) === controls) registry.current.delete(id);
    };
  }, []);

  const getControls = useCallback((id: string) => registry.current.get(id), []);

  const markCurrent = useCallback((id: string) => setCurrentId(id), []);

  const playId = useCallback((id: string) => {
    const c = registry.current.get(id);
    if (!c) return;
    const previousId = currentRef.current;
    if (previousId && previousId !== id) registry.current.get(previousId)?.pause();
    currentRef.current = id;
    setCurrentId(id);
    void Promise.resolve(c.play()).catch(() => {});
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const ids = orderRef.current.filter((id) => registry.current.has(id));
      if (ids.length === 0) return;
      if (shuffleRef.current && dir === 1 && ids.length > 1) {
        const pool = ids.filter((id) => id !== currentRef.current);
        playId(pool[Math.floor(Math.random() * pool.length)]!);
        return;
      }
      const idx = currentRef.current ? ids.indexOf(currentRef.current) : -1;
      let nextIdx = idx + dir;
      if (nextIdx >= ids.length) nextIdx = loopRef.current === "off" ? -1 : 0;
      if (nextIdx < 0 && dir === -1) nextIdx = ids.length - 1;
      if (nextIdx < 0) return;
      playId(ids[nextIdx]!);
    },
    [playId],
  );

  const next = useCallback(() => step(1), [step]);
  const prev = useCallback(() => step(-1), [step]);

  const handleEnded = useCallback(
    (id: string) => {
      if (currentRef.current !== id) return;
      if (loopRef.current === "one") {
        const c = registry.current.get(id);
        const el = c?.el();
        if (el) {
          el.currentTime = 0;
          void el.play().catch(() => {});
        }
        return;
      }
      step(1);
    },
    [step],
  );

  const value = useMemo<PlaylistApi>(
    () => ({
      order,
      currentId,
      loop,
      setLoop,
      shuffle,
      setShuffle,
      setOrder,
      register,
      markCurrent,
      playId,
      next,
      prev,
      handleEnded,
      getControls,
    }),
    [
      order,
      currentId,
      loop,
      shuffle,
      setOrder,
      register,
      markCurrent,
      playId,
      next,
      prev,
      handleEnded,
      getControls,
    ],
  );

  return <PlaylistContext.Provider value={value}>{children}</PlaylistContext.Provider>;
}

/** Returns null outside a provider so players work standalone too. */
export function usePlaylist() {
  return useContext(PlaylistContext);
}

/** Declarative helper: keeps the queue in sync with the rendered rows. */
export function PlaylistOrder({ ids }: { ids: string[] }) {
  const playlist = usePlaylist();
  const key = ids.join(",");
  useEffect(() => {
    playlist?.setOrder(key ? key.split(",") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
