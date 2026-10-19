// Streams an OG Bot reply into Telegram: the first words go out as soon as
// they arrive, then the same message is edited as the reply grows (at most
// about once a second, which Telegram is happy with). When the reply is done
// the message is set to the final, post-processed text, and anything past
// Telegram's length limit follows as extra messages.

export const TG_CHUNK = 3800;

export type LiveReplyIo = {
  /** Sends a new message; resolves with Telegram's response (or null on failure). */
  send: (text: string) => Promise<unknown>;
  /** Edits a sent message's text. */
  edit: (messageId: number, text: string) => Promise<unknown>;
  /** Waits for anything that must land first (the trade "hold on" line). */
  beforeFirst?: () => Promise<unknown>;
  /** Called once when the first words are on screen. */
  onFirst?: () => void;
};

const messageId = (res: unknown) =>
  (res as { result?: { message_id?: number } } | null)?.result?.message_id ?? null;

export function createLiveReply(io: LiveReplyIo, intervalMs = 1000) {
  let text = "";
  let shown = "";
  let firstRes: unknown = null;
  let id: number | null = null;
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let chain: Promise<void> = Promise.resolve();
  let closed = false;

  const flush = () => {
    chain = chain.then(async () => {
      const next = text.slice(0, TG_CHUNK);
      if (!next.trim() || next === shown) return;
      if (id === null) {
        await io.beforeFirst?.();
        firstRes = await io.send(next);
        id = messageId(firstRes);
        if (id !== null) io.onFirst?.();
      } else {
        await io.edit(id, next);
      }
      shown = next;
      lastAt = Date.now();
    });
    return chain;
  };

  return {
    /** New words from the model. */
    push(delta: string) {
      if (closed) return;
      text += delta;
      if (timer) return;
      // First words go straight out; after that, at most one edit per interval.
      const wait = id === null && !shown ? 0 : Math.max(0, intervalMs - (Date.now() - lastAt));
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, wait);
    },
    /**
     * Shows the final reply. Returns every Telegram response (for clean-up
     * scheduling); empty when nothing was ever sent live, so the caller sends
     * it the normal way.
     */
    async finish(finalText: string): Promise<unknown[]> {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await chain;
      if (id === null) return [];
      const chunks = finalText.match(/[\s\S]{1,3800}/g) ?? [finalText];
      if (chunks[0] !== shown) await io.edit(id, chunks[0]);
      const sent: unknown[] = [firstRes];
      for (const c of chunks.slice(1)) sent.push(await io.send(c));
      return sent;
    },
  };
}
