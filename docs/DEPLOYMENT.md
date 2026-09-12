# Production Deployment

## 1. Cloudflare control plane

Prerequisites: Cloudflare account, Node.js, Wrangler authenticated.

```bash
npm install
./scripts/bootstrap-cloudflare.sh
```

Copy the returned D1 `database_id` into `wrangler.toml`.

Set Worker secrets:

- `ADMIN_PASSWORD`
- `SESSION_SECRET` — long random value
- `BRIDGE_URL` — HTTPS URL that securely reaches the VPS bridge
- `BRIDGE_TOKEN` — independent random secret
- `CALLBACK_TOKEN` — independent random secret

Then:

```bash
npm run db:migrate
npm run check
npm run deploy
```

## 2. Hermes VPS

Verify one-shot mode:

```bash
hermes -z "ตอบว่า AGIS ONLINE"
```

Install Telegram Gateway as a boot service:

```bash
sudo hermes gateway install --system
sudo hermes gateway start --system
sudo hermes gateway status --system
```

Restrict Telegram access with numeric user IDs.

## 3. AGIS bridge

Copy `bridge/bridge.env.example` to `bridge/bridge.env`, fill secrets, and never commit it.

The bridge binds to `127.0.0.1` by default. Put it behind a secure HTTPS tunnel/reverse proxy; do not expose it raw.

Replace placeholders in `bridge/agis-bridge.service`, then:

```bash
sudo cp bridge/agis-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now agis-bridge
sudo systemctl status agis-bridge
```

## 4. Operational checks

- `/health` returns 200.
- Mission Control login succeeds.
- Bridge heartbeat reports online.
- Queue a harmless task.
- Task transitions `queued → dispatching → running → completed`.
- Reboot the VPS and verify Hermes Gateway + bridge return automatically.

## 5. Production write policy

Web-dispatched Hermes runs use `--safe-mode`.
Do not remove safe mode until a separate approval workflow exists.
Newly cloned repos/agents remain sandbox/experimental until reviewed.
