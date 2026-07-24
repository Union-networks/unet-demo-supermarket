/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/unet/domain-admin/issue': [
      './server-assets/barretenberg-threads.wasm.gz',
    ],
  },
};

export default nextConfig;
