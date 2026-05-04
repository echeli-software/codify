-- Fix the v0.0.1 uuid_generate_v7() function: Postgres has no
-- `bit | integer` operator, so the bit-or with the bit-literal failed
-- at runtime. Cast both sides to integer (or both to bit) consistently.

CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms = substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes = unix_ts_ms || gen_random_bytes(10);
  -- Set version 7 (top nibble of byte 6 = 0x70). 112 = b'01110000'.
  uuid_bytes = set_byte(uuid_bytes, 6, 112 | (get_byte(uuid_bytes, 6) & 15));
  -- Set variant (top two bits of byte 8 = 10). 128 = b'10000000'.
  uuid_bytes = set_byte(uuid_bytes, 8, 128 | (get_byte(uuid_bytes, 8) & 63));
  RETURN encode(uuid_bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;
