interface Env {}

export default {
  async fetch(_request: Request, _env: Env): Promise<Response> {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>True Mutuals</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
      color: #111;
    }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 48px 56px;
      text-align: center;
      box-shadow: 0 2px 24px rgba(0,0,0,0.08);
      max-width: 480px;
    }
    h1 { font-size: 32px; margin: 0 0 12px; }
    p { color: #666; line-height: 1.6; margin: 0; }
    .tag {
      display: inline-block;
      background: #e8f5fe;
      color: #1d9bf0;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 20px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="tag">Coming soon</div>
    <h1>True Mutuals</h1>
    <p>See who your X followers have in common with anyone you want to meet.<br><br>App launching here shortly.</p>
  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<Env>;
