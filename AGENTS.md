# Agent Instructions for Team Task Manager

## CLI Usage

The `tm` CLI lives in `cli/` and is globally linked as `tm`. All commands support `--json` / `-j` for machine-readable output.

### Setup

```bash
tm config set-url <SUPABASE_URL> <SUPABASE_ANON_KEY>
tm login <email> <password>
```

### Tasks

```bash
tm tasks list                           # List tasks (supports --project, --status, --priority)
tm tasks create -t "Fix bug" -D 2026-04-15 -r high
tm tasks complete <id>                   # Mark complete
tm tasks reopen <id>                     # Reopen task
tm tasks delete <id>                     # Delete task
tm tasks get <id>                        # Get task details
```

### Projects

```bash
tm projects list                         # List user's projects
tm projects create -n "Backend" -c "#4f46e5"
tm projects delete <id>                  # Owner only
tm projects get <id>                     # Get project details
```

### Auth

```bash
tm whoami                               # Show current user (--json)
tm logout                               # Clear session
tm config show                          # Show current config
```

### Integration with Claude Code

Use `--json` output to parse results:

```bash
# Get all high-priority tasks
tm tasks list --priority high --json

# Get tasks for a specific project
tm tasks list --project <project-id> --json

# Create a task and capture the ID
tm tasks create -t "Fix login bug" -r high -D 2026-04-15 -j
```

## Key Conventions

- Due dates use `YYYY-MM-DD` format
- Priority values: `high`, `medium`, `low`, `none`
- Status values: `pending`, `in-progress`, `completed`
- All IDs are UUIDs from Supabase
- Only project owners can delete projects
- Personal "General" projects are protected (cannot be deleted)
