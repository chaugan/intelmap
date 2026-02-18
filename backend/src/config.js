export default {
  port: process.env.PORT || 3001,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929',
  dataDir: process.env.DATA_DIR || './data',
  metUserAgent: 'IntelMap/1.0 github.com/intelmap',
};
