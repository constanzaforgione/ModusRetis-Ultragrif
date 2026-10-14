// Cron diario (vercel.json, lunes a viernes 8:00 ART): genera los avisos de tareas vencidas,
// por vencer, bloqueadas o sin movimiento, y manda un mail resumen a cada persona.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ALERT_META, alertsFor, type Alert } from "@/lib/alerts";
import { todayISO } from "@/lib/dates";
import type { Profile, Task } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const db = supabaseAdmin();
  const today = todayISO();
  // Tareas repetitivas del día (también se crean al abrir la app; no duplica)
  await db.rpc("spawn_recurring");

  const [{ data: profiles, error: e1 }, { data: tasks, error: e2 }] = await Promise.all([
    db.from("profiles").select("*").eq("active", true),
    db.from("tasks").select("*").neq("status", "hecha"),
  ]);
  if (e1 || e2) return NextResponse.json({ error: (e1 ?? e2)!.message }, { status: 500 });

  const people = profiles as Profile[];
  const open = tasks as Task[];
  const rows: { user_id: string; task_id: string; kind: string; message: string; day: string }[] = [];
  const digests: { p: Profile; mine: Alert[]; team: Alert[] }[] = [];

  for (const p of people) {
    const mine = alertsFor(open.filter((t) => t.assignee_id === p.id), today);
    // "Sin movimiento" va solo en el mail, para no llenar la campanita todos los días
    mine.filter((a) => a.kind !== "sin_movimiento").forEach((a) => rows.push({ user_id: p.id, task_id: a.task.id, kind: a.kind, message: `${a.text}: ${a.task.title}`, day: today }));

    let team: Alert[] = [];
    if (p.role === "lider" || p.role === "admin") {
      const teamIds = new Set(people.filter((x) => (p.role === "admin" || x.lead_id === p.id) && x.id !== p.id).map((x) => x.id));
      team = alertsFor(open.filter((t) => teamIds.has(t.assignee_id)), today).filter((a) => a.kind === "vencida" || a.kind === "bloqueada");
      team.forEach((a) => {
        const who = people.find((x) => x.id === a.task.assignee_id)?.full_name ?? "Alguien";
        rows.push({ user_id: p.id, task_id: a.task.id, kind: "equipo_" + a.kind, message: `${who} · ${a.text.toLowerCase()}: ${a.task.title}`, day: today });
      });
    }
    if (mine.length || team.length) digests.push({ p, mine, team });
  }

  if (rows.length) {
    const { error } = await db.from("notifications").upsert(rows, { onConflict: "user_id,task_id,kind,day", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let emails = 0;
  if (process.env.RESEND_API_KEY) {
    for (const d of digests.filter((d) => d.p.email_alerts)) {
      if (await sendDigest(d.p, d.mine, d.team, people)) emails++;
    }
  }
  return NextResponse.json({ ok: true, today, notifications: rows.length, emails });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function sendDigest(p: Profile, mine: Alert[], team: Alert[], people: Profile[]) {
  const url = process.env.APP_URL ?? "";
  const li = (a: Alert, who?: string) =>
    `<li style="margin:0 0 8px"><b style="color:${a.kind === "vencida" || a.kind === "bloqueada" ? "#c93636" : "#8a5300"}">${ALERT_META[a.kind].label}</b> · ${esc(a.task.title)}<br><span style="color:#5a6a85;font-size:13px">${esc(a.text)}${who ? ` · ${esc(who)}` : ""}</span></li>`;
  const html = `<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#111827">
    <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5a6a85;font-weight:700">Modus Retis · Planning</p>
    <h2 style="margin:0 0 12px">Hola ${esc(p.full_name.split(" ")[0] ?? "")}, esto necesita tu atención</h2>
    ${mine.length ? `<h3 style="color:#304cd3">Tus tareas</h3><ul style="padding-left:18px">${mine.map((a) => li(a)).join("")}</ul>` : ""}
    ${team.length ? `<h3 style="color:#304cd3">Tu equipo</h3><ul style="padding-left:18px">${team.map((a) => li(a, people.find((x) => x.id === a.task.assignee_id)?.full_name)).join("")}</ul>` : ""}
    ${url ? `<p><a href="${url}/atencion" style="background:#304cd3;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Abrir el planning</a></p>` : ""}
    <p style="color:#5a6a85;font-size:12px">Podés apagar estos mails en Equipo → “Recibir alertas por mail”.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERTS_FROM_EMAIL ?? "Planning Modus Retis <onboarding@resend.dev>",
      to: p.email,
      subject: `[Planning] ${mine.length + team.length} ${mine.length + team.length === 1 ? "tarea necesita" : "tareas necesitan"} atención`,
      html,
    }),
  });
  if (!res.ok) console.error("cron: Resend", res.status, await res.text());
  return res.ok;
}
