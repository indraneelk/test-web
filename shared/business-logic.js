/**
 * Shared Business Logic
 * Pure business logic functions used by both server-auth.js and worker.js
 *
 * These functions:
 * - Take dependencies as parameters (dependency injection)
 * - Return data or throw custom errors
 * - Have no HTTP-specific code
 */

const { generateId, getCurrentTimestamp, sanitizeString } = require('./helpers');
const { validateString, validatePriority, validateStatus } = require('./validators');
const { ValidationError, PermissionError, NotFoundError } = require('./errors');
const { VALIDATION, UI } = require('./constants');

// ==================== TASK OPERATIONS ====================

/**
 * Create a new task
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user creating the task
 * @param {Object} taskData - Task data {name, description, date, project_id, assigned_to_id, priority}
 * @returns {Promise<Object>} Created task
 * @throws {ValidationError} If validation fails
 * @throws {PermissionError} If user doesn't have access
 */
async function createTask(dataService, userId, taskData) {
    const { name, description, date, project_id, assigned_to_id, priority } = taskData;

    // Validate required fields
    if (!name || !date || !project_id) {
        throw new ValidationError('Missing required fields: name, date, project_id');
    }

    // Validate task name
    if (!validateString(name, VALIDATION.TASK_NAME_MIN, VALIDATION.TASK_NAME_MAX)) {
        throw new ValidationError(`Task name must be ${VALIDATION.TASK_NAME_MIN}-${VALIDATION.TASK_NAME_MAX} characters`);
    }

    // Validate description (optional)
    if (description && !validateString(description, 0, VALIDATION.TASK_DESCRIPTION_MAX)) {
        throw new ValidationError(`Description must be less than ${VALIDATION.TASK_DESCRIPTION_MAX} characters`);
    }

    // Validate date format
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
        throw new ValidationError('Invalid date format');
    }

    // Validate priority
    if (priority && !validatePriority(priority)) {
        throw new ValidationError('Invalid priority. Must be: none, low, medium, or high');
    }

    // Check if user is member of the project
    const project = await dataService.getProjectById(project_id);
    if (!project) {
        throw new NotFoundError('Project not found');
    }

    const isMember = await isProjectMemberHelper(dataService, userId, project_id);
    if (!isMember) {
        throw new PermissionError('You are not a member of this project');
    }

    // Check if assigned user is member of the project (only if assignee is provided)
    if (assigned_to_id && assigned_to_id.trim() !== '') {
        const assigneeIsMember = await isProjectMemberHelper(dataService, assigned_to_id, project_id);
        if (!assigneeIsMember) {
            throw new ValidationError('Assigned user is not a member of this project');
        }
    }

    const newTask = {
        id: generateId('task'),
        name: sanitizeString(name, VALIDATION.TASK_NAME_MAX),
        description: sanitizeString(description || '', VALIDATION.TASK_DESCRIPTION_MAX),
        date: date,
        project_id: project_id,
        assigned_to_id: (assigned_to_id && assigned_to_id.trim() !== '') ? assigned_to_id : null,
        created_by_id: userId,
        status: 'pending',
        priority: priority || 'none',
        archived: false,
        completed_at: null,
        created_at: getCurrentTimestamp(),
        updated_at: getCurrentTimestamp()
    };

    await dataService.createTask(newTask);
    return newTask;
}

/**
 * Update an existing task
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user updating the task
 * @param {string} taskId - ID of task to update
 * @param {Object} updates - Fields to update
 * @returns {Promise<Object>} Updated task
 * @throws {NotFoundError} If task not found
 * @throws {PermissionError} If user doesn't have access
 * @throws {ValidationError} If validation fails
 */
