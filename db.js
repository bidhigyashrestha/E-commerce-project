const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const databasePath = path.join(__dirname, 'gearshift.db');
const wasmDirectory = path.dirname(require.resolve('sql.js/dist/sql-wasm.wasm'));

let SQL;
let database;

function getSingleRow(sql, params = []) {
  const statement = database.prepare(sql);
  statement.bind(params);

  if (!statement.step()) {
    statement.free();
    return null;
  }

  const row = statement.getAsObject();
  statement.free();
  return row;
}

function getAllRows(sql, params = []) {
  const statement = database.prepare(sql);
  statement.bind(params);
  const rows = [];

  while (statement.step()) {
    rows.push(statement.getAsObject());
  }

  statement.free();
  return rows;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || 'user',
    createdAt: user.created_at,
    avatarData: user.avatar_data || '',
    avatarName: user.avatar_name || ''
  };
}

function getTableColumns(tableName) {
  const statement = database.prepare(`PRAGMA table_info(${tableName})`);
  const columns = [];

  while (statement.step()) {
    const row = statement.getAsObject();
    columns.push(row.name);
  }

  statement.free();
  return columns;
}

function ensureColumn(tableName, columnName, definition) {
  const columns = getTableColumns(tableName);
  if (!columns.includes(columnName)) {
    database.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

function normalizePartRecord(part) {
  return {
    id: part.id,
    name: part.name,
    description: part.description,
    price: part.price,
    owner_email: part.owner_email,
    image_data: part.image_data || '',
    image_name: part.image_name || '',
    vehicle_type: part.vehicle_type || '',
    category: part.category || '',
    brand: part.brand || '',
    model: part.model || '',
    condition: part.condition || '',
    stock_quantity: part.stock_quantity ?? '',
    warranty: part.warranty || '',
    part_number: part.part_number || '',
    created_at: part.created_at,
    updated_at: part.updated_at
  };
}

function normalizePurchaseRecord(purchase) {
  return {
    id: purchase.id,
    part_id: purchase.part_id,
    part_name: purchase.part_name,
    buyer_email: purchase.buyer_email,
    quantity: purchase.quantity,
    unit_price: purchase.unit_price,
    total_price: purchase.total_price,
    created_at: purchase.created_at
  };
}

function getSetting(key) {
  const row = getSingleRow('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : null;
}

function setSetting(key, value) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) {
    return;
  }

  if (value === null || value === undefined || value === '') {
    database.run('DELETE FROM settings WHERE key = ?', [normalizedKey]);
    persistDatabase();
    return;
  }

  database.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [normalizedKey, String(value)]
  );
  persistDatabase();
}

function getHomepageSpotlightPartId() {
  const value = getSetting('homepage_spotlight_part_id');
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function setHomepageSpotlightPartId(partId) {
  const numericValue = Number(partId);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    setSetting('homepage_spotlight_part_id', null);
    return;
  }

  setSetting('homepage_spotlight_part_id', numericValue);
}

function getHomepageFeaturedPartId() {
  const value = getSetting('homepage_featured_part_id');
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function setHomepageFeaturedPartId(partId) {
  const numericValue = Number(partId);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    setSetting('homepage_featured_part_id', null);
    return;
  }

  setSetting('homepage_featured_part_id', numericValue);
}

