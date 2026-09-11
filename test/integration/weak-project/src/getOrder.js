export async function getOrder() {
  const response = await fetch("https://api.example.com/orders/123");
  return response.json();
}
