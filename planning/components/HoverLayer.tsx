"use client";
// Resumen al pasar el mouse: cualquier elemento con data-hover-task="<id>" o data-hover-project="<id>"
// muestra una tarjeta con lo principal, sin tener que abrirlo. Solo en dispositivos con mouse.
import { useEffect, useRef, useState } from "react";
import { useData } from "./DataProvider";
import { Avatar, ClientTag } from "./ui";
import { alertFor } from "@/lib/alerts";
import { fmtShort, hhmm, relative } from "@/lib/dates";
import { PRIORITY_LABEL, PROJECT_STATUS_LABEL, STATUS_LABEL } from "@/lib/types";

type Target = { kind: "task" | "project"; id: string; rect: DOMRect };

const DELAY = 350;
const W = 320;

export function HoverLayer() {
  const { tasks, projects, today, byId } = useData();
  const [target, setTarget] = useState<Target | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef<Element | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTarget(null);
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-hover-task],[data-hover-project]");
      if (el === current.current) return;
      clearTimeout(timer.current);
      current.current = el;
      setTarget(null);
      if (!el) return;
      timer.current = setTimeout(() => {
        const h = el as HTMLElement;
        const kind = h.dataset.hoverTask ? "task" : "project";
        setTarget({ kind, id: (h.dataset.hoverTask ?? h.dataset.hoverProject)!, rect: h.getBoundingClientRect() });
      }, DELAY);
    };
    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Ubicación: debajo del elemento; si no entra, arriba. Siempre dentro de la ventana.
  useEffect(() => {
    if (!target) return setPos(null);
    const h = cardRef.current?.offsetHeight ?? 180;
    const r = target.rect;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - W - 8));
    const below = r.bottom + 8;
    const top = below + h < window.innerHeight - 8 ? below : Math.max(8, r.top - h - 8);
    setPos({ left, top });
  }, [target]);

  if (!target) return null;
  const style = { left: pos?.left ?? -9999, top: pos?.top ?? -9999 };

  if (target.kind === "task") {
    const t = tasks.find((x) => x.id === target.id);
    if (!t) return null;
    const who = byId.profile.get(t.assignee_id);
    const project = t.project_id ? byId.project.get(t.project_id) : undefined;
    const alert = alertFor(t, today);
    return (
      <div className="hovercard" ref={cardRef} style={style} role="tooltip">
        <div className="row">
          <ClientTag c={t.client_id ? byId.client.get(t.client_id) : undefined} />
          {project && <span className="muted">· {project.name}</span>}
        </div>
        <b className="h">{t.title}</b>
        <div className="row">
          <span className={`pill s-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          <span className={`prio ${t.priority}`}>{PRIORITY_LABEL[t.priority]}</span>
          {alert && <span className={`pill k-${alert.kind}`}>{alert.text}</span>}
        </div>
        <div className="kv">
          <span>Responsable</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Avatar p={who} sm /> {who?.full_name ?? "—"}
          </span>
          <span>Inicio</span>
          <span>{fmtShort(t.start_date)}</span>
          <span>Vence</span>
          <span>{t.due_date ? `${fmtShort(t.due_date)}${t.status !== "hecha" ? ` (${relative(t.due_date, today)})` : ""}` : "Sin fecha"}</span>
          {t.start_time && (
            <>
              <span>Horario</span>
              <span>
                {hhmm(t.start_time)}
                {t.end_time ? ` a ${hhmm(t.end_time)}` : ""}
              </span>
            </>
          )}
          {t.recurring_id && (
            <>
              <span>Repite</span>
              <span>🔁 Sí</span>
            </>
          )}
        </div>
        {t.description && <div className="desc">{t.description}</div>}
        <div className="hint">Clic para abrir y editar</div>
      </div>
    );
  }

  const p = projects.find((x) => x.id === target.id);
  if (!p) return null;
  const owner = p.owner_id ? byId.profile.get(p.owner_id) : undefined;
  const linked = tasks.filter((t) => t.project_id === p.id);
  const done = linked.filter((t) => t.status === "hecha").length;
  const late = linked.filter((t) => t.status !== "hecha" && t.due_date && t.due_date < today).length;
  return (
    <div className="hovercard" ref={cardRef} style={style} role="tooltip">
      <ClientTag c={byId.client.get(p.client_id)} />
      <b className="h">{p.name}</b>
      <div className="row">
        <span className="pill s-en_revision">{PROJECT_STATUS_LABEL[p.status]}</span>
        <span className="muted">{linked.length ? `${Math.round((done / linked.length) * 100)}% de avance` : "Sin tareas todavía"}</span>
      </div>
      <div className="bar-p">
        <i style={{ width: `${linked.length ? Math.round((done / linked.length) * 100) : 0}%` }} />
      </div>
      <div className="kv">
        <span>Responsable</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {owner ? (
            <>
              <Avatar p={owner} sm /> {owner.full_name}
            </>
          ) : (
            "Sin asignar"
          )}
        </span>
        <span>Fechas</span>
        <span>
          {fmtShort(p.start_date)} → {fmtShort(p.end_date)}
        </span>
        <span>Tareas</span>
        <span>
          {done}/{linked.length} hechas{late ? <b className="late"> · {late} vencidas</b> : null}
        </span>
      </div>
      {p.description && <div className="desc">{p.description}</div>}
      <div className="hint">Clic para abrir y editar</div>
    </div>
  );
}
