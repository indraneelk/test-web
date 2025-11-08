# Data Service Architecture

## Overview

The application now uses a **unified data abstraction layer** that automatically switches between:
- **JSON files** (development)
- **Cloudflare D1** (production)

## How It Works

```javascript
// server-auth.js
const dataService = require('./data-service');

// Automatically uses D1 if configured, otherwise JSON files
const users = await dataService.getUsers();
```

### Auto-Detection Logic

```javascript
// data-service.js checks for D1 credentials on startup
this.useD1 = !!(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.CLOUDFLARE_D1_DATABASE_ID &&
    process.env.CLOUDFLARE_API_TOKEN
);

if (this.useD1) {
    console.log('📊 Using Cloudflare D1 database');
} else {
    console.log('📊 Using JSON file storage (development mode)');
}
```

## Production vs Development

### Development (Local)
```bash
# .env has NO D1 credentials
SESSION_SECRET=abc123
ANTHROPIC_API_KEY=sk-ant-...

# Server output:
# 📊 Using JSON file storage (development mode)
```

**Behavior:**
- Uses `data/users.json`, `data/tasks.json`, etc.
- Creates default admin user
- Fast, no API calls
- Perfect for local development

### Production (Cloudflare Workers/Pages)
```bash
# .env has D1 credentials
SESSION_SECRET=abc123
ANTHROPIC_API_KEY=sk-ant-...
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_D1_DATABASE_ID=your-db-id
CLOUDFLARE_API_TOKEN=your-token

# Server output:
# 📊 Using Cloudflare D1 database
```

**Behavior:**
- Uses Cloudflare D1 (direct binding in Workers/Functions)
- Stateless JWT verification (Authorization: Bearer)
- No JSON files needed
- Scalable, persistent

## Data Service API

All database operations go through the same interface:

### Users
```javascript
await dataService.getUsers()
await dataService.getUserById(userId)
await dataService.getUserByUsername(username)
await dataService.createUser(userData)
```

### Projects
```javascript
await dataService.getProjects()
await dataService.getProjectById(projectId)
await dataService.createProject(projectData)
await dataService.updateProject(projectId, updates)
await dataService.deleteProject(projectId)
```

### Project Members
```javascript
await dataService.getProjectMembers(projectId)
await dataService.addProjectMember(projectId, userId)
await dataService.removeProjectMember(projectId, userId)
```

### Tasks
```javascript
await dataService.getTasks()
await dataService.getTaskById(taskId)
await dataService.createTask(taskData)
await dataService.updateTask(taskId, updates)
await dataService.deleteTask(taskId)
```

### Activity Log
```javascript
await dataService.logActivity(activityData)
await dataService.getActivityLog()
```

## Migration Status

### ✅ Completed
- Data service abstraction layer created
- D1 client implemented
- Auto-detection logic
- All CRUD operations supported
- logActivity() updated to async

### ⚠️ Notes

- Development server (Express) is for local iteration only; production logic lives in the Worker/Functions.
- See MIGRATIONS.md for the canonical schema and migration sequence expected by production code.

**Example - Before:**
```javascript
app.post('/api/auth/register', (req, res) => {
    const users = readJSON(USERS_FILE);  // OLD
    users.push(newUser);
    writeJSON(USERS_FILE, users);         // OLD
});
```

**Example - After:**
```javascript
app.post('/api/auth/register', async (req, res) => {
    const users = await dataService.getUsers();     // NEW
    await dataService.createUser(newUser);          // NEW
});
```

## Updating Routes (TODO)

Each route needs to be updated to use dataService. Here's the systematic approach:

### 1. Make route async
```javascript
// Before
app.post('/api/auth/register', (req, res) => {

// After
app.post('/api/auth/register', async (req, res) => {
```

### 2. Replace readJSON calls
```javascript
// Before
const users = readJSON(USERS_FILE);

// After
const users = await dataService.getUsers();
```

### 3. Replace writeJSON calls
```javascript
// Before
writeJSON(USERS_FILE, users);

// After
await dataService.createUser(newUser);
// or
await dataService.updateUser(userId, updates);
```

### 4. Update logActivity calls
```javascript
// Before
logActivity(userId, 'user_registered', 'User registered');

// After
await logActivity(userId, 'user_registered', 'User registered');
```

## Routes to Update

### Auth Routes
- ✅ `POST /api/auth/register` - Needs `dataService.createUser()`
- ✅ `POST /api/auth/login` - Needs `dataService.getUserByUsername()`
- ✅ `GET /api/auth/me` - Needs `dataService.getUserById()`

### User Routes
- ✅ `GET /api/users` - Needs `dataService.getUsers()`

### Project Routes
- ✅ `GET /api/projects` - Needs `dataService.getProjects()`
- ✅ `POST /api/projects` - Needs `dataService.createProject()`
- ✅ `PUT /api/projects/:id` - Needs `dataService.updateProject()`
- ✅ `DELETE /api/projects/:id` - Needs `dataService.deleteProject()`
- ✅ `POST /api/projects/:id/members` - Needs `dataService.addProjectMember()`
- ✅ `DELETE /api/projects/:id/members/:userId` - Needs `dataService.removeProjectMember()`

### Task Routes
- ✅ `GET /api/tasks` - Needs `dataService.getTasks()`
- ✅ `POST /api/tasks` - Needs `dataService.createTask()`
- ✅ `PUT /api/tasks/:id` - Needs `dataService.updateTask()`
- ✅ `DELETE /api/tasks/:id` - Needs `dataService.deleteTask()`

### Activity Routes
- ✅ `GET /api/activity` - Needs `dataService.getActivityLog()`

### Claude Routes
- ✅ Already use async/await
- Need `dataService` for fetching data
- `GET /api/claude/summary`
- `GET /api/claude/priorities`
- `POST /api/claude/ask`

## Testing

### Test JSON Mode (Development)
```bash
# Don't set D1 env vars
npm start

# Should see:
# 📊 Using JSON file storage (development mode)

# Test API endpoints - data saved to data/*.json files
```

### Test D1 Mode (Production)
```bash
# Set D1 env vars in .env
CLOUDFLARE_ACCOUNT_ID=your-id
CLOUDFLARE_D1_DATABASE_ID=your-db-id
CLOUDFLARE_API_TOKEN=your-token

npm start

# Should see:
# 📊 Using Cloudflare D1 database

# Test API endpoints - data saved to D1
```

## Benefits

### For Development
✅ No cloud dependencies
✅ Fast iteration
✅ Git-committable test data
✅ Works offline

### For Production
✅ Scalable database
✅ No file system needed
✅ Automatic backups (Cloudflare)
✅ Global distribution

### For Both
✅ Same API, same code
✅ Easy testing
✅ Gradual migration
✅ No code duplication

## Next Steps

1. **Update all routes** to use `dataService` (systematic replacement)
2. **Test locally** with JSON files
3. **Setup D1** in Cloudflare
4. **Test with D1** credentials
5. **Deploy** to production

## Files

- `data-service.js` - Main abstraction layer
- `d1-client.js` - D1 API client
- `server-auth.js` - Express server (being updated)
- `schema.sql` - D1 database schema

## Summary

**Development:** No D1 setup needed → uses JSON files
**Production:** Add 3 env vars → uses D1 automatically
**Code:** Same routes, same logic, zero changes needed after migration

This architecture gives you the best of both worlds!
