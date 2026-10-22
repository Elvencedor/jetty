import { Button } from "@/components/ui";

type Props = {
  from: number;
  to: number;
  /** All matching rows, when the API says (first page of a list); otherwise the range alone is shown. */
  total?: number | null | undefined;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy?: boolean;
};

/** "Showing 1–8 of 1,842" with Previous and Next. */
export function TablePager({ from, to, total, canPrev, canNext, onPrev, onNext, busy }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-body-sm text-muted">
      <p role="status">{to === 0 ? "No results" : `Showing ${from}–${to}${total ? ` of ${total.toLocaleString("en-NG")}` : ""}`}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={!canPrev || busy} onClick={onPrev}>Previous</Button>
        <Button size="sm" variant="outline" disabled={!canNext || busy} onClick={onNext}>Next</Button>
      </div>
    </div>
  );
}
