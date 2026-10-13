-- Clientes iniciales (se pueden sumar más desde la app)
insert into public.clients (name, color) values
  ('Modus Retis', '#304cd3'),
  ('Meli Retis',  '#e8b100'),
  ('Ultragrif',   '#00a9b0'),
  ('Placebo',     '#8b5cf6'),
  ('Odoo',        '#714b67')
on conflict (name) do nothing;
