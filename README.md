# AppZed Invoice Chaser Agent

Watches for overdue invoices and drafts polite, escalating reminders until they are paid. A daily 9am cron chases whatever is overdue. Schema self-initializes.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/naelmohammad/appzed-invoice-chaser)

Click **Deploy to Cloudflare**: it clones this repo to your GitHub account, provisions the bindings below on your Cloudflare account, and wires CI/CD with preview URLs on every PR.

## Bindings (auto-provisioned)

```jsonc
{
  "name": "appzed-invoice-chaser",
  "ai": {
    "binding": "AI"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "appzed-invoice-chaser-meta"
    }
  ],
  "triggers": {
    "crons": ["0 9 * * *"]
  }
}
```

## Try it

```bash
curl -X POST https://<your-worker>.workers.dev/invoices \
  -H 'content-type: application/json' \
  -d '{"client":"Acme Co","amount":1200,"due_date":"2026-10-01"}'

curl https://<your-worker>.workers.dev/overdue
```

GET /health for a liveness check. Managed by AppZed (https://dev.appzed.com/solutions/invoice-chaser).
