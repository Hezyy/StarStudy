import type { NextConfig } from 'next';
const cloudKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
let secret = cloudKey.startsWith('sb_secret_');
if (cloudKey.split('.').length === 3) {
  try {
    secret ||=
      JSON.parse(Buffer.from(cloudKey.split('.')[1], 'base64url').toString()).role ===
      'service_role';
  } catch {}
}
if (secret) throw new Error('禁止将Supabase secret/service_role密钥放入NEXT_PUBLIC环境变量');
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
};
export default config;
