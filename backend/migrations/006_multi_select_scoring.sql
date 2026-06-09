ALTER TABLE attempts
  ALTER COLUMN score TYPE DOUBLE PRECISION
  USING score::double precision;
