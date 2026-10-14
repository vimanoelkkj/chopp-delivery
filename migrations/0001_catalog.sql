CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL,
  price_30_cents INTEGER CHECK (price_30_cents BETWEEN 0 AND 9007199254740991),
  price_50_cents INTEGER CHECK (price_50_cents BETWEEN 0 AND 9007199254740991),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE cachaca (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL,
  bottle_ml INTEGER NOT NULL CHECK (bottle_ml > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents BETWEEN 0 AND 9007199254740991),
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1)
) STRICT;
