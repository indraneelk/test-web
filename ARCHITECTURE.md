# 🏗️ Architecture: How Supabase & D1 Work Together

**TL;DR:** Supabase and D1 are **completely separate systems**. Supabase handles **authentication only**, while D1/JSON stores **all your data**.

---

## 🎯 The Two-Database Architecture

Your task manager uses a **separation of concerns** architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    YOUR APPLICATION                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────┐        ┌────────────────────┐      │
│  │  AUTHENTICATION    │        │   DATA STORAGE     │      │
│  │   (Who you are)    │        │  (What you store)  │      │
│  │                    │        │                    │      │
│  │    SUPABASE        │        │   D1 or JSON       │      │
│  │  (Optional)        │        │   (Your data)      │      │
│  │                    │        │                    │      │
│  │  - Magic links     │        │  - Users           │      │
│  │  - OAuth (Google)  │        │  - Projects        │      │
│  │  - JWT tokens      │        │  - Tasks           │      │
│  │  - User emails     │        │  - Activity logs   │      │
│  └────────────────────┘        └────────────────────┘      │
│           ↓                              ↓                   │
│      "You are                      "Your tasks              │
│      john@example.com"             are stored here"         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 What Each System Does

### **Supabase (Authentication Layer)**
**Location:** External service (supabase.com)
**Purpose:** Verify who users are
**Stores:** Authentication tokens, OAuth connections

**What it does:**
- Sends magic link emails
- Manages OAuth (Google, GitHub, etc.)
- Issues JWT tokens proving user identity
- **DOES NOT** store your tasks, projects, or business data

**What it returns:**
```javascript
{
  id: "supabase-uuid-123",        // Supabase's user ID
  email: "user@example.com",       // User's email
  user_metadata: {                 // Optional OAuth data
    name: "John Doe"
  }
}
```

---

### **D1/JSON (Data Layer)**
**Location:** Your database (Cloudflare D1 or local JSON files)
**Purpose:** Store all application data
**Stores:** Users, projects, tasks, activity logs

**What it does:**
- Stores user profiles (name, initials, color, email)
- Manages projects and tasks
- Tracks activity logs
- **DOES** store all your business data

**Schema:**
```sql
users:
  - id (YOUR internal ID, not Supabase's)
  - supabase_id (links to Supabase auth)
  - email
  - name
  - initials
  - color

projects:
  - id
  - name
  - owner_id (links to users.id)

tasks:
  - id
  - name
  - project_id
  - assigned_to_id (links to users.id)
```

---

## 🔄 How They Work Together: The Flow

### **1. User Logs In with Magic Link**

```
┌─────────┐     Magic Link      ┌──────────┐
│  User   │ ──────────────────► │ Supabase │
│ (Email) │                      │          │
└─────────┘                      └────┬─────┘
                                      │
                                      │ Returns JWT token
                                      │ + user email/id
                                      ▼
                            ┌─────────────────┐
                            │  Your Server    │
                            │ (server-auth.js)│
                            └────┬────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
            Check if user    If new user,  If existing,
            exists in DB     create profile  sign in
                    │            │            │
                    ▼            ▼            ▼
            ┌─────────────────────────────────┐
            │      YOUR DATABASE (D1/JSON)    │
            │                                  │
            │  users table:                   │
            │  - id: "user-abc123"            │
            │  - supabase_id: "sb-uuid"       │
            │  - email: "user@example.com"    │
            │  - name: "John Doe"             │
            │  - initials: "JD"               │
            │  - color: "#4ECDC4"             │
            └──────────────────────────────────┘
```

**Step-by-step:**
1. User requests magic link → Supabase sends email
2. User clicks link → Redirected to `/auth/callback.html`
3. Callback page extracts JWT token from URL
4. Frontend sends token to YOUR server (`/api/auth/supabase-callback`)
5. Server verifies token with Supabase
6. Server checks if `supabase_id` exists in YOUR database
   - **If yes:** Log them in (existing user)
   - **If no:** Redirect to profile setup (new user)
7. New user completes profile → Stored in YOUR database
8. Server creates session → User can access app

