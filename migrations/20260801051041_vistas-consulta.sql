-- Vistas de consulta: lo que la API expone además de las tablas crudas.
-- Son los agregados que un participante armaría a mano en los primeros 20
-- minutos; darlos hechos deja las 4 horas para el cruce y la proyección.
--
-- «Hoy» es el 1 de agosto de 2026 a mediodía: la frontera entre julio (pasado,
-- con check-in) y agosto (por venir, sin check-in).

-- Boom: usuario con su historial resumido. La tasa de uso es LA señal.
create or replace view boom_user_profile as
select
  u.boom_user_id,
  u.first_name,
  u.last_name,
  u.email,
  u.phone,
  u.city,
  u.country,
  u.birthday,
  u.created_at,
  u.has_membership,
  u.membership_since,
  u.points,
  coalesce(t.total, 0)            as tickets_total,
  coalesce(t.usados, 0)           as tickets_used,
  case when coalesce(t.total, 0) = 0 then null
       else round(t.usados::numeric / t.total, 4) end as use_rate,
  t.ultimo_uso                    as last_used_at,
  coalesce(s.friends_count, 0)    as friends_count
from boom_user u
left join (
  select boom_user_id,
         count(*)                        as total,
         count(*) filter (where used)    as usados,
         max(date_used)                  as ultimo_uso
  from boom_ticket
  group by boom_user_id
) t on t.boom_user_id = u.boom_user_id
left join boom_social s on s.boom_user_id = u.boom_user_id;

-- FreeTicket: evento con su artista y el conteo de entradas.
-- checked_in_count queda NULL en agosto: el show no ha pasado, no hay verdad.
create or replace view ft_event_summary as
select
  e.event_id,
  e.title,
  e.artist_id,
  e.artist_name,
  a.residency_venue,
  a.residency_weekday,
  e.city,
  e.venue,
  e.capacity,
  e.starts_at,
  e.weekday,
  e.is_residency,
  e.is_paid,
  (e.starts_at > timestamptz '2026-08-01 12:00:00+00') as is_upcoming,
  case when e.starts_at > timestamptz '2026-08-01 12:00:00+00'
       then 'agosto' else 'julio' end                  as month,
  coalesce(k.vendidos, 0)                              as tickets_sold,
  case when coalesce(k.con_dato, 0) = 0 then null else k.entraron end as checked_in_count,
  case when coalesce(k.con_dato, 0) = 0 then null
       else round(k.entraron::numeric / nullif(k.vendidos, 0), 4) end as attendance_rate,
  round(coalesce(k.vendidos, 0)::numeric / nullif(e.capacity, 0), 4)  as fill_rate,
  k.recaudo                                            as gross_revenue
from ft_event e
join ft_artist a on a.artist_id = e.artist_id
left join (
  select event_id,
         count(*)                                      as vendidos,
         count(*) filter (where checked_in is not null) as con_dato,
         count(*) filter (where checked_in)            as entraron,
         sum(price)                                    as recaudo
  from ft_ticket
  group by event_id
) k on k.event_id = e.event_id;

-- FreeTicket: el artista y cómo le fue. La residencia es el histórico propio
-- de un show de agosto; un acto de gira no tiene ninguno.
create or replace view ft_artist_summary as
select
  a.artist_id,
  a.name,
  a.home_city,
  a.residency_venue,
  a.residency_weekday,
  (a.residency_weekday is not null and a.residency_weekday <> '') as has_residency,
  count(s.event_id)                                       as events_total,
  count(*) filter (where s.month = 'julio')               as events_past,
  count(*) filter (where s.month = 'agosto')              as events_upcoming,
  sum(s.tickets_sold)                                     as tickets_sold,
  sum(s.checked_in_count)                                 as checked_in_count,
  round(sum(s.checked_in_count)::numeric
        / nullif(sum(s.tickets_sold) filter (where s.month = 'julio'), 0), 4) as attendance_rate_july
from ft_artist a
left join ft_event_summary s on s.artist_id = a.artist_id
group by a.artist_id, a.name, a.home_city, a.residency_venue, a.residency_weekday;

revoke all on boom_user_profile, ft_event_summary, ft_artist_summary
  from anon, authenticated;
