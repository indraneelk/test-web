// Cloudflare Pages Function to proxy API requests to Worker
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const apiPath = context.params.path.join('/');

  // Construct Worker URL
  const workerUrl = `https://team-task-manager.moovmyway.workers.dev/api/${apiPath}${url.search}`;

  // Forward the request to the Worker
  const response = await fetch(workerUrl, {
    method: context.request.method,
    headers: context.request.headers,
    body: context.request.body
  });

  return response;
}
