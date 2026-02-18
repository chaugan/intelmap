import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import config from '../config.js';
import { getSystemPrompt } from '../ai/system-prompt.js';
import { tools } from '../ai/tools.js';
import { executeTool } from '../ai/executor.js';
import { buildContext } from '../ai/context.js';

const router = Router();

router.post('/chat', async (req, res) => {
  if (!config.anthropicApiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  const anthropic = new Anthropic({ apiKey: config.anthropicApiKey });
  const { messages, viewport, screenshot } = req.body;
  const io = req.app.get('io');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const context = buildContext(viewport);
    const systemPrompt = getSystemPrompt() + '\n\n' + context;

    // Build message list, converting to Claude format
    const claudeMessages = messages.map((m, i) => {
      // Attach screenshot to the last user message
      if (i === messages.length - 1 && m.role === 'user' && screenshot) {
        const content = [{ type: 'text', text: m.content }];
        // Strip data URL prefix to get raw base64
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

    while (continueLoop) {
      const stream = anthropic.messages.stream({
        model: config.claudeModel,
        max_tokens: 16384,
        system: systemPrompt,
        tools,
        messages: conversationMessages,
      });

      // Stream text deltas to the client as they arrive
      stream.on('text', (text) => {
        res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
      });

      // Wait for the complete message
      const message = await stream.finalMessage();

      // Continue loop if there are tool_use blocks
      const hasToolUse = message.content.some(b => b.type === 'tool_use');
      if (hasToolUse) {
        const toolUseBlocks = message.content.filter(b => b.type === 'tool_use');

        // Add the full assistant message (text + tool_use blocks) to conversation
        conversationMessages.push({ role: 'assistant', content: message.content });

        // Execute each tool and collect results
        const toolResults = [];
        for (const block of toolUseBlocks) {
          try {
            const result = await executeTool(block.name, block.input, io);
            res.write(`data: ${JSON.stringify({ type: 'tool', name: block.name, result })}\n\n`);
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

        // Add tool results as a user message and continue the loop
        conversationMessages.push({ role: 'user', content: toolResults });
      } else {
        continueLoop = false;
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`);
    res.end();
  }
});

export default router;
