"use client";

import { Star } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button, TextareaField, TextField } from "@/components/ui";
import { submitReview } from "@/lib/api/account";
import { isApiError } from "@/lib/api/client";
import { cn } from "@/lib/cn";

/** Rate a delivered item. New reviews wait for a moderator, and the form says so. */
export function ReviewForm({ orderItemId, title, onDone }: { orderItemId: string; title: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!rating) return setError("Choose a star rating");
    setBusy(true);
    setError(undefined);
    try {
      await submitReview({ orderItemId, rating, ...(heading.trim() ? { title: heading.trim() } : {}), ...(body.trim() ? { body: body.trim() } : {}) });
      setSent(true);
      onDone();
    } catch (err) {
      setError(isApiError(err) && err.code === "REVIEW_EXISTS" ? "You've already reviewed this item." : isApiError(err) && err.code === "REVIEW_NOT_ELIGIBLE" ? "This item can't be reviewed yet." : isApiError(err) && err.status === 429 ? "You've sent several reviews recently. Try again later." : "We couldn't send your review. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <p role="status" className="rounded-lg bg-success-bg p-3 text-body-sm font-semibold text-success">Thank you! Your review will appear once we&apos;ve checked it.</p>;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-lg bg-surface-tint p-4">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-label font-bold">How was {title}?</legend>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary">
              <input type="radio" name={`rating-${orderItemId}`} value={n} checked={rating === n} onChange={() => { setRating(n); setError(undefined); }} className="sr-only" />
              <span className="sr-only">{n} {n === 1 ? "star" : "stars"}</span>
              <Star aria-hidden="true" size={32} className={cn(n <= rating ? "fill-warning text-warning" : "text-line-strong")} />
            </label>
          ))}
        </div>
      </fieldset>
      <TextField label="Headline (optional)" maxLength={120} value={heading} onChange={(e) => setHeading(e.target.value)} />
      <TextareaField label="Your review (optional)" maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} />
      {error ? <p role="alert" className="text-body-sm font-medium text-danger">{error}</p> : null}
      <Button type="submit" loading={busy}>Send review</Button>
    </form>
  );
}
