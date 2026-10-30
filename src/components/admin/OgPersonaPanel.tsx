import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { adminGetPersonaDefaults } from "@/lib/persona-admin.functions";
import { Bot, Loader2, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Link } from "@tanstack/react-router";
import { useSiteContent, useSetSiteContent } from "@/hooks/use-site-content";
import { toast } from "sonner";

// Persona now lives in Boss → OG Bot; keep the old link working.

/** Persona editor. Rendered inside the gated OG Bot page. */
export function OgPersonaPanel() {
  const { isAdmin, isLoading } = useRole();
  const { get, isLoading: loadingContent } = useSiteContent();
  const setContent = useSetSiteContent();
  const loadDefaults = useServerFn(adminGetPersonaDefaults);

  const [script, setScript] = useState("");
  const [voice, setVoice] = useState("");
  const [dictionary, setDictionary] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loadingContent || !isAdmin) return;
    let cancelled = false;
    // Defaults live server-side so the persona text never ships in the bundle.
    void loadDefaults()
      .then((d) => {
        if (cancelled) return;
        setScript(get("og_persona.script", d.script));
        setVoice(get("og_persona.voice", d.voice));
        setDictionary(get("og_persona.dictionary", d.dictionary));
      })
      .catch(() => {
        if (cancelled) return;
        setScript(get("og_persona.script", ""));
        setVoice(get("og_persona.voice", ""));
        setDictionary(get("og_persona.dictionary", ""));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingContent, isAdmin]);

  if (isLoading || loadingContent) {
    return (
      <div className="grid place-items-center py-20">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (!isAdmin) return null;

  async function saveAll() {
    setSaving(true);
    try {
      await Promise.all([
        setContent.mutateAsync({ key: "og_persona.script", value: script }),
        setContent.mutateAsync({ key: "og_persona.voice", value: voice }),
        setContent.mutateAsync({ key: "og_persona.dictionary", value: dictionary }),
      ]);
      toast.success("OG B0T persona updated. New messages will use it instantly.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Script, voice and dictionary control how OG B0T talks everywhere: the OG B0T page, the
        widget and Telegram. Saving applies to the next message.
      </p>

      <p className="text-xs text-muted-foreground">
        Your own foul mouth switch is in{" "}
        <Link to="/settings" hash="preferences" className="text-primary underline">
          Settings → Preferences
        </Link>
        , the same place members flip theirs.
      </p>

      <div className="space-y-2">
        <Label htmlFor="og-script">Script (system prompt)</Label>
        <Textarea
          id="og-script"
          rows={8}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground">Core instructions, role, and goals.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="og-voice">Voice</Label>
        <Textarea
          id="og-voice"
          rows={4}
          value={voice}
          onChange={(e) => setVoice(e.target.value)}
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground">Tone, energy, and style rules.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="og-dict">Dictionary / Slang</Label>
        <Textarea
          id="og-dict"
          rows={6}
          value={dictionary}
          onChange={(e) => setDictionary(e.target.value)}
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground">
          Vocabulary and slang the bot should naturally use.
        </p>
      </div>

      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save persona
        </Button>
      </div>
    </div>
  );
}
