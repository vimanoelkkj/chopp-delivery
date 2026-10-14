-- Seed inicial: aplicado uma vez pelo controle de migrations. Nunca atualiza IDs existentes.
INSERT INTO products (id, name, description, price_30_cents, price_50_cents, visible, sort_order)
VALUES
  ('dronken', 'Dronken', 'Double Double', 51000, 65000, 1, 0),
  ('palato-beber', 'Palato Beber', 'Premium Lager Pilsen', 49000, 64000, 1, 1),
  ('villa-alema', 'Villa Alemã', 'Chopp', 52000, 67000, 1, 2),
  ('krug-bier', 'Krug Bier', 'Chopp', 57000, 76000, 1, 3),
  ('brahma', 'Brahma', 'Chopp', NULL, 89000, 1, 4),
  ('kaiser', 'Kaiser', 'Chopp', NULL, 89000, 1, 5),
  ('heineken', 'Heineken', 'Chopp', NULL, 99000, 1, 6),
  ('chopp-de-vinho', 'Chopp de vinho', 'Vinho', 57000, 79000, 1, 7)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cachaca (id, title, description, bottle_ml, price_cents, visible)
VALUES ('cachaca', 'Temos cachaça', 'Conservada em barril de umburana com jequitibá rosa', 700, 3000, 1)
ON CONFLICT(id) DO NOTHING;
