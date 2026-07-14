// landing-consultor — cerebro del consultor IA del landing "IA a tu medida".
// Público (pre-login), mismo patrón que scan-business.
// Acciones:
//   analyze : { rol, sitio, proyecto }            → Firecrawl (sitio) + Foundry → chips + resumen; crea lead
//   plan    : { lead_id, rol, sitio, proyecto, answers[], extra, resumen } → Foundry → plan personalizado
//   contact : { lead_id, contacto }               → guarda contacto + email al equipo

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const AZURE_FOUNDRY_API_KEY = Deno.env.get("AZURE_FOUNDRY_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const FOUNDRY_ENDPOINT = Deno.env.get("AZURE_FOUNDRY_ENDPOINT") ||
  "https://jacob-mn3yo64e-eastus2.services.ai.azure.com/models/chat/completions";
const FOUNDRY_API_VERSION = Deno.env.get("AZURE_FOUNDRY_API_VERSION") || "2024-05-01-preview";
const FOUNDRY_MODEL = "gpt-4o-mini";

const NOTIFICATION_EMAILS = ["jacobopayan@yaub.ai"];
const FROM_EMAIL = "Yaub Bot <noreply@yaub.ai>";

// Agente Consultoría Jacobo (assistants) — su calendario nativo vive en Yaub Calendar
const CONSULTOR_ASSISTANT_ID = "6abc23ed-5ae0-4d90-b47d-7c16d5ea5614";
const CONSULTOR_TENANT_ID = "2cc20bca-5bbb-49a4-8bee-067ff5fd62db";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

function normalizeUrl(raw: string): string | null {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  try {
    return new URL(u).toString();
  } catch (_e) {
    return null;
  }
}

async function firecrawlScrape(url: string): Promise<string> {
  if (!FIRECRAWL_API_KEY) return "";
  const { signal, cancel } = withTimeout(9000);
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIRECRAWL_API_KEY}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 8000 }),
      signal,
    });
    if (!res.ok) return "";
    const j = await res.json();
    return ((j.data ?? j).markdown ?? "").slice(0, 9000);
  } catch (_e) {
    return "";
  } finally {
    cancel();
  }
}

