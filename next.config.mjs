/** @type {import('next').NextConfig} */
export default {
  // Native, wasm, or file-reading at runtime — all must stay unbundled.
  // pdfkit in particular loads .afm font metrics by relative path, and bundling
  // rewrites that path to somewhere that does not exist.
  serverExternalPackages: ['@resvg/resvg-js', 'exceljs', 'pdfkit', 'sharp', 'harfbuzzjs'],
  experimental: {
    // Uploads are whole product catalogues with embedded images.
    serverActions: { bodySizeLimit: '50mb' },
  },
}
