package task

import (
	"context"
	"errors"
)

type State struct {
	Done int
}

// TODO: 实现可恢复的批处理，见 task_spec.md。
func Run(ctx context.Context, state *State, n int) (int, error) {
	return 0, errors.New("not implemented")
}
