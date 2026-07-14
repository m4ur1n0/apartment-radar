"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/";

  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = redirect;
      } else {
        const data = (await res.json()) as { error?: string };
        setErrorMsg(data.error === "wrong_password" ? "Wrong password." : "Login failed.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Network error.");
      setStatus("error");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-sm px-8">
        <h1
          className="text-2xl text-stone-900 leading-none mb-8"
          style={{ fontFamily: "var(--font-chonburi, serif)", fontWeight: 400 }}
        >
          apt-radar
        </h1>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            required
            className="border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-300 focus:outline-none focus:border-stone-600 transition-colors duration-150 w-full"
          />

          {errorMsg && (
            <p className="font-mono text-[10px] uppercase tracking-[0.07em] text-red-400">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={status === "loading" || !password}
            className="font-mono text-[11px] uppercase tracking-[0.07em] bg-stone-900 text-white px-5 py-2.5 hover:bg-stone-800 disabled:opacity-40 transition-colors duration-150"
          >
            {status === "loading" ? "..." : "Enter"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
