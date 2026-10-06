import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '会計アプリ',
    short_name: '会計',
    description: '帳簿・決算書・申告の数字',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#285e4b',
    lang: 'ja',
    icons: [
      { src: '/icon', sizes: '512x512', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
