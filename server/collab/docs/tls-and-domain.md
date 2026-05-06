# TLS and custom domains for the collab server

Three deployment scenarios, in order of operational simplicity.

## 1. App Runner with the auto-issued domain (simplest)

When you create the App Runner service, AWS gives you a URL like:

```
https://abcd1234.us-east-1.awsapprunner.com
```

App Runner terminates TLS at the load balancer using a wildcard cert it
manages. WebSockets work over `wss://` immediately, no configuration.

Wire the studio:

```
VITE_YJS_WS_URL=wss://abcd1234.us-east-1.awsapprunner.com
```

That's it.

## 2. App Runner with a custom domain (recommended for prod)

Use a subdomain like `collab.percy.app` for clarity in logs and to
decouple the studio's deploy from the collab server's URL.

### Steps

1. **Add a custom domain in App Runner**:

   ```bash
   aws apprunner associate-custom-domain \
     --service-arn <collab-service-arn> \
     --domain-name collab.percy.app
   ```

   AWS prints DNS records for domain validation + a target CNAME for the
   service.

2. **Add the records to your DNS provider** (Route 53, Cloudflare, etc.):

   ```
   _amazonses.collab.percy.app  CNAME  <validation-target>
   collab.percy.app             CNAME  <apprunner-target>.awsapprunner.com
   ```

3. **Wait for validation** (usually 1–5 minutes). App Runner provisions
   an ACM cert automatically.

4. **Wire the studio**:

   ```
   VITE_YJS_WS_URL=wss://collab.percy.app
   ```

5. **CSP**: add the domain to the studio's connect-src directive (and your
   FastAPI service's, if it serves CSP headers):

   ```
   connect-src 'self' wss://collab.percy.app https://collab.percy.app;
   ```

### Cost

- App Runner: per-vCPU + per-GB-RAM-hour (no extra for custom domains)
- Route 53 hosted zone: $0.50/mo
- ACM cert: free (managed)

## 3. Self-host with Caddy (no AWS)

For a single VPS or non-AWS environment. Caddy auto-issues Let's Encrypt
certs and handles WebSocket proxy in one config file.

```bash
# Run the collab server bound to localhost only
cd server/collab
npm ci --omit=dev
PORT=1234 HOST=127.0.0.1 node server.js &

# Install Caddy (Debian/Ubuntu)
sudo apt install -y caddy

# /etc/caddy/Caddyfile
sudo tee /etc/caddy/Caddyfile <<'EOF'
collab.percy.app {
    reverse_proxy 127.0.0.1:1234
    # Caddy proxies WebSocket upgrades by default; no extra config needed.
    # Cert is auto-issued from Let's Encrypt on first request.
}
EOF
sudo systemctl reload caddy
```

That's the entire TLS configuration. Caddy renews the cert automatically.

## 4. nginx alternative (if Caddy isn't an option)

```nginx
server {
    listen 443 ssl http2;
    server_name collab.percy.app;

    ssl_certificate     /etc/letsencrypt/live/collab.percy.app/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/collab.percy.app/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # WebSocket-friendly proxying
    location / {
        proxy_pass http://127.0.0.1:1234;

        # Required headers for WS upgrade
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long-lived connections — match your read timeout to keepalives.
        # Default Yjs ping interval is 30s; the collab server pings every 30s
        # too. Allow at least 2x that.
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
    }
}

# Redirect plain HTTP to HTTPS
server {
    listen 80;
    server_name collab.percy.app;
    return 301 https://$host$request_uri;
}
```

Use `certbot --nginx -d collab.percy.app` to issue + auto-renew the cert.

## A note on cookies and CORS

The collab server reads the `percy_session` JWT from either the `Cookie`
header or a `?token=` query param. For browser WebSocket connections,
cookies are sent automatically *if* the WS URL is on the same registrable
domain as the cookie's `Domain` attribute, OR cross-site with `SameSite=None`.

Recommended setup:

| FastAPI service | Collab server | Cookie domain | Works? |
|---|---|---|---|
| `app.percy.app` | `collab.percy.app` | `.percy.app` (suffix-set) | ✅ shared cookie |
| `app.percy.app` | `collab.percy.app` | `app.percy.app` (host-only) | ❌ — set Domain to `.percy.app` |
| `runner-1.awsapprunner.com` | `runner-2.awsapprunner.com` | (any) | ❌ — cross-site, cookie doesn't follow. Use `?token=` instead. |

For the third row (different App Runner runtime URLs), modify the studio's
`useStudioCollab` hook to append `?token=<jwt>` to the WS URL — the server
already accepts that path.

## Quick verification

Once TLS is up, confirm the connection from the studio's browser DevTools:

1. Open the studio.
2. Network tab → filter "WS".
3. You should see `wss://collab.percy.app/<docId>::slide-N` with status 101.
4. Frames tab shows binary Yjs traffic.

If it's stuck on `Pending` or fails with 1006, check:

- Cert is valid (`openssl s_client -connect collab.percy.app:443`)
- Cookies are flowing (Network → Headers → Cookie)
- App Runner / proxy isn't terminating long connections too eagerly