async function callFoundry(system: string, user: string, maxTokens = 1800): Promise<any> {
  if (!AZURE_FOUNDRY_API_KEY) throw new Error("AZURE_FOUNDRY_API_KEY no configurado");
  const { signal, cancel } = withTimeout(25000);
  try {
    const res = await fetch(`${FOUNDRY_ENDPOINT}?api-version=${FOUNDRY_API_VERSION}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": AZURE_FOUNDRY_API_KEY },
      body: JSON.stringify({
        model: FOUNDRY_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.6,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
      signal,
    });
    if (!res.ok) throw new Error(`Foundry ${res.status}: ${(await res.text()).slice(0, 400)}`);
    const data = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
  } finally {
    cancel();
  }
}

const ANALYZE_SYSTEM = `Eres el consultor IA de Yaub ("IA a tu medida", el programa 1:1 de Jacobo para
que profesionistas y dueños de negocio en México trabajen con IA sobre SU trabajo real).
Recibes el rol de la persona, su descripción de su día a día y (si existe) el contenido de su sitio web.

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON con esta forma EXACTA:
{
  "nombre_display": "nombre corto de la empresa/negocio detectado en el sitio, o si no hay sitio, una etiqueta corta del rol (ej. 'tu operación')",
  "resumen_sitio": "2-3 frases: a qué se dedica el negocio y qué implica para el trabajo de esta persona. Si no hubo sitio, resume lo que la persona contó.",
  "chips": [ { "k": "etiqueta corta", "v": "dato concreto" } ]
}

REGLAS:
- "chips": EXACTAMENTE 4, tipo hallazgo de consultor: giro del negocio, la tarea que más pesa, frecuencia, y qué tan manual es el proceso. Concretos a ESTA persona, no genéricos.
- "k" máx 12 caracteres, "v" máx 35 caracteres.
- Español mexicano neutro. Sin markdown.`;

const PLAN_SYSTEM = `Eres el consultor IA de Yaub ("IA a tu medida"). Con el brief completo del prospecto
armas su plan personalizado. El programa entrega: 3 skills de IA hechas sobre su trabajo real + "Cowork Yaub"
(su espacio de trabajo con IA) + capacitación 1:1 con Jacobo.

Paquetes (elige el que mejor le queda):
0 = MI SETUP ($4,990 MXN, individual, 4 semanas) — una persona optimizando su propio trabajo.
1 = MI NEGOCIO ($12,900 MXN, dueño + 2, 6 semanas) — dueño de negocio que quiere meter IA a su operación.
2 = MI EQUIPO (desde $2,990/persona, 6 semanas) — equipos de 5 o más.

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON con esta forma EXACTA:
{
  "nombre_display": "misma etiqueta corta del negocio/rol recibida (o mejórala)",
  "skills": [ { "name": "Skill <nombre corto y memorable>", "desc": "qué hace, en sus palabras, máx 60 caracteres" } ],
  "stages": [ { "label": "etapa de su semana, 1-3 palabras", "sub": "matiz corto, máx 25 caracteres" } ],
  "equipos": [ { "name": "pieza del stack", "ben": "beneficio concreto para él/ella, máx 55 caracteres", "lab": "verbo corto (organiza/redacta/coordina/mejora)" } ],
  "pkg_rec": 0 | 1 | 2,
  "intro": "1 frase cálida de consultor presentando el plan, máx 140 caracteres"
}

REGLAS:
- "skills": EXACTAMENTE 3, nombradas sobre SUS tareas reales (ej: 'Skill Reporte Semanal').
- "stages": EXACTAMENTE 5, las etapas reales de SU semana en orden cronológico.
- "equipos": EXACTAMENTE 4. La primera SIEMPRE es "Cowork Yaub"; la última SIEMPRE es "Plan de 90 días"
  con ben tipo "sigues automatizando por tu cuenta". Las 2 de en medio son 2 de las 3 skills.
- "pkg_rec": usa las respuestas (equipo, horas) para decidir.
- Español mexicano neutro. Sin markdown. Nada de promesas de métricas específicas.`;

async function handleAnalyze(body: any) {
  const rol = (body.rol ?? "").toString().slice(0, 200);
  const sitio = (body.sitio ?? "").toString().slice(0, 300);
  const proyecto = (body.proyecto ?? "").toString().slice(0, 2000);
  const nombre = (body.nombre ?? "").toString().trim().slice(0, 120);
  const telefono = (body.telefono ?? "").toString().trim().slice(0, 30);
  if (!rol && !proyecto) return json({ ok: false, error: "faltan_datos" }, 400);

  const url = normalizeUrl(sitio);
  const siteMd = url ? await firecrawlScrape(url) : "";

  let ai: any = {};
  try {
    ai = await callFoundry(
      ANALYZE_SYSTEM,
      `ROL: ${rol}\nSITIO: ${url ?? "(sin sitio)"}\nDÍA A DÍA: ${proyecto}\n\nCONTENIDO DEL SITIO (markdown, puede venir vacío):\n${siteMd || "(no se pudo leer el sitio)"}`,
      900,
    );
  } catch (e) {
    console.error("analyze foundry error:", e);
  }

  const chips = Array.isArray(ai.chips) ? ai.chips.filter((c: any) => c?.k && c?.v).slice(0, 4) : [];

  const { data: lead, error } = await supabase
    .from("landing_leads")
    .insert({
      rol, sitio, proyecto,
      nombre: nombre || null,
      telefono: telefono || null,
      contacto: nombre && telefono ? `${nombre} · ${telefono}` : (telefono || nombre || null),
      site_summary: ai.resumen_sitio ?? null,
      chips: chips.length ? chips : null,
    })
    .select("id")
    .single();
  if (error) console.error("lead insert error:", error);

  return json({
    ok: true,
    lead_id: lead?.id ?? null,
    nombre_display: ai.nombre_display ?? null,
    resumen: ai.resumen_sitio ?? null,
    chips,
  });
}

async function handlePlan(body: any) {
  const rol = (body.rol ?? "").toString().slice(0, 200);
  const sitio = (body.sitio ?? "").toString().slice(0, 300);
  const proyecto = (body.proyecto ?? "").toString().slice(0, 2000);
  const answers = Array.isArray(body.answers) ? body.answers.map((a: any) => String(a).slice(0, 120)).slice(0, 6) : [];
  const extra = (body.extra ?? "").toString().slice(0, 500);
  const resumen = (body.resumen ?? "").toString().slice(0, 1000);
  const transcript = (body.transcript ?? "").toString().slice(0, 6000);

  let ai: any;
  try {
    ai = await callFoundry(
      PLAN_SYSTEM,
      `ROL: ${rol}\nSITIO: ${sitio || "(sin sitio)"}\nRESUMEN DEL NEGOCIO: ${resumen || "(sin resumen)"}\nDÍA A DÍA: ${proyecto}\nRESPUESTAS DEL DISCOVERY: ${answers.join(" | ") || "(sin respuestas)"}\nNOTA EXTRA: ${extra || "(ninguna)"}\n\nTRANSCRIPT DEL DISCOVERY (conversación real con el agente entrevistador — es tu mejor fuente):\n${transcript || "(sin transcript)"}`,
      1400,
    );
  } catch (e) {
    console.error("plan foundry error:", e);
    return json({ ok: false, error: "foundry_failed" }, 502);
  }

  const plan = {
    nombre_display: ai.nombre_display ?? null,
    skills: Array.isArray(ai.skills) ? ai.skills.slice(0, 3) : [],
    stages: Array.isArray(ai.stages) ? ai.stages.slice(0, 5) : [],
    equipos: Array.isArray(ai.equipos) ? ai.equipos.slice(0, 4) : [],
    pkg_rec: [0, 1, 2].includes(ai.pkg_rec) ? ai.pkg_rec : 0,
    intro: ai.intro ?? null,
  };

  if (body.lead_id) {
    const { error } = await supabase
      .from("landing_leads")
      .update({
        answers: answers.length ? answers : null,
        extra: extra || null,
        transcript: transcript || null,
        plan,
        pkg: ["MI SETUP", "MI NEGOCIO", "MI EQUIPO"][plan.pkg_rec],
        status: "plan_generado",
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.lead_id);
    if (error) console.error("lead update error:", error);
  }

  return json({ ok: true, ...plan });
}

async function handleContact(body: any) {
  const contacto = (body.contacto ?? "").toString().trim().slice(0, 200);
  if (!contacto || !body.lead_id) return json({ ok: false, error: "faltan_datos" }, 400);

  const { data: lead, error } = await supabase
    .from("landing_leads")
    .update({ contacto, status: "contacto_capturado", updated_at: new Date().toISOString() })
    .eq("id", body.lead_id)
    .select("id, rol, sitio, proyecto, pkg, plan, site_summary")
    .single();
  if (error || !lead) return json({ ok: false, error: "lead_no_encontrado" }, 404);

  if (RESEND_API_KEY) {
    const skills = (lead.plan?.skills ?? []).map((s: any) => `<li><strong>${s.name}</strong> — ${s.desc}</li>`).join("");
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFICATION_EMAILS,
          subject: `🔥 Lead del landing IA a tu medida: ${lead.rol || "sin rol"} (${contacto})`,
          html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <h2>Nuevo lead del consultor IA</h2>
            <p><strong>Contacto:</strong> ${contacto}</p>
            <p><strong>Rol:</strong> ${lead.rol || "—"}<br/>
            <strong>Sitio:</strong> ${lead.sitio || "—"}<br/>
            <strong>Paquete recomendado:</strong> ${lead.pkg || "—"}</p>
            <p><strong>Su día a día:</strong><br/>${lead.proyecto || "—"}</p>
            <p><strong>Resumen del negocio:</strong><br/>${lead.site_summary || "—"}</p>
            ${skills ? `<p><strong>Skills propuestas:</strong></p><ul>${skills}</ul>` : ""}
            <p style="color:#888;font-size:12px;">Lead ${lead.id} · tabla landing_leads</p>
          </div>`,
        }),
      });
    } catch (e) {
      console.error("resend error:", e);
    }
  }

  return json({ ok: true });
}

