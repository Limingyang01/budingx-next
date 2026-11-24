export type Command = {
  name: string
  run: (args: string[]) => number
}

export const commands: Command[] = [
  {
    name: 'greet',
    run: (args: string[]) => {
      process.stdout.write('hello ' + (args[0] ?? 'world') + '\n')
      return 0
    }
  }
]

export function run(argv: string[]): number {
  const [name, ...rest] = argv
  const command = commands.find((item) => item.name === name)
  if (!command) {
    process.stderr.write('unknown command\n')
    return 2
  }
  return command.run(rest)
}
