// Multi line input buffer (SP002 design §3.6, AC TC-03).
// Self written: the editor is the largest hand written part of the TUI.
// The cursor column counts code points, so emoji and CJK never split.
export type Cursor = { line: number; col: number }

type Snapshot = { lines: string[]; cursor: Cursor }

const characters = (text: string): string[] => Array.from(text)

export class EditorBuffer {
  lines: string[] = ['']
  cursor: Cursor = { line: 0, col: 0 }
  history: string[] = []
  private undoStack: Snapshot[] = []
  private historyIndex = -1
  private draft = ''

  get text(): string {
    return this.lines.join('\n')
  }

  get isEmpty(): boolean {
    return this.text.trim() === ''
  }

  get isMultiline(): boolean {
    return this.lines.length > 1
  }

  setText(text: string): void {
    this.pushUndo()
    this.lines = text.split('\n')
    this.cursor = {
      line: this.lines.length - 1,
      col: characters(this.lines.at(-1) ?? '').length
    }
  }

  clear(): void {
    this.pushUndo()
    this.lines = ['']
    this.cursor = { line: 0, col: 0 }
  }

  insert(text: string): void {
    if (!text) return
    this.pushUndo()
    const parts = text.split('\n')
    const line = characters(this.lines[this.cursor.line])
    const head = line.slice(0, this.cursor.col).join('')
    const tail = line.slice(this.cursor.col).join('')
    if (parts.length === 1) {
      this.lines[this.cursor.line] = head + parts[0] + tail
      this.cursor.col += characters(parts[0]).length
      return
    }
    const before = this.lines.slice(0, this.cursor.line)
    const after = this.lines.slice(this.cursor.line + 1)
    const middle = parts.map((part, index) =>
      index === 0
        ? head + part
        : index === parts.length - 1
          ? part + tail
          : part
    )
    this.lines = [...before, ...middle, ...after]
    this.cursor = {
      line: before.length + parts.length - 1,
      col: characters(parts.at(-1) ?? '').length
    }
  }

  newline(): void {
    this.insert('\n')
  }

  backspace(): void {
    this.pushUndo()
    const line = characters(this.lines[this.cursor.line])
    if (this.cursor.col > 0) {
      this.lines[this.cursor.line] = line
        .slice(0, this.cursor.col - 1)
        .concat(line.slice(this.cursor.col))
        .join('')
      this.cursor.col -= 1
      return
    }
    if (this.cursor.line > 0) {
      const previous = this.lines[this.cursor.line - 1]
      this.lines.splice(this.cursor.line - 1, 2, previous + this.lines[this.cursor.line])
      this.cursor = { line: this.cursor.line - 1, col: characters(previous).length }
    }
  }

  deleteForward(): void {
    this.pushUndo()
    const line = characters(this.lines[this.cursor.line])
    if (this.cursor.col < line.length) {
      this.lines[this.cursor.line] = line
        .slice(0, this.cursor.col)
        .concat(line.slice(this.cursor.col + 1))
        .join('')
      return
    }
    if (this.cursor.line < this.lines.length - 1) {
      this.lines.splice(
        this.cursor.line,
        2,
        this.lines[this.cursor.line] + this.lines[this.cursor.line + 1]
      )
    }
  }

  moveLeft(): void {
    if (this.cursor.col > 0) {
      this.cursor.col -= 1
      return
    }
    if (this.cursor.line > 0) {
      this.cursor.line -= 1
      this.cursor.col = characters(this.lines[this.cursor.line]).length
    }
  }

  moveRight(): void {
    const line = characters(this.lines[this.cursor.line])
    if (this.cursor.col < line.length) {
      this.cursor.col += 1
      return
    }
    if (this.cursor.line < this.lines.length - 1) {
      this.cursor.line += 1
      this.cursor.col = 0
    }
  }

  moveUp(): void {
    if (this.cursor.line > 0) {
      this.cursor.line -= 1
      this.cursor.col = Math.min(
        this.cursor.col,
        characters(this.lines[this.cursor.line]).length
      )
    }
  }

  moveDown(): void {
    if (this.cursor.line < this.lines.length - 1) {
      this.cursor.line += 1
      this.cursor.col = Math.min(
        this.cursor.col,
        characters(this.lines[this.cursor.line]).length
      )
    }
  }

  moveHome(): void {
    this.cursor.col = 0
  }

  moveEnd(): void {
    this.cursor.col = characters(this.lines[this.cursor.line]).length
  }

  undo(): boolean {
    const snapshot = this.undoStack.pop()
    if (!snapshot) return false
    this.lines = snapshot.lines
    this.cursor = snapshot.cursor
    return true
  }

  /** Move one step back in the submitted input history. */
  recallPrevious(): boolean {
    if (this.history.length === 0) return false
    if (this.historyIndex === -1) {
      this.draft = this.text
      this.historyIndex = this.history.length - 1
    } else if (this.historyIndex > 0) {
      this.historyIndex -= 1
    } else {
      return true
    }
    this.setText(this.history[this.historyIndex])
    return true
  }

  /** Move one step forward in the submitted input history. */
  recallNext(): boolean {
    if (this.historyIndex === -1) return false
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1
      this.setText(this.history[this.historyIndex])
      return true
    }
    this.historyIndex = -1
    this.setText(this.draft)
    return true
  }

  /** Remember a submitted input. */
  commit(text: string): void {
    if (!text.trim()) return
    this.history.push(text)
    this.historyIndex = -1
    this.draft = ''
  }

  private pushUndo(): void {
    this.undoStack.push({
      lines: [...this.lines],
      cursor: { ...this.cursor }
    })
    if (this.undoStack.length > 100) this.undoStack.shift()
  }
}
