"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { signIn } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { emailError, normaliseEmail } from "@/lib/auth/rules";

/** Sign in with an email and password. */
export function PasswordSignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = { email: emailError(email), password: password ? undefined : "Enter your password" };
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await signIn({ email: normaliseEmail(email), password });
      onDone();
    } catch (err) {
      setErrors({ form: authErrorMessage(err, "password") });
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
      {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
      <Button type="submit" size="lg" loading={busy}>Sign in</Button>
      <Link href="/account/reset-password" className="self-center text-label font-semibold text-primary-strong">Forgot your password?</Link>
    </form>
  );
}
