"use client";

import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { register } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { emailError, normaliseEmail, passwordError } from "@/lib/auth/rules";

type Errors = { email?: string; password?: string; form?: string };

/** Create an account with an email and password. Phone numbers are asked for at checkout, where delivery needs one. */
export function RegisterForm({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found = { email: emailError(email), password: passwordError(password) };
    setErrors(found);
    if (found.email || found.password) return;
    setBusy(true);
    try {
      await register({ email: normaliseEmail(email), password });
      onDone();
    } catch (err) {
      setErrors({ form: authErrorMessage(err, "register") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField label="Email" type="email" autoComplete="email" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="new-password" value={password} error={errors.password} hint="At least 10 characters." onChange={(e) => setPassword(e.target.value)} />
      {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
      <Button type="submit" size="lg" loading={busy}>Create account</Button>
    </form>
  );
}
