"use client";

import { Eye, EyeOff, Lock } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { adminLogin } from "@/lib/api/admin";
import { safeAdminNext } from "@/lib/admin/nav";
import { emailError, normaliseEmail } from "@/lib/auth/rules";
import { useAdminSession } from "@/lib/stores/session";
import { AdminBrand } from "./AdminBrand";

/** Why a sign-in failed, without saying which part was wrong (the API does not either). */
function message(err: unknown): string {
  if (!isApiError(err)) return "Something went wrong. Please try again.";
  if (err.status === 401) return "That email or password isn't right.";
  if (err.status === 429) return `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
  if (err.status === 503) return "Sign-in is temporarily unavailable. Please try again shortly.";
  return err.retryable ? "We couldn't reach the server. Check your connection and try again." : err.message;
}

/** Email and password, with a heading that says this is the admin sign-in. Afterwards, back to the admin page that was asked for. */
export function AdminLoginForm() {
  const router = useRouter();
  const next = safeAdminNext(useSearchParams().get("next"));
  const status = useAdminSession((s) => s.status);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // Already signed in (or just restored from the cookie): nothing to do here.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = { email: emailError(email), password: password ? undefined : "Enter your password" };
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await adminLogin({ email: normaliseEmail(email), password });
      router.replace(next);
    } catch (err) {
      setErrors({ form: message(err) });
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      {/* On a large screen the brand sits in the panel beside the form; on a phone it heads the form. */}
      <div className="flex justify-center lg:hidden"><AdminBrand size="lg" /></div>
      <div className="flex flex-col gap-2">
        <span className="inline-flex items-center gap-1.5 self-start rounded-pill bg-surface-tint px-2.5 py-1 text-caption font-bold text-primary-strong"><Lock aria-hidden="true" size={12} />Admin sign-in</span>
        <h1 className="font-display text-heading-md font-extrabold">Welcome back</h1>
        <p className="text-body-sm text-muted">Sign in to manage orders, products, promotions and settings.</p>
      </div>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-sm lg:border-0 lg:p-0 lg:shadow-none">
        <TextField size="admin" label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
        <TextField size="admin" label="Password" type={show ? "text" : "password"} autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        <button type="button" aria-pressed={show} aria-describedby="reveal-hint" onClick={() => setShow((v) => !v)} className="-mt-2 inline-flex min-h-9 items-center gap-1.5 self-end text-label font-bold text-primary-strong">
          {show ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
          {show ? "Hide" : "Show"}
          <span id="reveal-hint" className="sr-only">what you typed in the field above</span>
        </button>
        {errors.form ? <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-body-sm font-medium text-danger">{errors.form}</p> : null}
        <Button type="submit" size="lg" loading={busy}>Sign in</Button>
      </form>
      <p className="flex items-center justify-between gap-3 text-caption text-muted">
        <span>Restricted to authorised staff.</span>
        <Link href="/" className="font-bold text-primary-strong underline">Back to the store</Link>
      </p>
    </div>
  );
}
