# 🔐 Supabase Authentication Setup Guide

Complete guide to setting up Supabase authentication with magic links for your Task Manager.

---

## ✨ Features

- **Magic Link Authentication** - Passwordless login via email
- **OAuth Providers** - Google, GitHub, and more (ready to enable)
- **User Profiles** - Name, initials, and color customization
- **Secure** - No passwords stored, managed by Supabase
- **User-Friendly** - Beautiful onboarding flow for new users

---

## 🚀 Quick Setup (5 Minutes)

### Step 1: Create Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project"
3. Create a new project:
   - Choose organization
   - Enter project name (e.g., "task-manager")
   - Set database password (save this!)
   - Select region closest to you
   - Click "Create new project"

### Step 2: Get Your API Keys

1. Wait for project to initialize (~2 minutes)
2. Go to **Project Settings** → **API**
3. Copy these values:
   - **Project URL** - Your unique Supabase URL
   - **anon/public key** - Public API key (safe for frontend)
   - **service_role key** - Secret key (server-only!)

### Step 3: Configure Environment Variables

1. Open your `.env` file
2. Add these values:

```bash
# Supabase Authentication
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### Step 4: Configure Email Settings (Optional but Recommended)

By default, Supabase uses their SMTP server (rate-limited). For production:

1. Go to **Authentication** → **Email Templates**
2. Customize magic link email template
3. Go to **Project Settings** → **Auth** → **SMTP Settings**
4. Configure your own SMTP provider (SendGrid, AWS SES, etc.)

### Step 5: Set Up Redirect URLs

1. Go to **Authentication** → **URL Configuration**
2. Add your callback URL to **Redirect URLs**:
   ```
   http://localhost:3000/auth/callback.html
   https://yourdomain.com/auth/callback.html
   ```

### Step 6: Test It Out!

1. Restart your server: `npm start`
2. Visit: [http://localhost:3000/magic-link.html](http://localhost:3000/magic-link.html)
3. Enter your email
4. Check your inbox for the magic link
5. Click the link and complete your profile!

---

## 📱 User Flow

### For New Users:

1. **Visit Magic Link Page** → `/magic-link.html`
2. **Enter Email** → Receive magic link email
3. **Click Link** → Auto-redirected to callback page
4. **Complete Profile** → Name, initials, and color
5. **Start Using App** → Full access to task manager

### For Returning Users:

1. **Visit Magic Link Page** → `/magic-link.html`
2. **Enter Email** → Receive magic link email
3. **Click Link** → Instantly signed in
4. **Redirected to App** → Continue where they left off

---

## 🎨 User Profile Fields

When users complete their profile, they provide:

| Field | Description | Example | Required |
|-------|-------------|---------|----------|
| **Name** | Full name | John Doe | ✅ Yes |
| **Initials** | 2-3 letter initials | JD | ✅ Yes |
| **Color** | Avatar color | #4ECDC4 | Auto-generated |
| **Email** | Email address | john@example.com | From Supabase |
| **user_id** | Internal ID | Generated | Auto-generated |
| **supabase_id** | Supabase auth ID | uuid | From Supabase |

These fields are used throughout the app for:
- Avatar circles with initials
- Color-coded project members
- Task assignments
- Activity tracking

---

## 🔌 API Endpoints

### Send Magic Link
```http
POST /api/auth/magic-link
Content-Type: application/json

{
  "email": "user@example.com",
  "redirectTo": "http://localhost:3000/auth/callback.html" // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Magic link sent! Check your email.",
  "email": "user@example.com"
}
```

### Handle Auth Callback
```http
POST /api/auth/supabase-callback
Content-Type: application/json

{
  "access_token": "eyJhbGci...",
  "refresh_token": "..." // optional
}
```

**Response (Existing User):**
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "John Doe",
    "initials": "JD",
    "color": "#4ECDC4"
  },
  "needsProfileSetup": false
}
```

**Response (New User):**
```json
{
  "success": true,
  "needsProfileSetup": true,
  "supabaseUser": {
    "id": "supabase-uuid",
    "email": "user@example.com",
    "name": "John"
  },
  "tempToken": "temporary-access-token"
}
```

### Complete Profile Setup
```http
POST /api/auth/profile-setup
Content-Type: application/json

{
  "access_token": "temporary-access-token",
  "name": "John Doe",
  "initials": "JD",
  "color": "#4ECDC4" // optional, auto-generated if not provided
}
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "John Doe",
    "initials": "JD",
    "color": "#4ECDC4",
    "supabase_id": "supabase-uuid"
  }
}
```

---

## 🔒 Security Features

### Built-In Security:
- ✅ **No password storage** - Supabase handles all auth
- ✅ **Secure tokens** - JWT-based authentication
- ✅ **Email verification** - Only valid email owners can sign in
- ✅ **Rate limiting** - Built into Supabase
- ✅ **Session management** - Automatic token refresh
- ✅ **HTTPS only** - Enforced in production

