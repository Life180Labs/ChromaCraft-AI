/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@imgly/background-removal-node', 'sharp'],
  reactStrictMode: true,

};
module.exports = nextConfig;