import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Plus,
  ShoppingBag,
  Trash2,
  Pencil,
  Package,
  ArrowUp,
  ArrowDown,
  EyeOff,
  Eye,
} from "lucide-react";
import { useRole } from "@/hooks/use-role";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { BossNav } from "@/components/admin/BossNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  listAllStoreItems,
  upsertStoreItem,
  deleteStoreItem,
  upsertStoreCategory,
  reorderStoreItems,
  reorderStoreCategories,
  type StoreItem,
  type StoreCategory,
} from "@/lib/store.functions";

export const Route = createFileRoute("/_authenticated/admin/store")({
  component: AdminStorePage,
});

type FormState = {
  id?: string;
  category_id: string;
  slug: string;
  name: string;
  description: string;
  image_url: string;
  price_amount: string; // major units
  coin_price: string;
  currency: string;
  recurring_interval: "" | "month" | "year";
  stock: string;
  coin_reward: string;
  perk_slug: string;
  rarity: "common" | "rare" | "epic" | "legendary";
  sort_order: string;
  active: boolean;
};

const EMPTY: FormState = {
  category_id: "",
  slug: "",
  name: "",
  description: "",
  image_url: "",
  price_amount: "",
  coin_price: "",
  currency: "gbp",
  recurring_interval: "",
  stock: "",
  coin_reward: "",
  perk_slug: "",
  rarity: "common",
  sort_order: "0",
  active: true,
};

