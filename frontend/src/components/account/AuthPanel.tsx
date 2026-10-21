"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui";
import { safeNext } from "@/lib/auth/rules";
import { useCustomerSession } from "@/lib/stores/session";
import { CodeSignIn } from "./CodeSignIn";
import { PasswordSignIn } from "./PasswordSignIn";
import { RegisterForm } from "./RegisterForm";

type Mode = "code" | "password" | "register";

/** Sign in by code, by password, or create an account. Afterwards, back to where the shopper was going. */
export function AuthPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [mode, setMode] = useState<Mode>(params.get("mode") === "register" ? "register" : "code");
  const status = useCustomerSession((s) => s.status);
  const done = () => router.replace(next);

  // Already signed in (or just became so): nothing to do here.
  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5">
      <h1 className="font-display text-heading-lg font-extrabold">{mode === "register" ? "Create your account" : "Welcome back"}</h1>
      <Segmented
        mode="tabs"
        label="How to sign in"
        value={mode}
        onChange={setMode}
        items={[{ value: "code", label: "Phone code" }, { value: "password", label: "Password" }, { value: "register", label: "New here" }]}
      />
      <div role="tabpanel">
        {mode === "code" ? <CodeSignIn onDone={done} /> : mode === "password" ? <PasswordSignIn onDone={done} /> : <RegisterForm onDone={done} />}
      </div>
    </div>
  );
}
