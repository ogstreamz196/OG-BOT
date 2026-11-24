// Spotting a provider's notice that came back in place of an answer.

/**
 * A provider's notice sent back as if it were the answer (Pollinations does
 * this when a key is out of credits): out of credits or quota, top-up and
 * quest links, a bad or missing key. Pure.
 */
export function isProviderNotice(text: string): boolean {
  return /enough credits|insufficient (?:credits?|balance|quota|funds)|pollinations\.ai\/(?:top-up|quests)|(?:quota|credits?) (?:exceeded|exhausted|used up)|rate limit (?:exceeded|reached)|(?:invalid|missing|expired) api key|api key (?:is )?(?:invalid|missing|expired)|this isn['’]t your pollinations account/i.test(
    text,
  );
}
