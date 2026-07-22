# @framelab/babel-plugin

Babel plugin that tags JSX elements with `data-framelab-id` so the Framelab canvas can map clicks back to source. Optionally injects the click runtime (gated behind `NEXT_PUBLIC_FRAMELAB=true`).

Part of [Framelab](https://www.npmjs.com/package/framelab) — `npx framelab init` configures this for you.

```js
// babel.config.js
module.exports = {
  presets: ['next/babel'],
  plugins: [
    process.env.NODE_ENV === 'development' && '@framelab/babel-plugin',
  ].filter(Boolean),
};
```

MIT
