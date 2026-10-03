-- PayPal checkout: hosts connect a PayPal merchant account; players pay in-app.
create table public.host_paypal_accounts (
  host_id uuid primary key references auth.users(id) on delete cascade,
  merchant_id text not null check (char_length(merchant_id) between 3 and 64),
  email text,
  connected_at timestamptz not null default now()
);
grant select, insert, update, delete on public.host_paypal_accounts to authenticated;
grant all on public.host_paypal_accounts to service_role;
alter table public.host_paypal_accounts enable row level security;
create policy "hosts manage own paypal account"
  on public.host_paypal_accounts for all to authenticated
  using (host_id = auth.uid()) with check (host_id = auth.uid());

-- Players rendering a PayPal button need the host's merchant id (public, not secret).
create or replace function public.get_game_host_paypal(_game_id text)
returns table(merchant_id text)
language sql stable security definer set search_path = public as $$
  select hpa.merchant_id
  from public.hosted_games g
  join public.host_paypal_accounts hpa on hpa.host_id = g.host_id::uuid
  where g.id = _game_id
  limit 1
$$;
revoke all on function public.get_game_host_paypal(text) from public;
grant execute on function public.get_game_host_paypal(text) to authenticated, anon;

create table public.paypal_orders (
  id uuid primary key default gen_random_uuid(),
  order_id text not null unique,
  game_id text not null references public.hosted_games(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  host_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD',
  status text not null default 'created' check (status in ('created','approved','captured','failed','cancelled')),
  capture_id text,
  created_at timestamptz not null default now(),
  captured_at timestamptz
);
create index paypal_orders_player_idx on public.paypal_orders (player_id, game_id);
create index paypal_orders_host_idx on public.paypal_orders (host_id, game_id);
grant select, insert on public.paypal_orders to authenticated;
grant all on public.paypal_orders to service_role;
alter table public.paypal_orders enable row level security;
create policy "players see own orders, hosts see theirs"
  on public.paypal_orders for select to authenticated
  using (player_id = auth.uid() or host_id = auth.uid());
create policy "players create own orders"
  on public.paypal_orders for insert to authenticated
  with check (player_id = auth.uid() and status = 'created');
-- Updates (capture/fail) happen server-side via the service role only.