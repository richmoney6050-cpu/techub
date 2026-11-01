-- TECHHUB schema (PostgreSQL 13+). Idempotent: safe to run repeatedly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  address text,
  phone text,
  email text,
  currency text NOT NULL DEFAULT 'GHS',
  currency_symbol text NOT NULL DEFAULT 'GH₵',
  receipt_footer text NOT NULL DEFAULT 'Thank you for shopping with us!',
  receipt_show_logo boolean NOT NULL DEFAULT true,
  default_min_stock integer NOT NULL DEFAULT 2 CHECK (default_min_stock >= 0),
  max_discount_percent numeric(5,2) NOT NULL DEFAULT 10 CHECK (max_discount_percent BETWEEN 0 AND 100),
  notify_in_app boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT false,
  notify_push boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Catalogue of permission keys (reference data)
CREATE TABLE IF NOT EXISTS permissions (
  key text PRIMARY KEY,
  description text NOT NULL,
  owner_only boolean NOT NULL DEFAULT false
);

-- Role templates per business. Owner role always has every permission.
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  UNIQUE (business_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role_id uuid REFERENCES roles(id) ON DELETE SET NULL,
  role text NOT NULL CHECK (role IN ('owner','employee')),
  name text NOT NULL,
  phone text,
  email text,
  username text NOT NULL,
  password_hash text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  failed_logins integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS push_tokens (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_uq
  ON categories (business_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_uq ON brands (business_id, lower(name));

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES brands(id) ON DELETE SET NULL,
  model text,
  description text,
  image_url text,
  condition text NOT NULL DEFAULT 'brand_new' CHECK (condition IN ('brand_new','used','refurbished')),
  specs jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_biz_idx ON products (business_id, is_active);

-- Every sellable unit (product + colour/size/etc.) is a variation with its own price and stock.
CREATE TABLE IF NOT EXISTS product_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku text NOT NULL,
  barcode text,
  label text,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  purchase_price numeric(12,2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  selling_price numeric(12,2) NOT NULL CHECK (selling_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, sku)
);
CREATE UNIQUE INDEX IF NOT EXISTS variations_barcode_uq ON product_variations (business_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS variations_product_idx ON product_variations (product_id);

CREATE TABLE IF NOT EXISTS inventory (
  variation_id uuid PRIMARY KEY REFERENCES product_variations(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_stock integer NOT NULL DEFAULT 2 CHECK (min_stock >= 0),
  status text GENERATED ALWAYS AS (
    CASE WHEN quantity = 0 THEN 'out_of_stock'
         WHEN quantity <= min_stock THEN 'low_stock'
         ELSE 'in_stock' END) STORED,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_biz_status_idx ON inventory (business_id, status);

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  variation_id uuid NOT NULL REFERENCES product_variations(id) ON DELETE CASCADE,
  product_name text NOT NULL,
  type text NOT NULL CHECK (type IN ('initial','sale','restock','removed','damaged','missing','return','manual_add','manual_remove','sale_void')),
  qty_before integer NOT NULL,
  qty_change integer NOT NULL,
  qty_after integer NOT NULL CHECK (qty_after >= 0),
  reason text,
  ref_type text,
  ref_id uuid,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movements_biz_time_idx ON stock_movements (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS movements_var_idx ON stock_movements (variation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS counters (
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, name)
);

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  receipt_no text NOT NULL,
  idempotency_key text NOT NULL,
  employee_id uuid NOT NULL REFERENCES users(id),
  customer_name text,
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  discount numeric(12,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(12,2) NOT NULL CHECK (total >= 0),
  amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  change_due numeric(12,2) NOT NULL DEFAULT 0,
  balance_due numeric(12,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL CHECK (payment_method IN ('cash','momo','bank_transfer','card')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partially_refunded','refunded')),
  refunded_total numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, receipt_no),
  UNIQUE (business_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS sales_biz_time_idx ON sales (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_emp_idx ON sales (employee_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  variation_id uuid NOT NULL REFERENCES product_variations(id),
  product_name text NOT NULL,
  sku text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL,
  unit_cost numeric(12,2) NOT NULL,
  line_total numeric(12,2) NOT NULL,
  returned_qty integer NOT NULL DEFAULT 0 CHECK (returned_qty >= 0 AND returned_qty <= quantity)
);
CREATE INDEX IF NOT EXISTS sale_items_sale_idx ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS sale_items_var_idx ON sale_items (variation_id);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','refund')),
  method text NOT NULL CHECK (method IN ('cash','momo','bank_transfer','card')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  reference text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_sale_idx ON payments (sale_id);

CREATE TABLE IF NOT EXISTS receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL UNIQUE REFERENCES sales(id) ON DELETE CASCADE,
  receipt_no text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  products_supplied text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  po_number text NOT NULL,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','partially_received','received','cancelled')),
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, po_number)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variation_id uuid NOT NULL REFERENCES product_variations(id),
  qty_ordered integer NOT NULL CHECK (qty_ordered > 0),
  qty_received integer NOT NULL DEFAULT 0 CHECK (qty_received >= 0 AND qty_received <= qty_ordered),
  unit_cost numeric(12,2) NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  method text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id),
  return_no text NOT NULL,
  type text NOT NULL CHECK (type IN ('return','exchange')),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending_inspection' CHECK (status IN ('pending_inspection','inspected','rejected')),
  refund_amount numeric(12,2) NOT NULL DEFAULT 0,
  refund_method text,
  refund_status text NOT NULL DEFAULT 'none' CHECK (refund_status IN ('none','requested','paid','denied')),
  exchange_sale_id uuid REFERENCES sales(id),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, return_no)
);

CREATE TABLE IF NOT EXISTS return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  sale_item_id uuid NOT NULL REFERENCES sale_items(id),
  variation_id uuid NOT NULL REFERENCES product_variations(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  condition text,
  resellable boolean,
  restocked boolean NOT NULL DEFAULT false,
  inspected_by uuid REFERENCES users(id),
  inspected_at timestamptz
);

CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  category text NOT NULL,
  description text,
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  variation_id uuid REFERENCES product_variations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('low_stock','out_of_stock','restocked','system')),
  message text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One active (unresolved) alert per product per condition => no duplicate alerts.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_active_uq
  ON notifications (variation_id, type) WHERE resolved = false AND type IN ('low_stock','out_of_stock');
CREATE INDEX IF NOT EXISTS notifications_biz_idx ON notifications (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_biz_idx ON audit_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_user_idx ON audit_logs (user_id, created_at DESC);

INSERT INTO permissions (key, description, owner_only) VALUES
 ('products.view','Search products, see prices and stock',false),
 ('products.view_cost','See purchase (cost) prices',false),
 ('products.create','Add new products',false),
 ('products.edit','Edit product details (not prices)',false),
 ('products.edit_price','Change product prices',false),
 ('products.delete','Delete products',false),
 ('stock.adjust','Adjust or add stock',false),
 ('sales.create','Process sales in the POS',false),
 ('sales.view','View own sales',false),
 ('sales.view_all','View all sales',false),
 ('discounts.apply','Apply discounts at the POS',false),
 ('returns.process','Process returns and exchanges',false),
 ('returns.refund','Approve refunds',false),
 ('reports.view','View reports',false),
 ('suppliers.manage','Manage suppliers and purchase orders',false),
 ('expenses.manage','Record expenses',false),
 ('notifications.view','See stock notifications',false),
 ('employees.manage','Manage employees',true),
 ('settings.manage','Change business settings',true)
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, owner_only = EXCLUDED.owner_only;
