"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { isApiError } from "@/lib/api/client";
import { adminLogin } from "@/lib/api/admin";
import { safeAdminNext } from "@/lib/admin/nav";
import { emailError, normaliseEmail } from "@/lib/auth/rules";
import { useAdminSession } from "@/lib/stores/session";

/** Why a sign-in failed, without saying which part was wrong (the API does not either). */
function message(err: unknown): string {
  if (!isApiError(err)) return "Something went wrong. Please try again.";
  if (err.status === 401) return "That email or password isn't right.";
  if (err.status === 429) return `Too many attempts. Try again in ${err.retryAfterSeconds ?? 60} seconds.`;
  if (err.status === 503) return "Sign-in is temporarily unavailable. Please try again shortly.";
  return err.retryable ? "We couldn't reach the server. Check your connection and try again." : err.message;
}

/** Email and password, on a centred card. Afterwards, back to the admin page that was asked for. */
export function AdminLoginForm() {
  const router = useRouter();
  const next = safeAdminNext(useSearchParams().get("next"));
  const status = useAdminSession((s) => s.status);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
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
    <form onSubmit={submit} noValidate className="flex w-full max-w-sm flex-col gap-4 rounded-card border border-line bg-surface p-6">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-[34px] items-center justify-center rounded-[11px] bg-primary font-display text-heading-xs font-extrabold text-on-primary">J</span>
        <span className="font-display text-heading-xs font-extrabold">jetty admin</span>
      </div>
      <h1 className="font-display text-heading-sm font-extrabold">Sign in</h1>
      <TextField size="admin" label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <TextField size="admin" label="Password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
      {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
      <Button type="submit" size="lg" loading={busy}>Sign in</Button>
    </form>
  );
}
