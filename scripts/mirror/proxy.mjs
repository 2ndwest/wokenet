import http from 'node:http';

export function loopbackOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.origin !== value || url.username || url.password) throw Error('Pi target must be an exact HTTP loopback origin.');
  return url;
}

export function cameraReadPath(path) {
  return /^\/(?:healthz|api\/(?:status|diagnostics|frames|live|frame\/\d{10}-\d{4}_[1-9]\d{0,12}))(?:\?[^#]*)?$/.test(path);
}

export function mirrorMiddleware({target, authorization, mirrorOrigin}) {
  const upstream = loopbackOrigin(target);
  return (req, res, next) => {
    if (!req.url?.startsWith('/camera-api')) return next();
    const path = req.url.slice('/camera-api'.length);
    const host = new URL(mirrorOrigin).host;
    const origin = req.headers.origin;
    if (req.headers.host !== host || (origin && origin !== mirrorOrigin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
      res.writeHead(403, {'Cache-Control':'no-store'}); res.end('Local mirror requests only.'); return;
    }
    if (req.method !== 'GET' || !cameraReadPath(path)) {
      res.writeHead(405, {'Allow':'GET','Cache-Control':'no-store'}); res.end('Read-only camera mirror.'); return;
    }
    const request = http.request(new URL(path, upstream), {
      method:'GET', headers:{Authorization:authorization, Accept:'*/*'}, timeout:20000,
    }, response => {
      const status = response.statusCode ?? 502;
      // Never forward a login challenge or redirect to the preview browser.
      if (status === 401 || status === 403 || status >= 300 && status < 400) {
        response.resume();res.writeHead(503, {'Cache-Control':'no-store'});res.end('Pi review login unavailable.');return;
      }
      const headers = {'Cache-Control':'no-store, private', 'Cross-Origin-Resource-Policy':'same-origin',
        'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
      for (const key of ['content-type','x-frame-id','x-frame-timestamp','x-live-state']) {
        if (response.headers[key]) headers[key] = response.headers[key];
      }
      res.writeHead(status, headers);
      let bytes=0;
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>2_000_000){request.destroy();res.destroy();}else res.write(chunk);});
      response.on('end',()=>res.end());
      response.on('error',()=>res.destroy());
    });
    const unavailable = () => {if(!res.headersSent)res.writeHead(502,{'Cache-Control':'no-store'});if(!res.destroyed)res.end('Pi connection unavailable; reconnecting.');};
    request.on('timeout',()=>request.destroy());request.on('error',unavailable);
    res.on('close',()=>request.destroy());request.end();
  };
}
