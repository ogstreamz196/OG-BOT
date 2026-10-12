import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Settings2,
  ExternalLink,
  Power,
  PowerOff,
  Music2,
  Plus,
  X,
  Save,
  Globe2,
  Palette,
  Coins,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  "English",
  "Spanish",
  "French",
  "Japanese",
  "German",
  "Italian",
  "Portuguese",
  "Korean",
  "Hindi",
  "Mandarin",
  "Arabic",
];

interface Portal {
  id: string;
  slug: string;
  name: string;
  language: string;
  status: string;
  custom_welcome_text: string | null;
  primary_color: string;
  coin_cost_per_generation: number;
  style_tags: string[];
  allowed_styles: string[] | null;
  created_at: string;
}

export function PortalManager() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Portal | null>(null);

  const portalsQuery = useQuery({
    queryKey: ["admin-portals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Portal[];
    },
  });

  const countsQuery = useQuery({
    queryKey: ["admin-portal-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("songs")
        .select("portal_id")
        .not("portal_id", "is", null);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped table/SDK shape
        const id = (row as any).portal_id as string;
        map.set(id, (map.get(id) ?? 0) + 1);
      }
      return map;
    },
  });

  const toggleStatus = useMutation({
    mutationFn: async (p: Portal) => {
      const next = p.status === "active" ? "maintenance" : "active";
      const { error } = await supabase.from("portals").update({ status: next }).eq("id", p.id);
      if (error) throw error;
      return next;
    },
    onSuccess: (next) => {
      qc.invalidateQueries({ queryKey: ["admin-portals"] });
      toast.success(`Portal is now ${next}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Portals</h3>
        </div>
        <span className="text-xs text-muted-foreground">
          {portalsQuery.data?.length ?? 0} total
        </span>
      </div>

      {portalsQuery.isLoading ? (
        <div className="grid place-items-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !portalsQuery.data || portalsQuery.data.length === 0 ? (
        <div className="grid place-items-center gap-2 py-10 text-muted-foreground">
          <Music2 className="h-7 w-7" />
          <p className="text-sm">No portals yet — create your first one.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {portalsQuery.data.map((p) => {
            const count = countsQuery.data?.get(p.id) ?? 0;
            const active = p.status === "active";
            return (
              <div
                key={p.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-background/40 p-4"
                style={{ borderTopColor: p.primary_color, borderTopWidth: 3 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{p.name}</div>
                    <div className="truncate text-xs text-muted-foreground">/{p.slug}</div>
                  </div>
                  <Badge
                    variant={active ? "default" : "secondary"}
                    className={cn(!active && "bg-muted text-muted-foreground")}
                  >
                    {active ? "Active" : "Maintenance"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Globe2 className="h-3 w-3" /> {p.language}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Coins className="h-3 w-3" /> {p.coin_cost_per_generation}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Music2 className="h-3 w-3" /> {count} songs
                  </span>
                </div>
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={active ? "outline" : "default"}
                    onClick={() => toggleStatus.mutate(p)}
                    disabled={toggleStatus.isPending}
                  >
                    {active ? (
                      <PowerOff className="mr-1.5 h-3.5 w-3.5" />
                    ) : (
                      <Power className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    {active ? "Pause" : "Resume"}
                  </Button>
                  <a href={`/portal/${p.slug}`} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline">
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View
                    </Button>
                  </a>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                    <Settings2 className="mr-1.5 h-3.5 w-3.5" /> Manage
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <EditPortalSheet
        portal={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["admin-portals"] });
          setEditing(null);
        }}
      />
    </div>
  );
}

function EditPortalSheet({
  portal,
  onClose,
  onSaved,
}: {
  portal: Portal | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!portal;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [language, setLanguage] = useState("English");
  const [welcome, setWelcome] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [coinCost, setCoinCost] = useState<string>("2");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [slugTaken, setSlugTaken] = useState(false);

  useEffect(() => {
    if (!portal) return;
    setName(portal.name);
    setSlug(portal.slug);
    setLanguage(portal.language);
    setWelcome(portal.custom_welcome_text ?? "");
    setColor(portal.primary_color || "#3B82F6");
    setCoinCost(String(portal.coin_cost_per_generation));
    setTags(portal.style_tags ?? []);
    setTagInput("");
    setSlugTaken(false);
  }, [portal]);

  const slugClean = useMemo(
    () =>
      slug
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, ""),
    [slug],
  );

  // Live slug availability check
  useEffect(() => {
    if (!portal || !slugClean || slugClean === portal.slug) {
      setSlugTaken(false);
      return;
    }
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from("portals")
        .select("id")
        .eq("slug", slugClean)
        .maybeSingle();
      setSlugTaken(!!data && data.id !== portal.id);
    }, 300);
    return () => clearTimeout(handle);
  }, [slugClean, portal]);

  function addTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags([...tags, t]);
    setTagInput("");
  }

  const save = useMutation({
    mutationFn: async () => {
      if (!portal) return;
      if (!name.trim()) throw new Error("Portal name required");
      if (!slugClean) throw new Error("URL slug required");
      if (slugTaken) throw new Error("Slug already taken");
      const cost = Number(coinCost);
      if (!Number.isInteger(cost) || cost < 0 || cost > 100)
        throw new Error("Coin cost must be 0–100");
      if (!/^#[0-9a-fA-F]{6}$/.test(color))
        throw new Error("Color must be a hex code like #3B82F6");
      if (tags.length < 1) throw new Error("Add at least one style tag");

      const { error } = await supabase
        .from("portals")
        .update({
          name: name.trim().slice(0, 80),
          slug: slugClean,
          language,
          custom_welcome_text: welcome.trim().slice(0, 280) || null,
          primary_color: color,
          coin_cost_per_generation: cost,
          style_tags: tags.slice(0, 12),
          allowed_styles: tags.slice(0, 12),
        })
        .eq("id", portal.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Portal configuration successfully propagated live!");
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Manage portal</SheetTitle>
          <SheetDescription>Update everything about “{portal?.name}”.</SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="identity" className="mt-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="identity">Identity</TabsTrigger>
            <TabsTrigger value="ai">AI Core</TabsTrigger>
            <TabsTrigger value="money">Coins</TabsTrigger>
            <TabsTrigger value="brand">Brand</TabsTrigger>
          </TabsList>

          <TabsContent value="identity" className="mt-4 space-y-4">
            <div>
              <Label htmlFor="p-name">Portal name</Label>
              <Input
                id="p-name"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="p-slug">URL slug</Label>
              <Input
                id="p-slug"
                value={slug}
                maxLength={60}
                onChange={(e) => setSlug(e.target.value)}
                className="mt-2"
              />
              <p
                className={cn(
                  "mt-1 text-xs",
                  slugTaken ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {slugTaken ? "This slug is already taken." : `/portal/${slugClean || "your-slug"}`}
              </p>
            </div>
            <div>
              <Label htmlFor="p-welcome">Welcome / announcement banner</Label>
              <Textarea
                id="p-welcome"
                value={welcome}
                maxLength={280}
                rows={3}
                onChange={(e) => setWelcome(e.target.value)}
                className="mt-2"
                placeholder="Shown to users at the top of the portal."
              />
              <p className="mt-1 text-xs text-muted-foreground">{welcome.length}/280</p>
            </div>
          </TabsContent>

          <TabsContent value="ai" className="mt-4 space-y-4">
            <div>
              <Label>Hardcoded lyrics language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">
                All lyrics generated inside this portal will be written in this language.
              </p>
            </div>
            <div>
              <Label>Style tags ({tags.length})</Label>
              <div className="mt-2 flex gap-2">
                <Input
                  value={tagInput}
                  maxLength={30}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="Type a genre and press Enter"
                />
                <Button type="button" variant="outline" onClick={addTag}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(tags.filter((x) => x !== t))}
                      className="opacity-70 hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {tags.length === 0 && (
                  <span className="text-xs text-muted-foreground">No tags yet.</span>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="money" className="mt-4 space-y-4">
            <div>
              <Label htmlFor="p-cost">Coins per generation (this portal)</Label>
              <Input
                id="p-cost"
                type="number"
                min={0}
                max={100}
                value={coinCost}
                onChange={(e) => setCoinCost(e.target.value)}
                className="mt-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Overrides the global price for users generating inside this portal.
              </p>
            </div>
          </TabsContent>

          <TabsContent value="brand" className="mt-4 space-y-4">
            <div>
              <Label htmlFor="p-color" className="flex items-center gap-2">
                <Palette className="h-4 w-4" /> Primary color
              </Label>
              <div className="mt-2 flex items-center gap-3">
                <input
                  id="p-color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-10 w-14 cursor-pointer rounded border border-border bg-transparent"
                />
                <Input
                  value={color}
                  maxLength={7}
                  onChange={(e) => setColor(e.target.value)}
                  className="font-mono"
                />
              </div>
              <div
                className="mt-4 rounded-xl border border-border p-4"
                style={{ borderColor: color }}
              >
                <p className="text-sm text-muted-foreground">Preview</p>
                <button
                  type="button"
                  className="mt-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: color }}
                >
                  Generate Song Tracks
                </button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <SheetFooter className="mt-6">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || slugTaken}
            className="bg-gradient-brand text-primary-foreground"
          >
            {save.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save changes
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
