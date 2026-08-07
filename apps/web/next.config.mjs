/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared workspace package from source.
  transpilePackages: ["@visora/shared"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "res.cloudinary.com" },
      { protocol: "https", hostname: "**.amazonaws.com" },
    ],
  },
};

export default nextConfig;
