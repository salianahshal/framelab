'use strict';

const fs = require('fs');
const path = require('path');
const t = require('./term');
const { detectFramework, detectRouter } = require('./detect');

const BABEL_CONFIG = `module.exports = {
  presets: ['next/babel'],
  plugins: [
    process.env.NODE_ENV === 'development' && '@framelab/babel-plugin',
  ].filter(Boolean),
};
`;

async function init(args) {
  const cwd = process.cwd();
  if (!fs.existsSync(path.join(cwd, 'package.json'))) {
    t.err('No package.json in the current directory.');
    t.info('Run this from your Next.js project root.');
    process.exit(1);
  }

  const fw = detectFramework(cwd);
  if (fw.framework !== 'next') {
    t.err('Next.js not detected.');
    t.info('Framelab currently supports Next.js + Tailwind projects.');
    t.info(`(found: ${fw.framework || 'no React framework'} in package.json)`);
    process.exit(1);
  }
  t.ok(`Detected ${t.bold('Next.js ' + fw.version.replace(/^[^\d]+/, ''))}`);

  const router = detectRouter(cwd);
  if (router === 'pages') {
    t.ok('Pages Router detected');
  } else if (router === 'app') {
    t.warn('App Router detected — Framelab v0.1 is built for Pages Router.');
    t.info('Pages Router (next dev with babel) is fully supported.');
    t.info('App Router with React Server Components has caveats; the babel');
    t.info('plugin will tag client components but server components are skipped.');
  } else {
    t.warn('Could not find pages/ or app/ directory.');
  }

  // 1. babel.config.js
  const babelPath = path.join(cwd, 'babel.config.js');
  if (fs.existsSync(babelPath)) {
    const existing = fs.readFileSync(babelPath, 'utf8');
    if (existing.includes('@framelab/babel-plugin')) {
      t.ok('babel.config.js already includes @framelab/babel-plugin');
    } else {
      t.warn('babel.config.js exists — leaving it alone.');
      t.info('Add this line to your `plugins` array (gated on dev mode):');
      console.log();
      console.log('    ' + t.hl(`process.env.NODE_ENV === 'development' && '@framelab/babel-plugin',`));
      console.log();
    }
  } else if (fs.existsSync(path.join(cwd, '.babelrc')) || fs.existsSync(path.join(cwd, '.babelrc.js'))) {
    t.warn('Found .babelrc — Framelab writes babel.config.js for project-wide config.');
    t.info('Add @framelab/babel-plugin to your existing .babelrc plugins manually.');
  } else {
    fs.writeFileSync(babelPath, BABEL_CONFIG);
    t.ok('Wrote babel.config.js');
  }

  // 2. .env.development
  const envPath = path.join(cwd, '.env.development');
  let envBody = '';
  if (fs.existsSync(envPath)) envBody = fs.readFileSync(envPath, 'utf8');
  if (envBody.includes('NEXT_PUBLIC_FRAMELAB')) {
    t.ok('.env.development already has NEXT_PUBLIC_FRAMELAB');
  } else {
    const sep = (!envBody || envBody.endsWith('\n')) ? '' : '\n';
    fs.writeFileSync(envPath, envBody + sep + 'NEXT_PUBLIC_FRAMELAB=true\n');
    t.ok('Added NEXT_PUBLIC_FRAMELAB=true to .env.development');
  }

  // 3. Print next steps
  console.log();
  console.log(t.bold('Next steps:'));
  console.log();
  console.log('  ' + t.dim('1. Install the runtime dependencies:'));
  console.log('     ' + t.hl('npm install --save-dev @framelab/babel-plugin @babel/runtime'));
  console.log();
  console.log('  ' + t.dim('2. Start your dev server (in one terminal):'));
  console.log('     ' + t.hl('npm run dev'));
  console.log();
  console.log('  ' + t.dim('3. Start framelab (in another terminal):'));
  console.log('     ' + t.hl('npx framelab'));
  console.log();
  console.log(t.dim('  Tip: create .framelabrc.json to lock the app URL or ports per project.'));
  console.log();
}

module.exports = init;
