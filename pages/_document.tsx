//pages/_document.tsx
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Neutral by design: nothing here names the ERRs. The name and icon a phone shows on its home screen
            can be changed in My account (lib/appLook.ts updates these tags). */}
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#000000" />
        <meta name="description" content="A simple calculator." />
        <meta name="application-name" content="Calculator" />
        <meta name="apple-mobile-web-app-title" content="Calculator" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/icons/disguise/calculator-180.png" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
