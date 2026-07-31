import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* The wordmark is above the fold, so this one face is worth preloading. */}
        <link
          rel="preload"
          as="font"
          type="font/woff2"
          href="/fonts/chakra-petch-600.woff2"
          crossOrigin="anonymous"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
