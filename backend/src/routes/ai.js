import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import config, { getAnthropicApiKey } from '../config.js';
import { getSystemPrompt, getSystemPromptById, getAvailablePrompts } from '../ai/system-prompt.js';
import { tools } from '../ai/tools.js';
import { executeTool } from '../ai/executor.js';
import { buildContext } from '../ai/context.js';
import { requireAuth } from '../auth/middleware.js';
import { canMutateProject, getProjectRole } from '../auth/project-access.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(__dirname, '..', 'ai', 'worker.mjs');

const router = Router();

router.get('/status', requireAuth, (req, res) => {
  const hasKey = !!getAnthropicApiKey();
  res.json({
    hasKey,
    model: config.claudeModel,
    prompts: getAvailablePrompts(),
  });
});

// Run Anthropic streaming in a child process to avoid HTTPS
// streaming stalls inside the main Express event loop.
function runAnthropicStream(apiKey, body, onEvent) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [WORKER_PATH], { stdio: ['pipe', 'pipe', 'pipe'] });

    child.stdin.write(JSON.stringify({ apiKey, body }));
    child.stdin.end();

    let lineBuf = '';
    const content = [];

    child.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        let event;
        try { event = JSON.parse(line); } catch { continue; }

        if (event.type === '_done') continue;
        if (event.type === 'error') {
          reject(new Error(event.error));
          return;
        }

        if (event.type === 'content_block_start') {
          content.push({ ...event.content_block, _text: '' });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            onEvent({ type: 'text', content: event.delta.text });
            const block = content[event.index];
            if (block) block._text += event.delta.text;
          } else if (event.delta.type === 'input_json_delta') {
            const block = content[event.index];
            if (block) block._text += event.delta.partial_json;
          }
        } else if (event.type === 'message_stop') {
          for (const block of content) {
            if (block.type === 'tool_use') {
              try { block.input = JSON.parse(block._text); } catch { block.input = {}; }
            } else if (block.type === 'text') {
              block.text = block._text;
            }
            delete block._text;
          }
        }
      }
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });

    child.on('close', (code) => {
      if (code !== 0 && content.length === 0) {
        reject(new Error(stderr || `Worker exited with code ${code}`));
      } else {
        resolve(content);
      }
    });

    child.on('error', reject);
  });
}

router.post('/chat', requireAuth, async (req, res) => {
  if (!req.user?.aiChatEnabled) {
    return res.status(403).json({ error: 'AI chat not enabled for your account' });
  }

  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const { messages, viewport, screenshot, projectId, promptId } = req.body;
  const io = req.app.get('io');

  if (projectId) {
    const role = getProjectRole(req.user.id, projectId);
    if (!role) {
      return res.status(403).json({ error: 'No access to this project' });
    }
    if (!canMutateProject(req.user.id, projectId)) {
      return res.status(403).json({ error: 'Editor access required to modify project via AI' });
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Use res.on('close') not req.on('close') — the request body is already
  // consumed by express.json(), so req 'close' fires immediately.
  let aborted = false;
  res.on('close', () => { aborted = true; });

  try {
    const context = buildContext(viewport, projectId);
    const basePrompt = getSystemPromptById(promptId) || getSystemPrompt();
    const systemPrompt = basePrompt + '\n\n' + context;

    const claudeMessages = messages.map((m, i) => {
      if (i === messages.length - 1 && m.role === 'user' && screenshot) {
        const content = [{ type: 'text', text: m.content }];
        const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
        const mediaType = screenshot.match(/^data:(image\/\w+);/)?.[1] || 'image/jpeg';
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: base64Data },
        });
        return { role: 'user', content };
      }
      return { role: m.role, content: m.content };
    });

    let conversationMessages = [...claudeMessages];
    let continueLoop = true;

    while (continueLoop && !aborted) {
      const fullContent = await runAnthropicStream(
        apiKey,
        {
          model: config.claudeModel,
          max_tokens: 16384,
          system: systemPrompt,
          tools,
          messages: conversationMessages,
          stream: true,
        },
        (event) => {
          if (!aborted) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
          }
        }
      );

      if (aborted) break;

      const hasToolUse = fullContent.some(b => b.type === 'tool_use');
      if (hasToolUse) {
        const toolUseBlocks = fullContent.filter(b => b.type === 'tool_use');
        conversationMessages.push({ role: 'assistant', content: fullContent });

        const toolResults = [];
        for (const block of toolUseBlocks) {
          if (aborted) break;
          try {
            const result = await executeTool(block.name, block.input, io, projectId);
            if (!aborted) {
              res.write(`data: ${JSON.stringify({ type: 'tool', name: block.name, result })}\n\n`);
            }
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: true,
              content: JSON.stringify({ error: err.message }),
            });
          }
        }

        if (!aborted) {
          conversationMessages.push({ role: 'user', content: toolResults });
        }
      } else {
        continueLoop = false;
      }
    }

    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  } catch (err) {
    console.error('[AI] Error:', err.message);
    if (!aborted) {
      res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
      res.end();
    }
  }
});

export default router;
