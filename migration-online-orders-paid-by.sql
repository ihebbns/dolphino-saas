-- Records who marked an online order paid, same audit intent as responded_by
-- for accept/reject. Lets a manager see, per order, which cashier accepted
-- it and which cashier collected payment on it — not just that it happened.
ALTER TABLE online_orders ADD COLUMN IF NOT EXISTS paid_by VARCHAR(80) DEFAULT '';
