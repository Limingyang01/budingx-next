export function formatMoney(value: number): string {
  return value.toFixed(2).replace(/(\d)(?=(\d{3})+\.\d{2}$)/g, '$1,')
}
