// Mock billing portal, mirroring server.ts.
export async function POST() {
  return Response.json({ url: `/dashboard?portal=success` });
}