async function initializeDatabase() {
  if (database) {
    return database;
  }

  SQL = await initSqlJs({
    locateFile: (file) => path.join(wasmDirectory, file)
  });

  if (fs.existsSync(databasePath)) {
    const fileBuffer = fs.readFileSync(databasePath);
    database = new SQL.Database(fileBuffer);
  } else {
    database = new SQL.Database();
  }

  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'user',
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price REAL NOT NULL,
      owner_email TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      part_name TEXT NOT NULL,
      buyer_email TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      total_price REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  database.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  ensureColumn('users', 'role', "TEXT NOT NULL DEFAULT 'user'");
  ensureColumn('users', 'avatar_data', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('users', 'avatar_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'updated_at', "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  ensureColumn('parts', 'vehicle_type', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'category', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'brand', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'model', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'image_data', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'image_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'condition', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'stock_quantity', "INTEGER NOT NULL DEFAULT 0");
  ensureColumn('parts', 'warranty', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('parts', 'part_number', "TEXT NOT NULL DEFAULT ''");

  ensureColumn('purchases', 'part_name', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchases', 'buyer_email', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('purchases', 'quantity', "INTEGER NOT NULL DEFAULT 1");
  ensureColumn('purchases', 'unit_price', "REAL NOT NULL DEFAULT 0");
  ensureColumn('purchases', 'total_price', "REAL NOT NULL DEFAULT 0");

  // Seed the two demo accounts only if they don't already exist. This used
  // to unconditionally wipe the entire users table on every server start,
  // which deleted every real registered account on each restart. Now it
  // only ensures the demo accounts are present, and leaves everyone else's
  // account untouched.
  ensureSeedUser({
    name: 'GearShift User',
    email: 'user@gmail.com',
    password: 'user123',
    role: 'user'
  });

  ensureSeedUser({
    name: 'GearShift Admin',
    email: 'admin@gmail.com',
    password: 'admin123',
    role: 'admin'
  });

  persistDatabase();

  return database;
}

function ensureSeedUser({ name, email, password, role }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = getSingleRow('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    return;
  }

  createUser({ name, email, password, role });
}

function persistDatabase() {
  if (!database) {
    return;
  }

  const exported = database.export();
  fs.writeFileSync(databasePath, Buffer.from(exported));
}

function createUser({ name, email, password, role = 'user' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const trimmedName = String(name || '').trim();
  const normalizedRole = role === 'admin' ? 'admin' : 'user';

  if (!trimmedName) {
    const error = new Error('Name is required.');
    error.code = 'INVALID_NAME';
    throw error;
  }

  if (!normalizedEmail) {
    const error = new Error('Email is required.');
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  if (!password || String(password).length < 6) {
    const error = new Error('Password must be at least 6 characters.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }

  const existing = getSingleRow('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (existing) {
    const error = new Error('An account with that email already exists.');
    error.code = 'EMAIL_EXISTS';
    throw error;
  }

  const { salt, hash } = hashPassword(String(password));
  database.run('INSERT INTO users (name, email, role, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)', [
    trimmedName,
    normalizedEmail,
    normalizedRole,
    salt,
    hash
  ]);

  const createdUser = getSingleRow(
    'SELECT id, name, email, role, created_at, avatar_data, avatar_name FROM users WHERE email = ?',
    [normalizedEmail]
  );

  persistDatabase();

  if (!createdUser) {
    return {
      id: null,
      name: trimmedName,
      email: normalizedEmail,
      role: normalizedRole,
      createdAt: new Date().toISOString(),
      avatarData: '',
      avatarName: ''
    };
  }

  return sanitizeUser(createdUser);
}

function authenticateUser({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password) {
    const error = new Error('Email and password are required.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const user = getSingleRow(
    'SELECT id, name, email, role, password_salt, password_hash, created_at, avatar_data, avatar_name FROM users WHERE email = ?',
    [normalizedEmail]
  );

  if (!user) {
    const error = new Error('Email or password is incorrect.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  const expectedHash = crypto.scryptSync(String(password), user.password_salt, 64).toString('hex');
  if (expectedHash !== user.password_hash) {
    const error = new Error('Email or password is incorrect.');
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  return sanitizeUser(user);
}

// Simple "forgot password" reset: no email verification/token, since this
// project has no email service. Anyone who knows an account's email can
// reset that account's password. Fine for a demo/college project, but not
// a secure pattern for a real product.
function resetPassword(email, newPassword) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error('Email is required.');
    error.code = 'INVALID_EMAIL';
    throw error;
  }

  if (!newPassword || String(newPassword).length < 6) {
    const error = new Error('Password must be at least 6 characters.');
    error.code = 'INVALID_PASSWORD';
    throw error;
  }

  const user = getSingleRow('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
  if (!user) {
    const error = new Error('No account found with that email.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const { salt, hash } = hashPassword(String(newPassword));
  database.run('UPDATE users SET password_salt = ?, password_hash = ? WHERE email = ?', [salt, hash, normalizedEmail]);
  persistDatabase();

  return true;
}

function listParts(currentUser) {
  const isAdmin = currentUser && currentUser.role === 'admin';
  return isAdmin
    ? getAllRows('SELECT id, name, description, price, owner_email, image_data, image_name, vehicle_type, category, brand, model, condition, stock_quantity, warranty, part_number, created_at, updated_at FROM parts ORDER BY id DESC').map(normalizePartRecord)
    : getAllRows(
        'SELECT id, name, description, price, owner_email, image_data, image_name, vehicle_type, category, brand, model, condition, stock_quantity, warranty, part_number, created_at, updated_at FROM parts WHERE owner_email = ? ORDER BY id DESC',
        [currentUser.email]
      ).map(normalizePartRecord);
}

function listPublicParts() {
  return getAllRows('SELECT id, name, description, price, owner_email, image_data, image_name, vehicle_type, category, brand, model, condition, stock_quantity, warranty, part_number, created_at, updated_at FROM parts ORDER BY id DESC').map(normalizePartRecord);
}

function getPartById(id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId) || numericId <= 0) {
    return null;
  }

  const part = getSingleRow('SELECT id, name, description, price, owner_email, image_data, image_name, vehicle_type, category, brand, model, condition, stock_quantity, warranty, part_number, created_at, updated_at FROM parts WHERE id = ?', [numericId]);
  return part ? normalizePartRecord(part) : null;
}

function createPart(currentUser, { name, description, price, vehicleType, category, brand, model, imageData, imageName, condition, stockQuantity, warranty, partNumber }) {
  const trimmedName = String(name || '').trim();
  const trimmedDescription = String(description || '').trim();
  const numericPrice = Number(price);
  const normalizedVehicleType = String(vehicleType || '').trim();
  const normalizedCategory = String(category || '').trim();
  const trimmedBrand = String(brand || '').trim();
  const trimmedModel = String(model || '').trim();
  const normalizedImageData = String(imageData || '').trim();
  const trimmedImageName = String(imageName || '').trim();
  const trimmedCondition = String(condition || '').trim();
  const trimmedWarranty = String(warranty || '').trim();
  const trimmedPartNumber = String(partNumber || '').trim();
  const numericStockQuantity = Number(stockQuantity || 0);

  if (!trimmedName) {
    const error = new Error('Part name is required.');
    error.code = 'INVALID_PART';
    throw error;
  }

  if (!trimmedDescription) {
    const error = new Error('Part description is required.');
    error.code = 'INVALID_PART';
    throw error;
  }

  if (!Number.isFinite(numericPrice) || numericPrice < 0) {
    const error = new Error('Part price must be a valid number.');
    error.code = 'INVALID_PART';
    throw error;
  }

  if (!normalizedVehicleType) {
    const error = new Error('Vehicle type is required.');
    error.code = 'INVALID_PART';
    throw error;
  }

  if (!normalizedCategory) {
    const error = new Error('Part category is required.');
    error.code = 'INVALID_PART';
    throw error;
  }

  if (!Number.isFinite(numericStockQuantity) || numericStockQuantity < 0) {
    const error = new Error('Stock quantity must be a valid number.');
    error.code = 'INVALID_PART';
    throw error;
  }

  database.run('INSERT INTO parts (name, description, price, owner_email, image_data, image_name, vehicle_type, category, brand, model, condition, stock_quantity, warranty, part_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
    trimmedName,
    trimmedDescription,
    numericPrice,
    currentUser.email,
    normalizedImageData,
    trimmedImageName,
    normalizedVehicleType,
    normalizedCategory,
    trimmedBrand,
    trimmedModel,
    trimmedCondition,
    numericStockQuantity,
    trimmedWarranty,
    trimmedPartNumber
  ]);

  persistDatabase();
  return true;
}

function updatePart(currentUser, id, { name, description, price, vehicleType, category, brand, model, imageData, imageName, condition, stockQuantity, warranty, partNumber }) {
  const part = getSingleRow('SELECT id, owner_email FROM parts WHERE id = ?', [id]);
  if (!part) {
    const error = new Error('Part not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const isOwner = part.owner_email === currentUser.email;
  const isAdmin = currentUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    const error = new Error('You can only edit your own parts.');
    error.code = 'FORBIDDEN';
    throw error;
  }

  const trimmedName = String(name || '').trim();
  const trimmedDescription = String(description || '').trim();
  const numericPrice = Number(price);
  const normalizedVehicleType = String(vehicleType || '').trim();
  const normalizedCategory = String(category || '').trim();
  const trimmedBrand = String(brand || '').trim();
  const trimmedModel = String(model || '').trim();
  const normalizedImageData = String(imageData || '').trim();
  const trimmedImageName = String(imageName || '').trim();
  const trimmedCondition = String(condition || '').trim();
  const trimmedWarranty = String(warranty || '').trim();
  const trimmedPartNumber = String(partNumber || '').trim();
  const numericStockQuantity = Number(stockQuantity || 0);

  if (!trimmedName || !trimmedDescription || !Number.isFinite(numericPrice) || numericPrice < 0 || !normalizedVehicleType || !normalizedCategory || !Number.isFinite(numericStockQuantity) || numericStockQuantity < 0) {
    const error = new Error('Provide a valid name, description, and price.');
    error.code = 'INVALID_PART';
    throw error;
  }

  database.run(
    'UPDATE parts SET name = ?, description = ?, price = ?, image_data = ?, image_name = ?, vehicle_type = ?, category = ?, brand = ?, model = ?, condition = ?, stock_quantity = ?, warranty = ?, part_number = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [trimmedName, trimmedDescription, numericPrice, normalizedImageData, trimmedImageName, normalizedVehicleType, normalizedCategory, trimmedBrand, trimmedModel, trimmedCondition, numericStockQuantity, trimmedWarranty, trimmedPartNumber, id]
  );
  persistDatabase();
}

function deletePart(currentUser, id) {
  const part = getSingleRow('SELECT id, owner_email FROM parts WHERE id = ?', [id]);
  if (!part) {
    const error = new Error('Part not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const isOwner = part.owner_email === currentUser.email;
  const isAdmin = currentUser.role === 'admin';
  if (!isOwner && !isAdmin) {
    const error = new Error('You can only delete your own parts.');
    error.code = 'FORBIDDEN';
    throw error;
  }

  database.run('DELETE FROM parts WHERE id = ?', [id]);
  if (getHomepageSpotlightPartId() === Number(id)) {
    setHomepageSpotlightPartId(null);
  }
  if (getHomepageFeaturedPartId() === Number(id)) {
    setHomepageFeaturedPartId(null);
  }
  persistDatabase();
}

function purchasePart(currentUser, id, quantity = 1) {
  const numericId = Number(id);
  const numericQuantity = Number(quantity || 1);

  if (!Number.isFinite(numericId) || numericId <= 0) {
    const error = new Error('Part not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
    const error = new Error('Quantity must be at least 1.');
    error.code = 'INVALID_PURCHASE';
    throw error;
  }

  const part = getSingleRow('SELECT id, name, price, owner_email, stock_quantity FROM parts WHERE id = ?', [numericId]);
  if (!part) {
    const error = new Error('Part not found.');
    error.code = 'NOT_FOUND';
    throw error;
  }

  if (part.owner_email === currentUser.email) {
    const error = new Error('You cannot buy your own part.');
    error.code = 'INVALID_PURCHASE';
    throw error;
  }

  const availableStock = Number(part.stock_quantity || 0);
  if (availableStock < numericQuantity) {
    const error = new Error('Not enough stock available.');
    error.code = 'OUT_OF_STOCK';
    throw error;
  }

  const unitPrice = Number(part.price);
  const totalPrice = unitPrice * numericQuantity;

  database.run('UPDATE parts SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [numericQuantity, numericId]);
  database.run(
    'INSERT INTO purchases (part_id, part_name, buyer_email, quantity, unit_price, total_price) VALUES (?, ?, ?, ?, ?, ?)',
    [numericId, part.name, currentUser.email, numericQuantity, unitPrice, totalPrice]
  );

  persistDatabase();

  return {
    partId: numericId,
    partName: part.name,
    buyerEmail: currentUser.email,
    quantity: numericQuantity,
    unitPrice,
    totalPrice
  };
}

function listPurchases(currentUser) {
  const isAdmin = currentUser && currentUser.role === 'admin';
  const rows = isAdmin
    ? getAllRows('SELECT id, part_id, part_name, buyer_email, quantity, unit_price, total_price, created_at FROM purchases ORDER BY id DESC')
    : getAllRows('SELECT id, part_id, part_name, buyer_email, quantity, unit_price, total_price, created_at FROM purchases WHERE buyer_email = ? ORDER BY id DESC', [currentUser.email]);

  return rows.map(normalizePurchaseRecord);
}

function getUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  return getSingleRow(
    'SELECT id, name, email, role, created_at, avatar_data, avatar_name FROM users WHERE email = ?',
    [normalizedEmail]
  );
}

function updateUserAvatar(currentUser, avatarData, avatarName) {
  const normalizedAvatarData = String(avatarData || '').trim();
  const trimmedAvatarName = String(avatarName || '').trim();

  database.run('UPDATE users SET avatar_data = ?, avatar_name = ? WHERE email = ?', [
    normalizedAvatarData,
    trimmedAvatarName,
    currentUser.email
  ]);
  persistDatabase();

  const updated = getSingleRow(
    'SELECT id, name, email, role, created_at, avatar_data, avatar_name FROM users WHERE email = ?',
    [currentUser.email]
  );

  return sanitizeUser(updated);
}

// Public-safe profile lookup: only what's safe to show a stranger
// (name + avatar) -- never email, role, or account creation date.
function getPublicUserProfile(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const user = getSingleRow('SELECT name, avatar_data, avatar_name FROM users WHERE email = ?', [normalizedEmail]);
  if (!user) {
    return null;
  }

  return {
    name: user.name,
    avatarData: user.avatar_data || '',
    avatarName: user.avatar_name || ''
  };
}

module.exports = {
  initializeDatabase,
  createUser,
  authenticateUser,
  resetPassword,
  listParts,
  listPublicParts,
  getPartById,
  createPart,
  updatePart,
  deletePart,
  purchasePart,
  listPurchases,
  getUserByEmail,
  updateUserAvatar,
  getPublicUserProfile,
  getHomepageSpotlightPartId,
  setHomepageSpotlightPartId,
  getHomepageFeaturedPartId,
  setHomepageFeaturedPartId
};