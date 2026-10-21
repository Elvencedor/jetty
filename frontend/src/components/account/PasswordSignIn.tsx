"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { signIn } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { toIdentifier } from "@/lib/auth/rules";

/** Sign in with a phone number or email and a password. */
export function PasswordSignIn({ onDone }: { onDone: () => void }) {
  const [who, setWho] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ who?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = toIdentifier(who);
    const next = { ...(id ? {} : { who: "Enter your phone number or email" }), ...(password ? {} : { password: "Enter your password" }) };
    setErrors(next);
    if (!id || !password) return;
    setBusy(true);
    try {
      await signIn({ ...id, password });
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
      <TextField label="Phone number or email" autoComplete="username" value={who} error={errors.who} onChange={(e) => setWho(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
      {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
      <Button type="submit" size="lg" loading={busy}>Sign in</Button>
      <Link href="/account/reset-password" className="self-center text-label font-semibold text-primary-strong">Forgot your password?</Link>
    </form>
  );
}
