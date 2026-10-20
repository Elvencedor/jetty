"use client";

import { Heart, ShoppingBag } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Chip, EmptyState, IconButton, Media, SearchField, Segmented, SelectField, Skeleton, StatusPill, Switch, TextField, TextareaField } from "@/components/ui";
import { formatNaira } from "@/lib/format";
import { ORDER_STATUS } from "@/lib/status";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="flex flex-col gap-3 border-b border-line py-6">
    <h2 className="font-display text-heading-sm font-extrabold">{title}</h2>
    <div className="flex flex-wrap items-center gap-3">{children}</div>
  </section>
);

export function Gallery() {
  const [length, setLength] = useState("20");
  const [tab, setTab] = useState("featured");
  const [range, setRange] = useState("30d");
  const [on, setOn] = useState(true);
  const [loading, setLoading] = useState(false);

  return (
    <main id="main" className="mx-auto w-full max-w-store px-4 py-8">
      <h1 className="font-display text-display-md font-extrabold">UI gallery</h1>
      <p className="text-muted">Primitives from design/02-components.md. Tab through everything: each control needs a visible focus ring.</p>

      <Section title="Buttons">
        {(["primary", "dark", "outline", "soft", "danger-soft", "add", "ghost-link"] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button size="sm">Small</Button>
        <Button size="lg">Large · {formatNaira(25_100_000)}</Button>
        <Button disabled>Disabled</Button>
        <Button loading={loading} onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1500); }}>
          Add to bag
        </Button>
        <Button href="/">As a link</Button>
      </Section>

      <Section title="Icon buttons">
        <IconButton label="Save" icon={<Heart className="size-5" />} />
        <IconButton label="Bag" icon={<ShoppingBag className="size-5" />} badge={3} />
        <IconButton label="Bag" variant="on-tint" icon={<ShoppingBag className="size-5" />} badge={120} />
      </Section>

      <Section title="Chips">
        {["14", "20", "26"].map((n) => (
          <Chip key={n} selected={length === n} onClick={() => setLength(n)} note={n === "26" ? "+₦25k" : undefined} aria-label={n === "26" ? undefined : `${n} inches`}>
            {n}&quot;
          </Chip>
        ))}
        <Chip disabled aria-label="30 inches, sold out">30&quot;</Chip>
        <Chip variant="choice-soft" selected>HD lace</Chip>
        <Chip variant="removable" onClick={() => undefined}>Body wave</Chip>
        <Chip variant="static">Static</Chip>
      </Section>

      <Section title="Segmented controls">
        <Segmented mode="tabs" label="Picks" value={tab} onChange={setTab} items={[{ value: "featured", label: "Featured" }, { value: "deal", label: "On deal" }, { value: "care", label: "Care" }]} />
        <Segmented tone="primary" label="Range" value={range} onChange={setRange} items={[{ value: "7d", label: "7d" }, { value: "30d", label: "30d" }, { value: "q", label: "Quarter" }]} />
      </Section>

      <Section title="Switch">
        <Switch checked={on} onChange={setOn} label="Show hero cards" />
        <Switch checked={false} onChange={() => undefined} label="Disabled" disabled />
      </Section>

      <Section title="Fields">
        <div className="grid w-full max-w-xl gap-4">
          <TextField label="Full name" placeholder="Adaeze Obi" hint="As it should appear on the delivery" />
          <TextField label="Phone" defaultValue="0803" error="Enter a Nigerian phone number, e.g. 0803 123 4567" />
          <TextField label="Price difference" prefix="₦" size="admin" />
          <SelectField label="State"><option>Lagos</option><option>FCT</option></SelectField>
          <TextareaField label="Landmark" rows={3} />
          <SearchField aria-label="Search the shop" placeholder="Try “bob”, “26 inch”" />
        </div>
      </Section>

      <Section title="Badges and status">
        <Badge kind="sale">−14%</Badge>
        <Badge kind="bogo">Buy 1 Get 1</Badge>
        <span className="rounded-sm bg-photo-1 p-1"><Badge>New</Badge></span>
        <Badge kind="gift">Free gift</Badge>
        <Badge kind="eligible">Add 1 more bob → 1 free</Badge>
        {Object.values(ORDER_STATUS).map((s) => (
          <StatusPill key={s.label} tone={s.tone}>{s.label}</StatusPill>
        ))}
      </Section>

      <Section title="Media and loading">
        <Media image={null} alt="Front view" caption="Front · hi-res photo" aspect="1 / 1.25" className="w-40" />
        <Media image={null} alt="Side view" caption="Side" tone={2} aspect="1 / 1.25" className="w-40" />
        <div className="grid w-40 gap-2"><Skeleton className="aspect-[1/1.25] w-full" /><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      </Section>

      <Section title="Empty state">
        <EmptyState title="Your bag is empty" action={<Button href="/shop">Shop wigs</Button>}>Add a wig and it will wait for you here.</EmptyState>
      </Section>
    </main>
  );
}
