/**
 * Test Discord Interactions endpoint verification
 * This simulates what Discord sends when verifying the endpoint
 */

const DISCORD_PUBLIC_KEY = '89494d4c11451a1336e88835dde8f3feecceb778beb457840c9ee2bd4762f19c';
const WORKER_URL = 'https://team-task-manager.moovmyway.workers.dev/api/interactions';
const PAGES_URL = 'https://mmw-tm.pages.dev/api/interactions';

// Discord sends a PING interaction during verification
const pingInteraction = {
    type: 1, // PING
    id: '1234567890',
    application_id: '1297860950398087240',
    token: 'test-token'
};

async function testEndpoint(endpointUrl, endpointName) {
    const body = JSON.stringify(pingInteraction);
    const timestamp = Date.now().toString();

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${endpointName}`);
    console.log(`URL: ${endpointUrl}`);
    console.log(`${'='.repeat(60)}`);

    // For this test, we'll send without signature first to see the response
    console.log('\n=== Test 1: Without signature (should fail) ===');
    try {
        const response1 = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: body
        });

        console.log('Status:', response1.status);
        console.log('Status Text:', response1.statusText);
        const text1 = await response1.text();
        console.log('Response:', text1);
    } catch (error) {
        console.error('Error:', error.message);
    }

    // Now let's try with a signature (we need the private key to generate a valid signature)
    // For now, let's just send an invalid signature to see how it's handled
    console.log('\n=== Test 2: With invalid signature (should also fail) ===');
    try {
        const response2 = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Signature-Ed25519': 'invalid_signature',
                'X-Signature-Timestamp': timestamp
            },
            body: body
        });

        console.log('Status:', response2.status);
        console.log('Status Text:', response2.statusText);
        const text2 = await response2.text();
        console.log('Response:', text2);
    } catch (error) {
        console.error('Error:', error.message);
    }

    // Test if endpoint is accessible at all
    console.log('\n=== Test 3: Basic GET request (should 404 or return method not allowed) ===');
    try {
        const response3 = await fetch(endpointUrl, {
            method: 'GET'
        });

        console.log('Status:', response3.status);
        console.log('Status Text:', response3.statusText);
        const text3 = await response3.text();
        console.log('Response:', text3);
    } catch (error) {
        console.error('Error:', error.message);
    }
}

async function runAllTests() {
    await testEndpoint(WORKER_URL, 'Worker (team-task-manager)');
    await testEndpoint(PAGES_URL, 'Pages (mmw-tm) via proxy');
}

runAllTests().catch(console.error);