async function updateTask(dataService, userId, taskId, updates) {
    const task = await dataService.getTaskById(taskId);

    if (!task) {
        throw new NotFoundError('Task not found');
    }

    // Check if user is member of the project
    const isMember = await isProjectMemberHelper(dataService, userId, task.project_id);
    if (!isMember) {
        throw new PermissionError('Access denied');
    }

    const { name, description, date, assigned_to_id, status, priority, project_id } = updates;

    // Validate name if provided
    if (name !== undefined && !validateString(name, VALIDATION.TASK_NAME_MIN, VALIDATION.TASK_NAME_MAX)) {
        throw new ValidationError(`Task name must be ${VALIDATION.TASK_NAME_MIN}-${VALIDATION.TASK_NAME_MAX} characters`);
    }

    // Validate description if provided
    if (description !== undefined && !validateString(description, 0, VALIDATION.TASK_DESCRIPTION_MAX)) {
        throw new ValidationError(`Description must be less than ${VALIDATION.TASK_DESCRIPTION_MAX} characters`);
    }

    // Validate date if provided
    if (date !== undefined) {
        const dateObj = new Date(date);
        if (isNaN(dateObj.getTime())) {
            throw new ValidationError('Invalid date format');
        }
    }

    // Validate status if provided
    if (status !== undefined && !validateStatus(status)) {
        throw new ValidationError('Invalid status. Must be: pending, in-progress, or completed');
    }

    // Validate priority if provided
    if (priority !== undefined && !validatePriority(priority)) {
        throw new ValidationError('Invalid priority. Must be: none, low, medium, or high');
    }

    // If changing assignee, verify they're in the correct project
    const targetProjectId = project_id && project_id !== task.project_id ? project_id : task.project_id;
    if (assigned_to_id && assigned_to_id.trim() !== '') {
        const assigneeIsMember = await isProjectMemberHelper(dataService, assigned_to_id, targetProjectId);
        if (!assigneeIsMember) {
            throw new ValidationError('Assigned user is not a member of the target project');
        }
    }

    // If changing project, verify requester can access target project
    if (project_id && project_id !== task.project_id) {
        const canAccessTarget = await isProjectMemberHelper(dataService, userId, project_id);
        if (!canAccessTarget) {
            throw new PermissionError('Access denied to target project');
        }
    }

    // Build update object
    const updateData = { updated_at: getCurrentTimestamp() };
    if (name !== undefined) updateData.name = sanitizeString(name, VALIDATION.TASK_NAME_MAX);
    if (description !== undefined) updateData.description = sanitizeString(description, VALIDATION.TASK_DESCRIPTION_MAX);
    if (date !== undefined) updateData.date = date;
    if (assigned_to_id !== undefined) updateData.assigned_to_id = assigned_to_id.trim() !== '' ? assigned_to_id : null;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (project_id !== undefined) updateData.project_id = project_id;

    await dataService.updateTask(taskId, updateData);

    const updatedTask = await dataService.getTaskById(taskId);
    return updatedTask;
}

/**
 * Delete a task
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user deleting the task
 * @param {string} taskId - ID of task to delete
 * @returns {Promise<void>}
 * @throws {NotFoundError} If task not found
 * @throws {PermissionError} If user doesn't have access
 */
async function deleteTask(dataService, userId, taskId) {
    const task = await dataService.getTaskById(taskId);

    if (!task) {
        throw new NotFoundError('Task not found');
    }

    // Check if user is member of the project
    const isMember = await isProjectMemberHelper(dataService, userId, task.project_id);
    if (!isMember) {
        throw new PermissionError('Access denied');
    }

    await dataService.deleteTask(taskId);
}

// ==================== PROJECT OPERATIONS ====================

/**
 * Create a new project
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user creating the project
 * @param {Object} projectData - Project data {name, description, color, members}
 * @returns {Promise<Object>} Created project
 * @throws {ValidationError} If validation fails
 */
async function createProject(dataService, userId, projectData) {
    const { name, description, color, members } = projectData;

    // Validate required fields
    if (!name || !name.trim()) {
        throw new ValidationError('Project name is required');
    }

    // Validate project name
    if (!validateString(name, VALIDATION.PROJECT_NAME_MIN, VALIDATION.PROJECT_NAME_MAX)) {
        throw new ValidationError(`Project name must be ${VALIDATION.PROJECT_NAME_MIN}-${VALIDATION.PROJECT_NAME_MAX} characters`);
    }

    // Validate description (optional)
    if (description && !validateString(description, 0, VALIDATION.PROJECT_DESCRIPTION_MAX)) {
        throw new ValidationError(`Description must be less than ${VALIDATION.PROJECT_DESCRIPTION_MAX} characters`);
    }

    // Validate color
    let projectColor = color || pickRandomProjectColor();
    if (color) {
        const hex = String(color).toLowerCase().trim();
        const isValidHex = VALIDATION.HEX_COLOR_REGEX.test(hex);
        if (!isValidHex) {
            throw new ValidationError('Invalid color. Use 6-digit hex like #f06a6a');
        }
        projectColor = hex;
    }

    const newProject = {
        id: generateId('proj'),
        name: sanitizeString(name, VALIDATION.PROJECT_NAME_MAX),
        description: sanitizeString(description || '', VALIDATION.PROJECT_DESCRIPTION_MAX),
        color: projectColor,
        owner_id: userId,
        is_personal: false,
        created_at: getCurrentTimestamp(),
        updated_at: getCurrentTimestamp()
    };

    await dataService.createProject(newProject);

    // Add members if provided
    if (Array.isArray(members) && members.length > 0) {
        for (const memberId of members) {
            try {
                await dataService.addProjectMember(newProject.id, memberId);
            } catch (error) {
                // Continue if member add fails
                console.error(`Failed to add member ${memberId}:`, error);
            }
        }
    }

    return newProject;
}

