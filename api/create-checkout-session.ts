// Mock checkout, mirroring server.ts: no real Stripe call yet.
export async function POST(request: Request) {
  const { priceId } = await request.json().catch(() => ({ priceId: undefined }));
  return Response.json({ url: `/dashboard?payment=success&price=${priceId}` });
}
