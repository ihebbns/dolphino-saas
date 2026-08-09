-- ═══════════════════════════════════════════════════
-- MIGRATION: QR-code table ordering (table-service base)
--
-- A table's QR code encodes /moi/<slug>?table=N&sec=SEC. The public order
-- endpoint stores which table an order came from; the till's accept flow
-- (see acceptOnlineOrder → window.tblMergeOnlineOrder in the table-service
-- POS) merges the items straight onto that table's running tab instead of
-- routing through the generic pickup/delivery unpaid-payment queue —
-- payment then flows through the table's own checkout like any other item
-- added to it, matching how Toast/Square QR-at-table ordering behaves.
--
-- NULL on both columns (the default) means "not a table order" — every
-- existing counter/pickup/delivery order is unaffected.
-- ═══════════════════════════════════════════════════

ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS table_num INTEGER;
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS table_sec VARCHAR(80);
