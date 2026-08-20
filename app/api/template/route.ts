import { buildTemplate } from '@/lib/excel/template'

export const runtime = 'nodejs'

export async function GET() {
  const buffer = await buildTemplate()
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="product-sheet-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