// ── Agenda (Yaub Calendar vía calendar-proxy, service-to-service) ──
async function callCalendarProxy(payload: Record<string, unknown>) {
  const { signal, cancel } = withTimeout(20000);
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/calendar-proxy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ ...payload, assistant_id: CONSULTOR_ASSISTANT_ID, tenant_id: CONSULTOR_TENANT_ID }),
      signal,
    });
    return await res.json();
  } finally {
    cancel();
  }
}

const AGENDA_TZ = "America/Monterrey";

function tzToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: AGENDA_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function slotLabel(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: AGENDA_TZ });
  const time = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: AGENDA_TZ });
  return `${day}, ${time} (hora de Monterrey)`;
}

// Sin fechas válidas en el body, el SERVIDOR pone hoy → +13 días (el LLM nunca calcula fechas).
async function handleAgendaSlots(body: any) {
  let startDate = String(body.start_date ?? "").slice(0, 10);
  let endDate = String(body.end_date ?? "").slice(0, 10);
  const today = tzToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < today) startDate = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate) {
    endDate = new Date(new Date(startDate + "T12:00:00Z").getTime() + 13 * 86400000).toISOString().slice(0, 10);
  }
  const r = await callCalendarProxy({ action: "check_availability", start_date: startDate, end_date: endDate, duration_minutes: 15 });
  if (r?.error) return json({ ok: false, error: r.error }, 502);
  const isoSlots: string[] = r.available_slots ?? [];
  return json({
    ok: true,
    server_today: today,
    timezone: r.timezone ?? AGENDA_TZ,
    available_slots: isoSlots,
    slots: isoSlots.slice(0, 40).map((s) => ({ start: s, label: slotLabel(s) })),
    count: isoSlots.length,
  });
}

