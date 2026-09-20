import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'dogfood-2026',
    offline: true,
    message: 'Dogfood 2026 hackathon platform is running.',
    docs: '/api/docs',
    health: '/api/health',
    timestamp: new Date().toISOString(),
  })
}
