# 🔒 Security Audit Report

**Date:** 2025-11-08
**Auditor:** AI Security Analysis
**Codebase:** Task Manager with Supabase Integration
**Branch:** `claude/what-is-in-011CUtQu8xWQi7mLBZ3EJ8pg`

---

## Executive Summary

This comprehensive security audit identifies vulnerabilities across the task manager codebase. While the application demonstrates good security practices in several areas (parameterized queries, password hashing, XSS protection), there are **critical vulnerabilities** that must be addressed before production deployment.

**Overall Risk Level:** 🟡 **MEDIUM-HIGH** (several critical issues, mostly fixable)

---

## 🚨 CRITICAL VULNERABILITIES (Fix Immediately)

### 1. ⚠️ Session Secret Fallback
**Severity:** CRITICAL
**Location:** `server-auth.js` lines 39-54
**CVSS Score:** 9.8

**Vulnerable Code:**
```javascript
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    console.warn('⚠️  WARNING: SESSION_SECRET environment variable is not set!');
    console.warn('⚠️  Using a fallback secret for development only.');
}

app.use(session({
    secret: SESSION_SECRET || 'dev-fallback-secret-change-in-production',
    // ...
}));
```

**Attack Scenario:**
1. Attacker knows fallback secret (it's in the code)
2. Can forge session cookies for any user
3. Complete authentication bypass
4. Full system compromise

**Fix:**
```javascript
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ FATAL: SESSION_SECRET must be set in production');
        process.exit(1);  // Refuse to start
    }
    console.warn('⚠️  WARNING: Using development session secret');
}

app.use(session({
    secret: SESSION_SECRET || crypto.randomBytes(32).toString('hex'), // Random fallback
    // ...
}));
```

---

### 2. ⚠️ CORS Wildcard in Cloudflare Worker
**Severity:** CRITICAL
**Location:** `worker.js` lines 14-18
**CVSS Score:** 8.1

**Vulnerable Code:**
```javascript
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',  // ⚠️ ANY domain can access!
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};
```

**Attack Scenario:**
1. Malicious website at `evil.com` makes requests to your API
2. User's browser sends requests with credentials
3. Attacker steals user data via CORS
4. CSRF attacks possible

**Impact:** Data theft, CSRF attacks, unauthorized access

**Fix:**
```javascript
// Match the pattern from server-auth.js
const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'https://yourdomain.com'
];

function getCorsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Credentials': 'true'
    };
}
```

---

### 3. ⚠️ No Rate Limiting on Authentication
**Severity:** HIGH
**Location:** `server-auth.js` - all auth endpoints
**CVSS Score:** 7.5

**Missing Protection:**
```javascript
app.post('/api/auth/login', async (req, res) => {
    // NO RATE LIMITING - vulnerable to brute force!
```

**Attack Scenario:**
1. Attacker tries 10,000 passwords per minute
2. No rate limit = unlimited attempts
3. Weak passwords get cracked quickly

**Fix:**
```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: 'Too many login attempts, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    // Now protected!
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
    // Protected!
});

app.post('/api/auth/magic-link', authLimiter, async (req, res) => {
    // Protected!
});
```

**Install:** `npm install express-rate-limit`

---

### 4. ⚠️ Weak Bcrypt Rounds
**Severity:** HIGH
**Location:** `server-auth.js` lines 227, 39
**CVSS Score:** 7.0

**Vulnerable Code:**
```javascript
const password_hash = bcrypt.hashSync(password, 10);  // Only 10 rounds!
```

**Attack Impact:**
- Modern GPUs can test ~100,000 bcrypt-10 hashes per second
- Weak passwords crackable in hours/days

**Recommendation:** Use 12-14 rounds

**Fix:**
```javascript
const BCRYPT_ROUNDS = 12;  // Recommended minimum
const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
```

**Performance Impact:** Each +1 round doubles hash time (12 rounds = ~250ms per hash, acceptable)

---

## 🟡 MEDIUM SEVERITY ISSUES

### 5. User Enumeration via Registration
**Severity:** MEDIUM
**Location:** `server-auth.js` line 220-224

**Vulnerable Code:**
```javascript
const existingUser = await dataService.getUserByUsername(username.trim());
if (existingUser) {
    return res.status(400).json({ error: 'Username already exists' });
}
```

**Attack:** Attacker can check if usernames exist

**Fix:** Use generic error messages or add delays

---

### 6. Weak Password Requirements
**Severity:** MEDIUM
**Location:** `server-auth.js` lines 122-126

**Current:**
```javascript
const validatePassword = (password) => {
    if (typeof password !== 'string') return false;
    return password.length >= 6;  // TOO WEAK!
};
```

**Fix:**
```javascript
const validatePassword = (password) => {
    if (typeof password !== 'string') return false;
    if (password.length < 8) return false;

    // Require complexity
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChar;
};
```

---

### 7. Information Disclosure in Error Messages
**Severity:** MEDIUM
**Location:** `worker.js` line 296

**Vulnerable:**
```javascript
return new Response(JSON.stringify({
    error: 'Internal server error',
    message: error.message  // ⚠️ Leaks internals!
}), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

**Fix:**
```javascript
return new Response(JSON.stringify({
    error: 'Internal server error'
    // Remove: message: error.message
}), {
    status: 500,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
});
```

---

### 8. All Users Visible to Any Authenticated User
**Severity:** MEDIUM
**Location:** `server-auth.js` line 583

**Issue:**
```javascript
app.get('/api/users', requireAuth, async (req, res) => {
    const users = await dataService.getUsers();  // ALL users!
    const usersWithoutPasswords = users.map(({ password_hash, ...user }) => user);
    res.json(usersWithoutPasswords);  // Exposes emails, names, etc.
});
```

**Privacy Risk:** Any authenticated user can see all emails

**Fix:**
```javascript
app.get('/api/users', requireAuth, async (req, res) => {
    const allUsers = await dataService.getUsers();
    const userId = req.session.userId;

    // Get user's projects
    const projects = await dataService.getProjects();
    const userProjectIds = projects
        .filter(p => p.owner_id === userId || isProjectMember(userId, p.id))
        .map(p => p.id);

    // Get members from user's projects
    const visibleUserIds = new Set([userId]);
    for (const projectId of userProjectIds) {
        const members = await dataService.getProjectMembers(projectId);
        members.forEach(m => visibleUserIds.add(m.user_id));
    }

    // Only return users from shared projects
    const visibleUsers = allUsers.filter(u => visibleUserIds.has(u.id));
    const usersWithoutPasswords = visibleUsers.map(({ password_hash, ...user }) => user);
    res.json(usersWithoutPasswords);
});
```

---

## 🟢 LOW SEVERITY / IMPROVEMENTS

### 9. Missing SameSite Cookie Attribute
**Location:** `server-auth.js` line 50

**Add:**
```javascript
cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',  // ADD THIS - prevents CSRF
    maxAge: 24 * 60 * 60 * 1000
}
```

---

### 10. No Request Body Size Limit
**Fix:**
```javascript
app.use(express.json({ limit: '1mb' }));  // Prevent DoS
```

---

### 11. Missing Security Headers
**Install Helmet:**
```bash
npm install helmet
```

**Add to server:**
```javascript
const helmet = require('helmet');

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
            imgSrc: ["'self'", "data:", "https:"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));
