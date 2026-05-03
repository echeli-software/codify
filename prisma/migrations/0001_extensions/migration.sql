-- Enable extensions and define a UUIDv7 generator used as default for ID columns.
-- Implementation cribbed from the canonical pgsql-uuidv7 reference; produces a
-- time-ordered v7 UUID. Replace with pg_uuidv7 extension if/when DO Managed
-- Postgres supports it.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  -- Set version 7 (top nibble of byte 6 = 0x70)
  uuid_bytes = set_byte(uuid_bytes, 6, (b'01110000' | (get_byte(uuid_bytes, 6) & 15))::bit(8)::int);
  -- Set variant (top two bits of byte 8 = 10)
  uuid_bytes = set_byte(uuid_bytes, 8, (b'10000000' | (get_byte(uuid_bytes, 8) & 63))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
