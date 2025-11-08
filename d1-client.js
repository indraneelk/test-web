const axios = require('axios');

/**
 * D1 Database Client
 * Connects to Cloudflare D1 via Workers API
 */
class D1Client {
    constructor() {
        this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        this.databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
        this.apiToken = process.env.CLOUDFLARE_API_TOKEN;
        this.baseUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/d1/database/${this.databaseId}`;
    }

    /**
     * Execute a SQL query on D1
     */
    async query(sql, params = []) {
        if (!this.accountId || !this.databaseId || !this.apiToken) {
            throw new Error('Cloudflare D1 credentials not configured');
        }

        try {
            const response = await axios.post(
                `${this.baseUrl}/query`,
                {
                    sql: sql,
                    params: params
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.data.success) {
                throw new Error(response.data.errors?.[0]?.message || 'D1 query failed');
            }

            return response.data.result[0];
        } catch (error) {
            console.error('D1 query error:', error.message);
            throw error;
        }
    }

    /**
     * Get all tasks
     */
    async getTasks() {
        const result = await this.query(`
            SELECT t.*, u.name as assignee_name, p.name as project_name
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to_id = u.id
            LEFT JOIN projects p ON t.project_id = p.id
            ORDER BY t.created_at DESC
        `);
        return result.results || [];
    }

    /**
     * Get tasks for a specific user
     */
    async getUserTasks(userId) {
        const result = await this.query(`
            SELECT t.*, u.name as assignee_name, p.name as project_name
            FROM tasks t
            LEFT JOIN users u ON t.assigned_to_id = u.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.assigned_to_id = ?
            ORDER BY t.created_at DESC
        `, [userId]);
        return result.results || [];
    }

    /**
     * Get all projects
     */
    async getProjects() {
        const result = await this.query(`
            SELECT p.*, u.name as owner_name
            FROM projects p
            LEFT JOIN users u ON p.owner_id = u.id
            ORDER BY p.created_at DESC
        `);
        return result.results || [];
    }

    /**
     * Get project members
     */
    async getProjectMembers(projectId) {
        const result = await this.query(`
            SELECT u.id, u.name, u.email
            FROM users u
            INNER JOIN project_members pm ON u.id = pm.user_id
            WHERE pm.project_id = ?
        `, [projectId]);
        return result.results || [];
    }

    /**
     * Get all users
     */
    async getUsers() {
        const result = await this.query(`
            SELECT id, username, name, email, initials, is_admin, created_at
            FROM users
            ORDER BY name
        `);
        return result.results || [];
    }
}

module.exports = D1Client;
