"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { forgotPassword, resetPassword } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { cleanCode, CODE_LENGTH, emailError, normaliseEmail, passwordError } from "@/lib/auth/rules";
import { useCooldown } from "@/lib/auth/useCooldown";

/** Forgot password: ask for a code by email, then set a new password with it. Never says whether the account exists. */
export function ResetPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; code?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const cooldown = useCooldown();

  async function request(e?: FormEvent) {
    e?.preventDefault();
    const problem = emailError(email);
    if (problem) return setErrors({ email: problem });
    setBusy(true);
    setErrors({});
    try {
      const res = await forgotPassword({ email: normaliseEmail(email) });
      setSent(true);
      cooldown.start(res.resendAfterSeconds);
    } catch (err) {
      setErrors({ form: authErrorMessage(err, "request") });
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    const found = { ...(code.length === CODE_LENGTH ? {} : { code: `Enter the ${CODE_LENGTH}-digit code` }), ...(passwordError(password) ? { password: passwordError(password) } : {}) };
    setErrors(found);
    if (Object.keys(found).length || !sent) return;
    setBusy(true);
    try {
      await resetPassword({ email: normaliseEmail(email), code, password });
      setDone(true);
    } catch (err) {
      setErrors({ form: authErrorMessage(err, "reset") });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="flex flex-col gap-4 rounded-lg bg-success-bg p-5">
        <p className="font-bold text-success">Your password has been changed.</p>
        <p className="text-body-sm text-ink-soft">For your safety you&apos;ve been signed out everywhere. Sign in with your new password.</p>
        <Button href="/account/sign-in" size="lg">Sign in</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <h1 className="font-display text-heading-lg font-extrabold">Reset your password</h1>
      {!sent ? (
        <form onSubmit={request} noValidate className="flex flex-col gap-4">
          <TextField label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => { setEmail(e.target.value); setErrors({}); }} hint="We'll email a code to this address if we have an account for it." />
          {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
          <Button type="submit" size="lg" loading={busy}>Send code</Button>
        </form>
      ) : (
        <form onSubmit={reset} noValidate className="flex flex-col gap-4">
          <p className="text-body-sm text-ink-soft" aria-live="polite">If there&apos;s an account for that email, a code is on its way.</p>
          <TextField label="Code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} error={errors.code} className="text-center tracking-[0.4em]" onChange={(e) => setCode(cleanCode(e.target.value))} />
          <TextField label="New password" type="password" autoComplete="new-password" hint="At least 10 characters." value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
          {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
          <Button type="submit" size="lg" loading={busy}>Change password</Button>
          <Button variant="ghost-link" size="sm" disabled={cooldown.left > 0 || busy} onClick={() => void request()}>{cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend code"}</Button>
        </form>
      )}
      <Link href="/account/sign-in" className="self-center text-label font-semibold text-primary-strong">Back to sign in</Link>
    </div>
  );
}