async function handleAgendaBook(body: any) {
  const start = String(body.start ?? "");
  const name = (body.name ?? "").toString().trim().slice(0, 120);
  const phone = (body.phone ?? "").toString().trim().slice(0, 30);
  if (!start || !name || phone.replace(/\D/g, "").length < 10) {
    return json({ ok: false, error: "faltan_datos", message: "Falta el horario (start ISO), el nombre o un WhatsApp de 10 dígitos." }, 200);
  }
  if (new Date(start).getTime() < Date.now()) {
    return json({ ok: false, reason: "slot_pasado", message: "Ese horario ya pasó. Pide los horarios de nuevo con consultor_agenda_slots." }, 200);
  }
  const r = await callCalendarProxy({
    action: "book_slot",
    start,
    duration_minutes: 15,
    summary: `Consultoría IA a tu medida — ${name}`,
    customer_phone: phone,
  });
  if (!r?.booked) {
    return json({ ok: false, reason: r?.reason ?? "book_failed", message: r?.message ?? r?.error ?? "No se pudo agendar." }, 200);
  }
  if (body.lead_id) {
    const { error } = await supabase
      .from("landing_leads")
      .update({ contacto: `${name} · ${phone}`, status: "cita_agendada", updated_at: new Date().toISOString() })
      .eq("id", body.lead_id);
    if (error) console.error("lead cita update error:", error);
  }
  return json({ ok: true, appointment_id: r.appointment_id, starts_at: r.starts_at, ends_at: r.ends_at, starts_at_label: slotLabel(r.starts_at) });
}

// ── PDF del plan (web: botón de descarga · WhatsApp: tool consultor_plan_pdf + send_document) ──
function winAnsiSafe(s: string): string {
  return (s || "")
    .replace(/[✓✅]/g, "·").replace(/[→⇒]/g, ">").replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, "");
}