**Key Point:** Supabase only validates "this person controls this email". YOUR database stores everything else.

---

## 📊 Data Storage: Who Stores What

| Data Type | Stored In | Purpose |
|-----------|-----------|---------|
| **Email address** | Both! | Supabase (auth), Your DB (contact info) |
| **Password hash** | Your DB only | For bcrypt users (not Supabase users) |
| **supabase_id** | Your DB only | Links to Supabase auth |
| **Name** | Your DB only | User's full name |
| **Initials** | Your DB only | Avatar display |
| **Color** | Your DB only | User identification |
| **user_id** | Your DB only | Internal ID for tasks/projects |
| **Projects** | Your DB only | Project data |
| **Tasks** | Your DB only | Task data |
| **Activity logs** | Your DB only | Audit trail |
| **JWT tokens** | Supabase | Authentication state |
| **Magic link tokens** | Supabase | One-time login codes |
| **OAuth tokens** | Supabase | Google/GitHub auth |

---

## 🔀 Database Selection: D1 vs JSON

Your app **automatically chooses** which database to use:

```javascript
// From data-service.js
this.useD1 = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_D1_DATABASE_ID &&
    process.env.CLOUDFLARE_API_TOKEN
);

if (this.useD1) {
    console.log('📊 Using Cloudflare D1 database');
    this.d1 = new D1Client();
} else {
    console.log('📊 Using JSON file storage (development mode)');
    // Use local files
}
```

**Decision tree:**
```
Are D1 credentials configured?
├─ YES → Use Cloudflare D1 (production)
└─ NO → Use JSON files (development)
```

**Both modes support:**
- ✅ Supabase authentication
- ✅ bcrypt authentication
- ✅ All app features (tasks, projects, users)

---

## 🔗 How Supabase Users Link to Your Database

When a user signs in with Supabase, here's the data mapping:

```javascript
// Supabase returns this:
{
  id: "a1b2c3d4-supabase-uuid",
  email: "john@example.com",
  user_metadata: { name: "John Doe" }
}

// Your database stores this:
{
  id: "user-xyz789",              // YOUR internal ID
  supabase_id: "a1b2c3d4...",     // Links to Supabase
  email: "john@example.com",
  name: "John Doe",
  initials: "JD",
  color: "#4ECDC4",
  username: "john",
  is_admin: false
}
```

