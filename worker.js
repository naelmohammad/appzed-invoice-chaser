/**
 * AppZed invoice-chaser (managed=true). Register invoices, list overdue,
 * AI-draft escalating reminders. Daily cron chases what is overdue.
 * Bindings: AI, DB (d1).
 */
const SCHEMA = "CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, client TEXT, amount REAL, due_date TEXT, status TEXT DEFAULT 'unpaid', reminders INTEGER DEFAULT 0, last_reminder TEXT, created_at TEXT DEFAULT (datetime('now')))";
const MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, solution: "invoice-chaser" });
    }
    if (request.method === "GET" && url.pathname === "/schema") {
      return new Response(SCHEMA, { headers: { "content-type": "text/plain" } });
    }
    if (request.method === "POST" && url.pathname === "/invoices") {
      const body = await request.json().catch(() => null);
      if (!body || !body.client || body.amount === undefined || !body.due_date) {
        return bad("client, amount, and due_date (YYYY-MM-DD) are required.");
      }
      const id = crypto.randomUUID();
      await env.DB.exec(SCHEMA);
      await env.DB.prepare(
        "INSERT INTO invoices (id, client, amount, due_date) VALUES (?, ?, ?, ?)"
      ).bind(id, body.client, Number(body.amount), body.due_date).run();
      return Response.json({ id, status: "unpaid" }, { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/overdue") {
      await env.DB.exec(SCHEMA);
      const rows = await env.DB.prepare(
        "SELECT *, CAST(julianday('now') - julianday(due_date) AS INTEGER) AS days_overdue FROM invoices WHERE status = 'unpaid' AND due_date < date('now') ORDER BY due_date ASC"
      ).all();
      return Response.json({ overdue: rows.results || [] });
    }
    const remind = url.pathname.match(/^\/remind\/([^/]+)$/);
    if (request.method === "POST" && remind) {
      const inv = await env.DB.prepare("SELECT *, CAST(julianday('now') - julianday(due_date) AS INTEGER) AS days_overdue FROM invoices WHERE id = ?").bind(remind[1]).first();
      if (!inv) return Response.json({ error: "not found" }, { status: 404 });
      const text = await draftReminder(env, inv);
      await env.DB.prepare(
        "UPDATE invoices SET reminders = reminders + 1, last_reminder = datetime('now') WHERE id = ?"
      ).bind(remind[1]).run();
      return Response.json({ id: remind[1], days_overdue: inv.days_overdue, reminder: text });
    }
    const paid = url.pathname.match(/^\/paid\/([^/]+)$/);
    if (request.method === "POST" && paid) {
      const result = await env.DB.prepare("UPDATE invoices SET status = 'paid' WHERE id = ?").bind(paid[1]).run();
      if ((result.meta.changes || 0) === 0) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ id: paid[1], status: "paid" });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env) {
    await env.DB.exec(SCHEMA);
    const rows = await env.DB.prepare(
      "SELECT *, CAST(julianday('now') - julianday(due_date) AS INTEGER) AS days_overdue FROM invoices WHERE status = 'unpaid' AND due_date < date('now')"
    ).all();
    const chased = [];
    for (const inv of rows.results || []) {
      const text = await draftReminder(env, inv);
      await env.DB.prepare(
        "UPDATE invoices SET reminders = reminders + 1, last_reminder = datetime('now') WHERE id = ?"
      ).bind(inv.id).run();
      chased.push({ id: inv.id, client: inv.client, days_overdue: inv.days_overdue, reminder: text });
    }
    return Response.json({ chased });
  },
};

async function draftReminder(env, inv) {
  const tone = inv.days_overdue > 30 ? "firm final notice" : inv.days_overdue > 14 ? "direct follow-up" : "polite first reminder";
  const out = await env.AI.run(MODEL, {
    messages: [
      { role: "system", content: `Write a short ${tone} email for an overdue invoice. Plain text, no placeholders except the ones given.` },
      { role: "user", content: `Client: ${inv.client}. Amount: ${inv.amount}. Due: ${inv.due_date} (${inv.days_overdue} days overdue). Previous reminders: ${inv.reminders}.` },
    ],
    max_tokens: 256,
  });
  return out.response || "";
}

function bad(message) {
  return Response.json({ error: message }, { status: 400 });
}
