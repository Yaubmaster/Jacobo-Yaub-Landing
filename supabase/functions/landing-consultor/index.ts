// landing-consultor — cerebro del consultor IA del landing "IA a tu medida".
// Público (pre-login), mismo patrón que scan-business.
// Acciones:
//   analyze       : { rol, sitio, proyecto }            → Firecrawl (sitio) + Foundry → chips + resumen; crea lead
//   plan          : { lead_id, rol, sitio, proyecto, answers[], extra, resumen } → Foundry → plan personalizado
//   contact       : { lead_id, contacto }               → guarda contacto + email al equipo
//   agenda_slots  : { }                                 → horarios reales (el servidor calcula las fechas)
//   agenda_book   : { start, name, phone, lead_id? }    → agenda 15 min con Jacobo
//   plan_pdf      : { lead_id | nombre+plan_texto }     → PDF del plan
//   plan_checkout : { lead_id } o { nombre, telefono, pkg } → link de pago MercadoPago (Checkout Pro)
//   access_unlock : { lead_id, password }               → bypass de pago con master password (SOLO server-side)
//   payment_status: { lead_id }                         → estado de pago/acceso del lead (para el wizard del front)
// Webhook de MercadoPago: POST ?mp=1 (MP no manda Origin ni JWT; se valida re-consultando el pago a la API de MP).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const AZURE_FOUNDRY_API_KEY = Deno.env.get("AZURE_FOUNDRY_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const MP_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN") || Deno.env.get("MP_ACCESS_TOKEN") || "";
// Master password: mueve esto a un secret (YAUB_MASTER_PASSWORD) cuando puedas. Nunca se manda al cliente.
const MASTER_PASSWORD = Deno.env.get("YAUB_MASTER_PASSWORD") || "yaubmaster1103";
const LANDING_URL = Deno.env.get("LANDING_URL") || "https://jacobo.yaub.ai";

const FOUNDRY_ENDPOINT = Deno.env.get("AZURE_FOUNDRY_ENDPOINT") ||
  "https://jacob-mn3yo64e-eastus2.services.ai.azure.com/models/chat/completions";
const FOUNDRY_API_VERSION = Deno.env.get("AZURE_FOUNDRY_API_VERSION") || "2024-05-01-preview";
const FOUNDRY_MODEL = "gpt-4o-mini";

const NOTIFICATION_EMAILS = ["jacobopayan@yaub.ai"];
const FROM_EMAIL = "Yaub Bot <noreply@yaub.ai>";

// Agente Consultoría Jacobo (assistants) — su calendario nativo vive en Yaub Calendar
const CONSULTOR_ASSISTANT_ID = "6abc23ed-5ae0-4d90-b47d-7c16d5ea5614";
const CONSULTOR_TENANT_ID = "2cc20bca-5bbb-49a4-8bee-067ff5fd62db";

// Catálogo de paquetes. pkg_rec del plan indexa aquí. MI EQUIPO no se auto-cobra (precio por persona).
const PKGS = [
  { name: "MI SETUP", price_mxn: 4990, price: "$4,990 MXN por persona", weeks: "4 semanas · 4 sesiones 1:1", chargeable: true },
  { name: "MI NEGOCIO", price_mxn: 12900, price: "$12,900 MXN por empresa", weeks: "6 semanas · 6 sesiones", chargeable: true },
  { name: "MI EQUIPO", price_mxn: 0, price: "desde $2,990 MXN por persona", weeks: "6 semanas · talleres + 1:1", chargeable: false },
];

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Content-Type": "application/json",
};

// Anti-abuso: la fn es pública (pre-login). El navegador del landing SIEMPRE manda Origin;
// las llamadas server-to-server del runtime (tools de WhatsApp/voz) NO mandan Origin y suelen
// traer el service role → se les hace bypass. El resto (incl. floods por curl) va por rate-limit por IP.
const ALLOWED_ORIGIN = /^https?:\/\/(jacobo\.yaub\.ai|([a-z0-9-]+\.)?vercel\.app|localhost(:\d+)?|127\.0\.0\.1(:\d+)?)$/i;
const RATE_LIMITS: Record<string, { limit: number; win: number }> = {
  analyze:       { limit: 25, win: 600 },
  plan:          { limit: 25, win: 600 },
  contact:       { limit: 15, win: 3600 },
  agenda_slots:  { limit: 90, win: 600 },
  agenda_book:   { limit: 30, win: 3600 },
  plan_pdf:      { limit: 40, win: 3600 },
  plan_checkout: { limit: 20, win: 3600 },
  // Apretado a propósito: es el único freno contra fuerza bruta a la master password.
  access_unlock: { limit: 8, win: 3600 },
  payment_status:{ limit: 120, win: 600 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

// Escapa HTML para interpolar datos del usuario en el correo de notificación sin inyección.
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return { signal: ac.signal, cancel: () => clearTimeout(t) };
}

function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}

