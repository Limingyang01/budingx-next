export type OrderItem = { sku: string; price: number; qty: number }
export type Customer = { name: string; address?: { zip: string } }
export type Order = { id: string; items: OrderItem[]; customer: Customer }

export function totalFor(order: Order): number {
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0)
  const shipping = order.customer.address.zip.length === 5 ? 0 : 8
  return subtotal + shipping
}
