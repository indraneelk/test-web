import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(os.homedir(), '.tm');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return {};
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch {
        return {};
    }
}

export function saveConfig(config) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getSession() {
    const config = loadConfig();
    return config.session || null;
}

export function setSession(session) {
    const config = loadConfig();
    config.session = session;
    saveConfig(config);
}

export function clearSession() {
    const config = loadConfig();
    delete config.session;
    saveConfig(config);
}

export function getSupabaseEnv() {
    const config = loadConfig();
    return {
        url: config.supabaseUrl || process.env.SUPABASE_URL,
        anonKey: config.supabaseAnonKey || process.env.SUPABASE_ANON_KEY
    };
}

export function setSupabaseEnv(url, anonKey) {
    const config = loadConfig();
    config.supabaseUrl = url;
    config.supabaseAnonKey = anonKey;
    saveConfig(config);
}
