// TikTok OAuth callback. TikTok redirects the user here after they authorize
// the app on tiktok.com. We capture the ?code= param + optional state, then
// either:
//   - Render a small HTML page that POSTs the code back to the hub (preferred)
//   - Or show the code on screen so the operator can paste it manually
//
// Why this lives on Vercel and not the hub: the hub runs on localhost, which
// TikTok's redirect URI policy doesn't accept. Vercel gives us a real HTTPS
// endpoint TikTok accepts, and the operator pastes the code into the hub.

export default async function handler(req, res) {
  const code  = (req.query.code  || "").toString();
  const state = (req.query.state || "").toString();
  const error = (req.query.error || req.query.error_description || "").toString();

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");

  if (error) {
    return res.status(400).send(renderPage({
      title: "TikTok auth failed",
      message: `TikTok returned an error: <code>${escapeHtml(error)}</code>`,
      code:    null,
    }));
  }

  if (!code) {
    return res.status(400).send(renderPage({
      title: "Missing code",
      message: "TikTok didn't return an authorization code. Re-run the auth flow from the hub.",
      code:    null,
    }));
  }

  return res.status(200).send(renderPage({
    title:   "TikTok connected",
    message: "Paste this authorization code into the NullMade Hub:",
    code,
    state,
  }));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]
  ));
}

function renderPage({ title, message, code, state }) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${escapeHtml(title)} — NullMade</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body{background:#0a0a0a;color:#f5f0e6;font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;
       min-height:100vh;margin:0;display:flex;align-items:center;justify-content:center;padding:40px;}
  .wrap{max-width:600px;width:100%;}
  h1{font-size:28px;margin:0 0 8px;letter-spacing:-.4px;}
  p{color:#a3a3a3;font-size:15px;line-height:1.6;margin:0 0 24px;}
  .code-box{background:#141414;border:1px solid #262626;border-radius:12px;
            padding:18px 20px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
            font-size:13px;color:#f5f0e6;word-break:break-all;}
  .meta{margin-top:10px;color:#525252;font-size:12px;letter-spacing:.3px;}
  .copy-btn{display:inline-block;margin-top:14px;padding:9px 18px;background:#ff6b35;color:#0a0a0a;
            border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;
            letter-spacing:1px;text-transform:uppercase;}
  .copy-btn:hover{background:#ff8456;}
  .acc{color:#ff6b35;}
</style></head>
<body><div class="wrap">
  <h1>${escapeHtml(title)} <span class="acc">·</span> NullMade</h1>
  <p>${message}</p>
  ${code ? `
    <div class="code-box" id="codebox">${escapeHtml(code)}</div>
    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('codebox').innerText).then(()=>{this.textContent='Copied ✓';});">Copy code</button>
    ${state ? `<div class="meta">state: ${escapeHtml(state)}</div>` : ""}
    <p class="meta" style="margin-top:24px;">Then in the hub: paste this code into <code>/tiktok/auth/finish</code>.</p>
  ` : ""}
</div></body></html>`;
}
