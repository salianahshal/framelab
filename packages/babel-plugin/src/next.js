'use strict';

// next.config wrapper.
//
// The Babel plugin tags JSX everywhere, server components included, but the
// click runtime has to reach the browser, and until Next.js 16.3 the only
// place to put it was `pages/_app` — a file App Router projects don't have.
// That, not the tagging, is why App Router apps rendered in the canvas and
// nothing responded.
//
// `instrumentationClientInject` (Next.js 16.3+) is a list of modules imported
// on the client for their side effects, before hydration, in both routers.
// The Next.js docs describe it as "primarily intended for next.config.js
// plugins ... without requiring every project to author or modify an
// instrumentation-client file", which is exactly this.
//
//   const { withFramelab } = require('@framelab/babel-plugin/next');
//   module.exports = withFramelab({ /* your config */ });

const CLIENT_MODULE = '@framelab/babel-plugin/client';

function enabled(options) {
  if (options && typeof options.enabled === 'boolean') return options.enabled;
  // Same gate as the Babel plugin: dev only, and only when the canvas is
  // meant to attach. A production build carries none of this.
  return process.env.NODE_ENV !== 'production'
    && process.env.NEXT_PUBLIC_FRAMELAB === 'true';
}

/**
 * Add Framelab's client runtime to a Next.js config.
 *
 * Appends rather than replaces, so it composes with other config wrappers
 * (withSentry and friends) in any order, and is a no-op when it is already
 * present or when Framelab is switched off.
 */
function withFramelab(nextConfig = {}, options = {}) {
  if (!enabled(options)) return nextConfig;

  const existing = nextConfig.instrumentationClientInject || [];
  const list = Array.isArray(existing) ? existing : [existing];
  if (list.includes(CLIENT_MODULE)) return nextConfig;

  return {
    ...nextConfig,
    instrumentationClientInject: [...list, CLIENT_MODULE],
  };
}

module.exports = withFramelab;
module.exports.withFramelab = withFramelab;
module.exports.CLIENT_MODULE = CLIENT_MODULE;
