// Marketing images ship .avif + .webp siblings next to their .png/.jpg fallback
// (generated and committed via scripts/optimize-marketing-images.sh). These
// helpers derive the modern-format paths from a fallback path so <picture> can
// offer AVIF -> WebP -> original. <picture> picks a <source> by FORMAT SUPPORT,
// not by file existence, so every referenced image must have its siblings
// committed or capable browsers show a broken image.

/** `marketing/foo.jpg` -> `marketing/foo.avif`. */
export const avifSrc = (src: string): string => src.replace(/\.(png|jpe?g)$/i, '.avif');

/** `marketing/foo.jpg` -> `marketing/foo.webp`. */
export const webpSrc = (src: string): string => src.replace(/\.(png|jpe?g)$/i, '.webp');