// Comparación en tiempo constante: evita distinguir la password por latencia.
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

function normalizeUrl(raw: string): string | null {
  let u = (raw || "").trim();
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch (_e) {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Bloquea hosts privados/reservados: evita usar Firecrawl para raspar red interna / metadata (SSRF/abuso).
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const p = host.split(".").map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return null;
    if (p[0] === 169 && p[1] === 254) return null;              // link-local / metadata (169.254.169.254)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return null;  // 172.16/12
    if (p[0] === 192 && p[1] === 168) return null;              // 192.168/16
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return null; // CGNAT 100.64/10
  }
  if (host.includes(":")) { // IPv6 loopback / privados
    if (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return null;
  }
  return parsed.toString();
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
armas su plan personalizado, YA PRE-ARMADO para arrancar (no una cotización a construir). El programa entrega: 3 skills de IA hechas sobre su trabajo real + "Cowork Yaub"
(su espacio de trabajo con IA: correo, calendario y Drive conectados) + capacitación 1:1 con Jacobo + comunidad de por vida.
Si la persona es dueño de negocio o dueño/responsable de un proceso, ADEMÁS se le ofrece un Agente Yaub por vertical (WhatsApp/voz 24/7).

Paquetes (elige el que mejor le queda):
0 = MI SETUP ($4,990 MXN, individual, 4 semanas) — una persona optimizando su propio trabajo.
1 = MI NEGOCIO ($12,900 MXN, dueño + 2, 6 semanas) — dueño de negocio que quiere meter IA a su operación (incluye 1er mes de agente de WhatsApp).
2 = MI EQUIPO (desde $2,990/persona, 6 semanas) — equipos de 5 o más.

DEVUELVE EXCLUSIVAMENTE UN OBJETO JSON con esta forma EXACTA:
{
  "nombre_display": "misma etiqueta corta del negocio/rol recibida (o mejórala)",
  "skills": [ { "name": "Skill <nombre corto y memorable>", "desc": "qué hace, en sus palabras, máx 60 caracteres" } ],
  "stages": [ { "label": "etapa de su semana, 1-3 palabras", "sub": "matiz corto, máx 25 caracteres" } ],
  "equipos": [ { "name": "pieza del stack", "ben": "beneficio concreto para él/ella, máx 55 caracteres", "lab": "verbo corto (organiza/redacta/coordina/mejora)" } ],
  "es_dueno": true,
  "vertical": "reclutamiento | cobranza | inmobiliaria | atencion_clientes | ventas | restaurantes | otro | null",
  "agente_yaub": { "name": "Agente <Vertical> Yaub", "ben": "qué hace 24/7 por WhatsApp/voz para SU negocio, máx 60 caracteres" },
  "pkg_rec": 0,
  "intro": "1 frase cálida de consultor presentando el plan YA armado, máx 140 caracteres"
}

REGLAS:
- "skills": EXACTAMENTE 3, nombradas sobre SUS tareas reales (ej: 'Skill Reporte Semanal').
- "stages": EXACTAMENTE 5, las etapas reales de SU semana en orden cronológico.
- "equipos": EXACTAMENTE 4. La primera SIEMPRE es "Cowork Yaub"; la última SIEMPRE es "Plan de 90 días"
  con ben tipo "sigues automatizando por tu cuenta". Las 2 de en medio son 2 de las 3 skills.
- "es_dueno": true si es dueño de negocio o dueño/responsable de un proceso (contratación, cobranza, ventas, atención...); false si es empleado que solo optimiza su propio trabajo.
- "vertical" y "agente_yaub": SOLO cuando es_dueno=true. Elige la vertical que mejor encaje (reclutamiento, cobranza, inmobiliaria, atencion_clientes, ventas, restaurantes u otro) y arma el agente para SU negocio. Si es_dueno=false → vertical="null" y agente_yaub=null. No inventes precios: el agente va dentro de Mi Negocio (1er mes incluido) o se cotiza en el discovery.
- "pkg_rec": si es_dueno=true recomienda 1 (MI NEGOCIO); equipos de 5+ → 2; individual → 0.
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

  const agente = ai.agente_yaub && ai.agente_yaub.name
    ? { name: String(ai.agente_yaub.name).slice(0, 60), ben: String(ai.agente_yaub.ben ?? "").slice(0, 90) }
    : null;
  const plan = {
    nombre_display: ai.nombre_display ?? null,
    skills: Array.isArray(ai.skills) ? ai.skills.slice(0, 3) : [],
    stages: Array.isArray(ai.stages) ? ai.stages.slice(0, 5) : [],
    equipos: Array.isArray(ai.equipos) ? ai.equipos.slice(0, 4) : [],
    es_dueno: typeof ai.es_dueno === "boolean" ? ai.es_dueno : !!agente,
    vertical: ai.vertical && ai.vertical !== "null" ? String(ai.vertical).slice(0, 40) : null,
    agente_yaub: agente,
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
        pkg: PKGS[plan.pkg_rec].name,
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

  // Si el front manda nombre/telefono por separado, los persistimos en sus columnas
  // (sin ellas el lead queda sin forma de cobrarle ni darle seguimiento).
  const nombre = (body.nombre ?? "").toString().trim().slice(0, 120);
  const telefono = (body.telefono ?? "").toString().trim().slice(0, 30);

  const patch: Record<string, unknown> = { contacto, status: "contacto_capturado", updated_at: new Date().toISOString() };
  if (nombre) patch.nombre = nombre;
  if (telefono) patch.telefono = telefono;

  const { data: lead, error } = await supabase
    .from("landing_leads")
    .update(patch)
    .eq("id", body.lead_id)
    .select("id, rol, sitio, proyecto, pkg, plan, site_summary")
    .single();
  if (error || !lead) return json({ ok: false, error: "lead_no_encontrado" }, 404);

  if (RESEND_API_KEY) {
    const skills = (lead.plan?.skills ?? []).map((s: any) => `<li><strong>${esc(s.name)}</strong> — ${esc(s.desc)}</li>`).join("");
    const agenteHtml = lead.plan?.agente_yaub ? `<p><strong>Agente Yaub sugerido:</strong> ${esc(lead.plan.agente_yaub.name)} — ${esc(lead.plan.agente_yaub.ben)} (vertical: ${esc(lead.plan.vertical) || "—"})</p>` : "";
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFICATION_EMAILS,
          subject: `🔥 Lead del landing IA a tu medida: ${(lead.rol || "sin rol").toString().replace(/[\r\n]+/g, " ").slice(0, 120)} (${contacto.replace(/[\r\n]+/g, " ")})`,
          html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <h2>Nuevo lead del consultor IA</h2>
            <p><strong>Contacto:</strong> ${esc(contacto)}</p>
            <p><strong>Rol:</strong> ${esc(lead.rol) || "—"}<br/>
            <strong>Sitio:</strong> ${esc(lead.sitio) || "—"}<br/>
            <strong>Paquete recomendado:</strong> ${esc(lead.pkg) || "—"}</p>
            <p><strong>Su día a día:</strong><br/>${esc(lead.proyecto) || "—"}</p>
            <p><strong>Resumen del negocio:</strong><br/>${esc(lead.site_summary) || "—"}</p>
            ${agenteHtml}
            ${skills ? `<p><strong>Skills propuestas:</strong></p><ul>${skills}</ul>` : ""}
            <p style="color:#888;font-size:12px;">Lead ${esc(lead.id)} · tabla landing_leads</p>
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
      .update({ nombre: name, telefono: phone, contacto: `${name} · ${phone}`, status: "cita_agendada", updated_at: new Date().toISOString() })
      .eq("id", body.lead_id);
    if (error) console.error("lead cita update error:", error);
  }
  return json({ ok: true, appointment_id: r.appointment_id, starts_at: r.starts_at, ends_at: r.ends_at, starts_at_label: slotLabel(r.starts_at) });
}

// ── Pagos (MercadoPago Checkout Pro, credenciales de PLATAFORMA — Yaub cobra al prospecto) ──
// Caso A del proyecto (mismo token que mp-platform-checkout), pero sin invoices/tenants:
// el prospecto del landing todavía no es tenant. external_reference = "lead:<uuid>".
function pkgIndexFor(lead: any, bodyPkg?: unknown): number {
  const byName = typeof bodyPkg === "string" ? PKGS.findIndex((p) => p.name.toLowerCase() === bodyPkg.toLowerCase()) : -1;
  if (byName >= 0) return byName;
  if (typeof bodyPkg === "number" && [0, 1, 2].includes(bodyPkg)) return bodyPkg;
  const rec = lead?.plan?.pkg_rec;
  return [0, 1, 2].includes(rec) ? rec : 0;
}

const LEAD_COLS = "id, nombre, telefono, rol, pkg, plan, payment_status, access_granted, mp_preference_id, amount_mxn";

async function handlePlanCheckout(body: any) {
  if (!MP_TOKEN) return json({ ok: false, error: "mp_no_configurado", message: "Falta MERCADOPAGO_ACCESS_TOKEN." }, 500);

  let lead: any = null;

  if (body.lead_id) {
    const { data } = await supabase.from("landing_leads").select(LEAD_COLS).eq("id", body.lead_id).maybeSingle();
    if (!data) return json({ ok: false, error: "lead_no_encontrado" }, 404);
    lead = data;
  } else {
    // Canal WhatsApp/voz: no hay lead del landing. Creamos uno para que TODO pago
    // viva en la misma tabla y no se abran dos sistemas de cobro en paralelo.
    const nombre = (body.nombre ?? "").toString().trim().slice(0, 120);
    const telefono = (body.telefono ?? "").toString().trim().slice(0, 30);
    if (!nombre || telefono.replace(/\D/g, "").length < 10) {
      return json({ ok: false, error: "faltan_datos", message: "Para generar el link necesito el nombre y el WhatsApp (10 dígitos) del cliente." }, 200);
    }
    // Si ya le generamos link antes al mismo teléfono, reusamos su lead (no duplicamos prospectos).
    const { data: prev } = await supabase.from("landing_leads").select(LEAD_COLS)
      .eq("telefono", telefono).eq("source", "whatsapp_consultor")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (prev) {
      lead = prev;
    } else {
      const idxNew = pkgIndexFor(null, body.pkg);
      const { data: nl, error } = await supabase.from("landing_leads").insert({
        source: "whatsapp_consultor",
        rol: (body.rol ?? "").toString().slice(0, 200) || null,
        proyecto: (body.notas ?? "").toString().slice(0, 2000) || null,
        nombre, telefono,
        contacto: `${nombre} · ${telefono}`,
        pkg: PKGS[idxNew].name,
        plan: { pkg_rec: idxNew },
        status: "pago_pendiente",
      }).select(LEAD_COLS).single();
      if (error || !nl) {
        console.error("lead whatsapp insert error:", error);
        return json({ ok: false, error: "lead_insert_failed" }, 500);
      }
      lead = nl;
    }
  }

  // Ya tiene acceso (pagó o entró con master password): no lo mandes a pagar otra vez.
  if (lead.access_granted) return json({ ok: true, already: true, access: true, lead_id: lead.id, payment_status: lead.payment_status });

  const idx = pkgIndexFor(lead, body.pkg);
  const pk = PKGS[idx];
  if (!pk.chargeable) {
    return json({ ok: false, error: "requiere_cotizacion", pkg: pk.name, message: "MI EQUIPO se cotiza por persona: Jacobo te manda el link a la medida." }, 200);
  }

  const nombreLead = (lead.nombre || "").trim();
  const title = `Yaub — IA a tu medida · ${pk.name}`;
  const pref: Record<string, unknown> = {
    items: [{ title, description: pk.weeks, quantity: 1, unit_price: pk.price_mxn, currency_id: "MXN" }],
    external_reference: `lead:${lead.id}`,
    notification_url: `${SUPABASE_URL}/functions/v1/landing-consultor?mp=1`,
    statement_descriptor: "YAUB",
    back_urls: {
      success: `${LANDING_URL}/?pago=success&lead=${lead.id}`,
      failure: `${LANDING_URL}/?pago=failure&lead=${lead.id}`,
      pending: `${LANDING_URL}/?pago=pending&lead=${lead.id}`,
    },
    auto_return: "approved",
    metadata: { lead_id: lead.id, pkg: pk.name, origen: "landing_ia_a_tu_medida" },
  };
  if (nombreLead) {
    (pref as any).payer = {
      name: nombreLead.split(" ")[0].slice(0, 60),
      surname: nombreLead.split(" ").slice(1).join(" ").slice(0, 60) || "-",
    };
  }

  const { signal, cancel } = withTimeout(15000);
  let mpData: any;
  try {
    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${MP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(pref),
      signal,
    });
    mpData = await mpRes.json();
    if (!mpRes.ok) {
      console.error("mp preference failed:", JSON.stringify(mpData).slice(0, 500));
      return json({ ok: false, error: "mp_preference_failed", message: mpData?.message ?? "MercadoPago rechazó la preferencia." }, 502);
    }
  } catch (e) {
    console.error("mp preference error:", e);
    return json({ ok: false, error: "mp_unreachable" }, 502);
  } finally {
    cancel();
  }

  await supabase.from("landing_leads").update({
    mp_preference_id: mpData.id,
    amount_mxn: pk.price_mxn,
    payment_status: "pending",
    pkg: pk.name,
    status: "pago_pendiente",
    updated_at: new Date().toISOString(),
  }).eq("id", lead.id);

  return json({
    ok: true,
    lead_id: lead.id,
    pkg: pk.name,
    amount_mxn: pk.price_mxn,
    price_label: pk.price,
    preference_id: mpData.id,
    init_point: mpData.init_point,
    sandbox_init_point: mpData.sandbox_init_point,
    checkout_url: mpData.init_point ?? mpData.sandbox_init_point,
  });
}

// Estado de pago/acceso — el wizard del front hace polling aquí al volver de MercadoPago.
async function handlePaymentStatus(body: any) {
  if (!body.lead_id) return json({ ok: false, error: "faltan_datos" }, 400);
  const { data: lead } = await supabase
    .from("landing_leads")
    .select("id, pkg, payment_status, access_granted, access_reason, amount_mxn, paid_at, status")
    .eq("id", body.lead_id)
    .maybeSingle();
  if (!lead) return json({ ok: false, error: "lead_no_encontrado" }, 404);
  return json({ ok: true, ...lead });
}

// Bypass con master password. SOLO se valida aquí (server-side): la password NUNCA
// viaja al navegador ni se devuelve en ninguna respuesta. Rate-limit 8/h por IP + auditoría.
async function handleAccessUnlock(body: any, ip: string) {
  const password = (body.password ?? "").toString();
  const leadId = body.lead_id ?? null;
  const ok = !!password && safeEqual(password, MASTER_PASSWORD);

  await supabase.from("landing_access_attempts").insert({ lead_id: leadId, ip, success: ok });

  if (!ok) return json({ ok: false, error: "password_incorrecto" }, 200);

  if (leadId) {
    await supabase.from("landing_leads").update({
      access_granted: true,
      access_reason: "master_password",
      access_granted_at: new Date().toISOString(),
      payment_status: "bypass",
      status: "acceso_master",
      updated_at: new Date().toISOString(),
    }).eq("id", leadId);
  }
  return json({ ok: true, access: true, reason: "master_password" });
}

// Webhook de MercadoPago. Llega sin JWT y sin Origin, así que NO confiamos en el body:
// solo tomamos el payment id y le preguntamos a MP directo con nuestro token.
async function handleMpWebhook(body: any) {
  const paymentId = body?.data?.id ?? body?.resource ?? null;
  const topic = body?.type ?? body?.topic ?? "";
  if (!paymentId || (topic && !String(topic).includes("payment"))) return json({ ok: true, ignored: true });
  if (!MP_TOKEN) return json({ ok: true, ignored: "sin_token" });

  const { signal, cancel } = withTimeout(15000);
  let pay: any;
  try {
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
      signal,
    });
    if (!r.ok) {
      console.error("mp payment fetch failed:", r.status);
      return json({ ok: true, ignored: "payment_no_encontrado" });
    }
    pay = await r.json();
  } catch (e) {
    console.error("mp webhook error:", e);
    return json({ ok: true, ignored: "mp_unreachable" }); // 200 para que MP no reintente en loop
  } finally {
    cancel();
  }

  const ref = String(pay.external_reference ?? "");
  if (!ref.startsWith("lead:")) return json({ ok: true, ignored: "no_es_lead" }); // facturas de tenants las cobra mp-platform-webhook
  const leadId = ref.slice(5);
  const approved = pay.status === "approved";

  const patch: Record<string, unknown> = {
    payment_status: pay.status,
    mp_payment_id: String(pay.id),
    updated_at: new Date().toISOString(),
  };
  if (approved) {
    patch.paid_at = new Date().toISOString();
    patch.access_granted = true;
    patch.access_reason = "paid";
    patch.access_granted_at = new Date().toISOString();
    patch.status = "pagado";
    patch.amount_mxn = pay.transaction_amount ?? null;
  }

  const { data: lead, error } = await supabase.from("landing_leads")
    .update(patch).eq("id", leadId)
    .select("id, nombre, telefono, rol, pkg, contacto").maybeSingle();
  if (error) console.error("lead pago update error:", error);

  if (approved && RESEND_API_KEY && lead) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: NOTIFICATION_EMAILS,
          subject: `💰 PAGO RECIBIDO — ${esc(lead.pkg) || "IA a tu medida"} · ${esc(lead.nombre || lead.contacto || "sin nombre")}`,
          html: `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;">
            <h2>💰 Pago aprobado</h2>
            <p><strong>Cliente:</strong> ${esc(lead.nombre || lead.contacto) || "—"}<br/>
            <strong>WhatsApp:</strong> ${esc(lead.telefono) || "—"}<br/>
            <strong>Rol:</strong> ${esc(lead.rol) || "—"}<br/>
            <strong>Paquete:</strong> ${esc(lead.pkg) || "—"}<br/>
            <strong>Monto:</strong> $${esc(pay.transaction_amount)} MXN<br/>
            <strong>Pago MP:</strong> ${esc(pay.id)}</p>
            <p>Ya tiene acceso. Contáctalo para arrancar.</p>
            <p style="color:#888;font-size:12px;">Lead ${esc(leadId)} · tabla landing_leads</p>
          </div>`,
        }),
      });
    } catch (e) {
      console.error("resend pago error:", e);
    }
  }

  return json({ ok: true, lead_id: leadId, status: pay.status });
}