**Why separate IDs?**
- `supabase_id`: Supabase's identifier (UUID format)
- `id`: Your internal ID (shorter, task-manager specific)
- Tasks reference `assigned_to_id` (your ID, not Supabase's)
- This allows flexibility (e.g., migrating to different auth provider)

---

## 🛡️ Security Flow

### **Authentication Request:**
```
1. User enters email
   ↓
2. Frontend → POST /api/auth/magic-link
   ↓
3. Server → Supabase.sendMagicLink()
   ↓
4. Supabase → Sends email with token
   ↓
5. User clicks link → Redirected to callback
   ↓
6. Callback page extracts token
   ↓
7. Frontend → POST /api/auth/supabase-callback
   ↓
8. Server → Supabase.verifyToken()
   ↓
9. Supabase returns: "✅ This email is verified"
   ↓
10. Server checks YOUR database
   ↓
11. If user exists → Create session
    If new → Redirect to profile setup
```

**Security layers:**
1. **Supabase verifies email ownership** (only real email owner gets link)
2. **JWT token is cryptographically signed** (can't be forged)
3. **Server validates token** before trusting it
4. **Session created only** after validation
5. **Your database** stores the final user record

---

## 💾 Data Flow: Creating a Task

Here's what happens when a user creates a task:

```
User creates task "Buy milk"
         ↓
Frontend sends:
POST /api/tasks
{
  name: "Buy milk",
  project_id: "project-123",
  assigned_to_id: "user-xyz789"  ← YOUR internal user ID
}
         ↓
Server validates:
- Is user authenticated? (check session)
- Is user member of project-123? (check YOUR DB)
- Does user-xyz789 exist? (check YOUR DB)
         ↓
Server saves to YOUR database:
{
  id: "task-abc",
  name: "Buy milk",
  project_id: "project-123",
  assigned_to_id: "user-xyz789",  ← Links to users.id
  created_by_id: "user-xyz789",
  status: "pending"
}
         ↓
✅ Task saved!
```

**Supabase is NOT involved** in this flow. It only verified the user during login.

---

## 🔄 Dual Authentication Support

Your app supports **both** authentication methods simultaneously:

### **Method 1: Bcrypt (Traditional)**
```
User: admin
Password: admin123
         ↓
Server checks: password_hash in YOUR database
         ↓
If match → Create session
```

**Database:**
```javascript
{
  id: "user-admin",
  username: "admin",
  password_hash: "$2a$10$...",  // bcrypt hash
  supabase_id: null             // No Supabase link
}
```

---

### **Method 2: Supabase (Magic Link)**
```
Email: user@example.com
         ↓
Supabase sends magic link
         ↓
User clicks → Token verified
         ↓
Server creates/finds user in YOUR database
```

**Database:**
```javascript
{
  id: "user-xyz",
  username: "user",
  password_hash: null,           // No password!
  supabase_id: "sb-uuid-123",    // Linked to Supabase
  email: "user@example.com"
}
```

---

## 🔄 Account Linking

If an existing bcrypt user logs in with Supabase using the **same email**:

```javascript
// Existing user (bcrypt)
{
  id: "user-123",
  email: "john@example.com",
  password_hash: "$2a$10$...",
  supabase_id: null
}

// User logs in with Supabase (same email)
// Server automatically links:

{
  id: "user-123",              // Same user!
  email: "john@example.com",
  password_hash: "$2a$10$...",  // Kept for password login
  supabase_id: "sb-uuid"        // Added Supabase link
}
```

Now the user can log in **both ways**:
- Password login (bcrypt)
- Magic link login (Supabase)

---

## 📡 API Flow Examples

### **Example 1: Get User's Tasks**

**Frontend:**
```javascript
fetch('/api/tasks', {
  credentials: 'include'  // Send session cookie
})
```

**Server Flow:**
```
1. Check session cookie → Get user_id
2. Query YOUR database for user's projects
3. Query YOUR database for tasks in those projects
4. Return tasks
```

**Supabase involvement:** NONE (after initial login)

---

### **Example 2: Add Project Member**

**Frontend:**
```javascript
fetch('/api/projects/project-123/members', {
  method: 'POST',
  body: JSON.stringify({ user_id: "user-xyz" }),
  credentials: 'include'
})
```

**Server Flow:**
```
1. Check session → Verify user is project owner
2. Check YOUR database → Does user-xyz exist?
3. Check YOUR database → Is user-xyz already member?
4. Add to YOUR database → project_members table
5. Return success
```

**Supabase involvement:** NONE

---

## 🗄️ Database Schema Comparison

### **Your Database (D1 or JSON)**
```sql
users:
  id TEXT PRIMARY KEY                 ← Your internal ID
  supabase_id TEXT UNIQUE            ← Links to Supabase (optional)
  username TEXT
  password_hash TEXT                  ← For bcrypt users (optional)
  email TEXT
  name TEXT
  initials TEXT
  color TEXT
  is_admin BOOLEAN

projects:
  id TEXT PRIMARY KEY
  name TEXT
  owner_id TEXT → users.id           ← Uses YOUR user ID

tasks:
  id TEXT PRIMARY KEY
  name TEXT
  project_id TEXT → projects.id
  assigned_to_id TEXT → users.id     ← Uses YOUR user ID

project_members:
  project_id TEXT → projects.id
  user_id TEXT → users.id            ← Uses YOUR user ID

activity_log:
  user_id TEXT → users.id            ← Uses YOUR user ID
  action TEXT
  timestamp TEXT
```

### **Supabase Database (Managed by them)**
```sql
auth.users:
  id UUID PRIMARY KEY                 ← Supabase's user ID
  email TEXT
  encrypted_password TEXT            ← Supabase manages
  email_confirmed_at TIMESTAMP

auth.identities:
  provider TEXT                       ← 'email', 'google', etc.
  user_id UUID → auth.users.id
  provider_id TEXT
```

**You never touch** Supabase's database directly!

---

## 🔀 Migration Scenarios

### **Scenario 1: Existing Users Start Using Supabase**

**Before:**
```json
{
  "id": "user-123",
  "email": "john@example.com",
  "password_hash": "$2a$10$...",
  "supabase_id": null
}
```

**User logs in with magic link:**
1. Server gets Supabase token
2. Server finds user by email
3. Server adds `supabase_id` to user record

**After:**
```json
{
  "id": "user-123",
  "email": "john@example.com",
  "password_hash": "$2a$10$...",       ← Kept!
  "supabase_id": "sb-uuid-123"         ← Added!
}
```

**Result:** User can now log in with password OR magic link!

---

### **Scenario 2: Migrate from JSON to D1**

Your data moves, but the structure stays the same:

**Step 1: Run migration**
```bash
# Upload schema
wrangler d1 execute task-manager --file=./schema.sql

# Export JSON data
node export-json-to-sql.js

# Import to D1
wrangler d1 execute task-manager --file=./migration.sql
```

**Step 2: Update `.env`**
```bash
CLOUDFLARE_ACCOUNT_ID=your-account
CLOUDFLARE_D1_DATABASE_ID=your-db-id
CLOUDFLARE_API_TOKEN=your-token
```

**Step 3: Restart**
```bash
npm start
```

**Result:** Same app, same data, now using D1 instead of JSON files!

---

## 🛠️ Troubleshooting

### **"Which database is my data in?"**

Check your server startup logs:

```bash
npm start

# You'll see:
📊 Using Cloudflare D1 database          ← Data in D1
# OR
📊 Using JSON file storage (development) ← Data in ./data/*.json

⚠️  Supabase not configured              ← No Supabase auth
# OR
✅ Supabase authentication enabled        ← Supabase auth active
```

---

### **"Can I use Supabase without D1?"**

**YES!** Supabase only handles authentication. Your data can be in:
- ✅ JSON files (development)
- ✅ Cloudflare D1 (production)
- ✅ Any database you add (PostgreSQL, MySQL, etc.)

Supabase doesn't care where your data is stored.

---

### **"Can I use D1 without Supabase?"**

**YES!** D1 stores your data regardless of authentication method:
- ✅ Bcrypt passwords only
- ✅ Supabase magic links only
- ✅ Both at the same time

---

### **"Where is my friend's email stored?"**

**Both places:**
1. **Supabase:** Stores it for authentication
2. **Your database:** Stores it in the `users` table

They're synchronized during profile setup:
```javascript
// Supabase provides:
email: "friend@example.com"

// Your database stores:
{
  id: "user-xyz",
  email: "friend@example.com",  ← Copied from Supabase
  name: "Friend Name",
  initials: "FN",
  color: "#FF6B6B"
}
```

---

## 📊 Summary Table

| Feature | Supabase | D1/JSON |
|---------|----------|---------|
| **Purpose** | Authentication | Data storage |
| **What it stores** | Auth tokens, OAuth data | Users, projects, tasks |
| **Required?** | No (optional) | Yes (always) |
| **Your data lives here?** | No | Yes |
| **Manages passwords?** | Yes (for Supabase users) | Yes (for bcrypt users) |
| **Can be replaced?** | Yes (swap for Auth0, etc.) | Yes (swap for PostgreSQL, etc.) |
| **Location** | supabase.com | Your server/Cloudflare |
| **Cost** | Free tier: 50,000 users | Free tier: 100,000 reads/day |

---

## 🎯 Key Takeaways

1. **Supabase = Auth, Your DB = Data**
2. **They don't talk to each other directly**
3. **Your server is the bridge between them**
4. **user_id is YOUR ID, supabase_id links to Supabase**
5. **You can use either database (D1 or JSON) with or without Supabase**
6. **All business logic and data lives in YOUR database**
7. **Supabase just proves "this person owns this email"**

---

**Questions?** See the flow diagrams in SUPABASE_SETUP.md and DEPLOYMENT_STATUS.md!
