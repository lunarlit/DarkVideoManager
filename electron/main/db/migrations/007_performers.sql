-- Dedicated performers (actors) field, managed separately from tags.
ALTER TABLE videos ADD COLUMN performers TEXT NOT NULL DEFAULT '';
