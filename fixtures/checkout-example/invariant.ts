export default (result: {
  total: number;
  lineItems: { price: number }[];
  tax: number;
}) => {
  const sumLineItems = result.lineItems.reduce(
    (sum, item) => sum + item.price,
    0,
  );
  return result.total === sumLineItems + result.tax;
};
