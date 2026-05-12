-- Fix users id sequence out of sync with actual data
SELECT setval(
  pg_get_serial_sequence('"users"', 'id'),
  COALESCE((SELECT MAX(id) FROM "users"), 1)
);
