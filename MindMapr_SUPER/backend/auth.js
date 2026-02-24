const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { insertUser, getUserByEmail, getUserById } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "mindmapr-dev-secret";

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function toSafeUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username || null,
    role: user.role,
  };
}

function generateToken(user) {
  return jwt.sign(toSafeUser(user), JWT_SECRET, { expiresIn: "24h" });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_err) {
    return null;
  }
}

function authMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }
  const token = authHeader.slice(7);
  req.user = verifyToken(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

async function register(req, res) {
  const { email, password, username } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await getUserByEmail(normalizedEmail);
    if (existing) return res.status(400).json({ error: "Email already exists" });

    const passwordHash = await hashPassword(password);
    const insertResult = await insertUser(
      normalizedEmail,
      username ? String(username).trim() : null,
      passwordHash,
      "user"
    );
    const user = await getUserById(insertResult.lastID);
    const token = generateToken(user);
    return res.json({ token, user: toSafeUser(user) });
  } catch (_err) {
    return res.status(500).json({ error: "Registration failed" });
  }
}

async function login(req, res) {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await getUserByEmail(normalizedEmail);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const token = generateToken(user);
    return res.json({ token, user: toSafeUser(user) });
  } catch (_err) {
    return res.status(500).json({ error: "Login failed" });
  }
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireAdmin,
  register,
  login,
  hashPassword,
};