function AdminStorePage() {
  const { isAdmin, isLoading } = useRole();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [catDialog, setCatDialog] = useState(false);
  const [catForm, setCatForm] = useState({ slug: "", label: "", description: "" });

  const query = useQuery({
    queryKey: ["admin-store"],
    enabled: isAdmin,
    queryFn: () => listAllStoreItems(),
  });

  const saveMut = useMutation({
    mutationFn: (data: FormState) =>
      upsertStoreItem({
        data: {
          id: data.id,
          category_id: data.category_id,
          slug: data.slug,
          name: data.name,
          description: data.description || null,
          image_url: data.image_url || null,
          price_cents: Math.round(Number(data.price_amount) * 100),
          coin_price: data.coin_price === "" ? null : Number(data.coin_price),
          currency: data.currency,
          recurring_interval: data.recurring_interval || null,
          stock: data.stock === "" ? null : Number(data.stock),
          coin_reward: data.coin_reward === "" ? null : Number(data.coin_reward),
          perk_slug: data.perk_slug || null,
          rarity: data.rarity,
          sort_order: Number(data.sort_order) || 0,
          active: data.active,
        },
      }),
    onSuccess: () => {
      toast.success("Item saved");
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
      setForm(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteStoreItem({ data: { id } }),
    onSuccess: () => {
      toast.success("Item archived");
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const catMut = useMutation({
    mutationFn: (d: typeof catForm) =>
      upsertStoreCategory({ data: { slug: d.slug, label: d.label, description: d.description } }),
    onSuccess: () => {
      toast.success("Category added");
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
      setCatDialog(false);
      setCatForm({ slug: "", label: "", description: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderItemsMut = useMutation({
    mutationFn: (ids: string[]) => reorderStoreItems({ data: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reorderCatsMut = useMutation({
    mutationFn: (ids: string[]) => reorderStoreCategories({ data: { ids } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCatMut = useMutation({
    mutationFn: (c: StoreCategory) =>
      upsertStoreCategory({
        data: {
          id: c.id,
          slug: c.slug,
          label: c.label,
          description: c.description ?? "",
          sort_order: c.sort_order,
          active: !c.active,
        },
      }),
    onSuccess: () => {
      toast.success("Category updated");
      qc.invalidateQueries({ queryKey: ["admin-store"] });
      qc.invalidateQueries({ queryKey: ["store-catalog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <DashboardShell title="Store admin">
        <div className="grid place-items-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </DashboardShell>
    );
  }
  if (!isAdmin) return <Navigate to="/" />;

  const categories: StoreCategory[] = query.data?.categories ?? [];
  const items: StoreItem[] = query.data?.items ?? [];
  const catById = new Map(categories.map((c) => [c.id, c]));

  function openNew(catId: string) {
    setForm({
      ...EMPTY,
      category_id: catId,
      slug: `item-${Math.random().toString(36).slice(2, 7)}`,
    });
  }
  function openEdit(it: StoreItem) {
    setForm({
      id: it.id,
      category_id: it.category_id,
      slug: it.slug,
      name: it.name,
      description: it.description ?? "",
      image_url: it.image_url ?? "",
      price_amount: (it.price_cents / 100).toFixed(2),
      coin_price: it.coin_price == null ? "" : String(it.coin_price),
      currency: it.currency,
      recurring_interval: (it.recurring_interval as "" | "month" | "year") ?? "",
      stock: it.stock == null ? "" : String(it.stock),
      coin_reward: it.coin_reward == null ? "" : String(it.coin_reward),
      perk_slug: it.perk_slug ?? "",
      rarity: it.rarity,
      sort_order: String(it.sort_order),
      active: it.active,
    });
  }

  function moveItem(catItems: StoreItem[], idx: number, dir: -1 | 1) {
    const next = [...catItems];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    reorderItemsMut.mutate(next.map((x) => x.id));
  }
  function moveCategory(idx: number, dir: -1 | 1) {
    const next = [...categories];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    reorderCatsMut.mutate(next.map((x) => x.id));
  }

  return (
    <DashboardShell title="Store admin">
      <div className="boss-ui mx-auto w-full min-w-0 max-w-5xl space-y-6">
        <BossNav />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground">
            Add items across coins, subscriptions and random loot. Each item is checkout-ready.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setCatDialog(true)}>
              <Plus className="mr-1 h-4 w-4" /> Category
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/store">
                <ShoppingBag className="mr-1 h-4 w-4" /> View storefront
              </Link>
            </Button>
          </div>
        </div>

        {categories.map((cat, catIdx) => {
          const catItems = items.filter((i) => i.category_id === cat.id);
          return (
            <section
              key={cat.id}
              className={`rounded-2xl border p-4 ${cat.active ? "border-border bg-card/60" : "border-dashed border-slate-600 bg-card/30 opacity-70"}`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex flex-col">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={catIdx === 0}
                      onClick={() => moveCategory(catIdx, -1)}
                      aria-label="Move category up"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      disabled={catIdx === categories.length - 1}
                      onClick={() => moveCategory(catIdx, 1)}
                      aria-label="Move category down"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <div>
                    <h2 className="font-display text-lg font-bold uppercase tracking-wider">
                      {cat.label}
                    </h2>
                    {cat.description && (
                      <p className="text-xs text-muted-foreground">{cat.description}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleCatMut.mutate(cat)}
                    disabled={toggleCatMut.isPending}
                  >
                    {cat.active ? (
                      <EyeOff className="mr-1 h-4 w-4" />
                    ) : (
                      <Eye className="mr-1 h-4 w-4" />
                    )}
                    {cat.active ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" onClick={() => openNew(cat.id)} className="bg-gradient-brand">
                    <Plus className="mr-1 h-4 w-4" /> Add item
                  </Button>
                </div>
              </div>

              {catItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No items yet in {cat.label}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Rarity</TableHead>
                        <TableHead>Stock</TableHead>
                        <TableHead>Coins</TableHead>
                        <TableHead>Perk</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {catItems.map((it, itIdx) => (
                        <TableRow key={it.id}>
                          <TableCell className="max-w-xs truncate">
                            <div className="font-semibold">{it.name}</div>
                            <div className="text-xs text-muted-foreground">{it.slug}</div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {it.coin_price != null
                              ? `${it.coin_price} OG Coins`
                              : `${(it.price_cents / 100).toFixed(2)} ${it.currency.toUpperCase()}`}
                            {it.recurring_interval && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                / {it.recurring_interval}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs uppercase">{it.rarity}</TableCell>
                          <TableCell className="text-xs">
                            {it.stock == null ? "∞" : `${it.stock - it.stock_sold} / ${it.stock}`}
                          </TableCell>
                          <TableCell className="text-xs">{it.coin_reward ?? "—"}</TableCell>
                          <TableCell className="text-xs">{it.perk_slug ?? "—"}</TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                                it.active
                                  ? "bg-emerald-500/20 text-emerald-300"
                                  : "bg-slate-500/20 text-slate-300"
                              }`}
                            >
                              {it.active ? "On" : "Off"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="inline-flex items-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={itIdx === 0 || reorderItemsMut.isPending}
                                onClick={() => moveItem(catItems, itIdx, -1)}
                                aria-label="Move item up"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={
                                  itIdx === catItems.length - 1 || reorderItemsMut.isPending
                                }
                                onClick={() => moveItem(catItems, itIdx, 1)}
                                aria-label="Move item down"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => openEdit(it)}
                                aria-label="Edit item"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  if (it.active) {
                                    if (confirm(`Hide "${it.name}" from the storefront?`))
                                      delMut.mutate(it.id);
                                  } else {
                                    toast.info(
                                      "Item is already hidden. Edit it and toggle Active to bring it back.",
                                    );
                                  }
                                }}
                                aria-label="Archive item"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          );
        })}

        {categories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <Package className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Create a category to get started.</p>
          </div>
        )}
      </div>

      {/* Item form */}
      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit item" : "New item"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Category</Label>
                <Select
                  value={form.category_id}
                  onValueChange={(v) => setForm({ ...form, category_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Image URL</Label>
                <Input
                  value={form.image_url}
                  onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div>
                <Label>Slug (unique)</Label>
                <Input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                />
              </div>
              <div>
                <Label>Sort order</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </div>
              <div>
                <Label>Price (major units)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price_amount}
                  onChange={(e) => setForm({ ...form, price_amount: e.target.value })}
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value.toLowerCase() })}
                  maxLength={3}
                />
              </div>
              <div>
                <Label>OG Coin price (optional)</Label>
                <Input
                  type="number"
                  min="1"
                  step="1"
                  value={form.coin_price}
                  onChange={(e) => setForm({ ...form, coin_price: e.target.value })}
                  placeholder="Leave blank for card checkout"
                />
              </div>
              <div>
                <Label>Recurring</Label>
                <Select
                  value={form.recurring_interval || "one_time"}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      recurring_interval: v === "one_time" ? "" : (v as "month" | "year"),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="one_time">One-time</SelectItem>
                    <SelectItem value="month">Monthly</SelectItem>
                    <SelectItem value="year">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Rarity</Label>
                <Select
                  value={form.rarity}
                  onValueChange={(v) => setForm({ ...form, rarity: v as FormState["rarity"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="common">Common</SelectItem>
                    <SelectItem value="rare">Rare</SelectItem>
                    <SelectItem value="epic">Epic</SelectItem>
                    <SelectItem value="legendary">Legendary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Stock (blank = ∞)</Label>
                <Input
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
              </div>
              <div>
                <Label>Coin reward (optional)</Label>
                <Input
                  type="number"
                  value={form.coin_reward}
                  onChange={(e) => setForm({ ...form, coin_reward: e.target.value })}
                />
              </div>
              <div>
                <Label>Perk slug (e.g. role:vip)</Label>
                <Input
                  value={form.perk_slug}
                  onChange={(e) => setForm({ ...form, perk_slug: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  checked={form.active}
                  onCheckedChange={(v) => setForm({ ...form, active: v })}
                />
                <Label className="!m-0">Active (visible in store)</Label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => form && saveMut.mutate(form)}
              disabled={saveMut.isPending}
              className="bg-gradient-brand"
            >
              {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category form */}
      <Dialog open={catDialog} onOpenChange={setCatDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New category</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Label</Label>
              <Input
                value={catForm.label}
                onChange={(e) => setCatForm({ ...catForm, label: e.target.value })}
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={catForm.slug}
                onChange={(e) => setCatForm({ ...catForm, slug: e.target.value.toLowerCase() })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={catForm.description}
                onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => catMut.mutate(catForm)}
              disabled={catMut.isPending}
              className="bg-gradient-brand"
            >
              {catMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
