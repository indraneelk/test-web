#!/usr/bin/env node

// Test script to create a task via API
// Usage: node test-task-creation.js

const https = require('https');

const userId = '9540b462-5136-411c-a2e1-563d412c5deb';
const projectId = 'project-1762708627088-9u69s1guk';

// Create test task data
const taskData = {
  name: 'Test Task from Script',
  description: 'Testing task creation directly',
  date: '2025-11-15',
  project_id: projectId,
  assigned_to_id: userId,
  priority: 'high'
};

console.log('Testing task creation...');
console.log('User ID:', userId);
console.log('Project ID:', projectId);
console.log('Task data:', JSON.stringify(taskData, null, 2));
console.log('\n--- Attempting to create task WITHOUT authentication ---');

// Test WITHOUT authentication first
const data = JSON.stringify(taskData);

const options = {
  hostname: 'team-task-manager.moovmyway.workers.dev',
  port: 443,
  path: '/api/tasks',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('\nResponse body:');
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
      console.log(body);
    }

    if (res.statusCode === 401) {
      console.log('\n✓ Authentication check working correctly (401 expected)');
      console.log('\nTo test with authentication:');
      console.log('1. Log in at https://mmw-tm.pages.dev');
      console.log('2. Open browser console');
      console.log('3. Run: await supa.auth.getSession()');
      console.log('4. Copy the access_token');
      console.log('5. Add to this script with: -H "Authorization: Bearer <token>"');
    }
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();
