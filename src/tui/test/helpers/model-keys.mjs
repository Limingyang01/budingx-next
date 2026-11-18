export async function openModels(ui) {
  await ui.send('/models')
  await ui.send('\r')
}

export async function addCustomModel(ui, { label, baseUrl, model, key = '', use = false }) {
  await openModels(ui)
  await ui.send('n')
  await ui.send('\x1b[F')
  await ui.send('\r')
  await ui.send(baseUrl)
  await ui.send('\r')
  await ui.send(model)
  await ui.send('\r')
  if (label) await ui.send(label)
  await ui.send('\r')
  if (key) await ui.send(key)
  for (let i = 0; i < (use ? 6 : 5); i++) await ui.send('\t')
  await ui.send('\r')
  if (!use) await ui.send('\x1b')
}