// ── PDF del plan (web: botón de descarga · WhatsApp: tool consultor_plan_pdf + send_document) ──
function winAnsiSafe(s: string): string {
  return (s || "")
    .replace(/[✓✅]/g, "·").replace(/[→⇒]/g, ">").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E -ÿ–—‘’“”•]/g, "");
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
    if (plan.agente_yaub && plan.agente_yaub.name) {
      draw("TU AGENTE YAUB 24/7 (WHATSAPP Y VOZ)", { size: 10, b: true, color: accent });
      draw(`• ${plan.agente_yaub.name}`, { b: true });
      for (const l of wrap(plan.agente_yaub.ben || "", 88)) draw(l, { size: 10, color: muted, x: 60 });
      y -= 6;
    }
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

  // ── Webhook de MercadoPago (?mp=1): va antes del check de action porque MP manda su propio "action". ──
  if (new URL(req.url).searchParams.has("mp")) {
    try {
      return await handleMpWebhook(body);
    } catch (e) {
      console.error("mp webhook fatal:", e);
      return json({ ok: true }); // 200 siempre: si fallamos, que MP no reintente en loop
    }
  }

  if (!body?.action) return json({ error: "missing_action" }, 400);

  // ── Anti-abuso (solo para llamadas no confiables) ──
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const isTrusted = !!bearer && bearer === SUPABASE_SERVICE_ROLE_KEY; // runtime server-to-server
  const ip = clientIp(req);
  if (!isTrusted) {
    const origin = req.headers.get("origin") || "";
    if (origin && !ALLOWED_ORIGIN.test(origin)) return json({ ok: false, error: "forbidden_origin" }, 403);
    const rl = RATE_LIMITS[body.action];
    if (rl) {
      try {
        const { data, error } = await supabase.rpc("landing_rl_hit", { p_ip: ip, p_action: body.action, p_limit: rl.limit, p_window_secs: rl.win });
        if (error) console.error("rate-limit rpc error:", error); // fail-open: un fallo del RPC no tumba el landing
        else if (data === false) return json({ ok: false, error: "rate_limited", message: "Demasiadas solicitudes. Espera un momento y vuelve a intentar." }, 429);
      } catch (e) {
        console.error("rate-limit error:", e);
      }
    }
  }

  try {
    switch (body.action) {
      case "analyze": return await handleAnalyze(body);
      case "plan": return await handlePlan(body);
      case "contact": return await handleContact(body);
      case "agenda_slots": return await handleAgendaSlots(body);
      case "agenda_book": return await handleAgendaBook(body);
      case "plan_pdf": return await handlePlanPdf(body);
      case "plan_checkout": return await handlePlanCheckout(body);
      case "payment_status": return await handlePaymentStatus(body);
      case "access_unlock": return await handleAccessUnlock(body, ip);
      default: return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("landing-consultor error:", e); // detalle solo en logs; al cliente mensaje genérico
    return json({ ok: false, error: "internal" }, 500);
  }
});
