"use client";
// Dictado con la Web Speech API del navegador (Chrome, Edge, Safari). En español rioplatense.
import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Recognition = any;

export function speechSupported() {
  return typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export function useSpeech(onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setError("Tu navegador no soporta dictado. Probá con Chrome o Edge.");
      return;
    }
    setError(null);
    const r: Recognition = new SR();
    r.lang = "es-AR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e: any) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else partial += res[0].transcript;
      }
      setInterim(partial);
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed") setError("Necesitamos permiso para usar el micrófono.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError("Se cortó el dictado. Probá de nuevo.");
    };
    r.onend = () => {
      setListening(false);
      setInterim("");
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  return { listening, interim, error, start, stop, toggle: () => (listening ? stop() : start()) };
}
