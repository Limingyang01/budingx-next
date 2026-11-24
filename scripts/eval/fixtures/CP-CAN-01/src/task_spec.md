# 恢复语义

`Run(ctx context.Context, state *State, n int) (int, error)`：

- `state.Done` 记录已经处理过的条目数量。
- 每次运行从 `state.Done` 开始继续，已经处理过的条目不得重复产生副作用。
- 被取消时返回已处理总数和 `ctx.Err()`，并把已处理总数写回 `state.Done`。
- 恢复后再次运行，副作用总次数仍然是一次。
