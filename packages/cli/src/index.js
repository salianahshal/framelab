'use strict';

const t = require('./term');

const COMMANDS = {
  init: () => require('./init'),
  start: () => require('./start'),
  mcp: () => require('./mcp'),
};

function printHelp() {
  console.log(`
${t.bold('framelab')} — visual editor for Next.js + Tailwind. Local-only.

${t.bold('Usage:')}
  ${t.hl('framelab')}                    Start the canvas (default)
  ${t.hl('framelab init')}               Set up the current project (writes babel.config.js, .env)
  ${t.hl('framelab start')}              Same as default
  ${t.hl('framelab mcp')}                MCP server (stdio) for Claude Code / Cursor / Continue
  ${t.hl('framelab help')}               Show this message

${t.bold('Options (for start):')}
  ${t.hl('--app-url <url>')}              Override dev server URL (default: auto-detect)
  ${t.hl('--port <n>')}                   Override canvas port (default: 3133)
  ${t.hl('--api-port <n>')}               Override API port (default: 3131)
  ${t.hl('--root <dir>')}                 Override watched directory (default: cwd)
  ${t.hl('--no-open')}                    Don't open the browser automatically

${t.bold('Per-project config:')} write ${t.hl('.framelabrc.json')} with any of those keys.
`);
}

async function run(args) {
  if (args.length === 0) {
    return COMMANDS.start()(args);
  }
  const cmd = args[0];
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    return;
  }
  // Subcommand
  if (COMMANDS[cmd]) {
    return COMMANDS[cmd]()(args.slice(1));
  }
  // Treat unknown args as start flags (so `framelab --port 4000` works)
  if (cmd.startsWith('-')) {
    return COMMANDS.start()(args);
  }
  t.err(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

module.exports = { run };
