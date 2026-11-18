export const FINAL_ITERATION = 'SP016'

export function isPlannedIteration(iteration) {
  return /^SP\d{3}$/.test(iteration) && iteration >= 'SP001' && iteration <= FINAL_ITERATION
}
