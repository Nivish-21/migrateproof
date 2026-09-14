export async function getCharge(): Promise<{ amount: number; currency: string }> {
  const response = await fetch("http://localhost/charge");
  return response.json() as Promise<{ amount: number; currency: string }>;
}
