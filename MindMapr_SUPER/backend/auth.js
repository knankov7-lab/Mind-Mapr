const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
  insertUser,
  getUserByEmail,
  getUserById,
  updateUserProfile,
  updateUserPasswordHash,
  insertPasswordReset,
  getPasswordResetByHash,
  markPasswordResetUsed,
  insertLog,
} = require("./db");
const { toSofiaSqlString } = require("./time");

const JWT_SECRET = process.env.JWT_SECRET || "mindmapr-dev-secret";

function normalizeRole(role) {
  return String(role || "user").trim().toLowerCase();
}

function isAdminRole(role) {
  return normalizeRole(role) === "admin";
}

function isAdminUserLike(user) {
  if (!user) return false;
  return isAdminRole(user.role);
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function toSafeUser(user) {
  const role = normalizeRole(user.role);
  return {
    id: user.id,
    email: user.email,
    username: user.username || null,
    role,
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

async function authMiddleware(req, _res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    req.user = null;
    return next();
  }

  try {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      req.user = null;
      return next();
    }

    // Always hydrate user from DB so role/permission changes apply immediately.
    const freshUser = await getUserById(decoded.id);
    if (!freshUser) {
      req.user = null;
      return next();
    }

    req.user = toSafeUser(freshUser);
    return next();
  } catch {
    req.user = null;
    return next();
  }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !isAdminUserLike(req.user)) {
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

async function updateProfile(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  const { username } = req.body || {};
  try {
    await updateUserProfile(userId, { username });
    const fresh = await getUserById(userId);
    await insertLog(userId, "profile_update", { username: fresh?.username ?? null }, req.ip);
    return res.json({ ok: true, user: toSafeUser(fresh) });
  } catch (_err) {
    return res.status(500).json({ error: "Profile update failed" });
  }
}

async function changePassword(req, res) {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: "Authentication required" });

  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: "oldPassword and newPassword required" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const user = await getUserById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const ok = await verifyPassword(String(oldPassword), user.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const nextHash = await hashPassword(String(newPassword));
    await updateUserPasswordHash(userId, nextHash);
    await insertLog(userId, "password_change", {}, req.ip);
    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: "Password change failed" });
  }
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

async function requestPasswordReset(req, res) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = await getUserByEmail(normalizedEmail);
    // Always return ok to avoid user enumeration
    if (!user) return res.json({ ok: true });

    const token = crypto.randomBytes(24).toString("hex");
    const tokenHash = sha256Hex(token);
    const expiresAt = toSofiaSqlString(new Date(Date.now() + 60 * 60 * 1000)); // 60 min

    await insertPasswordReset(user.id, tokenHash, expiresAt);
    await insertLog(user.id, "password_reset_requested", { email: normalizedEmail }, req.ip);

    // Dev-mode: return token in response. In production you'd email this.
    return res.json({ ok: true, token, expiresAt });
  } catch (_err) {
    return res.status(500).json({ error: "Reset request failed" });
  }
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body || {};
  if (!token || !newPassword) {
    return res.status(400).json({ error: "token and newPassword required" });
  }
  if (String(newPassword).length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const tokenHash = sha256Hex(token);
    const pr = await getPasswordResetByHash(tokenHash);
    if (!pr) return res.status(400).json({ error: "Invalid or expired token" });
    if (pr.used_at) return res.status(400).json({ error: "Token already used" });
    const exp = new Date(pr.expires_at).getTime();
    if (!Number.isFinite(exp) || Date.now() > exp) {
      return res.status(400).json({ error: "Invalid or expired token" });
    }

    const nextHash = await hashPassword(String(newPassword));
    await updateUserPasswordHash(pr.user_id, nextHash);
    await markPasswordResetUsed(pr.id);
    await insertLog(pr.user_id, "password_reset_completed", {}, req.ip);
    return res.json({ ok: true });
  } catch (_err) {
    return res.status(500).json({ error: "Reset failed" });
  }
}

module.exports = {
  authMiddleware,
  requireAuth,
  requireAdmin,
  register,
  login,
  hashPassword,
  verifyToken,
  isAdminRole,
  isAdminUserLike,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
};
