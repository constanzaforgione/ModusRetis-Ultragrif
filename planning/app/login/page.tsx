"use client";
import { useEffect, useState } from "react";
import { Iso } from "@/components/Logo";
import { supabaseBrowser } from "@/lib/supabase/client";

const ERRORS: Record<string, string> = {
  link: "El link venció o ya se usó. Pedí uno nuevo.",
  dominio: "Ese mail no pertenece al equipo de Modus Retis.",
};

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("error");
    if (code) setError(ERRORS[code] ?? "No pudimos iniciar sesión.");
  }, []);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo() },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function google() {
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="login">
      <div className="panel">
        <div className="brand">
          <Iso />
          <div>
            <div className="eyebrow">Modus Retis · El mejor aliado tecnológico de las pymes</div>
            <h1>
              Planning de <em>equipo</em>
            </h1>
          </div>
        </div>
        {sent ? (
          <div className="notice">
            Te mandamos un link a <b>{email}</b>. Abrilo desde este mismo navegador para entrar.
          </div>
        ) : (
          <>
            <button className="btn" onClick={google} type="button">
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Entrar con Google
            </button>
            <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>
              o con un link por mail
            </div>
            <form onSubmit={sendLink} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label className="field">
                <span>Tu mail de trabajo</span>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@modusretis.com" />
              </label>
              <button className="btn primary" disabled={busy}>
                {busy ? "Enviando…" : "Mandarme el link"}
              </button>
            </form>
          </>
        )}
        {error && <div className="notice err">{error}</div>}
      </div>
    </main>
  );
}
