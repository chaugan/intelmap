// AI streaming worker — runs as a separate process to avoid
// HTTPS streaming stalls inside the Express event loop.
// Receives request on stdin, writes SSE events to stdout.
import https from 'https';

let input = '';
process.stdin.on('data', (d) => { input += d; });
process.stdin.on('end', async () => {
  try {
    const { apiKey, body } = JSON.parse(input);
    const postData = JSON.stringify(body);

    const apiRes = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(postData),
        },
      }, resolve);
      req.on('error', reject);
      req.write(postData);
      req.end();
    });

    if (apiRes.statusCode !== 200) {
      let body = '';
      apiRes.on('data', (d) => { body += d; });
      apiRes.on('end', () => {
        process.stdout.write(JSON.stringify({ type: 'error', error: `API ${apiRes.statusCode}: ${body.slice(0, 200)}` }) + '\n');
        process.exit(1);
      });
      return;
    }

    let buffer = '';
    apiRes.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          // Forward relevant events as JSON lines to stdout
          process.stdout.write(JSON.stringify(event) + '\n');
        } catch {}
      }
    });

    apiRes.on('end', () => {
      process.stdout.write(JSON.stringify({ type: '_done' }) + '\n');
      process.exit(0);
    });

    apiRes.on('error', (err) => {
      process.stdout.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
      process.exit(1);
    });
  } catch (err) {
    process.stdout.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    process.exit(1);
  }
});
