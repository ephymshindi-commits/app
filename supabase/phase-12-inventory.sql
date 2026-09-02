
create table public.inventory_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table public.inventory_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  contact_person text,
  phone text,
  email text,
  address text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique,
  name text not null,
  category_id uuid references public.inventory_categories(id) on delete set null,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  description text,
  serial_number text,
  unit_of_measure text not null default 'each',
  quantity_on_hand numeric(12,2) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(12,2) not null default 0 check (reorder_level >= 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  item_condition text not null default 'good' check (item_condition in ('new', 'good', 'fair', 'needs_repair', 'damaged', 'disposed')),
  operational_status text not null default 'active' check (operational_status in ('active', 'maintenance', 'disposed')),
  location text,
  acquired_on date,
  purchase_reference text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  supplier_id uuid references public.inventory_suppliers(id) on delete set null,
  movement_type text not null check (movement_type in ('opening_balance', 'receipt', 'issue', 'adjustment', 'return')),
  quantity_change numeric(12,2) not null check (quantity_change <> 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  delivery_reference text,
  notes text,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index inventory_items_category_idx on public.inventory_items(category_id, operational_status);
create index inventory_items_low_stock_idx on public.inventory_items(quantity_on_hand, reorder_level);
create index inventory_movements_item_date_idx on public.inventory_movements(item_id, occurred_at desc);

alter table public.inventory_categories enable row level security;
alter table public.inventory_suppliers enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;

create policy "inventory categories: administrators manage" on public.inventory_categories
  for all to authenticated using ((select public.is_administrator())) with check ((select public.is_administrator()));
create policy "inventory suppliers: administrators manage" on public.inventory_suppliers
  for all to authenticated using ((select public.is_administrator())) with check ((select public.is_administrator()));
create policy "inventory items: administrators manage" on public.inventory_items
  for all to authenticated using ((select public.is_administrator())) with check ((select public.is_administrator()));
create policy "inventory movements: administrators manage" on public.inventory_movements
  for all to authenticated using ((select public.is_administrator())) with check ((select public.is_administrator()));

create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  revised_quantity numeric(12,2);
begin
  if tg_op <> 'INSERT' then
    raise exception 'Inventory movements are immutable; create an adjustment instead.';
  end if;

  select quantity_on_hand + new.quantity_change into revised_quantity
  from public.inventory_items
  where id = new.item_id
  for update;

  if revised_quantity is null then
    raise exception 'Inventory item does not exist.';
  end if;
  if revised_quantity < 0 then
    raise exception 'This transaction would make stock negative.';
  end if;

  update public.inventory_items
  set quantity_on_hand = revised_quantity,
      updated_at = now()
  where id = new.item_id;
  return new;
end;
$$;

create trigger inventory_movements_apply_stock
  before insert or update or delete on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

create trigger inventory_suppliers_updated_at before update on public.inventory_suppliers
  for each row execute function public.set_updated_at();
create trigger inventory_items_updated_at before update on public.inventory_items
  for each row execute function public.set_updated_at();

create trigger audit_inventory_suppliers after insert or update or delete on public.inventory_suppliers
  for each row execute function public.record_audit_log();
create trigger audit_inventory_items after insert or update or delete on public.inventory_items
  for each row execute function public.record_audit_log();
create trigger audit_inventory_movements after insert on public.inventory_movements
  for each row execute function public.record_audit_log();

insert into public.inventory_categories (name, description)
values
  ('ICT equipment', 'Computers, network devices and peripherals'),
  ('Furniture', 'Desks, chairs, cabinets and fittings'),
  ('Teaching equipment', 'Training tools, machines and classroom equipment'),
  ('Library resources', 'Books and printed learning materials'),
  ('Office supplies', 'Stationery and consumable office items'),
  ('Maintenance', 'Facilities and maintenance materials'),
  ('Other', 'Other school assets and supplies')
on conflict (name) do nothing;
