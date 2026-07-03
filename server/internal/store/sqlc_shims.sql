-- sqlc-only schema shims. NEVER run against a real database.
--
-- sqlc type-checks queries against the schema, but it has no knowledge of the
-- PostGIS extension (the real types/functions come from CREATE EXTENSION
-- postgis, which sqlc ignores). These stand-ins let sqlc resolve the PostGIS
-- functions and operators our queries use. Signatures mirror PostGIS; bodies
-- are irrelevant.

CREATE DOMAIN citext AS text;

CREATE TYPE geometry AS (dummy int);
CREATE TYPE geography AS (dummy int);

CREATE FUNCTION ST_MakePoint(float8, float8) RETURNS geometry AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_SetSRID(geometry, int) RETURNS geometry AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_MakeEnvelope(float8, float8, float8, float8, int) RETURNS geometry AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_X(geometry) RETURNS float8 AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_Y(geometry) RETURNS float8 AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_Distance(geography, geography) RETURNS float8 AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_DWithin(geography, geography, float8) RETURNS boolean AS 'SELECT NULL' LANGUAGE sql;
CREATE FUNCTION ST_Intersects(geography, geography) RETURNS boolean AS 'SELECT NULL' LANGUAGE sql;

CREATE CAST (geometry AS geography) WITHOUT FUNCTION;
CREATE CAST (geography AS geometry) WITHOUT FUNCTION;

CREATE OPERATOR && (LEFTARG = geography, RIGHTARG = geography, PROCEDURE = ST_Intersects);
