-- Dataset del hackathon «¿Cuánta gente entra realmente?».
--
-- Dos universos que NUNCA comparten un id. Viven en el mismo Postgres por
-- comodidad de operación, pero ninguna FK los une y ninguna consulta de la API
-- los devuelve juntos: cruzarlos es el reto del participante.
--
-- Nadie lee estas tablas directamente. RLS queda activo SIN políticas, así que
-- la anon key no ve nada; la única puerta son las edge functions, que validan
-- el token del participante.

-- ---------------------------------------------------------------- Boom (v2)

create table if not exists boom_user (
  boom_user_id     text primary key,
  first_name       text not null,
  last_name        text not null,
  email            text not null,
  phone            text,
  city             text,
  country          text,
  birthday         date,
  created_at       timestamptz,
  has_membership   boolean not null default false,
  membership_since timestamptz,
  points           integer not null default 0
);
create index if not exists boom_user_email_idx on boom_user (lower(email));
create index if not exists boom_user_phone_idx on boom_user (phone);
create index if not exists boom_user_city_idx  on boom_user (city);
create index if not exists boom_user_nombre_idx on boom_user (lower(first_name), lower(last_name));

create table if not exists boom_ticket (
  boom_ticket_id text primary key,
  boom_user_id   text not null references boom_user (boom_user_id) on delete cascade,
  event_id       text not null,
  type           text,
  source         text,
  created_at     timestamptz,
  used           boolean not null default false,
  date_used      timestamptz
);
create index if not exists boom_ticket_user_idx  on boom_ticket (boom_user_id);
create index if not exists boom_ticket_event_idx on boom_ticket (event_id);

create table if not exists boom_social (
  boom_user_id  text primary key references boom_user (boom_user_id) on delete cascade,
  friends_count integer not null default 0
);

-- ------------------------------------------------------ FreeTicket (tiquetera)

create table if not exists ft_artist (
  artist_id         text primary key,
  name              text not null,
  home_city         text,
  residency_venue   text,
  residency_weekday text
);

create table if not exists ft_event (
  event_id     text primary key,
  title        text not null,
  artist_id    text not null references ft_artist (artist_id),
  city         text,
  venue        text,
  capacity     integer,
  starts_at    timestamptz not null,
  weekday      text,
  is_residency boolean not null default false,
  is_paid      boolean not null default true
);
create index if not exists ft_event_artist_idx on ft_event (artist_id);
create index if not exists ft_event_starts_idx on ft_event (starts_at);
create index if not exists ft_event_city_idx   on ft_event (city);

create table if not exists ft_sale (
  sale_id      text primary key,
  event_id     text not null references ft_event (event_id) on delete cascade,
  buyer_name   text,
  buyer_email  text,
  buyer_phone  text,
  qty          integer not null default 1,
  subtotal     bigint not null default 0,
  channel      text,
  purchased_at timestamptz
);
create index if not exists ft_sale_event_idx on ft_sale (event_id);
create index if not exists ft_sale_email_idx on ft_sale (lower(buyer_email));
create index if not exists ft_sale_phone_idx on ft_sale (buyer_phone);

create table if not exists ft_ticket (
  ticket_id     text primary key,
  sale_id       text not null references ft_sale (sale_id) on delete cascade,
  event_id      text not null references ft_event (event_id) on delete cascade,
  ticket_type   text,
  price         bigint not null default 0,
  -- null = el show todavía no pasa (agosto). true/false = julio.
  checked_in    boolean,
  checked_in_at timestamptz
);
create index if not exists ft_ticket_event_idx on ft_ticket (event_id);
create index if not exists ft_ticket_sale_idx  on ft_ticket (sale_id);

-- --------------------------------------------------------------- participantes

create table if not exists hackathon_participant (
  token        text primary key,
  handle       text not null,
  created_at   timestamptz not null default now(),
  requests     integer not null default 0,
  last_seen_at timestamptz
);

-- ------------------------------------------------------------------- candados

alter table boom_user             enable row level security;
alter table boom_ticket           enable row level security;
alter table boom_social           enable row level security;
alter table ft_artist             enable row level security;
alter table ft_event              enable row level security;
alter table ft_sale               enable row level security;
alter table ft_ticket             enable row level security;
alter table hackathon_participant enable row level security;

-- Sin políticas: RLS activo y sin política = nadie pasa. Además se revocan los
-- privilegios de los roles de runtime para que la anon key no pueda ni
-- intentarlo. Las edge functions entran con la API key del proyecto.
revoke all on boom_user, boom_ticket, boom_social,
              ft_artist, ft_event, ft_sale, ft_ticket,
              hackathon_participant
  from anon, authenticated;
