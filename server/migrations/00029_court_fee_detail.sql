-- +goose Up
-- Pay-to-play detail. `fee` is already a bool; these say how much, so the app
-- can show "$5 drop-in" instead of a bare "Fee to play".
--
-- Amount is minor units (cents) rather than numeric: money in an exact integer
-- avoids both float rounding and pgtype.Numeric in the generated store layer.
-- Currencies with no minor unit (JPY, KRW) still round-trip — 500 JPY stores
-- as 500 with fee_currency='JPY', and the formatter reads the exponent off the
-- currency, not the column.
ALTER TABLE courts ADD COLUMN fee_amount_cents integer CHECK (fee_amount_cents >= 0 AND fee_amount_cents <= 1000000);
ALTER TABLE courts ADD COLUMN fee_currency     text    CHECK (fee_currency ~ '^[A-Z]{3}$');
ALTER TABLE courts ADD COLUMN fee_note         text    CHECK (char_length(fee_note) <= 80);

-- An amount with no currency is unformattable, so the pair travels together.
-- The reverse is allowed: fee_currency alone is harmless, and OSM's charge=*
-- tag sometimes yields a currency we can parse from a price we cannot.
ALTER TABLE courts ADD CONSTRAINT courts_fee_amount_needs_currency
    CHECK (fee_amount_cents IS NULL OR fee_currency IS NOT NULL);

-- +goose Down
ALTER TABLE courts DROP CONSTRAINT courts_fee_amount_needs_currency;
ALTER TABLE courts DROP COLUMN fee_note;
ALTER TABLE courts DROP COLUMN fee_currency;
ALTER TABLE courts DROP COLUMN fee_amount_cents;
