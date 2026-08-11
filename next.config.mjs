import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this folder. Without it Next walks up and finds
  // the unrelated package.json in the parent voncierge/ directory.
  outputFileTracingRoot: here,
};

export default nextConfig;
