/** @type {import('next').NextConfig} */
const { i18n } = require('./next-i18next.config');
const path = require('path');
const fs = require('fs');

// Copy PDF worker to public directory
const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.js');
const workerDest = path.join(process.cwd(), 'public', 'pdf.worker.min.js');

// Ensure the worker file is copied
try {
  fs.copyFileSync(workerPath, workerDest);
} catch (err) {
  console.error('Error copying PDF worker:', err);
}

const nextConfig = {
    poweredByHeader: false, // don't announce "Next.js" in every response
    i18n: {
        ...i18n,
        defaultLocale: 'ar',
        locales: ['ar', 'en', 'es']
    },
    webpack: (config) => {
        config.resolve.alias.canvas = false
        return config
    },
    // Add rewrites to handle service worker
    async rewrites() {
        return [
            {
                source: '/sw.js',
                destination: '/_next/static/sw.js'
            }
        ];
    },
    async headers() {
        return [
            // Basic browser protections on every page and API route (audit M2, 26 Oct 2026).
            // The CSP only covers framing, plugins, <base> and form targets: it doesn't restrict
            // scripts or styles, so Next.js inline scripts and Google Fonts keep working.
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'same-origin' },
                    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
                    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
                    { key: 'X-DNS-Prefetch-Control', value: 'off' }
                ]
            },
            {
                source: '/sw.js',
                headers: [
                    {
                        key: 'Cache-Control',
                        value: 'no-cache, no-store, max-age=0'
                    },
                    {
                        key: 'Service-Worker-Allowed',
                        value: '/'
                    },
                    {
                        key: 'Content-Type',
                        value: 'application/javascript; charset=utf-8'
                    }
                ]
            }
        ];
    }
};

module.exports = nextConfig;

