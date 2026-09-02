export default async function checkout() {
  const response = await fetch("https://api.example.com/v1/orders/123");
  return response.json();
}
