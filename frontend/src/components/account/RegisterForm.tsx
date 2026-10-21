"use client";

import { useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { register } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { emailError, passwordError, phoneError } from "@/lib/auth/rules";
import { normaliseNigerianPhone } from "@/lib/format";

type Errors = { phone?: string; email?: string; password?: string; form?: string };

/** Create an account with a phone number and password (email is optional). */
export function RegisterForm({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Errors = { phone: phoneError(phone), password: passwordError(password), ...(email.trim() ? { email: emailError(email) } : {}) };
    const clean = Object.fromEntries(Object.entries(found).filter(([, v]) => v)) as Errors;
    setErrors(clean);
    const e164 = normaliseNigerianPhone(phone);
    if (Object.keys(clean).length || !e164) return;
    setBusy(true);
    try {
      await register({ phone: e164, password, ...(email.trim() ? { email: email.trim().toLowerCase() } : {}) });
      onDone();
    } catch (err) {
      setErrors({ form: authErrorMessage(err, "register") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <TextField label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} error={errors.phone} onChange={(e) => setPhone(e.target.value)} />
      <TextField label="Email (optional)" type="email" autoComplete="email" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
      <TextField label="Password" type="password" autoComplete="new-password" value={password} error={errors.password} hint="At least 10 characters." onChange={(e) => setPassword(e.target.value)} />
      {errors.form ? <p role="alert" className="text-body-sm font-medium text-danger">{errors.form}</p> : null}
      <Button type="submit" size="lg" loading={busy}>Create account</Button>
    </form>
  );
}
