/**
 * One-tap sign-in for links the bot sends to a linked chat.
 *
 * Telegram opens links in its own in-app browser, which doesn't share the
 * member's Safari/Chrome sign-in, so people landed signed out and made a
 * second account. Buttons sent to a linked chat now carry a one-time,
 * short-lived Supabase magic-link token for that chat's account; /tg trades
 * it for a session. One token per message (a new one replaces the last), and
 * plain links are used whenever a token can't be made.
 */
const SITE = "https://ogbot.co.uk";

type Admin = {
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{ data: { user: { email?: string | null } | null } }>;
      generateLink: (args: {
        type: "magiclink";
        email: string;
      }) => Promise<{ data: { properties?: { hashed_token?: string } } | null; error: unknown }>;
    };
  };
};

/** Returns a function that turns a site path into a link signed in as `userId`. */
export function telegramSignInLinker(admin: unknown, userId: string) {
  let token: Promise<string | null> | null = null;
  const getToken = () =>
    (token ??= (async () => {
      try {
        const a = admin as Admin;
        const { data: u } = await a.auth.admin.getUserById(userId);
        const email = u?.user?.email;
        if (!email) return null;
        const { data, error } = await a.auth.admin.generateLink({ type: "magiclink", email });
        if (error) return null;
        return data?.properties?.hashed_token ?? null;
      } catch (e) {
        console.warn("[telegram] sign-in link failed", e);
        return null;
      }
    })());
  return async (path: string) => {
    const t = await getToken();
    const clean = path.startsWith("/") ? path : `/${path}`;
    return t
      ? `${SITE}/tg?t=${encodeURIComponent(t)}&next=${encodeURIComponent(clean)}`
      : `${SITE}${clean === "/" ? "" : clean}`;
  };
}
