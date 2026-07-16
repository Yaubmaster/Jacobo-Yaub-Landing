-- Funnel de pago del plan: cobro previo ($99 solo-plan / $499 depósito+horario) + hold de horario.
-- El discovery/plan DEJA de ser gratis: se cobra antes de generar el plan, y el fee se reembolsa
-- (manual, dentro de 24 h hábiles) SOLO si contratan la consultoría. Ver memoria pricing-funnel.
--
-- ⚠️ NO aplicado a prod todavía. Additivo (add column if not exists / create table if not exists):
-- no toca datos existentes. Los campos del fee van SEPARADOS del pago del PROGRAMA completo
-- (payment_status/access_granted/amount_mxn ya existentes), que es otra compra ($4,990/$12,900).

-- 1) Campos del fee del plan en el lead.
alter table public.landing_leads
  add column if not exists fee_kind             text,                 -- 'plan_fee' ($99) | 'deposito' ($499)
  add column if not exists fee_amount_mxn       numeric,
  add column if not exists fee_status           text default 'none',  -- none | pending | paid | refunded
  add column if not exists fee_paid_at          timestamptz,
  add column if not exists fee_refunded_at      timestamptz,          -- lo llena Jacobo manualmente al reembolsar
  add column if not exists fee_mp_preference_id text,
  add column if not exists fee_mp_payment_id    text,
  add column if not exists plan_unlocked        boolean default false, -- gate: el plan solo se genera si esto es true
  add column if not exists held_slot_start      timestamptz;          -- horario apartado (path depósito)

-- 2) Holds temporales de horario (5 min) — protegen el slot durante el checkout del depósito.
--    OJO: solo bloquean a otros visitantes del landing; la reserva real del calendario sigue
--    pasando por calendar-proxy al confirmarse el pago. Suficiente para 1 consultor, baja concurrencia.
-- hold_token: el visitante elige fecha ANTES de que exista su lead (el lead nace en analyze,
-- tras el formulario). El token lo genera el cliente y liga el hold a esa sesión del navegador.
create table if not exists public.landing_slot_holds (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.landing_leads(id) on delete cascade,  -- se liga después
  hold_token  text,
  slot_start  timestamptz not null,
  expires_at  timestamptz not null,
  created_at  timestamptz default now()
);
create index if not exists idx_slot_holds_active on public.landing_slot_holds (slot_start, expires_at);
create index if not exists idx_slot_holds_token  on public.landing_slot_holds (hold_token);

-- RLS igual que el resto de la landing: habilitado y SIN policies → solo el service-role de la
-- edge function puede leer/escribir. Ver atlas_database.
alter table public.landing_slot_holds enable row level security;