### Environment Variable Security:
- ✅ **SUPABASE_ANON_KEY** - Safe for frontend (row-level security)
- 🔐 **SUPABASE_SERVICE_ROLE_KEY** - Server-only (never expose!)
- 🔐 Keys never committed to git (in `.gitignore`)

---

## 🌐 Enabling OAuth Providers

### Google Sign-In:

1. Go to **Authentication** → **Providers**
2. Enable **Google**
3. Get credentials from [Google Cloud Console](https://console.cloud.google.com)
4. Add Client ID and Secret to Supabase
5. Add authorized redirect URI:
   ```
   https://your-project-id.supabase.co/auth/v1/callback
   ```

### GitHub Sign-In:

1. Go to **Authentication** → **Providers**
2. Enable **GitHub**
3. Create OAuth App at [GitHub Settings](https://github.com/settings/developers)
4. Add Client ID and Secret to Supabase
5. Set callback URL to Supabase redirect URI

---

## 📊 Database Integration

### Supabase + Internal Database:

The system supports **both** authentication methods:

| Method | Use Case | Storage |
|--------|----------|---------|
| **Bcrypt (Legacy)** | Password-based login | password_hash in DB |
| **Supabase** | Magic link / OAuth | supabase_id in DB |

Users are linked via:
```javascript
{
  id: "internal-user-id",           // Our system's user ID
  supabase_id: "supabase-uuid",     // Links to Supabase auth
  email: "user@example.com",
  name: "John Doe",
  initials: "JD",
  color: "#4ECDC4"
}
```

### Migration Path:

Existing users can link their accounts:
1. User logs in with magic link
2. System finds existing user by email
3. Adds `supabase_id` to existing account
4. Future logins use Supabase

---

## 🎨 Customization

### Customize Colors:

Edit `/public/profile-setup.html`:
```javascript
const predefinedColors = [
  '#FF6B6B', '#4ECDC4', '#45B7D1',
  // Add your colors here!
];
```

### Customize Email Template:

1. Go to **Authentication** → **Email Templates**
2. Select **Magic Link**
3. Edit HTML/text:
   ```html
   <h2>Sign in to Task Manager</h2>
   <p>Click the button below to sign in:</p>
   <a href="{{ .ConfirmationURL }}">Sign In</a>
   ```

### Customize Redirect Behavior:

Edit `/public/auth/callback.html`:
```javascript
// Change where users go after login
window.location.href = '/dashboard'; // Custom destination
```

---

## 🐛 Troubleshooting

### Magic Link Not Arriving?

1. **Check spam folder**
2. **Verify SMTP settings** in Supabase
3. **Check rate limits** (default: 3 emails/hour in dev)
4. **Enable email confirmations** in Auth settings

### "Supabase not configured" Error?

1. Check `.env` file exists
2. Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set
3. Restart server after changing `.env`
4. Check console for startup message

### Profile Setup Not Working?

1. Check browser console for errors
2. Verify temp token in sessionStorage
3. Check network tab for API errors
4. Ensure `/api/auth/profile-setup` route is accessible

### Users Not Linking to Existing Accounts?

1. Verify email matches exactly
2. Check `supabase_id` column exists in DB
3. Run migration: `migrations/005_add_supabase_support.sql`

---

## 📈 Production Checklist

Before going live:

- [ ] Use custom SMTP provider (not Supabase default)
- [ ] Add production domain to redirect URLs
- [ ] Enable rate limiting for magic links
- [ ] Customize email templates with branding
- [ ] Set up OAuth providers (Google, GitHub, etc.)
- [ ] Enable email confirmations
- [ ] Set secure session secret
- [ ] Use HTTPS for all requests
- [ ] Test magic link flow end-to-end
- [ ] Monitor authentication logs in Supabase

---

## 🔗 Useful Links

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Auth Guide](https://supabase.com/docs/guides/auth)
- [Magic Link Setup](https://supabase.com/docs/guides/auth/auth-email)
- [OAuth Providers](https://supabase.com/docs/guides/auth/social-login)
- [Email Templates](https://supabase.com/docs/guides/auth/auth-email#email-templates)

---

## 💡 Tips & Best Practices

1. **Test in Incognito** - Avoid session conflicts
2. **Use Real Emails** - Some providers block +aliases
3. **Customize Templates** - Match your brand
4. **Monitor Logs** - Check Supabase dashboard
5. **Set Up Webhooks** - Track user events
6. **Enable 2FA** - For admin users
7. **Regular Backups** - Export user data

---

## 🎉 You're All Set!

Your users can now sign in with magic links! They'll get:
- Passwordless authentication
- Beautiful profile customization
- Secure, managed auth via Supabase
- Seamless integration with your task manager

**Next Steps:**
1. Send your friends the magic link page URL
2. They'll receive email links to create accounts
3. Watch them complete their colorful profiles!
4. Start collaborating on projects together

Happy task managing! 🚀
