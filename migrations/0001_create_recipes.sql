CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('한식','양식','중식','기타')),
  title TEXT NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_updated_at ON recipes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_recipes_category ON recipes(category);
