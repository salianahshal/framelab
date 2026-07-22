'use strict';

// Reads the project's own tailwind.config.{js,cjs,mjs}, runs resolveConfig
// (using the project's own tailwindcss install), and extracts the design
// tokens the inspector cares about: colors, spacing, fontSize, borderRadius,
// fontWeight. The point is to show *the user's* design system in the
// swatches/dropdowns rather than a generic Tailwind palette.
//
// TS configs (tailwind.config.ts) aren't supported yet — they need an on-the-fly
// TS loader (jiti / esbuild). For now we detect them and fall back.

const fs = require('fs');
const path = require('path');
const Module = require('module');

const CONFIG_CANDIDATES = [
  // Prefer .ts first since modern Next.js / shadcn scaffolds default to it.
  'tailwind.config.ts',
  'tailwind.config.cts',
  'tailwind.config.mts',
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
];

function findConfigFile(rootDir) {
  for (const name of CONFIG_CANDIDATES) {
    const full = path.join(rootDir, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function projectRequire(rootDir) {
  return Module.createRequire(path.join(rootDir, 'package.json'));
}

function loadResolveConfig(rootDir) {
  try {
    return projectRequire(rootDir)('tailwindcss/resolveConfig');
  } catch {
    return null;
  }
}

function loadDefaultColors(rootDir) {
  try {
    return projectRequire(rootDir)('tailwindcss/colors');
  } catch {
    return null;
  }
}

function bustRequireCache(filePath) {
  try {
    const resolved = require.resolve(filePath);
    delete require.cache[resolved];
  } catch {}
}

// jiti is small (~50KB) and handles TS / ESM-import-syntax-in-CJS configs,
// which Tailwind itself uses internally for its loadConfig. We create a fresh
// instance per load so config edits are always picked up — no stale cache.
function createJitiLoader() {
  try {
    const factory = require('jiti');
    return factory(__filename, {
      interopDefault: true,
      esmResolve: true,
      requireCache: false,
    });
  } catch (err) {
    return null;
  }
}

async function loadUserConfig(configFile) {
  if (configFile.endsWith('.ts') || configFile.endsWith('.mts') || configFile.endsWith('.cts')) {
    const jiti = createJitiLoader();
    if (!jiti) {
      const e = new Error('ts-config-needs-jiti');
      e.code = 'NO_JITI';
      throw e;
    }
    const mod = jiti(configFile);
    return mod && mod.default ? mod.default : mod;
  }
  if (configFile.endsWith('.mjs')) {
    // dynamic import with cache-busting query so file changes are picked up
    const url = 'file://' + configFile + '?t=' + Date.now();
    const mod = await import(url);
    return mod.default || mod;
  }
  bustRequireCache(configFile);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(configFile);
}

function flattenColors(obj, prefix = []) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      out.push({ name: [...prefix, key].join('-'), value });
    } else if (value && typeof value === 'object') {
      // DEFAULT means the bare class name (e.g. `bg-brand`) takes this value
      if (typeof value.DEFAULT === 'string') {
        out.push({ name: [...prefix, key].join('-'), value: value.DEFAULT });
      }
      for (const [k, v] of Object.entries(value)) {
        if (k === 'DEFAULT') continue;
        if (typeof v === 'string') {
          out.push({ name: [...prefix, key, k].join('-'), value: v });
        } else if (v && typeof v === 'object') {
          out.push(...flattenColors({ [k]: v }, [...prefix, key]));
        }
      }
    }
  }
  return out;
}

function spacingSort(a, b) {
  const an = parseFloat(a);
  const bn = parseFloat(b);
  const aNum = !Number.isNaN(an);
  const bNum = !Number.isNaN(bn);
  if (aNum && bNum) return an - bn;
  if (aNum) return 1;
  if (bNum) return -1;
  return String(a).localeCompare(String(b));
}

const DEFAULT_KEYS = {
  spacing: [
    'px', '0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4',
    '5', '6', '7', '8', '9', '10', '11', '12', '14', '16', '20',
    '24', '28', '32', '36', '40', '44', '48', '52', '56', '60',
    '64', '72', '80', '96',
  ],
  fontSize: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'],
  borderRadius: ['none', 'sm', 'DEFAULT', 'md', 'lg', 'xl', '2xl', '3xl', 'full'],
  boxShadow: ['DEFAULT', 'sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none'],
  fontWeight: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
};

function partitionKeys(keys, defaultKeys) {
  const dset = new Set(defaultKeys);
  const all = [...keys];
  const custom = [];
  const defaults = [];
  for (const k of keys) (dset.has(k) ? defaults : custom).push(k);
  return { all, custom, defaults };
}

function extractTokens(theme, defaultColorKeys) {
  const allColors = flattenColors(theme.colors || {});
  const customColors = [];
  const defaultColors = [];
  const defaultSet = new Set(defaultColorKeys || []);
  for (const c of allColors) {
    const top = c.name.split('-')[0];
    if (defaultSet.has(top)) defaultColors.push(c);
    else customColors.push(c);
  }

  const spacingKeys = Object.keys(theme.spacing || {}).sort(spacingSort);

  return {
    colors: { all: allColors, custom: customColors, defaults: defaultColors },
    spacing: partitionKeys(spacingKeys, DEFAULT_KEYS.spacing),
    fontSize: partitionKeys(Object.keys(theme.fontSize || {}), DEFAULT_KEYS.fontSize),
    borderRadius: partitionKeys(Object.keys(theme.borderRadius || {}), DEFAULT_KEYS.borderRadius),
    boxShadow: partitionKeys(Object.keys(theme.boxShadow || {}), DEFAULT_KEYS.boxShadow),
    fontWeight: partitionKeys(Object.keys(theme.fontWeight || {}), DEFAULT_KEYS.fontWeight),
  };
}

async function loadTheme(rootDir) {
  const configFile = findConfigFile(rootDir);
  if (!configFile) {
    return { found: false, configFile: null, tokens: null, reason: 'no-config' };
  }

  const resolveConfig = loadResolveConfig(rootDir);
  if (!resolveConfig) {
    return {
      found: true,
      configFile,
      tokens: null,
      reason: 'tailwindcss-not-installed',
    };
  }
  const defaultColors = loadDefaultColors(rootDir);
  const defaultColorKeys = defaultColors ? Object.keys(defaultColors) : [];

  try {
    const userConfig = await loadUserConfig(configFile);
    const full = resolveConfig(userConfig);
    const tokens = extractTokens(full.theme, defaultColorKeys);
    return { found: true, configFile, tokens };
  } catch (err) {
    return {
      found: true,
      configFile,
      tokens: null,
      reason: 'config-load-error',
      error: err.message,
    };
  }
}

module.exports = {
  loadTheme,
  loadUserConfig,
  findConfigFile,
  extractTokens,
  flattenColors,
  CONFIG_CANDIDATES,
};