/**
 * Update a project
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user updating the project
 * @param {string} projectId - ID of project to update
 * @param {Object} updates - Fields to update {name, description, color}
 * @returns {Promise<Object>} Updated project
 * @throws {NotFoundError} If project not found
 * @throws {PermissionError} If user is not the owner
 * @throws {ValidationError} If validation fails
 */
async function updateProject(dataService, userId, projectId, updates) {
    const project = await dataService.getProjectById(projectId);

    if (!project) {
        throw new NotFoundError('Project not found');
    }

    // Only owner can update project details
    if (project.owner_id !== userId) {
        throw new PermissionError('Only the project owner can update project details');
    }

    const { name, description, color } = updates;

    // Validate name if provided
    if (name !== undefined && !validateString(name, VALIDATION.PROJECT_NAME_MIN, VALIDATION.PROJECT_NAME_MAX)) {
        throw new ValidationError(`Project name must be ${VALIDATION.PROJECT_NAME_MIN}-${VALIDATION.PROJECT_NAME_MAX} characters`);
    }

    // Validate description if provided
    if (description !== undefined && description !== null && !validateString(description, 0, VALIDATION.PROJECT_DESCRIPTION_MAX)) {
        throw new ValidationError(`Description must be less than ${VALIDATION.PROJECT_DESCRIPTION_MAX} characters`);
    }

    // Validate color if provided
    if (color !== undefined) {
        const hex = String(color).toLowerCase().trim();
        const isValidHex = VALIDATION.HEX_COLOR_REGEX.test(hex);
        if (!isValidHex) {
            throw new ValidationError('Invalid color. Use 6-digit hex like #f06a6a');
        }
    }

    // Build update object
    const updateData = { updated_at: getCurrentTimestamp() };
    if (name !== undefined) updateData.name = sanitizeString(name, VALIDATION.PROJECT_NAME_MAX);
    if (description !== undefined) updateData.description = sanitizeString(description, VALIDATION.PROJECT_DESCRIPTION_MAX);
    if (color !== undefined) updateData.color = color.toLowerCase().trim();

    await dataService.updateProject(projectId, updateData);

    const updatedProject = await dataService.getProjectById(projectId);
    return updatedProject;
}

/**
 * Delete a project
 * @param {Object} dataService - Data service instance
 * @param {string} userId - ID of user deleting the project
 * @param {string} projectId - ID of project to delete
 * @returns {Promise<void>}
 * @throws {NotFoundError} If project not found
 * @throws {PermissionError} If user is not the owner
 */
async function deleteProject(dataService, userId, projectId) {
    const project = await dataService.getProjectById(projectId);

    if (!project) {
        throw new NotFoundError('Project not found');
    }

    // Only owner can delete project
    if (project.owner_id !== userId) {
        throw new PermissionError('Only the project owner can delete this project');
    }

    await dataService.deleteProject(projectId);
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if user is a project member or owner
 * @param {Object} dataService - Data service instance
 * @param {string} userId - User ID to check
 * @param {string} projectId - Project ID
 * @returns {Promise<boolean>} True if user is member or owner
 */
async function isProjectMemberHelper(dataService, userId, projectId) {
    try {
        const project = await dataService.getProjectById(projectId);
        if (!project) return false;
        if (project.owner_id === userId) return true;

        // Check if members is an array (JSON storage) or needs to be fetched (D1)
        if (Array.isArray(project.members)) {
            return project.members.includes(userId);
        } else {
            const members = await dataService.getProjectMembers(projectId);
            return members.some(m => m.id === userId || m.user_id === userId);
        }
    } catch (error) {
        console.error('isProjectMemberHelper error:', error);
        return false;
    }
}

/**
 * Pick a random project color from preset palette
 * @returns {string} Hex color code
 */
function pickRandomProjectColor() {
    return UI.PROJECT_COLORS[Math.floor(Math.random() * UI.PROJECT_COLORS.length)];
}

module.exports = {
    // Task operations
    createTask,
    updateTask,
    deleteTask,

    // Project operations
    createProject,
    updateProject,
    deleteProject,

    // Helpers
    isProjectMemberHelper,
    pickRandomProjectColor
};
