/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: {
    '/api/unet/domain-admin/issue': [
      './server-assets/barretenberg-threads.wasm.gz',
    ],
  },
};

export default nextConfig;
