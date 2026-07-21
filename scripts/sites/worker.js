const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request)

    if (response.status !== 404 || !acceptsHtml(request)) {
      return response
    }

    const fallbackUrl = new URL('/index.html', request.url)
    return env.ASSETS.fetch(new Request(fallbackUrl, request))
  },
}

function acceptsHtml(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false
  }

  return request.headers.get('accept')?.includes('text/html') ?? false
}

export default worker
