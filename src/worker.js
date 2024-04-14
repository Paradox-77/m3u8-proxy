// We support the GET, POST, HEAD, and OPTIONS methods from any origin,
// and accept the Content-Type header on requests. These headers must be
// present on all responses to all CORS requests. In practice, this means
// all responses to OPTIONS requests.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};
const PROXY_ENDPOINT = '/corsproxy/';

async function handleRequest(request) {
  const url = new URL(request.url);
  const queryString = url.search;
  let apiUrl = url.searchParams.get('destination');

  // Check if there's a '&' at the end of apiUrl, indicating additional headers
  // Split the query string into individual parameters
  let headers = {};
  if (queryString.includes('&')) {
    // Iterate over query parameters to extract headers
    const params = new URLSearchParams(queryString);
    params.forEach((value, key) => {
      if (key !== 'destination') {
        headers[key] = value;
      }
    });
    // Remove apiUrl from the query parameters
    url.searchParams.delete('destination');
  }

  // Rewrite request to point to API url. This also makes the request mutable
  // so we can add the correct Origin header to make the API server think
  // that this request isn't cross-site.
  request = new Request(apiUrl, request);

  for (const [key, value] of Object.entries(headers)) {
    request.headers.set(key, value);
  }

  const originalCookies = request.headers.get('Cookie');
  if (originalCookies) {
    request.headers.set('Cookie', originalCookies);
  }

  let response = await fetch(request);

  if (
    response.headers.get('Content-Type').includes('application/vnd.apple.mpegurl') ||
    response.headers.get('Content-Type').includes('text/vtt')
  ) {
    const contentType = response.headers.get('Content-Type').includes('text/vtt')
      ? 'text/vtt'
      : 'application/vnd.apple.mpegurl';

    let headersString = '';
    for (const [key, value] of Object.entries(headers)) {
      headersString += `&${key}=${encodeURIComponent(value)}`;
    }

    // Read the response body as an array buffer
    const arrayBuffer = await response.arrayBuffer();
    // Convert array buffer to string
    const playlistText = new TextDecoder().decode(arrayBuffer);
    // Modify each playlist URL
    const modifiedPlaylistText = playlistText
      .split('\n')
      .map((line) => {
        if (line.startsWith('http')) {
          // Add the proxy URL and referrer query parameter
          const modifiedURL = `${url.protocol}//${url.hostname}/corsproxy/?destination=${encodeURIComponent(
            line
          )}${headersString}`;
          return modifiedURL;
        } else if (line.endsWith('m3u8')) {
          const modifiedURL = `?destination=${encodeURIComponent(
            apiUrl.replace(/\/list[^/]+\.m3u8/, '')
          )}/${encodeURIComponent(line)}${headersString}`;
          return modifiedURL;
        }
        return line;
      })
      .join('\n');

    // Convert modified playlist text back to array buffer
    const modifiedArrayBuffer = new TextEncoder().encode(modifiedPlaylistText);
    // Pass along cookies from the proxied response to the original response
    const proxiedCookies = response.headers.get('Set-Cookie');
    // Recreate the response with modified playlist
    response = new Response(modifiedArrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*', // Set CORS header here
        Vary: 'Origin', // Add Vary header here
        ...(proxiedCookies && { 'Set-Cookie': proxiedCookies })
      }
    });
    return response;
  } else {
    response = new Response(response.body, response);
    // Set CORS headers
    response.headers.set('Access-Control-Allow-Origin', '*');
    // Append to/Add Vary header so browser will cache response correctly
    response.headers.append('Vary', 'Origin');
    // Pass along cookies from the proxied response to the original response
    const proxiedCookies = response.headers.get('Set-Cookie');
    if (proxiedCookies) {
      response.headers.set('Set-Cookie', proxiedCookies);
    }
    return response;
  }
}

function handleOptions(request) {
  // Make sure the necessary headers are present
  // for this to be a valid pre-flight request
  if (
    request.headers.get('Origin') !== null &&
    request.headers.get('Access-Control-Request-Method') !== null &&
    request.headers.get('Access-Control-Request-Headers') !== null
  ) {
    // Handle CORS pre-flight request.
    // If you want to check the requested method + headers
    // you can do that here.
    return new Response(null, {
      headers: corsHeaders
    });
  } else {
    // Handle standard OPTIONS request.
    // If you want to allow other HTTP Methods, you can do that here.
    return new Response(null, {
      headers: {
        Allow: 'GET, HEAD, POST, OPTIONS'
      }
    });
  }
}
addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.pathname.startsWith(PROXY_ENDPOINT)) {
    if (request.method === 'OPTIONS') {
      // Handle CORS preflight requests
      event.respondWith(handleOptions(request));
    } else if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'POST') {
      // Handle requests to the API server
      event.respondWith(handleRequest(request));
    } else {
      event.respondWith(
        new Response(null, {
          status: 405,
          statusText: 'Method Not Allowed'
        })
      );
    }
  } else {
    // Serve demo page
    event.respondWith(
      new Response(JSON.stringify({ message: 'Proxy is working as expected (v1.0.0)' }), {
        headers: { 'Content-Type': 'application/json;charset=UTF-8' }
      })
    );
  }
});
