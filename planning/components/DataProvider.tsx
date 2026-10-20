"use client";
// Carga clientes, roadmap, tareas y equipo una vez y los mantiene al día con Supabase Realtime.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { Client, Notification, Profile, Project, RecurringTask, Task } from "@/lib/types";
import { todayISO } from "@/lib/dates";

type Table = "tasks" | "projects" | "clients" | "profiles" | "notifications" | "recurring_tasks";

interface Data {
  me: Profile;
  profiles: Profile[];
  clients: Client[];
  projects: Project[];
  tasks: Task[];
  recurring: RecurringTask[];
  notifications: Notification[];
  loading: boolean;
  today: string;
  reload: (table?: Table) => Promise<void>;
  /** Inserta/actualiza/borra y devuelve el error en castellano, o null si salió bien */
  save: <T extends { id?: string }>(table: Table, row: Partial<T> & { id?: string }) => Promise<{ error: string | null; row?: T }>;
  remove: (table: Table, id: string) => Promise<string | null>;
  toast: (msg: string, err?: boolean) => void;
  byId: { profile: Map<string, Profile>; client: Map<string, Client>; project: Map<string, Project> };
}

const Ctx = createContext<Data | null>(null);

export function useData() {
  const d = useContext(Ctx);
  if (!d) throw new Error("useData fuera de DataProvider");
  return d;
}

function humanError(message: string): string {
  if (/row-level security|permission denied/i.test(message)) return "No tenés permiso para hacer ese cambio.";
  if (/Solo un admin/.test(message)) return message;
  if (/duplicate key.*clients_name/i.test(message)) return "Ya existe un cliente con ese nombre.";
  if (/check constraint/i.test(message)) return "Revisá las fechas: el fin no puede ser antes del inicio.";
  return message;
}

export function DataProvider({ me: initialMe, children }: { me: Profile; children: React.ReactNode }) {
  const sb = supabaseBrowser();
  const [profiles, setProfiles] = useState<Profile[]>([initialMe]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recurring, setRecurring] = useState<RecurringTask[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState<{ msg: string; err: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [today, setToday] = useState(todayISO());

  const me = profiles.find((p) => p.id === initialMe.id) ?? initialMe;

  const toast = useCallback((msg: string, err = false) => {
    setToastMsg({ msg, err });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500);
  }, []);

  const reload = useCallback(
    async (table?: Table) => {
      const load = async (t: Table) => {
        if (t === "profiles") {
          const { data } = await sb.from("profiles").select("*").order("full_name");
          if (data) setProfiles(data as Profile[]);
        } else if (t === "clients") {
          const { data } = await sb.from("clients").select("*").order("name");
          if (data) setClients(data as Client[]);
        } else if (t === "projects") {
          const { data } = await sb.from("projects").select("*").order("start_date");
          if (data) setProjects(data as Project[]);
        } else if (t === "recurring_tasks") {
          const { data } = await sb.from("recurring_tasks").select("*").eq("active", true);
          if (data) setRecurring(data as RecurringTask[]);
        } else if (t === "tasks") {
          const { data } = await sb.from("tasks").select("*").order("due_date", { nullsFirst: false });
          if (data) setTasks(data as Task[]);
        } else {
          const { data } = await sb
            .from("notifications")
            .select("*")
            .eq("user_id", initialMe.id)
            .order("created_at", { ascending: false })
            .limit(60);
          if (data) setNotifications(data as Notification[]);
        }
      };
      if (table) await load(table);
      else await Promise.all((["profiles", "clients", "projects", "tasks", "notifications", "recurring_tasks"] as Table[]).map(load));
    },
    [sb, initialMe.id],
  );

  useEffect(() => {
    // Crea las tareas repetitivas que tocan hoy (no duplica) y después carga todo
    Promise.resolve(sb.rpc("spawn_recurring"))
      .catch(() => null)
      // Avisos del día (vence hoy, venció ayer, proyectos por terminar); no duplica
      .then(() => Promise.resolve(sb.rpc("daily_notifications")).catch(() => null))
      .then(() => reload())
      .finally(() => setLoading(false));
    const ch = sb.channel("planning");
    (["tasks", "projects", "clients", "profiles", "notifications", "recurring_tasks"] as Table[]).forEach((t) =>
      ch.on("postgres_changes", { event: "*", schema: "public", table: t }, () => reload(t)),
    );
    ch.subscribe();
    // "Hoy" cambia a medianoche aunque la pestaña quede abierta
    const iv = setInterval(() => setToday(todayISO()), 60_000);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      sb.removeChannel(ch);
      clearInterval(iv);
      window.removeEventListener("focus", onFocus);
    };
  }, [sb, reload]);

  const save: Data["save"] = useCallback(
    async (table, row) => {
      const { id, ...fields } = row;
      const q = id ? sb.from(table).update(fields).eq("id", id) : sb.from(table).insert(fields);
      const { data, error } = await q.select().maybeSingle();
      if (error) return { error: humanError(error.message) };
      if (!data) return { error: "No tenés permiso para hacer ese cambio." };
      await reload(table);
      return { error: null, row: data };
    },
    [sb, reload],
  );

  const remove: Data["remove"] = useCallback(
    async (table, id) => {
      const { data, error } = await sb.from(table).delete().eq("id", id).select("id");
      if (error) return humanError(error.message);
      if (!data?.length) return "No tenés permiso para borrar esto.";
      await reload(table);
      return null;
    },
    [sb, reload],
  );

  const byId = useMemo(
    () => ({
      profile: new Map(profiles.map((p) => [p.id, p])),
      client: new Map(clients.map((c) => [c.id, c])),
      project: new Map(projects.map((p) => [p.id, p])),
    }),
    [profiles, clients, projects],
  );

  const value: Data = { me, profiles, clients, projects, tasks, recurring, notifications, loading, today, reload, save, remove, toast, byId };

  return (
    <Ctx.Provider value={value}>
      {children}
      {toastMsg && (
        <div className={`toast ${toastMsg.err ? "err" : ""}`} role="status">
          {toastMsg.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}