async function handlePlanPdf(body: any) {
  let nombre = (body.nombre ?? "").toString().trim().slice(0, 120);
  let empresa = (body.empresa ?? "").toString().trim().slice(0, 160);
  let telefono = (body.telefono ?? "").toString().trim().slice(0, 30);
  let planTexto = (body.plan_texto ?? "").toString().slice(0, 4000);
  let plan: any = null;
  let folio = "YB-" + new Date().toISOString().slice(2, 10).replace(/-/g, "");

  if (body.lead_id) {
    const { data: lead } = await supabase
      .from("landing_leads")
      .select("id, nombre, telefono, rol, sitio, plan, pkg, site_summary")
      .eq("id", body.lead_id)
      .maybeSingle();
    if (!lead) return json({ ok: false, error: "lead_no_encontrado" }, 404);
    nombre = nombre || lead.nombre || "Prospecto";
    telefono = telefono || lead.telefono || "";
    empresa = empresa || lead.rol || "";
    plan = lead.plan;
    folio = "YB-" + String(lead.id).slice(0, 8).toUpperCase();
  }
  if (!nombre) return json({ ok: false, error: "faltan_datos", message: "Falta el nombre del cliente." }, 200);
  if (!plan && !planTexto) return json({ ok: false, error: "faltan_datos", message: "Falta el contenido del plan (plan_texto)." }, 200);

  const PKGS = [
    { name: "MI SETUP", price: "$4,990 MXN por persona", weeks: "4 semanas · 4 sesiones 1:1" },
    { name: "MI NEGOCIO", price: "$12,900 MXN por empresa", weeks: "6 semanas · 6 sesiones" },
    { name: "MI EQUIPO", price: "desde $2,990 MXN por persona", weeks: "6 semanas · talleres + 1:1" },
  ];

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.12, 0.15, 0.24), muted = rgb(0.45, 0.48, 0.56), accent = rgb(0.93, 0.28, 0.6);
  let y = 790;
  const draw = (t: string, opts: { size?: number; b?: boolean; color?: any; x?: number } = {}) => {
    page.drawText(winAnsiSafe(t), { x: opts.x ?? 48, y, size: opts.size ?? 11, font: opts.b ? bold : font, color: opts.color ?? ink });
    y -= (opts.size ?? 11) + 7;
  };
  const wrap = (t: string, width = 92) => {
    const words = winAnsiSafe(t).split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > width) { lines.push(cur.trim()); cur = w; } else cur += " " + w; }
    if (cur.trim()) lines.push(cur.trim());
    return lines;
  };

  page.drawRectangle({ x: 0, y: 812, width: 595, height: 30, color: rgb(0.118, 0.153, 0.38) });
  page.drawText("JacoboYaub  ·  IA A TU MEDIDA", { x: 48, y: 821, size: 11, font: bold, color: rgb(1, 1, 1) });
  y = 770;
  draw("Tu plan personalizado", { size: 22, b: true });
  draw(`Folio ${folio}  ·  ${new Date().toLocaleDateString("es-MX", { timeZone: "America/Monterrey", day: "numeric", month: "long", year: "numeric" })}`, { size: 10, color: muted });
  y -= 6;
  draw(`Para: ${nombre}${empresa ? "  ·  " + empresa : ""}${telefono ? "  ·  " + telefono : ""}`, { size: 11, b: true });
  y -= 8;

  if (plan) {
    if (plan.intro) { for (const l of wrap(plan.intro)) draw(l, { color: muted }); y -= 6; }
    draw("TUS 3 SKILLS, HECHAS SOBRE TU TRABAJO REAL", { size: 10, b: true, color: accent });
    for (const s of plan.skills ?? []) {
      draw(`• ${s.name}`, { b: true });
      for (const l of wrap(s.desc || "", 88)) draw(l, { size: 10, color: muted, x: 60 });
    }
    y -= 6;
    draw("TU SEMANA, CON EL STACK TRABAJANDO", { size: 10, b: true, color: accent });
    for (const st of plan.stages ?? []) draw(`• ${st.label} — ${st.sub}`, { size: 10 });
    y -= 6;
    const pk = PKGS[[0, 1, 2].includes(plan.pkg_rec) ? plan.pkg_rec : 0];
    draw("PAQUETE RECOMENDADO", { size: 10, b: true, color: accent });
    draw(`${pk.name} — ${pk.price}`, { size: 13, b: true });
    draw(pk.weeks, { size: 10, color: muted });
    draw("Incluye: 3 skills + Cowork Yaub + capacitación 1:1 + comunidad de por vida.", { size: 10, color: muted });
  } else {
    for (const l of wrap(planTexto)) { if (y < 90) break; draw(l, { size: 10.5 }); }
  }

  y = Math.min(y, 96);
  draw("Siguiente paso: agenda 15 minutos con Jacobo — tu consultor te contacta por WhatsApp.", { size: 10, b: true });
  draw("Precio de lanzamiento válido 14 días · Todos los paquetes se facturan · yaub.ai", { size: 9, color: muted });

  const bytes = await doc.save();
  const path = `ia-a-tu-medida/plan-${folio}-${Date.now()}.pdf`;
  const { error: upErr } = await supabase.storage.from("yaub-quotations").upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) return json({ ok: false, error: "storage_failed", message: upErr.message }, 500);
  const { data: signed, error: sgErr } = await supabase.storage.from("yaub-quotations").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (sgErr || !signed?.signedUrl) return json({ ok: false, error: "sign_failed" }, 500);
  return json({ ok: true, url: signed.signedUrl, filename: `Plan IA a tu medida - ${winAnsiSafe(nombre)}.pdf` });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!body?.action) return json({ error: "missing_action" }, 400);

  try {
    switch (body.action) {
      case "analyze": return await handleAnalyze(body);
      case "plan": return await handlePlan(body);
      case "contact": return await handleContact(body);
      case "agenda_slots": return await handleAgendaSlots(body);
      case "agenda_book": return await handleAgendaBook(body);
      case "plan_pdf": return await handlePlanPdf(body);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("landing-consultor error:", e);
    return json({ ok: false, error: "internal", detail: (e as Error)?.message }, 500);
  }
});