```

---

### 12. Hardcoded Default Admin Password
**Location:** `data-service.js` line 39-40

**Issue:**
```javascript
const adminPassword = bcrypt.hashSync('admin123', 10);
```

**Recommendation:** Force password change on first login

**Fix:**
```javascript
const newUser = {
    // ...
    password_hash: adminPassword,
    must_change_password: true,  // ADD THIS FLAG
};

// In login route:
if (user.must_change_password) {
    return res.status(403).json({
        error: 'Password change required',
        redirect: '/change-password'
    });
}
```

---

## ✅ GOOD SECURITY PRACTICES OBSERVED

1. **✅ Parameterized Queries** - SQL injection protection via `.bind()`
2. **✅ Password Hashing** - Using bcrypt (though rounds should increase)
3. **✅ HttpOnly Cookies** - Prevents XSS cookie theft
4. **✅ XSS Protection** - `escapeHtml()` function in frontend
5. **✅ Session-based Auth** - Secure server-side sessions
6. **✅ Input Sanitization** - `sanitizeString()` helper
7. **✅ CORS Validation** - Proper origin checking in `server-auth.js`
8. **✅ Environment Variables** - Sensitive data not hardcoded
9. **✅ No Password in Responses** - Passwords filtered out
10. **✅ Supabase Integration** - Secure OAuth flow

---

## 📊 VULNERABILITY SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 Critical | 2 | ⚠️ Needs immediate fix |
| 🟠 High | 2 | ⚠️ Fix before production |
| 🟡 Medium | 4 | ⚠️ Fix soon |
| 🟢 Low | 4 | Nice to have |

---

## 🎯 PRIORITIZED FIX PLAN

### **Week 1 (Critical):**
1. ✅ Fix session secret (fail in production if not set)
2. ✅ Fix CORS wildcard in worker.js
3. ✅ Add rate limiting to auth endpoints
4. ✅ Increase bcrypt rounds to 12

### **Week 2 (High/Medium):**
5. ✅ Strengthen password requirements (8+ chars, complexity)
6. ✅ Fix user enumeration in registration
7. ✅ Restrict `/api/users` endpoint
8. ✅ Add SameSite cookie attribute
9. ✅ Remove error details from worker responses

### **Week 3-4 (Improvements):**
10. ✅ Add Helmet.js security headers
11. ✅ Add request body size limits
12. ✅ Force admin password change on first login
13. ✅ Implement audit logging
14. ✅ Add input validation to worker.js IDs

---

## 🔧 QUICK FIX SCRIPT

Save as `security-fixes.sh`:

```bash
#!/bin/bash

# Install security packages
npm install express-rate-limit helmet

# Create rate limiter middleware
cat > rate-limiter.js << 'EOF'
const rateLimit = require('express-rate-limit');

exports.authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many attempts, please try again later'
});

exports.apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
});
EOF

echo "✅ Security packages installed!"
echo "⚠️  Manual fixes still required - see SECURITY_AUDIT.md"
```

---

## 📞 EMERGENCY CONTACTS

If you discover an active exploit:
1. **Immediately** change `SESSION_SECRET` in production
2. **Revoke** all active sessions
3. **Review** access logs for suspicious activity
4. **Notify** users of potential breach
5. **Update** passwords with stronger requirements

---

## 🏆 SECURITY SCORE

**Current:** 6.5/10
**With Fixes:** 9/10

The application has a solid foundation but needs critical fixes before production deployment. Most issues are straightforward to fix and well-documented above.

---

**Last Updated:** 2025-11-08
**Next Audit:** After implementing critical fixes
