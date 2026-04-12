#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';

import * as tasks from './commands/tasks.js';
import * as projects from './commands/projects.js';
import { whoami } from './commands/whoami.js';
import { login } from './commands/login.js';
import { logout } from './commands/logout.js';
import { setSupabaseEnv, loadConfig } from './config.js';
import { resetClient } from './supabase.js';

const program = new Command();

program
    .name('tm')
    .description('Team Task Manager CLI')
    .version('1.0.0');

// ── Config ──────────────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
    .command('set-url <url> <anon-key>')
    .description('Set Supabase URL and anon key')
    .action((url, anonKey) => {
        setSupabaseEnv(url, anonKey);
        resetClient();
        console.log(pc.green('✓ Supabase credentials saved to ~/.tm/config.json'));
    });

configCmd
    .command('show')
    .description('Show current configuration (without secrets)')
    .action(() => {
        const cfg = loadConfig();
        if (cfg.supabaseUrl) {
            console.log(`Supabase URL: ${cfg.supabaseUrl}`);
            console.log(`Anon key:     ${cfg.supabaseAnonKey ? '***' + cfg.supabaseAnonKey.slice(-4) : pc.red('not set')}`);
        } else {
            console.log(pc.yellow('Not configured. Set with: tm config set-url <url> <anon-key>'));
        }
    });

// ── Auth ────────────────────────────────────────────────────────────────────

program
    .command('login <email> <password>')
    .description('Log in with email and password')
    .action(login);

program
    .command('logout')
    .description('Log out and clear stored session')
    .action(logout);

program
    .command('whoami')
    .description('Show current logged-in user')
    .option('-j, --json', 'Output as JSON')
    .action(whoami);

// ── Tasks ───────────────────────────────────────────────────────────────────

const tasksCmd = program.command('tasks').description('Manage tasks');

tasksCmd
    .command('list')
    .description('List all tasks')
    .option('-p, --project <id>', 'Filter by project ID')
    .option('-s, --status <status>', 'Filter by status (pending, in-progress, completed)')
    .option('-r, --priority <priority>', 'Filter by priority (high, medium, low, none)')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
        await tasks.listTasks(opts);
    });

tasksCmd
    .command('create')
    .description('Create a new task')
    .requiredOption('-t, --title <title>', 'Task title')
    .option('-d, --description <text>', 'Task description')
    .option('-p, --project <id>', 'Project ID')
    .option('-D, --due <YYYY-MM-DD>', 'Due date')
    .option('-r, --priority <priority>', 'Priority (high, medium, low, none)')
    .option('-a, --assignee <user-id>', 'Assignee user ID')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
        await tasks.createTask(opts);
    });

tasksCmd
    .command('complete <id>')
    .description('Mark a task as completed')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await tasks.completeTask(id, opts.json);
    });

tasksCmd
    .command('reopen <id>')
    .description('Reopen a completed task')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await tasks.reopenTask(id, opts.json);
    });

tasksCmd
    .command('delete <id>')
    .description('Delete a task')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await tasks.deleteTask(id, opts.json);
    });

tasksCmd
    .command('get <id>')
    .description('Get a task by ID')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await tasks.getTask(id, opts.json);
    });

// ── Projects ────────────────────────────────────────────────────────────────

const projectsCmd = program.command('projects').description('Manage projects');

projectsCmd
    .command('list')
    .description('List all projects')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
        await projects.listProjects(opts);
    });

projectsCmd
    .command('create')
    .description('Create a new project')
    .requiredOption('-n, --name <name>', 'Project name')
    .option('-d, --description <text>', 'Project description')
    .option('-c, --color <hex>', 'Project color (hex, e.g. #f06a6a)')
    .option('-j, --json', 'Output as JSON')
    .action(async (opts) => {
        await projects.createProject(opts);
    });

projectsCmd
    .command('delete <id>')
    .description('Delete a project (owner only)')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await projects.deleteProject(id, opts.json);
    });

projectsCmd
    .command('get <id>')
    .description('Get a project by ID')
    .option('-j, --json', 'Output as JSON')
    .action(async (id, opts) => {
        await projects.getProject(id, opts.json);
    });

// ── Parse ────────────────────────────────────────────────────────────────────

program.parse();
