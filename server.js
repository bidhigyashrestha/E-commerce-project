const express = require('express');
const {
  authenticateUser,
  createUser,
  initializeDatabase,
  getUserByEmail,
  listParts,
  listPublicParts,
  getPartById,
  createPart,
  updatePart,
  deletePart,
  purchasePart,
  listPurchases,
  getHomepageSpotlightPartId,
  setHomepageSpotlightPartId,
  getHomepageFeaturedPartId,
  setHomepageFeaturedPartId
} = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(express.static(__dirname));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

function resolveRequestUser(req) {
  const email = req.headers['x-user-email'];
  if (!email) {
    return null;
  }

  return getUserByEmail(email);
}

function buildHomepageResponse() {
  const parts = listPublicParts();
  const spotlightPartId = getHomepageSpotlightPartId();
  const spotlightPart = spotlightPartId ? getPartById(spotlightPartId) : null;
  const featuredPartId = getHomepageFeaturedPartId();
  const featuredPart = featuredPartId ? getPartById(featuredPartId) : null;

  const featuredParts = featuredPart ? [featuredPart] : [...parts]
    .sort((left, right) => Number(right.price) - Number(left.price))
    .slice(0, 3);

  const trendingParts = [...parts]
    .sort((left, right) => new Date(right.updated_at || right.created_at) - new Date(left.updated_at || left.created_at))
    .slice(0, 3);

  return {
    spotlightPart,
    featuredPart,
    featuredParts,
    trendingParts,
    totalParts: parts.length
  };
}

app.post('/api/register', (req, res) => {
  try {
    const user = createUser(req.body || {});
    res.status(201).json({ user });
  } catch (error) {
    const status = error.code === 'EMAIL_EXISTS' ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/login', (req, res) => {
  try {
    const user = authenticateUser(req.body || {});
    res.json({ user });
  } catch (error) {
    const status = error.code === 'INVALID_CREDENTIALS' ? 401 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/me', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  res.json({ user });
});

app.get('/api/parts', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  res.json({ parts: listParts(user) });
});

app.get('/api/public/parts/:id', (req, res) => {
  const part = getPartById(req.params.id);
  if (!part) {
    res.status(404).json({ error: 'Part not found.' });
    return;
  }

  res.json({ part });
});

app.get('/api/homepage', (_req, res) => {
  res.json(buildHomepageResponse());
});

app.get('/api/purchases', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  res.json({ purchases: listPurchases(user) });
});

app.put('/api/homepage/spotlight', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Only admin users can set the homepage spotlight.' });
    return;
  }

  const partId = Number((req.body && req.body.partId) || 0);
  if (!Number.isFinite(partId) || partId <= 0) {
    res.status(400).json({ error: 'A valid part must be selected.' });
    return;
  }

  const part = getPartById(partId);
  if (!part) {
    res.status(404).json({ error: 'Part not found.' });
    return;
  }

  setHomepageSpotlightPartId(partId);
  res.json({ spotlightPart: part, ...buildHomepageResponse() });
});

app.put('/api/homepage/featured', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  if (user.role !== 'admin') {
    res.status(403).json({ error: 'Only admin users can set the homepage featured item.' });
    return;
  }

  const partId = Number((req.body && req.body.partId) || 0);
  if (!Number.isFinite(partId) || partId <= 0) {
    res.status(400).json({ error: 'A valid part must be selected.' });
    return;
  }

  const part = getPartById(partId);
  if (!part) {
    res.status(404).json({ error: 'Part not found.' });
    return;
  }

  setHomepageFeaturedPartId(partId);
  res.json({ featuredPart: part, ...buildHomepageResponse() });
});

app.post('/api/purchases', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  try {
    const purchase = purchasePart(user, req.body && req.body.partId, req.body && req.body.quantity);
    const part = getPartById(purchase.partId);
    res.status(201).json({ purchase, part, homepage: buildHomepageResponse() });
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'OUT_OF_STOCK' ? 409 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.post('/api/parts', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  try {
    createPart(user, req.body || {});
    res.status(201).json({ parts: listParts(user), homepage: buildHomepageResponse() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/parts/:id', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  try {
    updatePart(user, Number(req.params.id), req.body || {});
    res.json({ parts: listParts(user), homepage: buildHomepageResponse() });
  } catch (error) {
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

app.delete('/api/parts/:id', (req, res) => {
  const user = resolveRequestUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in.' });
    return;
  }

  try {
    deletePart(user, Number(req.params.id));
    res.json({ parts: listParts(user), homepage: buildHomepageResponse() });
  } catch (error) {
    const status = error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : 400;
    res.status(status).json({ error: error.message });
  }
});

async function start() {
  await initializeDatabase();

  app.listen(port, () => {
    console.log(`GearShift server running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to initialize GearShift database', error);
  process.exit(1);
});