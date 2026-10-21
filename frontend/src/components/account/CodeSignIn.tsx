"use client";

import { useRef, useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";
import { requestLoginCode, verifyLoginCode } from "@/lib/api/account";
import { authErrorMessage } from "@/lib/auth/errors";
import { cleanCode, CODE_LENGTH, phoneError } from "@/lib/auth/rules";
import { useCooldown } from "@/lib/auth/useCooldown";
import { normaliseNigerianPhone, maskPhone } from "@/lib/format";

/** Sign in (or create an account) with a six-digit code texted to the phone. The code submits itself at six digits. */
export function CodeSignIn({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cooldown = useCooldown();
  const verifying = useRef(false);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const problem = phoneError(phone);
    const e164 = normaliseNigerianPhone(phone);
    if (problem || !e164) return setError(problem);
    setBusy(true);
    setError(undefined);
    try {
      const res = await requestLoginCode(e164);
      setSentTo(e164);
      setCode("");
      cooldown.start(res.resendAfterSeconds);
    } catch (err) {
      setError(authErrorMessage(err, "request"));
    } finally {
      setBusy(false);
    }
  }

  async function verify(value: string) {
    if (!sentTo || verifying.current) return;
    verifying.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await verifyLoginCode({ phone: sentTo, code: value });
      onDone();
    } catch (err) {
      setError(authErrorMessage(err, "code"));
      setCode("");
    } finally {
      verifying.current = false;
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} noValidate className="flex flex-col gap-4">
        <TextField label="Phone number" type="tel" inputMode="tel" autoComplete="tel" placeholder="0803 123 4567" value={phone} error={error} onChange={(e) => { setPhone(e.target.value); setError(undefined); }} hint="We'll text you a code. No password needed." />
        <Button type="submit" size="lg" loading={busy}>Send me a code</Button>
      </form>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (code.length === CODE_LENGTH) void verify(code); }} noValidate className="flex flex-col gap-4">
      <p className="text-body-sm text-ink-soft" aria-live="polite">We texted a {CODE_LENGTH}-digit code to <strong>{maskPhone(sentTo)}</strong>.</p>
      <TextField
        label="Code"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={CODE_LENGTH + 4}
        placeholder="123456"
        value={code}
        error={error}
        className="text-center font-display text-heading-sm tracking-[0.4em]"
        onChange={(e) => {
          const next = cleanCode(e.target.value);
          setCode(next);
          setError(undefined);
          if (next.length === CODE_LENGTH) void verify(next);
        }}
      />
      <Button type="submit" size="lg" loading={busy} disabled={code.length !== CODE_LENGTH}>Sign in</Button>
      <div className="flex items-center justify-between text-body-sm">
        <Button variant="ghost-link" size="sm" disabled={cooldown.left > 0 || busy} onClick={() => void send()}>
          {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : "Resend code"}
        </Button>
        <Button variant="ghost-link" size="sm" onClick={() => { setSentTo(null); setError(undefined); }}>Use a different number</Button>
      </div>
    </form>
  );
}
