# 任务规格

`func Run(ctx context.Context, n int) (int, error)`：

- 按 0..n-1 顺序处理任务。
- 每处理一个任务前检查一次 `ctx.Done()`。
- 一旦被取消，立刻返回已经处理的数量和 `ctx.Err()`，不得继续处理后续任务。
- 全部处理完返回 n 和 nil。
